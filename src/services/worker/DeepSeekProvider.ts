
import { buildContinuationUserPrompt, buildInitUserPrompt, buildObservationPrompt, buildSummaryPrompt, buildSystemPrompt } from '../../sdk/prompts.js';
import { getCredential } from '../../shared/EnvManager.js';
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

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

/**
 * Parse Retry-After header (seconds or HTTP-date). Returns ms or undefined.
 */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Classify a DeepSeek fetch failure into ClassifiedProviderError. Called
 * at the boundary right after `fetch()` returns or throws.
 */
export function classifyDeepSeekError(input: {
  status?: number;
  bodyText?: string;
  headers?: Headers | { get(name: string): string | null };
  cause: unknown;
  requestId?: string;
}): ClassifiedProviderError {
  const status = input.status;
  const body = input.bodyText ?? '';
  const lower = body.toLowerCase();
  const headers = input.headers;
  const retryAfterMs = headers ? parseRetryAfterMs(headers.get('retry-after')) : undefined;

  // Quota / insufficient credits — body marker takes precedence over status.
  if (
    lower.includes('quota exceeded') ||
    lower.includes('insufficient credits') ||
    lower.includes('insufficient_quota') ||
    lower.includes('insufficient balance')
  ) {
    return new ClassifiedProviderError(
      `DeepSeek quota exhausted${status !== undefined ? ` (status ${status})` : ''}`,
      { kind: 'quota_exhausted', cause: input.cause },
    );
  }

  if (status === 429) {
    return new ClassifiedProviderError(
      'DeepSeek rate limit (429)',
      { kind: 'rate_limit', cause: input.cause, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
    );
  }

  if (status === 401 || status === 403) {
    return new ClassifiedProviderError(
      `DeepSeek auth error (status ${status})`,
      { kind: 'auth_invalid', cause: input.cause },
    );
  }

  if (status === 400 || status === 404) {
    return new ClassifiedProviderError(
      `DeepSeek bad request (status ${status})`,
      { kind: 'unrecoverable', cause: input.cause },
    );
  }

  if (status !== undefined && status >= 500 && status < 600) {
    return new ClassifiedProviderError(
      `DeepSeek upstream error (status ${status})`,
      { kind: 'transient', cause: input.cause },
    );
  }

  // Network errors (no status) — treat as transient.
  if (status === undefined) {
    return new ClassifiedProviderError(
      `DeepSeek network error: ${input.cause instanceof Error ? input.cause.message : String(input.cause)}`,
      { kind: 'transient', cause: input.cause },
    );
  }

  return new ClassifiedProviderError(
    `DeepSeek API error: ${status}${body ? ` - ${body.substring(0, 200)}` : ''}`,
    { kind: 'unrecoverable', cause: input.cause },
  );
}

const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_MAX_ESTIMATED_TOKENS = 100000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    // DeepSeek context-cache hit accounting. Present when the request's
    // stable prefix matched the upstream cache. Cache hit tokens are billed
    // at ~10% of the miss rate.
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export class DeepSeekProvider {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    const { apiKey, model, baseUrl } = this.getDeepSeekConfig();

    if (!apiKey) {
      throw new Error('DeepSeek API key not configured. Set CLAUDE_MEM_DEEPSEEK_API_KEY in settings or DEEPSEEK_API_KEY environment variable.');
    }

    if (!session.memorySessionId) {
      const syntheticMemorySessionId = `deepseek-${session.contentSessionId}-${Date.now()}`;
      session.memorySessionId = syntheticMemorySessionId;
      this.dbManager.getSessionStore().updateMemorySessionId(session.sessionDbId, syntheticMemorySessionId);
      logger.info('SESSION', `MEMORY_ID_GENERATED | sessionDbId=${session.sessionDbId} | provider=DeepSeek`);
    }

    const mode = ModeManager.getInstance().getActiveMode();

    // Stable observer instructions live in `session.systemPrompt` so they
    // can be cached across every turn (Fase 2 split). DeepSeek's free
    // implicit cache fires whenever the prefix bytes are identical, so the
    // gain is automatic once the system message stays put.
    if (!session.systemPrompt) {
      session.systemPrompt = buildSystemPrompt(mode);
    }
    const initPrompt = session.lastPromptNumber === 1
      ? buildInitUserPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
      : buildContinuationUserPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

    session.conversationHistory.push({ role: 'user', content: initPrompt });

    try {
      const initResponse = await this.queryDeepSeekMultiTurn(session.conversationHistory, apiKey, model, baseUrl, { systemPrompt: session.systemPrompt });
      await this.handleInitResponse(initResponse, session, worker, model);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('SDK', 'DeepSeek init failed', { sessionId: session.sessionDbId, model }, error);
      } else {
        logger.error('SDK', 'DeepSeek init failed with non-Error', { sessionId: session.sessionDbId, model }, new Error(String(error)));
      }
      await this.handleSessionError(error, session, worker);
      return;
    }

    let lastCwd: string | undefined;

    try {
      for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
        lastCwd = await this.processOneMessage(session, message, lastCwd, apiKey, model, baseUrl, worker, mode);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('SDK', 'DeepSeek message processing failed', { sessionId: session.sessionDbId, model }, error);
      } else {
        logger.error('SDK', 'DeepSeek message processing failed with non-Error', { sessionId: session.sessionDbId, model }, new Error(String(error)));
      }
      await this.handleSessionError(error, session, worker);
      return;
    }

    const sessionDuration = Date.now() - session.startTime;
    logger.success('SDK', 'DeepSeek agent completed', {
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
        worker, tokensUsed, null, 'DeepSeek', undefined, model
      );
    } else {
      logger.error('SDK', 'Empty DeepSeek init response - session may lack context', {
        sessionId: session.sessionDbId, model
      });
    }
  }

  private async processOneMessage(
    session: ActiveSession,
    message: { _persistentId: number; agentId?: string | null; agentType?: string | null; type: 'observation' | 'summarize'; cwd?: string; prompt_number?: number; tool_name?: string; tool_input?: unknown; tool_response?: unknown; last_assistant_message?: string },
    lastCwd: string | undefined,
    apiKey: string,
    model: string,
    baseUrl: string,
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
        apiKey, model, baseUrl, worker, mode
      );
    } else if (message.type === 'summarize') {
      await this.processSummaryMessage(
        session, message, originalTimestamp, lastCwd,
        apiKey, model, baseUrl, worker, mode
      );
    }

    return lastCwd;
  }

  private async processObservationMessage(
    session: ActiveSession,
    message: { prompt_number?: number; tool_name?: string; tool_input?: unknown; tool_response?: unknown; cwd?: string },
    originalTimestamp: number | null,
    lastCwd: string | undefined,
    apiKey: string,
    model: string,
    baseUrl: string,
    worker: WorkerRef | undefined,
    _mode: ModeConfig
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
    const obsResponse = await this.queryDeepSeekMultiTurn(session.conversationHistory, apiKey, model, baseUrl, { systemPrompt: session.systemPrompt });

    let tokensUsed = 0;
    if (obsResponse.content) {
      session.conversationHistory.push({ role: 'assistant', content: obsResponse.content });
      tokensUsed = obsResponse.tokensUsed || 0;
      session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
      session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
    }

    await processAgentResponse(
      obsResponse.content || '', session, this.dbManager, this.sessionManager,
      worker, tokensUsed, originalTimestamp, 'DeepSeek', lastCwd, model
    );
  }

  private async processSummaryMessage(
    session: ActiveSession,
    message: { last_assistant_message?: string },
    originalTimestamp: number | null,
    lastCwd: string | undefined,
    apiKey: string,
    model: string,
    baseUrl: string,
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
    // Summary is end-of-session, low volume, high value — enable thinking mode
    // for Pro-tier coherence on Flash pricing.
    const summaryResponse = await this.queryDeepSeekMultiTurn(session.conversationHistory, apiKey, model, baseUrl, { useThinking: true, systemPrompt: session.systemPrompt });

    let tokensUsed = 0;
    if (summaryResponse.content) {
      session.conversationHistory.push({ role: 'assistant', content: summaryResponse.content });
      tokensUsed = summaryResponse.tokensUsed || 0;
      session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
      session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
    }

    await processAgentResponse(
      summaryResponse.content || '', session, this.dbManager, this.sessionManager,
      worker, tokensUsed, originalTimestamp, 'DeepSeek', lastCwd, model
    );
  }

  private async handleSessionError(error: unknown, session: ActiveSession, _worker?: WorkerRef): Promise<never> {
    if (isAbortError(error)) {
      logger.warn('SDK', 'DeepSeek agent aborted', { sessionId: session.sessionDbId });
      throw error;
    }

    logger.failure('SDK', 'DeepSeek agent error', { sessionDbId: session.sessionDbId }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  private truncateHistory(history: ConversationMessage[], systemPrompt?: string): ConversationMessage[] {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const MAX_CONTEXT_MESSAGES = parseInt(settings.CLAUDE_MEM_DEEPSEEK_MAX_CONTEXT_MESSAGES) || DEFAULT_MAX_CONTEXT_MESSAGES;
    const RAW_MAX_ESTIMATED_TOKENS = parseInt(settings.CLAUDE_MEM_DEEPSEEK_MAX_TOKENS) || DEFAULT_MAX_ESTIMATED_TOKENS;
    const systemTokens = systemPrompt ? this.estimateTokens(systemPrompt) : 0;
    const MAX_ESTIMATED_TOKENS = Math.max(1, RAW_MAX_ESTIMATED_TOKENS - systemTokens);

    if (history.length <= MAX_CONTEXT_MESSAGES) {
      const totalTokens = history.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
      if (totalTokens <= MAX_ESTIMATED_TOKENS) {
        return history;
      }
    }

    const truncated: ConversationMessage[] = [];
    let tokenCount = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (truncated.length >= MAX_CONTEXT_MESSAGES || tokenCount + msgTokens > MAX_ESTIMATED_TOKENS) {
        logger.warn('SDK', 'Context window truncated to prevent runaway costs', {
          originalMessages: history.length,
          keptMessages: truncated.length,
          droppedMessages: i + 1,
          estimatedTokens: tokenCount,
          tokenLimit: MAX_ESTIMATED_TOKENS
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

  private async queryDeepSeekMultiTurn(
    history: ConversationMessage[],
    apiKey: string,
    model: string,
    baseUrl: string,
    options: { useThinking?: boolean; systemPrompt?: string } = {}
  ): Promise<{ content: string; tokensUsed?: number }> {
    const useThinking = options.useThinking === true;
    const truncatedHistory = this.truncateHistory(history, options.systemPrompt);
    const messages = this.conversationToOpenAIMessages(truncatedHistory, options.systemPrompt);
    const totalChars = truncatedHistory.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = this.estimateTokens(truncatedHistory.map(m => m.content).join(''));

    logger.debug('SDK', `Querying DeepSeek multi-turn (${model})`, {
      turns: truncatedHistory.length,
      totalChars,
      estimatedTokens
    });

    const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    let priorRequestId: string | null = null;

    const data = await withRetry<DeepSeekResponse>(async (attemptSignal) => {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(priorRequestId ? { 'x-claude-mem-prior-request-id': priorRequestId } : {}),
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3,
            // Thinking-on uses output tokens for reasoning before content;
            // bump max_tokens so content isn't truncated by reasoning budget.
            max_tokens: useThinking ? 16384 : 4096,
            thinking: useThinking ? { type: 'enabled' } : { type: 'disabled' },
          }),
          signal: attemptSignal,
        });
      } catch (networkError: unknown) {
        throw classifyDeepSeekError({ cause: networkError });
      }

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-deepseek-request-id');
      if (requestId) {
        priorRequestId = requestId;
      } else {
        logger.debug('SDK', 'DeepSeek response missing request-id header; retry dedup is best-effort');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw classifyDeepSeekError({
          status: response.status,
          bodyText: errorText,
          headers: response.headers,
          cause: new Error(`DeepSeek API error: ${response.status} - ${errorText}`),
          ...(requestId ? { requestId } : {}),
        });
      }

      const responseData = await response.json() as DeepSeekResponse;

      if (responseData.error) {
        // Errors can come in 200 responses too.
        throw classifyDeepSeekError({
          status: response.status,
          bodyText: `${responseData.error.code} ${responseData.error.message ?? ''}`,
          headers: response.headers,
          cause: new Error(`DeepSeek API error: ${responseData.error.code} - ${responseData.error.message}`),
        });
      }

      return responseData;
    }, { label: `DeepSeek ${model}`, perAttemptTimeoutMs: 90_000 });

    if (!data.choices?.[0]?.message?.content) {
      logger.error('SDK', 'Empty response from DeepSeek');
      return { content: '' };
    }

    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens;

    if (tokensUsed) {
      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      const cacheHitTokens = data.usage?.prompt_cache_hit_tokens || 0;
      const cacheMissTokens = data.usage?.prompt_cache_miss_tokens || (inputTokens - cacheHitTokens);
      // DeepSeek pricing (deepseek-v4-flash, USD per 1M tokens, off-peak rates).
      // Cache-hit input is billed at ~10% of miss rate.
      const estimatedCost = (cacheMissTokens / 1_000_000 * 0.27) + (cacheHitTokens / 1_000_000 * 0.027) + (outputTokens / 1_000_000 * 1.10);
      const cacheHitRate = inputTokens > 0 ? Math.round((cacheHitTokens / inputTokens) * 100) : 0;

      logger.info('SDK', 'DeepSeek API usage', {
        model,
        inputTokens,
        outputTokens,
        cacheHitTokens,
        cacheMissTokens,
        cacheHitRate: `${cacheHitRate}%`,
        totalTokens: tokensUsed,
        estimatedCostUSD: estimatedCost.toFixed(4),
        messagesInContext: truncatedHistory.length
      });

      // DeepSeek pricing ~12x cheaper than Claude; bump warn threshold accordingly
      // to avoid alarmism when 60k-token calls cost ~$0.02.
      if (tokensUsed > 200000) {
        logger.warn('SDK', 'High token usage detected - consider reducing context', {
          totalTokens: tokensUsed,
          estimatedCost: estimatedCost.toFixed(4)
        });
      }
    }

    return { content, tokensUsed };
  }

  /**
   * Plan F.2 (Fase 3): Single-shot non-streaming digest compression call.
   *
   * Does NOT touch session state, conversation history, or DB. The DigestGenerator
   * calls this from the background job. The caller-provided AbortSignal is wired
   * through to withRetry so worker shutdown cancels in-flight requests.
   *
   * Throws on quota/auth/network failure. Caller (DigestGenerator) catches per-period.
   *
   * Patterns copied from queryDeepSeekMultiTurn — auth header, endpoint URL,
   * error parsing via classifyDeepSeekError, withRetry harness.
   */
  async compressDigest(prompt: string, signal: AbortSignal): Promise<string> {
    const { apiKey, model, baseUrl } = this.getDeepSeekConfig();
    if (!apiKey) {
      throw new Error('DeepSeek API key not configured. Set CLAUDE_MEM_DEEPSEEK_API_KEY in settings or DEEPSEEK_API_KEY environment variable.');
    }

    if (signal.aborted) {
      throw new Error('Digest compression aborted before request');
    }

    // Lazy import so this module's import graph stays unchanged for non-digest paths.
    const { DIGEST_SYSTEM_PROMPT } = await import('../../sdk/prompts.js');
    const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    let priorRequestId: string | null = null;

    logger.debug('SDK', `Querying DeepSeek single-shot (digest, ${model})`, {
      promptChars: prompt.length,
    });

    const data = await withRetry<DeepSeekResponse>(async (attemptSignal) => {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(priorRequestId ? { 'x-claude-mem-prior-request-id': priorRequestId } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: DIGEST_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2048,
            stream: false,
            thinking: { type: 'disabled' },
          }),
          signal: attemptSignal,
        });
      } catch (networkError: unknown) {
        throw classifyDeepSeekError({ cause: networkError });
      }

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-deepseek-request-id');
      if (requestId) priorRequestId = requestId;

      if (!response.ok) {
        const errorText = await response.text();
        throw classifyDeepSeekError({
          status: response.status,
          bodyText: errorText,
          headers: response.headers,
          cause: new Error(`DeepSeek API error: ${response.status} - ${errorText}`),
          ...(requestId ? { requestId } : {}),
        });
      }

      const responseData = await response.json() as DeepSeekResponse;
      if (responseData.error) {
        throw classifyDeepSeekError({
          status: response.status,
          bodyText: `${responseData.error.code} ${responseData.error.message ?? ''}`,
          headers: response.headers,
          cause: new Error(`DeepSeek API error: ${responseData.error.code} - ${responseData.error.message}`),
        });
      }

      return responseData;
    }, { label: `DeepSeek digest ${model}`, perAttemptTimeoutMs: 60_000, abortSignal: signal });

    const content = data.choices?.[0]?.message?.content ?? '';
    return content;
  }

  private getDeepSeekConfig(): { apiKey: string; model: string; baseUrl: string } {
    const settingsPath = USER_SETTINGS_PATH;
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

    const apiKey = settings.CLAUDE_MEM_DEEPSEEK_API_KEY || getCredential('DEEPSEEK_API_KEY') || '';
    const model = settings.CLAUDE_MEM_DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
    const baseUrl = settings.CLAUDE_MEM_DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;

    return { apiKey, model, baseUrl };
  }
}

export function isDeepSeekAvailable(): boolean {
  const settingsPath = USER_SETTINGS_PATH;
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  return !!(settings.CLAUDE_MEM_DEEPSEEK_API_KEY || getCredential('DEEPSEEK_API_KEY'));
}

export function isDeepSeekSelected(): boolean {
  const settingsPath = USER_SETTINGS_PATH;
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  return settings.CLAUDE_MEM_PROVIDER === 'deepseek';
}
