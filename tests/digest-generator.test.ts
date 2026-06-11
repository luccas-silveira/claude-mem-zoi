/**
 * Plan F.2 (Fase 3): tests for DigestGenerator with :memory: SQLite.
 *
 * Uses ClaudeMemDatabase directly to get a fully-migrated schema (same pattern
 * as tests/observation-digests-schema.test.ts) and constructs a DigestGenerator
 * with a stubbed provider so we never make a real LLM call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import { DigestGenerator } from '../src/services/worker/digest/DigestGenerator.js';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';
import { logger } from '../src/utils/logger.js';

/**
 * Ensure an sdk_sessions row exists for the given memory_session_id+project so
 * the observation FK is satisfied. Idempotent via INSERT OR IGNORE.
 */
function ensureSdkSession(store: SessionStore, memoryId: string, project: string, epoch: number): void {
  store.db.prepare(`
    INSERT OR IGNORE INTO sdk_sessions (
      content_session_id, memory_session_id, project, started_at, started_at_epoch, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(`content-${memoryId}`, memoryId, project, new Date(epoch).toISOString(), epoch, 'completed');
}

// Helper: insert a fake observation. Builds the required sdk_sessions row first
// to satisfy the FK, then inserts directly so we can seed arbitrary epochs.
function seedObs(store: SessionStore, opts: {
  project: string;
  epoch: number;
  type?: string;
  concepts?: string[];
  files?: string[];
}): void {
  const memoryId = `mem-${opts.project}-${opts.epoch}`;
  ensureSdkSession(store, memoryId, opts.project, opts.epoch);
  const created_at = new Date(opts.epoch).toISOString();
  store.db.prepare(`
    INSERT INTO observations (
      memory_session_id, project, text, type, title, subtitle,
      facts, narrative, concepts, files_read, files_modified,
      prompt_number, discovery_tokens, created_at, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memoryId,
    opts.project,
    'sample text',
    opts.type ?? 'bugfix',
    `title-${opts.epoch}`,
    `subtitle-${opts.epoch}`,
    JSON.stringify(['fact A', 'fact B']),
    'narrative ' + opts.epoch,
    JSON.stringify(opts.concepts ?? ['caching']),
    JSON.stringify(opts.files ?? ['src/foo.ts']),
    JSON.stringify([]),
    null,
    0,
    created_at,
    opts.epoch,
  );
}

function makeSettings(overrides: Partial<ReturnType<typeof SettingsDefaultsManager.getAllDefaults>> = {}) {
  return { ...SettingsDefaultsManager.getAllDefaults(), ...overrides };
}

interface ProviderStub {
  compressDigest: (prompt: string, signal: AbortSignal) => Promise<string>;
  calls: number;
}

function makeValidXmlProvider(): ProviderStub {
  const stub: ProviderStub = {
    calls: 0,
    async compressDigest(_prompt, _signal) {
      stub.calls += 1;
      return `<digest>
  <summary_text>Week summary with concrete progress and one bug fix.</summary_text>
  <facts><fact>Implemented X</fact><fact>Fixed Y</fact></facts>
  <dominant_types><type>bugfix</type><type>feature</type></dominant_types>
  <dominant_concepts><concept>caching</concept></dominant_concepts>
  <files_touched><file>src/foo.ts</file></files_touched>
</digest>`;
    },
  };
  return stub;
}

function makeGarbageProvider(): ProviderStub {
  const stub: ProviderStub = {
    calls: 0,
    async compressDigest() {
      stub.calls += 1;
      return 'not xml, just chatter';
    },
  };
  return stub;
}

function makeRejectingProvider(): ProviderStub {
  const stub: ProviderStub = {
    calls: 0,
    async compressDigest() {
      stub.calls += 1;
      throw new Error('simulated timeout');
    },
  };
  return stub;
}

const UTC_2026_06_10 = Date.parse('2026-06-10T00:00:00.000Z');
const DAY = 86_400_000;

function digestCount(store: SessionStore): number {
  return (store.db.prepare('SELECT COUNT(*) AS c FROM observation_digests').get() as { c: number }).c;
}

describe('DigestGenerator', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('disabled path: returns zeros, no DB writes', async () => {
    seedObs(store, { project: 'demo', epoch: UTC_2026_06_10 - 90 * DAY });
    const provider = makeValidXmlProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({ CLAUDE_MEM_DIGEST_ENABLED: 'false' }),
      logger,
    });
    const ac = new AbortController();
    const result = await gen.generateMissingDigests(ac.signal);
    expect(result).toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(provider.calls).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('empty DB: enabled but no obs → returns zeros', async () => {
    const provider = makeValidXmlProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({ CLAUDE_MEM_DIGEST_ENABLED: 'true' }),
      logger,
    });
    const ac = new AbortController();
    const result = await gen.generateMissingDigests(ac.signal);
    expect(result).toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(provider.calls).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('no old obs: all observations newer than threshold → returns zeros', async () => {
    // Insert obs that are clearly newer than (now - 30 days).
    seedObs(store, { project: 'demo', epoch: Date.now() - 1 * DAY });
    const provider = makeValidXmlProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({ CLAUDE_MEM_DIGEST_ENABLED: 'true', CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '30' }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result.generated).toBe(0);
    expect(provider.calls).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('happy path: 100 obs across 4 weeks → 4 digests generated', async () => {
    // Use a very small min_age (1 day) so we don't have to time-travel.
    // Bucket 4 distinct weeks, each with 25 observations.
    const now = Date.now();
    const baseWeek = now - 30 * DAY; // Way past threshold
    for (let week = 0; week < 4; week++) {
      const weekStart = baseWeek + week * 7 * DAY;
      for (let i = 0; i < 25; i++) {
        seedObs(store, {
          project: 'demo',
          epoch: weekStart + i * 60_000, // Spread within the week
        });
      }
    }

    const provider = makeValidXmlProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
        CLAUDE_MEM_DIGEST_PERIOD: 'weekly',
        CLAUDE_MEM_DIGEST_MAX_OBS_PER: '100',
      }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);

    // We seeded 4 distinct ISO weeks. The DigestGenerator finds the oldest obs
    // epoch and walks weekly periods up to the threshold; some of those periods
    // contain our seeded obs and produce digests. The remainder skip (zero obs).
    expect(result.generated).toBeGreaterThanOrEqual(4);
    expect(result.failed).toBe(0);
    expect(digestCount(store)).toBe(result.generated);
    expect(provider.calls).toBe(result.generated);
  });

  it('idempotent: re-running with the same DB inserts no new digests', async () => {
    const baseWeek = Date.now() - 30 * DAY;
    for (let week = 0; week < 2; week++) {
      const weekStart = baseWeek + week * 7 * DAY;
      seedObs(store, { project: 'demo', epoch: weekStart });
    }
    const provider = makeValidXmlProvider();
    const settings = makeSettings({
      CLAUDE_MEM_DIGEST_ENABLED: 'true',
      CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
    });
    const gen1 = new DigestGenerator({ store, provider, settings, logger });
    const r1 = await gen1.generateMissingDigests(new AbortController().signal);
    expect(r1.generated).toBeGreaterThan(0);
    const initialCount = digestCount(store);

    const callsBefore = provider.calls;
    const gen2 = new DigestGenerator({ store, provider, settings, logger });
    const r2 = await gen2.generateMissingDigests(new AbortController().signal);
    expect(r2.generated).toBe(0);
    expect(digestCount(store)).toBe(initialCount);
    // Idempotency: no new LLM calls because all periods were already digested.
    expect(provider.calls).toBe(callsBefore);
  });

  it('parser failure: garbage XML → 1 failed, 0 generated, returns normally', async () => {
    seedObs(store, { project: 'demo', epoch: Date.now() - 30 * DAY });
    const provider = makeGarbageProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.generated).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('LLM timeout: provider rejects → caught, failed increments, returns normally', async () => {
    seedObs(store, { project: 'demo', epoch: Date.now() - 30 * DAY });
    const provider = makeRejectingProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.generated).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('abort signal: pre-abort before first iteration → returns early', async () => {
    // Seed enough obs so without abort there would be work to do.
    for (let week = 0; week < 4; week++) {
      seedObs(store, { project: 'demo', epoch: Date.now() - (30 + week * 7) * DAY });
    }
    // Slow provider — but we abort BEFORE the first call so it never runs.
    const provider: ProviderStub = {
      calls: 0,
      async compressDigest(_, _signal) {
        provider.calls += 1;
        return '<digest><summary_text>x</summary_text></digest>';
      },
    };
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
    });
    const ac = new AbortController();
    ac.abort();
    const result = await gen.generateMissingDigests(ac.signal);
    expect(result.generated).toBe(0);
    expect(provider.calls).toBe(0);
    expect(digestCount(store)).toBe(0);
  });

  it('non-DeepSeek provider (no compressDigest method) → warn + early return', async () => {
    seedObs(store, { project: 'demo', epoch: Date.now() - 30 * DAY });
    const provider = { someOtherMethod: () => {} }; // no compressDigest
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result).toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(digestCount(store)).toBe(0);
  });

  it('max digests per run cap: 60 distinct weekly periods → at most 50 processed', async () => {
    // Seed 60 distinct weekly buckets.
    const baseWeek = Date.now() - 365 * DAY;
    for (let week = 0; week < 60; week++) {
      seedObs(store, {
        project: 'demo',
        epoch: baseWeek + week * 7 * DAY,
      });
    }
    const provider = makeValidXmlProvider();
    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
    });
    const result = await gen.generateMissingDigests(new AbortController().signal);
    // MAX_DIGESTS_PER_RUN = 50. generated + failed must be <= 50.
    expect(result.generated + result.failed).toBeLessThanOrEqual(50);
    expect(result.generated).toBeGreaterThan(0);
  });
});
