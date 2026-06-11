import { buildContinuationUserPrompt, buildInitUserPrompt, buildObservationPrompt, buildSummaryPrompt, buildSystemPrompt } from '../../sdk/prompts.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { ModeManager } from '../domain/ModeManager.js';
import type { ModeConfig } from '../domain/types.js';
import type { ActiveSession, ConversationMessage } from '../worker-types.js';
import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import {
  isAbortError,
  processAgentResponse,
  type WorkerRef
} from './agents/index.js';
import { ClassifiedProviderError } from './provider-errors.js';
import { withRetry } from './retry.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_OLLAMA_MODEL = 'phi4:14b';
const DEFAULT_OLLAMA_NUM_CTX = 32768;
const RESPONSE_TOKEN_RESERVE = 2048;
const CHARS_PER_TOKEN_ESTIMATE = 4;

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

interface OllamaConfig {
  baseUrl: string;
  model: string;
  numCtx: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function getNestedErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') return maybeCode;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) return getNestedErrorCode(cause);
  return '';
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && (error.name === 'AbortError' || /timeout/i.test(error.message))) {
    return true;
  }
  const cause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  return cause ? isTimeoutError(cause) : false;
}

export function classifyOllamaError(input: {
  status?: number;
  bodyText?: string;
  cause: unknown;
  model?: string;
}): ClassifiedProviderError {
  const status = input.status;
  const body = input.bodyText ?? '';
  const lower = body.toLowerCase();
  const code = getNestedErrorCode(input.cause);
  const causeMessage = input.cause instanceof Error ? input.cause.message : String(input.cause);
  const model = input.model ?? getOllamaConfig().model;

  if (
    code === 'ECONNREFUSED' ||
    /econnrefused/i.test(causeMessage) ||
    /fetch failed/i.test(causeMessage)
  ) {
    return new ClassifiedProviderError(
      'Ollama não está rodando. Execute `ollama serve`.',
      { kind: 'unrecoverable', cause: input.cause },
    );
  }

  if (status === 404 || (lower.includes('model') && lower.includes('not found'))) {
    return new ClassifiedProviderError(
      `Modelo \`${model}\` não encontrado. Execute \`ollama pull ${model}\`.`,
      { kind: 'unrecoverable', cause: input.cause },
    );
  }

  if (status === 500 || status === 503) {
    return new ClassifiedProviderError(
      'Ollama indisponível temporariamente. Retentando.',
      { kind: 'transient', cause: input.cause },
    );
  }

  if (isTimeoutError(input.cause)) {
    return new ClassifiedProviderError(
      'Timeout ao consultar Ollama. Retentando.',
      { kind: 'transient', cause: input.cause },
    );
  }

  return new ClassifiedProviderError(
    `Erro desconhecido do Ollama: \`${status ?? 'sem status'}\`.`,
    { kind: 'unknown', cause: input.cause },
  );
}

export class OllamaProvider {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    const { baseUrl, model, numCtx } = getOllamaConfig();

    if (!session.memorySessionId) {
      const syntheticMemorySessionId = `ollama-${session.contentSessionId}-${Date.now()}`;
      session.memorySessionId = syntheticMemorySessionId;
      this.dbManager.getSessionStore().updateMemorySessionId(session.sessionDbId, syntheticMemorySessionId);
      logger.info('SESSION', `MEMORY_ID_GENERATED | sessionDbId=${session.sessionDbId} | provider=Ollama`);
    }

    const mode = ModeManager.getInstance().getActiveMode();

    // Stable observer instructions live in `session.systemPrompt` so they
    // can be cached across every turn (Fase 2 split). User message keeps
    // only the per-turn dynamic content.
    if (!session.systemPrompt) {
      session.systemPrompt = buildSystemPrompt(mode);
    }
    const initPrompt = session.lastPromptNumber === 1
      ? buildInitUserPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
      : buildContinuationUserPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

    session.conversationHistory.push({ role: 'user', content: initPrompt });

