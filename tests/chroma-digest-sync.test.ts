/**
 * Plan F.4 (Fase 5): tests for ChromaSync digest indexing + DigestGenerator
 * end-to-end with a mock ChromaSync.
 *
 * No real Chroma server is touched. We exercise two surfaces:
 *
 *   1. ChromaSync.formatDigestDocs / syncDigest doc shape — by replacing the
 *      ChromaMcpManager singleton with a fake whose `callTool` captures all
 *      `chroma_add_documents` requests in memory.
 *
 *   2. DigestGenerator wiring — pass a duck-typed mock with `syncDigest` and
 *      assert it's called with a fully-populated ObservationDigestRow after
 *      each successful SQLite INSERT.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import { DigestGenerator } from '../src/services/worker/digest/DigestGenerator.js';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';
import { ChromaSync } from '../src/services/sync/ChromaSync.js';
import { ChromaMcpManager } from '../src/services/sync/ChromaMcpManager.js';
import { logger } from '../src/utils/logger.js';
import type { ObservationDigestRow } from '../src/services/sqlite/types.js';

// ---------------------------------------------------------------------------
// ChromaMcpManager singleton fake
// ---------------------------------------------------------------------------

interface CapturedAddCall {
  collection_name: string;
  ids: string[];
  documents: string[];
  metadatas: Array<Record<string, string | number>>;
}

interface FakeChromaMcpInstance {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  addCalls: CapturedAddCall[];
  reset(): void;
}

/**
 * Replace the ChromaMcpManager singleton with an in-memory fake. Returns the
 * fake so the test can inspect captured calls and reset it. Tests MUST call
 * `restoreChromaMcpSingleton()` in afterEach to put the real singleton back.
 */
function installFakeChromaMcpSingleton(): FakeChromaMcpInstance {
  const fake: FakeChromaMcpInstance = {
    addCalls: [],
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (name === 'chroma_create_collection') {
        return null;
      }
      if (name === 'chroma_add_documents') {
        fake.addCalls.push({
          collection_name: args.collection_name as string,
          ids: args.ids as string[],
          documents: args.documents as string[],
          metadatas: args.metadatas as Array<Record<string, string | number>>,
        });
        return null;
      }
      if (name === 'chroma_get_documents') {
        return { ids: [], metadatas: [] };
      }
      return null;
    },
    reset() {
      fake.addCalls = [];
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ChromaMcpManager as any).instance = fake;
  return fake;
}

function restoreChromaMcpSingleton(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ChromaMcpManager as any).instance = null;
}

// ---------------------------------------------------------------------------
// Mock for DigestGenerator integration
// ---------------------------------------------------------------------------

class MockChromaSync {
  public calls: ObservationDigestRow[] = [];
  public throwOnNext = false;

