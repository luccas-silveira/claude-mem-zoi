/**
 * Plan F.6: digest LLM cost must be distinguishable from session LLM cost.
 *
 * Both code paths in DeepSeekProvider write the same `DeepSeek API usage` log
 * line; we tag them with a `kind` field so `scripts/inspect-cache-savings.ts`
 * (and any future analytics) can roll them up separately.
 *
 *   queryDeepSeekMultiTurn → kind: 'session'   (per-turn agent loop)
 *   compressDigest         → kind: 'digest'    (background hierarchical compression)
 *
 * Legacy log lines without `kind` default to `session` so historical data
 * keeps making sense. The parser test pins that legacy contract.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { DeepSeekProvider } from '../src/services/worker/DeepSeekProvider';
import { DatabaseManager } from '../src/services/worker/DatabaseManager';
import { SessionManager } from '../src/services/worker/SessionManager';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager';
import { logger } from '../src/utils/logger';
import { parseDeepSeekUsageLine } from '../scripts/inspect-cache-savings';

const USAGE_PAYLOAD = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: 1000,
};

function mockJsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('digest cost log isolation', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof global.fetch;
  let loadFromFileSpy: ReturnType<typeof spyOn>;
  let loggerInfoSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_DEEPSEEK_API_KEY: 'test-key',
      CLAUDE_MEM_DEEPSEEK_MODEL: 'deepseek-v4-flash',
      CLAUDE_MEM_DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    loggerInfoSpy = spyOn(logger, 'info');

    // The provider only touches dbManager / sessionManager in startSession;
    // queryDeepSeekMultiTurn and compressDigest don't, so empty stubs suffice.
    const dbManager = {} as unknown as DatabaseManager;
    const sessionManager = {} as unknown as SessionManager;
    provider = new DeepSeekProvider(dbManager, sessionManager);

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    loadFromFileSpy?.mockRestore();
    loggerInfoSpy?.mockRestore();
    mock.restore();
  });

  it('compressDigest logs `DeepSeek API usage` with kind: "digest"', async () => {
    global.fetch = mock(() => Promise.resolve(mockJsonResponse({
      choices: [{ message: { role: 'assistant', content: '<digest></digest>' } }],
      usage: USAGE_PAYLOAD,
    }))) as unknown as typeof global.fetch;

    const ac = new AbortController();
    await provider.compressDigest('test prompt', ac.signal);

    // Find the usage log call.
    const usageCalls = (loggerInfoSpy.mock.calls as unknown as Array<[string, string, Record<string, unknown>?]>)
      .filter((call) => call[1] === 'DeepSeek API usage');

    expect(usageCalls.length).toBe(1);
    const context = usageCalls[0][2];
    expect(context).toBeDefined();
    expect(context!.kind).toBe('digest');
    expect(context!.model).toBe('deepseek-v4-flash');
    expect(context!.inputTokens).toBe(1000);
    expect(context!.outputTokens).toBe(200);
    expect(typeof context!.estimatedCostUSD).toBe('string');
  });

  it('queryDeepSeekMultiTurn (session path) logs kind: "session"', async () => {
    global.fetch = mock(() => Promise.resolve(mockJsonResponse({
      choices: [{ message: { role: 'assistant', content: 'hello world' } }],
      usage: USAGE_PAYLOAD,
    }))) as unknown as typeof global.fetch;

    // queryDeepSeekMultiTurn is private — we hit it via the public bracket access
    // since this test runs in the same module isolation boundary as the source.
    const queryFn = (provider as unknown as {
      queryDeepSeekMultiTurn: (
        history: Array<{ role: 'user' | 'assistant'; content: string }>,
        apiKey: string,
        model: string,
        baseUrl: string,
        options?: { systemPrompt?: string },
      ) => Promise<{ content: string; tokensUsed?: number }>;
    }).queryDeepSeekMultiTurn.bind(provider);

    await queryFn(
      [{ role: 'user', content: 'hi' }],
      'test-key',
      'deepseek-v4-flash',
      'https://api.deepseek.com/v1',
      { systemPrompt: 'be helpful' },
    );

    const usageCalls = (loggerInfoSpy.mock.calls as unknown as Array<[string, string, Record<string, unknown>?]>)
      .filter((call) => call[1] === 'DeepSeek API usage');

    expect(usageCalls.length).toBe(1);
    const context = usageCalls[0][2];
    expect(context).toBeDefined();
    expect(context!.kind).toBe('session');
    expect(context!.model).toBe('deepseek-v4-flash');
  });
});

describe('parseDeepSeekUsageLine (inspect-cache-savings)', () => {
  it('extracts kind=digest from an INFO-level log line', () => {
    const line = '[2026-06-10 12:00:00.000] [INFO ] [SDK   ] DeepSeek API usage {kind=digest, model=deepseek-v4-flash, inputTokens=1000, outputTokens=200, estimatedCostUSD=0.0042}';
    const parsed = parseDeepSeekUsageLine(line);
    expect(parsed).toEqual({ kind: 'digest', estimatedCostUSD: 0.0042 });
  });

  it('extracts kind=session from an INFO-level log line', () => {
    const line = '[2026-06-10 12:00:00.000] [INFO ] [SDK   ] DeepSeek API usage {kind=session, model=deepseek-v4-flash, inputTokens=1000, outputTokens=200, estimatedCostUSD=0.0100}';
    const parsed = parseDeepSeekUsageLine(line);
    expect(parsed).toEqual({ kind: 'session', estimatedCostUSD: 0.01 });
  });

  it('defaults to kind=session when kind field is missing (legacy logs)', () => {
    const line = '[2026-06-10 12:00:00.000] [INFO ] [SDK   ] DeepSeek API usage {model=deepseek-v4-flash, inputTokens=1000, outputTokens=200, estimatedCostUSD=0.0050}';
    const parsed = parseDeepSeekUsageLine(line);
    expect(parsed).toEqual({ kind: 'session', estimatedCostUSD: 0.005 });
  });

  it('also parses JSON-style DEBUG log lines (multi-line stringify)', () => {
    const line = 'DeepSeek API usage {"kind":"digest","model":"deepseek-v4-flash","estimatedCostUSD":"0.0030"}';
    const parsed = parseDeepSeekUsageLine(line);
    expect(parsed).toEqual({ kind: 'digest', estimatedCostUSD: 0.003 });
  });

  it('returns null for unrelated lines', () => {
    expect(parseDeepSeekUsageLine('some other log message')).toBeNull();
    expect(parseDeepSeekUsageLine('')).toBeNull();
  });

  it('returns null when DeepSeek API usage line lacks estimatedCostUSD', () => {
    const line = '[2026-06-10] [INFO ] [SDK   ] DeepSeek API usage {kind=session, model=foo}';
    expect(parseDeepSeekUsageLine(line)).toBeNull();
  });
});
