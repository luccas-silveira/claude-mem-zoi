/**
 * Plan F.2 (Fase 3) multi-provider parity: compressDigest is now on
 * DeepSeek, Gemini, Ollama, OpenRouter (real single-shot calls) and
 * ClaudeProvider (deliberate ClassifiedProviderError throw because the
 * Agent SDK has no clean single-shot path).
 *
 * Asserts the request-body shape on each provider so the cache-friendly
 * payload (system + user, no session history, low temperature, stream:false
 * where applicable, cache_control on anthropic/* models for OpenRouter) is
 * locked in against future refactors.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { ClaudeProvider } from '../src/services/worker/ClaudeProvider.js';
import { DeepSeekProvider } from '../src/services/worker/DeepSeekProvider.js';
import { GeminiProvider } from '../src/services/worker/GeminiProvider.js';
import { OllamaProvider } from '../src/services/worker/OllamaProvider.js';
import { OpenRouterProvider } from '../src/services/worker/OpenRouterProvider.js';
import { ClassifiedProviderError, isClassified } from '../src/services/worker/provider-errors.js';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

type CapturedRequest = {
  url: string;
  init?: RequestInit;
  body?: unknown;
};

function installFetchSpy(responseJson: unknown): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const original = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : (url as URL).toString();
    let parsed: unknown = undefined;
    const body = init?.body;
    if (typeof body === 'string') {
      try { parsed = JSON.parse(body); } catch { parsed = body; }
    }
    calls.push({ url: urlStr, init, body: parsed });
    return new Response(JSON.stringify(responseJson), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof global.fetch;
  return {
    calls,
    restore: () => { global.fetch = original; },
  };
}

function fakeDbManager(): any {
  return {
    getSessionStore: () => ({}),
    getChromaSync: () => undefined,
  };
}

function fakeSessionManager(): any {
  return {};
}

describe('multi-provider compressDigest — method presence', () => {
  it('DeepSeekProvider.compressDigest is a function', () => {
    const p = new DeepSeekProvider(fakeDbManager(), fakeSessionManager());
    expect(typeof (p as any).compressDigest).toBe('function');
  });

  it('GeminiProvider.compressDigest is a function', () => {
    const p = new GeminiProvider(fakeDbManager(), fakeSessionManager());
    expect(typeof (p as any).compressDigest).toBe('function');
  });

  it('OllamaProvider.compressDigest is a function', () => {
    const p = new OllamaProvider(fakeDbManager(), fakeSessionManager());
    expect(typeof (p as any).compressDigest).toBe('function');
  });

  it('OpenRouterProvider.compressDigest is a function', () => {
    const p = new OpenRouterProvider(fakeDbManager(), fakeSessionManager());
    expect(typeof (p as any).compressDigest).toBe('function');
  });

  it('ClaudeProvider.compressDigest is a function', () => {
    const p = new ClaudeProvider(fakeDbManager(), fakeSessionManager());
    expect(typeof (p as any).compressDigest).toBe('function');
  });
});

describe('DeepSeekProvider.compressDigest — request shape', () => {
  let restoreSettings: () => void;
  let restoreFetch: () => void;
  let captured: CapturedRequest[];

  beforeEach(() => {
    const settingsSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_DEEPSEEK_API_KEY: 'test-ds-key',
      CLAUDE_MEM_DEEPSEEK_MODEL: 'deepseek-v4-flash',
    }));
    restoreSettings = () => settingsSpy.mockRestore();
    const f = installFetchSpy({
      choices: [{ message: { role: 'assistant', content: '<digest></digest>' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    captured = f.calls;
    restoreFetch = f.restore;
  });

  afterEach(() => { restoreFetch(); restoreSettings(); });

  it('posts a single-shot system+user payload with stream:false implicit (no streaming response handler)', async () => {
    const p = new DeepSeekProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    const result = await p.compressDigest('PROMPT_BODY', ac.signal);
    expect(typeof result).toBe('string');
    expect(captured.length).toBe(1);
    const body = captured[0].body as any;
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('PROMPT_BODY');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(2048);
    expect(body.stream).toBe(false);
  });
});

describe('GeminiProvider.compressDigest — request shape', () => {
  let restoreSettings: () => void;
  let restoreFetch: () => void;
  let captured: CapturedRequest[];

  beforeEach(() => {
    const settingsSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_GEMINI_API_KEY: 'test-g-key',
      CLAUDE_MEM_GEMINI_MODEL: 'gemini-2.5-flash-lite',
      // Rate limiting OFF so the test doesn't sleep.
      CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: 'false',
    }));
    restoreSettings = () => settingsSpy.mockRestore();
    const f = installFetchSpy({
      candidates: [{ content: { parts: [{ text: '<digest></digest>' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    captured = f.calls;
    restoreFetch = f.restore;
  });

  afterEach(() => { restoreFetch(); restoreSettings(); });

  it('posts contents=[single user message] + systemInstruction + low temperature', async () => {
    const p = new GeminiProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    const result = await p.compressDigest('GEMINI_PROMPT', ac.signal);
    expect(typeof result).toBe('string');
    expect(captured.length).toBe(1);
    expect(captured[0].url).toContain('generateContent');
    const body = captured[0].body as any;
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.contents.length).toBe(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('GEMINI_PROMPT');
    expect(body.systemInstruction).toBeDefined();
    expect(body.systemInstruction.parts[0].text.length).toBeGreaterThan(0);
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });
});

describe('OllamaProvider.compressDigest — request shape', () => {
  let restoreSettings: () => void;
  let restoreFetch: () => void;
  let captured: CapturedRequest[];

  beforeEach(() => {
    const settingsSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OLLAMA_BASE_URL: 'http://localhost:11434/v1',
      CLAUDE_MEM_OLLAMA_MODEL: 'phi4:14b',
    }));
    restoreSettings = () => settingsSpy.mockRestore();
    const f = installFetchSpy({
      choices: [{ message: { role: 'assistant', content: '<digest></digest>' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    captured = f.calls;
    restoreFetch = f.restore;
  });

  afterEach(() => { restoreFetch(); restoreSettings(); });

  it('posts messages=[system, user] with stream:false and low temperature', async () => {
    const p = new OllamaProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    const result = await p.compressDigest('OLLAMA_PROMPT', ac.signal);
    expect(typeof result).toBe('string');
    expect(captured.length).toBe(1);
    expect(captured[0].url).toContain('/chat/completions');
    const body = captured[0].body as any;
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('OLLAMA_PROMPT');
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('OpenRouterProvider.compressDigest — request shape', () => {
  let restoreFetch: () => void;
  let captured: CapturedRequest[];
  let settingsSpy: ReturnType<typeof spyOn>;

  function setupForModel(model: string) {
    settingsSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: 'test-or-key',
      CLAUDE_MEM_OPENROUTER_MODEL: model,
    }));
  }

  beforeEach(() => {
    const f = installFetchSpy({
      choices: [{ message: { role: 'assistant', content: '<digest></digest>' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    captured = f.calls;
    restoreFetch = f.restore;
  });

  afterEach(() => { restoreFetch(); settingsSpy?.mockRestore(); });

  it('non-Anthropic model: system block is a plain string, stream:false, low temperature', async () => {
    setupForModel('mistralai/mistral-large');
    const p = new OpenRouterProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    const result = await p.compressDigest('OR_PROMPT', ac.signal);
    expect(typeof result).toBe('string');
    expect(captured.length).toBe(1);
    const body = captured[0].body as any;
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe('system');
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toBe('OR_PROMPT');
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(2048);
  });

  it('anthropic/* model: system block is content array with cache_control:{type:"ephemeral"}', async () => {
    setupForModel('anthropic/claude-haiku-4-5');
    const p = new OpenRouterProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    await p.compressDigest('ANTHROPIC_PROMPT', ac.signal);
    expect(captured.length).toBe(1);
    const body = captured[0].body as any;
    const sys = body.messages[0];
    expect(sys.role).toBe('system');
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content[0].type).toBe('text');
    expect(sys.content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(typeof sys.content[0].text).toBe('string');
    expect(sys.content[0].text.length).toBeGreaterThan(0);
    // User turn should NOT have cache_control attached.
    const user = body.messages[1];
    expect(user.role).toBe('user');
    expect(user.content).toBe('ANTHROPIC_PROMPT');
  });
});

describe('ClaudeProvider.compressDigest — deliberate throw', () => {
  it('throws ClassifiedProviderError with kind="unrecoverable"', async () => {
    const p = new ClaudeProvider(fakeDbManager(), fakeSessionManager());
    const ac = new AbortController();
    let caught: unknown;
    try {
      await p.compressDigest('whatever', ac.signal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught instanceof ClassifiedProviderError).toBe(true);
    expect(isClassified(caught)).toBe(true);
    expect((caught as ClassifiedProviderError).kind).toBe('unrecoverable');
    expect((caught as Error).message.toLowerCase()).toContain('claude');
  });
});