  async syncDigest(digest: ObservationDigestRow): Promise<void> {
    if (this.throwOnNext) {
      this.throwOnNext = false;
      throw new Error('simulated chroma outage');
    }
    this.calls.push(digest);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSdkSession(store: SessionStore, memoryId: string, project: string, epoch: number): void {
  store.db.prepare(`
    INSERT OR IGNORE INTO sdk_sessions (
      content_session_id, memory_session_id, project, started_at, started_at_epoch, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(`content-${memoryId}`, memoryId, project, new Date(epoch).toISOString(), epoch, 'completed');
}

function seedObs(store: SessionStore, opts: {
  project: string;
  epoch: number;
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
    'bugfix',
    `title-${opts.epoch}`,
    `subtitle-${opts.epoch}`,
    JSON.stringify(['fact A', 'fact B']),
    'narrative ' + opts.epoch,
    JSON.stringify(['caching']),
    JSON.stringify(['src/foo.ts']),
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

function makeValidXmlProvider() {
  const stub = {
    calls: 0,
    async compressDigest(_prompt: string, _signal: AbortSignal): Promise<string> {
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

const DAY = 86_400_000;

function digestCount(store: SessionStore): number {
  return (store.db.prepare('SELECT COUNT(*) AS c FROM observation_digests').get() as { c: number }).c;
}

function makeDigestRow(overrides: Partial<ObservationDigestRow> = {}): ObservationDigestRow {
  return {
    id: 1,
    project: 'demo',
    merged_into_project: null,
    period_start_epoch: 1700_000_000_000,
    period_end_epoch: 1700_604_800_000,
    period_kind: 'weekly',
    obs_count: 17,
    dominant_types: JSON.stringify(['bugfix', 'feature']),
    dominant_concepts: JSON.stringify(['caching', 'sqlite']),
    summary_text: 'Implemented caching layer and fixed two SQLite migration bugs.',
    facts: JSON.stringify(['Fact one', 'Fact two', 'Fact three']),
    files_touched: JSON.stringify(['src/a.ts', 'src/b.ts']),
    created_at: new Date(1700_604_800_000).toISOString(),
    created_at_epoch: 1700_604_800_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ChromaSync.syncDigest — doc shape tests
// ---------------------------------------------------------------------------

describe('ChromaSync.syncDigest (doc shape)', () => {
  let cs: ChromaSync;
  let fake: FakeChromaMcpInstance;

  beforeEach(() => {
    fake = installFakeChromaMcpSingleton();
    cs = new ChromaSync('claude-mem');
  });

  afterEach(() => {
    restoreChromaMcpSingleton();
  });

  it('emits a single digest_summary doc when summary + facts fit under the cap', async () => {
    const digest = makeDigestRow();
    await cs.syncDigest(digest);

    expect(fake.addCalls).toHaveLength(1);
    const call = fake.addCalls[0];
    expect(call.ids).toHaveLength(1);
    expect(call.ids[0]).toBe('digest_1_summary');
    expect(call.metadatas[0]).toMatchObject({
      sqlite_id: 1,
      doc_type: 'digest',
      entity_kind: 'digest',
      project: 'demo',
      period_kind: 'weekly',
      period_start_epoch: 1700_000_000_000,
      obs_count: 17,
      field_type: 'digest_summary',
    });
    expect(call.metadatas[0].created_at_epoch).toBe(1700_604_800_000);
    expect(call.documents[0]).toContain('Implemented caching layer');
    expect(call.documents[0]).toContain('Fact one');
  });

  it('id namespacing — never collides with obs_ / summary_ / prompt_ prefixes', async () => {
    const digest = makeDigestRow({ id: 42 });
    await cs.syncDigest(digest);
    expect(fake.addCalls).toHaveLength(1);
    for (const id of fake.addCalls[0].ids) {
      expect(id.startsWith('digest_')).toBe(true);
      expect(id.startsWith('obs_')).toBe(false);
      expect(id.startsWith('summary_')).toBe(false);
      expect(id.startsWith('prompt_')).toBe(false);
    }
  });

  it('emits two docs (summary + facts) when combined length exceeds the cap', async () => {
    const longSummary = 'x'.repeat(7000);
    const longFacts = JSON.stringify([
      'y'.repeat(2000),
      'z'.repeat(2000),
    ]);
    const digest = makeDigestRow({ summary_text: longSummary, facts: longFacts });
    await cs.syncDigest(digest);

    expect(fake.addCalls).toHaveLength(1);
    const call = fake.addCalls[0];
    expect(call.ids).toHaveLength(2);
    expect(call.ids[0]).toBe('digest_1_summary');
    expect(call.metadatas[0].field_type).toBe('digest_summary');
    expect(call.ids[1]).toBe('digest_1_facts');
    expect(call.metadatas[1].field_type).toBe('digest_facts');
    expect(call.documents[0].length).toBeLessThanOrEqual(8000);
    expect(call.documents[1].length).toBeLessThanOrEqual(8000);
  });

  it('null facts → only digest_summary doc', async () => {
    const digest = makeDigestRow({ facts: null });
    await cs.syncDigest(digest);
    expect(fake.addCalls).toHaveLength(1);
    const call = fake.addCalls[0];
    expect(call.ids).toHaveLength(1);
    expect(call.metadatas[0].field_type).toBe('digest_summary');
    expect(call.documents[0]).not.toContain('Fact one');
  });

  it('empty facts array → only digest_summary doc', async () => {
    const digest = makeDigestRow({ facts: '[]' });
    await cs.syncDigest(digest);
    expect(fake.addCalls).toHaveLength(1);
    expect(fake.addCalls[0].ids).toHaveLength(1);
    expect(fake.addCalls[0].metadatas[0].field_type).toBe('digest_summary');
  });

  it('empty summary_text + null facts (defensive — schema is NOT NULL) emits zero docs', async () => {
    const digest = makeDigestRow({ summary_text: '', facts: null });
    await cs.syncDigest(digest);
    // No docs → addDocuments short-circuits, never calls chroma_add_documents.
    expect(fake.addCalls).toHaveLength(0);
  });

  it('whitespace-only summary_text + valid facts → only digest_facts doc', async () => {
    const digest = makeDigestRow({ summary_text: '   \n\n  ', facts: JSON.stringify(['real fact']) });
    await cs.syncDigest(digest);
    expect(fake.addCalls).toHaveLength(1);
    const call = fake.addCalls[0];
    expect(call.ids).toHaveLength(1);
    expect(call.ids[0]).toBe('digest_1_facts');
    expect(call.metadatas[0].field_type).toBe('digest_facts');
    expect(call.documents[0]).toBe('real fact');
  });
});

// ---------------------------------------------------------------------------
// DigestGenerator + ChromaSync integration
// ---------------------------------------------------------------------------

describe('DigestGenerator + ChromaSync integration', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('inserts digest in SQLite AND calls chromaSync.syncDigest with the row', async () => {
    const baseWeek = Date.now() - 30 * DAY;
    for (let i = 0; i < 5; i++) {
      seedObs(store, { project: 'demo', epoch: baseWeek + i * 60_000 });
    }
    const provider = makeValidXmlProvider();
    const chroma = new MockChromaSync();

    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
        CLAUDE_MEM_DIGEST_PERIOD: 'weekly',
      }),
      logger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chromaSync: chroma as any,
    });

    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result.generated).toBeGreaterThan(0);
    expect(digestCount(store)).toBe(result.generated);
    expect(chroma.calls.length).toBe(result.generated);

    const row = chroma.calls[0];
    expect(row.id).toBeGreaterThan(0);
    expect(row.project).toBe('demo');
    expect(row.period_kind).toBe('weekly');
    expect(row.summary_text.length).toBeGreaterThan(0);
    expect(row.created_at_epoch).toBeGreaterThan(0);
  });

  it('omitted chromaSync → digest still lands in SQLite, no crash', async () => {
    const baseWeek = Date.now() - 30 * DAY;
    seedObs(store, { project: 'demo', epoch: baseWeek });
    const provider = makeValidXmlProvider();

    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
      // chromaSync intentionally omitted
    });

    const result = await gen.generateMissingDigests(new AbortController().signal);
    expect(result.generated).toBeGreaterThan(0);
    expect(digestCount(store)).toBe(result.generated);
  });

  it('chromaSync throws → generator catches, digest stays in SQLite, run summary correct', async () => {
    const baseWeek = Date.now() - 30 * DAY;
    seedObs(store, { project: 'demo', epoch: baseWeek });
    const provider = makeValidXmlProvider();
    const chroma = new MockChromaSync();
    chroma.throwOnNext = true;

    const gen = new DigestGenerator({
      store,
      provider,
      settings: makeSettings({
        CLAUDE_MEM_DIGEST_ENABLED: 'true',
        CLAUDE_MEM_DIGEST_MIN_AGE_DAYS: '1',
      }),
      logger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chromaSync: chroma as any,
    });

    const result = await gen.generateMissingDigests(new AbortController().signal);
    // SQLite is source of truth — digest counts as generated even though Chroma threw.
    expect(result.generated).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(digestCount(store)).toBe(result.generated);
  });
});

// ---------------------------------------------------------------------------
// SessionStore.getLatestDigestForPeriod
// ---------------------------------------------------------------------------

describe('SessionStore.getLatestDigestForPeriod', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('returns the inserted digest row including id and created_at_epoch', () => {
    const inserted = store.insertObservationDigest({
      project: 'demo',
      merged_into_project: null,
      period_start_epoch: 1700_000_000_000,
      period_end_epoch: 1700_604_800_000,
      period_kind: 'weekly',
      obs_count: 17,
      dominant_types: JSON.stringify(['bugfix']),
      dominant_concepts: JSON.stringify(['caching']),
      summary_text: 'A summary.',
      facts: JSON.stringify(['a fact']),
      files_touched: JSON.stringify(['src/a.ts']),
    });
    expect(inserted).toBe(true);

    const row = store.getLatestDigestForPeriod('demo', 'weekly', 1700_000_000_000);
    expect(row).not.toBeNull();
    expect(row!.id).toBeGreaterThan(0);
    expect(row!.project).toBe('demo');
    expect(row!.period_kind).toBe('weekly');
    expect(row!.summary_text).toBe('A summary.');
    expect(row!.created_at_epoch).toBeGreaterThan(0);
  });

  it('returns null when no digest exists for the tuple', () => {
    const row = store.getLatestDigestForPeriod('demo', 'weekly', 9999_999_999_999);
    expect(row).toBeNull();
  });
});