    try {
      const initResponse = await this.queryOllamaMultiTurn(session.conversationHistory, { baseUrl, model, numCtx }, worker, session.systemPrompt);
      await this.handleInitResponse(initResponse, session, worker, model);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('SDK', 'Ollama init failed', { sessionId: session.sessionDbId, model }, error);
      } else {
        logger.error('SDK', 'Ollama init failed with non-Error', { sessionId: session.sessionDbId, model }, new Error(String(error)));
      }
      await this.handleSessionError(error, session, worker);
      return;
    }

    let lastCwd: string | undefined;

    try {
      for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
        lastCwd = await this.processOneMessage(session, message, lastCwd, { baseUrl, model, numCtx }, worker, mode);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('SDK', 'Ollama message processing failed', { sessionId: session.sessionDbId, model }, error);
      } else {
        logger.error('SDK', 'Ollama message processing failed with non-Error', { sessionId: session.sessionDbId, model }, new Error(String(error)));
      }
      await this.handleSessionError(error, session, worker);
      return;
    }

    const sessionDuration = Date.now() - session.startTime;
    logger.success('SDK', 'Ollama agent completed', {
      sessionId: session.sessionDbId,
      duration: `${(sessionDuration / 1000).toFixed(1)}s`,
      historyLength: session.conversationHistory.length,
      model
    });
  }

  private prepareMessageMetadata(session: ActiveSession, message: { agentId?: string | null; agentType?: string | null }): void {
    session.pendingAgentId = message.agentId ?? null;
    session.pendingAgentType = message.agentType ?? null;
  }

  private async handleInitResponse(
    initResponse: { content: string; tokensUsed?: number },
    session: ActiveSession,
    worker: WorkerRef | undefined,
    model: string
  ): Promise<void> {
    if (initResponse.content) {
      session.conversationHistory.push({ role: 'assistant', content: initResponse.content });
      const tokensUsed = initResponse.tokensUsed || 0;
      session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
      session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);

      await processAgentResponse(
        initResponse.content, session, this.dbManager, this.sessionManager,
        worker, tokensUsed, null, 'Ollama', undefined, model
      );
    } else {
      logger.error('SDK', 'Empty Ollama init response - session may lack context', {
        sessionId: session.sessionDbId, model
      });
    }
  }

  private async processOneMessage(
    session: ActiveSession,
    message: { _persistentId: number; agentId?: string | null; agentType?: string | null; type: 'observation' | 'summarize'; cwd?: string; prompt_number?: number; tool_name?: string; tool_input?: unknown; tool_response?: unknown; last_assistant_message?: string },
    lastCwd: string | undefined,
    config: OllamaConfig,
    worker: WorkerRef | undefined,
    mode: ModeConfig
  ): Promise<string | undefined> {
    this.prepareMessageMetadata(session, message);

    if (message.cwd) {
      lastCwd = message.cwd;
    }
    const originalTimestamp = session.earliestPendingTimestamp;

    if (message.type === 'observation') {
      await this.processObservationMessage(
        session, message, originalTimestamp, lastCwd,
        config, worker
      );
    } else if (message.type === 'summarize') {
      await this.processSummaryMessage(
        session, message, originalTimestamp, lastCwd,
        config, worker, mode
      );
    }

    return lastCwd;
  }

  private async processObservationMessage(
    session: ActiveSession,
    message: { prompt_number?: number; tool_name?: string; tool_input?: unknown; tool_response?: unknown; cwd?: string },
    originalTimestamp: number | null,
    lastCwd: string | undefined,
    config: OllamaConfig,
    worker: WorkerRef | undefined
  ): Promise<void> {
    if (message.prompt_number !== undefined) {
      session.lastPromptNumber = message.prompt_number;
    }

    if (!session.memorySessionId) {
      throw new Error('Cannot process observations: memorySessionId not yet captured. This session may need to be reinitialized.');
    }

    const obsPrompt = buildObservationPrompt({
      id: 0,
      tool_name: message.tool_name!,
      tool_input: JSON.stringify(message.tool_input),
      tool_output: JSON.stringify(message.tool_response),
      created_at_epoch: originalTimestamp ?? Date.now(),
      cwd: message.cwd
    });

    session.conversationHistory.push({ role: 'user', content: obsPrompt });
    const obsResponse = await this.queryOllamaMultiTurn(session.conversationHistory, config, worker, session.systemPrompt);

    let tokensUsed = 0;
    if (obsResponse.content) {
      session.conversationHistory.push({ role: 'assistant', content: obsResponse.content });
      tokensUsed = obsResponse.tokensUsed || 0;
      session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
      session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
    }

    await processAgentResponse(
      obsResponse.content || '', session, this.dbManager, this.sessionManager,
      worker, tokensUsed, originalTimestamp, 'Ollama', lastCwd, config.model
    );
  }

  private async processSummaryMessage(
    session: ActiveSession,
    message: { last_assistant_message?: string },
    originalTimestamp: number | null,
    lastCwd: string | undefined,
    config: OllamaConfig,
    worker: WorkerRef | undefined,
    mode: ModeConfig
  ): Promise<void> {
    if (!session.memorySessionId) {
      throw new Error('Cannot process summary: memorySessionId not yet captured. This session may need to be reinitialized.');
    }

    const summaryPrompt = buildSummaryPrompt({
      id: session.sessionDbId,
      memory_session_id: session.memorySessionId,
      project: session.project,
      user_prompt: session.userPrompt,
      last_assistant_message: message.last_assistant_message || ''
    }, mode);

    session.conversationHistory.push({ role: 'user', content: summaryPrompt });
    const summaryResponse = await this.queryOllamaMultiTurn(session.conversationHistory, config, worker, session.systemPrompt);

    let tokensUsed = 0;
    if (summaryResponse.content) {
      session.conversationHistory.push({ role: 'assistant', content: summaryResponse.content });
      tokensUsed = summaryResponse.tokensUsed || 0;
      session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
      session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
    }

    await processAgentResponse(
      summaryResponse.content || '', session, this.dbManager, this.sessionManager,
      worker, tokensUsed, originalTimestamp, 'Ollama', lastCwd, config.model
    );
  }

  private async handleSessionError(error: unknown, session: ActiveSession, _worker?: WorkerRef): Promise<never> {
    if (isAbortError(error)) {
      logger.warn('SDK', 'Ollama agent aborted', { sessionId: session.sessionDbId });
      throw error;
    }

    logger.failure('SDK', 'Ollama agent error', { sessionDbId: session.sessionDbId }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  private truncateHistory(
    history: ConversationMessage[],
    numCtx: number,
    systemPrompt?: string
  ): ConversationMessage[] {
    const systemTokens = systemPrompt ? this.estimateTokens(systemPrompt) : 0;
    const maxEstimatedTokens = Math.max(1, numCtx - RESPONSE_TOKEN_RESERVE - systemTokens);

    const totalTokens = history.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    if (totalTokens <= maxEstimatedTokens) {
      return history;
    }

    const truncated: ConversationMessage[] = [];
    let tokenCount = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (tokenCount + msgTokens > maxEstimatedTokens) {
        logger.warn('SDK', 'Ollama context window truncated', {
          originalMessages: history.length,
          keptMessages: truncated.length,
          droppedMessages: i + 1,
          estimatedTokens: tokenCount,
          tokenLimit: maxEstimatedTokens
        });
        break;
      }

      truncated.unshift(msg);
      tokenCount += msgTokens;
    }

    return truncated;
  }

  private conversationToOpenAIMessages(history: ConversationMessage[], systemPrompt?: string): OpenAIMessage[] {
    const mapped: OpenAIMessage[] = history.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));
    if (systemPrompt && systemPrompt.length > 0) {
      return [{ role: 'system', content: systemPrompt }, ...mapped];
    }
    return mapped;
  }

  private disableThinking(messages: OpenAIMessage[], model: string): OpenAIMessage[] {
    if (!/qwen3|deepseek-r1|reasoning/i.test(model)) return messages;
    if (messages.length === 0) return messages;
    const last = messages[messages.length - 1];
    if (last.role !== 'user' || /\/no_think/.test(last.content)) return messages;
    return [
      ...messages.slice(0, -1),
      { ...last, content: `${last.content}\n\n/no_think` },
    ];
  }

  private shouldForceJson(messages: OpenAIMessage[]): boolean {
    const latestUserMessage = [...messages].reverse().find(message => message.role === 'user');
    return /\bjson\b|json_object|response_format/i.test(latestUserMessage?.content ?? '');
  }

  private async queryOllamaMultiTurn(
    history: ConversationMessage[],
    config: OllamaConfig,
    worker?: WorkerRef,
    systemPrompt?: string
  ): Promise<{ content: string; tokensUsed?: number }> {
    const truncatedHistory = this.truncateHistory(history, config.numCtx, systemPrompt);
    const messages = this.conversationToOpenAIMessages(truncatedHistory, systemPrompt);
    const totalChars = truncatedHistory.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = this.estimateTokens(truncatedHistory.map(m => m.content).join(''));
    const forceJson = this.shouldForceJson(messages);

    logger.debug('SDK', `Querying Ollama multi-turn (${config.model})`, {
      turns: truncatedHistory.length,
      totalChars,
      estimatedTokens,
      numCtx: config.numCtx,
      forceJson
    });

    const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;

    const data = await withRetry<{ content: string; tokensUsed?: number }>(async (attemptSignal) => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: this.disableThinking(messages, config.model),
            stream: true,
            temperature: 0.3,
            max_tokens: 4096,
            options: {
              num_ctx: config.numCtx,
            },
            ...(forceJson ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: attemptSignal,
        });
      } catch (networkError: unknown) {
        throw classifyOllamaError({ cause: networkError, model: config.model });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw classifyOllamaError({
          status: response.status,
          bodyText: errorText,
          cause: new Error(`Ollama API error: ${response.status} - ${errorText}`),
          model: config.model,
        });
      }

      return this.readStreamingResponse(response, config.model, worker);
    }, { label: `Ollama ${config.model}`, perAttemptTimeoutMs: 300_000 });

    if (!data.content) {
      logger.error('SDK', 'Empty response from Ollama');
      return { content: '' };
    }

    return data;
  }

  /**
   * Plan F.2 (Fase 3) — multi-provider parity: single-shot non-streaming digest
   * compression call. Mirrors DeepSeekProvider.compressDigest in shape but
   * targets Ollama's OpenAI-compatible /chat/completions endpoint. `stream:false`
   * because we want one parseable JSON envelope, not SSE chunks.
   *
   * No session state, no DB writes, signal-aware. Caller (DigestGenerator) is
   * responsible for per-period failure handling.
   */
  async compressDigest(prompt: string, signal: AbortSignal): Promise<string> {
    const config = getOllamaConfig();

    if (signal.aborted) {
      throw new Error('Digest compression aborted before request');
    }

    // Lazy import so this module's import graph stays unchanged for non-digest paths.
    const { DIGEST_SYSTEM_PROMPT } = await import('../../sdk/prompts.js');

    const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
    const messages: OpenAIMessage[] = [
      { role: 'system', content: DIGEST_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    logger.debug('SDK', `Querying Ollama single-shot (digest, ${config.model})`, {
      promptChars: prompt.length,
    });

    const data = await withRetry<{ content: string }>(async (attemptSignal) => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: this.disableThinking(messages, config.model),
            stream: false,
            temperature: 0.2,
            max_tokens: 2048,
            options: {
              num_ctx: config.numCtx,
            },
          }),
          signal: attemptSignal,
        });
      } catch (networkError: unknown) {
        throw classifyOllamaError({ cause: networkError, model: config.model });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw classifyOllamaError({
          status: response.status,
          bodyText: errorText,
          cause: new Error(`Ollama API error: ${response.status} - ${errorText}`),
          model: config.model,
        });
      }

      const json = await response.json() as OllamaStreamChunk;
      if (json.error) {
        throw classifyOllamaError({
          bodyText: `${json.error.code ?? ''} ${json.error.message ?? ''}`,
          cause: new Error(`Ollama API error: ${json.error.code ?? 'unknown'} - ${json.error.message ?? ''}`),
          model: config.model,
        });
      }
      const content = json.choices?.[0]?.message?.content ?? '';
      return { content };
    }, { label: `Ollama digest ${config.model}`, perAttemptTimeoutMs: 300_000, abortSignal: signal });

    return data.content;
  }

  private async readStreamingResponse(
    response: Response,
    model: string,
    worker?: WorkerRef
  ): Promise<{ content: string; tokensUsed?: number }> {
    if (!response.body) {
      return { content: '' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let tokensUsed: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk: OllamaStreamChunk;
        try {
          chunk = JSON.parse(payload) as OllamaStreamChunk;
        } catch (error: unknown) {
          logger.debug('SDK', 'Skipping malformed Ollama stream chunk', {
            payload: payload.substring(0, 200)
          }, error instanceof Error ? error : new Error(String(error)));
          continue;
        }

        if (chunk.error) {
          throw classifyOllamaError({
            bodyText: `${chunk.error.code ?? ''} ${chunk.error.message ?? ''}`,
            cause: new Error(`Ollama API error: ${chunk.error.code ?? 'unknown'} - ${chunk.error.message ?? ''}`),
            model,
          });
        }

        const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
        if (delta) {
          content += delta;
          worker?.sseBroadcaster?.broadcast({
            type: 'llm_stream_delta',
            provider: 'ollama',
            model,
            content: delta
          });
        }

        if (chunk.usage?.total_tokens) {
          tokensUsed = chunk.usage.total_tokens;
        }
      }
    }

    if (buffer.trim().length > 0) {
      const payload = buffer.trim().startsWith('data:')
        ? buffer.trim().slice(5).trim()
        : buffer.trim();
      if (payload && payload !== '[DONE]') {
        try {
          const chunk = JSON.parse(payload) as OllamaStreamChunk;
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
          if (delta) content += delta;
          if (chunk.usage?.total_tokens) tokensUsed = chunk.usage.total_tokens;
        } catch {
          // Ignore trailing partial chunks.
        }
      }
    }

    return { content, tokensUsed };
  }
}

function getOllamaConfig(): OllamaConfig {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

  const baseUrl = settings.CLAUDE_MEM_OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const model = settings.CLAUDE_MEM_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const parsedNumCtx = parseInt(settings.CLAUDE_MEM_OLLAMA_NUM_CTX || String(DEFAULT_OLLAMA_NUM_CTX), 10);
  const numCtx = Number.isFinite(parsedNumCtx) && parsedNumCtx > RESPONSE_TOKEN_RESERVE
    ? parsedNumCtx
    : DEFAULT_OLLAMA_NUM_CTX;

  return { baseUrl, model, numCtx };
}

export function isOllamaAvailable(): boolean {
  const { baseUrl, model } = getOllamaConfig();
  return baseUrl.trim().length > 0 && model.trim().length > 0;
}

export function isOllamaSelected(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  return settings.CLAUDE_MEM_PROVIDER === 'ollama';
}
