/**
 * Plan F.4+ extension: tests for ChromaSync.backfillDigests + the new
 * ProjectWatermarks.digests field.
 *
 * Closes the gap where a worker that crashed between
 * `insertObservationDigest` (SQLite) and `syncDigest` (Chroma) would leave
 * the new digest permanently unindexed. The live digest path is best-effort
 * by design (DigestGenerator catches Chroma errors), so the backfill pass on
 * boot is the durability mechanism.
 *
 * No real Chroma server is touched. We:
 *   - Use a `:memory:` SQLite DB via SessionStore + ClaudeMemDatabase
 *   - Replace the ChromaMcpManager singleton with an in-memory fake that
 *     captures every `chroma_add_documents` call (and can be told to throw
 *     on demand)
 *   - Point `CLAUDE_MEM_DATA_DIR` at a tmp dir so the watermark JSON file
 *     lives in an isolated location
 *   - Reset the ChromaSyncState in-memory cache between tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import { ChromaSync } from '../src/services/sync/ChromaSync.js';
import { ChromaMcpManager } from '../src/services/sync/ChromaMcpManager.js';
import { ChromaSyncState } from '../src/services/sync/ChromaSyncState.js';
import type { ObservationDigestRow } from '../src/services/sqlite/types.js';

// ---------------------------------------------------------------------------
// ChromaMcpManager singleton fake — same shape as chroma-digest-sync.test.ts.
// We extend it with a throw-on-demand toggle for the failure-mid-pass test.
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
  /** When non-null, the next `chroma_add_documents` call throws this error. */
  throwOnNextAdd: Error | null;
  reset(): void;
}

function installFakeChromaMcpSingleton(): FakeChromaMcpInstance {
  const fake: FakeChromaMcpInstance = {
    addCalls: [],
    throwOnNextAdd: null,
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (name === 'chroma_create_collection') {
        return null;
      }
      if (name === 'chroma_add_documents') {
        if (fake.throwOnNextAdd) {
          const err = fake.throwOnNextAdd;
          fake.throwOnNextAdd = null;
          throw err;
        }
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
      if (name === 'chroma_delete_documents') {
        return null;
      }
      return null;
    },
    reset() {
      fake.addCalls = [];
      fake.throwOnNextAdd = null;
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
// Helpers — seed digest rows directly. ChromaSync.backfillDigests pages by
// `id > watermark`, so we just need rows with monotonic ids.
// ---------------------------------------------------------------------------

function insertDigest(
  store: SessionStore,
  project: string,
  periodStartEpoch: number,
  periodKind: 'weekly' | 'monthly' = 'weekly',
): boolean {
  return store.insertObservationDigest({
    project,
    period_start_epoch: periodStartEpoch,
    period_end_epoch: periodStartEpoch + 7 * 86_400_000,
    period_kind: periodKind,
    obs_count: 4,
    dominant_types: JSON.stringify(['bugfix']),
    dominant_concepts: JSON.stringify(['caching']),
    summary_text: `summary for period ${periodStartEpoch}`,
    facts: JSON.stringify(['fact one', 'fact two']),
    files_touched: JSON.stringify(['src/a.ts']),
  });
}

function listDigests(store: SessionStore, project: string): ObservationDigestRow[] {
  return store.db.prepare(
    'SELECT * FROM observation_digests WHERE project = ? ORDER BY id ASC'
  ).all(project) as ObservationDigestRow[];
}

// ---------------------------------------------------------------------------
// Reach into the private API. backfillDigests + runBackfillPipeline are
// `private`, but TypeScript only enforces that at compile time — at runtime
// they're just methods on the instance. We cast through `unknown` so the test
// is the single place that knows about that.
// ---------------------------------------------------------------------------

interface ChromaSyncInternals {
  backfillDigests(
    db: SessionStore,
    project: string,
    watermark: number,
  ): Promise<{ synced: number; lastId: number }>;
  runBackfillPipeline(
    db: SessionStore,
    project: string,
    watermarks: { observations: number; summaries: number; prompts: number; digests: number },
  ): Promise<void>;
}

function internals(cs: ChromaSync): ChromaSyncInternals {
  return cs as unknown as ChromaSyncInternals;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChromaSync.backfillDigests', () => {
  let store: SessionStore;
  let cm: ClaudeMemDatabase;
  let fake: FakeChromaMcpInstance;
  let cs: ChromaSync;
  let tmpDataDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    // Each test gets its own tmp data dir so the chroma-sync-state.json file
    // is isolated. ChromaSyncState resolves the dir via
    // SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), which checks
    // process.env first — so flipping the env var redirects writes.
    tmpDataDir = mkdtempSync(join(tmpdir(), 'cm-backfill-digests-'));
    originalDataDir = process.env.CLAUDE_MEM_DATA_DIR;
    process.env.CLAUDE_MEM_DATA_DIR = tmpDataDir;
    ChromaSyncState.resetCache();

    cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
    fake = installFakeChromaMcpSingleton();
    cs = new ChromaSync('demo');
  });

  afterEach(() => {
    restoreChromaMcpSingleton();
    try { cm.db.close(); } catch { /* ignore */ }
    if (originalDataDir === undefined) {
      delete process.env.CLAUDE_MEM_DATA_DIR;
    } else {
      process.env.CLAUDE_MEM_DATA_DIR = originalDataDir;
    }
    ChromaSyncState.resetCache();
    try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('indexes all digests on a fresh DB and advances the watermark to the last id', async () => {
    for (let i = 0; i < 3; i++) {
      insertDigest(store, 'demo', 1700_000_000_000 + i * 7 * 86_400_000);
    }
    const seeded = listDigests(store, 'demo');
    expect(seeded).toHaveLength(3);

    const result = await internals(cs).backfillDigests(store, 'demo', 0);

    expect(result.synced).toBe(3);
    expect(result.lastId).toBe(seeded[2].id);

    // Each digest produces 1 add call (small enough to fit in a single doc).
    expect(fake.addCalls.length).toBeGreaterThanOrEqual(3);

    // Watermark persisted.
    expect(ChromaSyncState.get('demo').digests).toBe(seeded[2].id);
  });

  it('re-running with the watermark in place is a no-op', async () => {
    insertDigest(store, 'demo', 1700_000_000_000);
    insertDigest(store, 'demo', 1700_604_800_000);
    const seeded = listDigests(store, 'demo');

    // First pass: indexes everything.
    await internals(cs).backfillDigests(store, 'demo', 0);
    expect(fake.addCalls.length).toBeGreaterThanOrEqual(2);
    expect(ChromaSyncState.get('demo').digests).toBe(seeded[1].id);

    // Reset capture but keep watermark.
    fake.reset();

    const result = await internals(cs).backfillDigests(
      store,
      'demo',
      ChromaSyncState.get('demo').digests,
    );

    expect(result.synced).toBe(0);
    expect(fake.addCalls).toHaveLength(0);
    expect(ChromaSyncState.get('demo').digests).toBe(seeded[1].id);
  });

  it('a digest inserted after the watermark gets indexed on the next run', async () => {
    insertDigest(store, 'demo', 1700_000_000_000);
    const firstSeeded = listDigests(store, 'demo');

    // First pass — indexes everything that exists right now.
    await internals(cs).backfillDigests(store, 'demo', 0);
    expect(ChromaSyncState.get('demo').digests).toBe(firstSeeded[0].id);
    fake.reset();

    // Insert a new digest AFTER the first pass — simulates a fresh weekly
    // digest landing while the worker was offline.
    insertDigest(store, 'demo', 1700_604_800_000);
    const afterSeeded = listDigests(store, 'demo');
    expect(afterSeeded).toHaveLength(2);

    const result = await internals(cs).backfillDigests(
      store,
      'demo',
      ChromaSyncState.get('demo').digests,
    );

    expect(result.synced).toBe(1);
    expect(fake.addCalls).toHaveLength(1);
    expect(fake.addCalls[0].ids[0]).toBe(`digest_${afterSeeded[1].id}_summary`);
    expect(ChromaSyncState.get('demo').digests).toBe(afterSeeded[1].id);
  });

  it('a Chroma error mid-pass freezes the watermark at the last good digest', async () => {
    // Seed 3 digests. We will let the first one succeed, then throw on the
    // second add call to simulate a transient Chroma outage. The watermark
    // must end up at the FIRST digest's id — not the second, not the third.
    for (let i = 0; i < 3; i++) {
      insertDigest(store, 'demo', 1700_000_000_000 + i * 7 * 86_400_000);
    }
    const seeded = listDigests(store, 'demo');
    expect(seeded).toHaveLength(3);

    // We need to skip the first add call (which is for digest #1) and throw
    // on the second. Easiest way: index #1 manually, advance watermark, then
    // arm the throw for the next add.
    let addCallCount = 0;
    const originalCallTool = fake.callTool.bind(fake);
    fake.callTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      if (name === 'chroma_add_documents') {
        addCallCount += 1;
        if (addCallCount === 2) {
          throw new Error('simulated chroma 502');
        }
      }
      return originalCallTool(name, args);
    };

    const result = await internals(cs).backfillDigests(store, 'demo', 0);

    // First digest synced; second failed; third never attempted (we bail on
    // the first failure to avoid corrupting the watermark).
    expect(result.synced).toBe(1);
    expect(result.lastId).toBe(seeded[0].id);

    // Watermark is frozen at the first digest. On next boot, backfill will
    // retry digests #2 and #3 — no permanent gap.
    expect(ChromaSyncState.get('demo').digests).toBe(seeded[0].id);
    expect(ChromaSyncState.get('demo').digests).toBeLessThan(seeded[1].id);
    expect(ChromaSyncState.get('demo').digests).toBeLessThan(seeded[2].id);
  });

  it('scopes by project — digests for other projects do not advance this watermark', async () => {
    insertDigest(store, 'demo', 1700_000_000_000);
    insertDigest(store, 'other', 1700_000_000_000);
    insertDigest(store, 'demo', 1700_604_800_000);

    const demoDigests = listDigests(store, 'demo');
    expect(demoDigests).toHaveLength(2);

    const result = await internals(cs).backfillDigests(store, 'demo', 0);

    // Only the 2 demo digests should have been synced — `other` is invisible.
    expect(result.synced).toBe(2);
    expect(result.lastId).toBe(demoDigests[1].id);
    expect(ChromaSyncState.get('demo').digests).toBe(demoDigests[1].id);
    expect(ChromaSyncState.get('other').digests).toBe(0);
  });

  it('listDigestsAboveId returns digests strictly above the cursor in id ASC order', () => {
    insertDigest(store, 'demo', 1700_000_000_000);
    insertDigest(store, 'demo', 1700_604_800_000);
    insertDigest(store, 'demo', 1701_209_600_000);
    const all = listDigests(store, 'demo');

    const firstPage = store.listDigestsAboveId('demo', 0, 100);
    expect(firstPage.map(r => r.id)).toEqual(all.map(r => r.id));

    const above = store.listDigestsAboveId('demo', all[0].id, 100);
    expect(above).toHaveLength(2);
    expect(above[0].id).toBe(all[1].id);
    expect(above[1].id).toBe(all[2].id);

    const limited = store.listDigestsAboveId('demo', 0, 2);
    expect(limited).toHaveLength(2);
  });
});

describe('ChromaSync.runBackfillPipeline → backfillDigests ordering', () => {
  let store: SessionStore;
  let cm: ClaudeMemDatabase;
  let fake: FakeChromaMcpInstance;
  let cs: ChromaSync;
  let tmpDataDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'cm-backfill-pipeline-'));
    originalDataDir = process.env.CLAUDE_MEM_DATA_DIR;
    process.env.CLAUDE_MEM_DATA_DIR = tmpDataDir;
    ChromaSyncState.resetCache();

    cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
    fake = installFakeChromaMcpSingleton();
    cs = new ChromaSync('demo');
  });

  afterEach(() => {
    restoreChromaMcpSingleton();
    try { cm.db.close(); } catch { /* ignore */ }
    if (originalDataDir === undefined) {
      delete process.env.CLAUDE_MEM_DATA_DIR;
    } else {
      process.env.CLAUDE_MEM_DATA_DIR = originalDataDir;
    }
    ChromaSyncState.resetCache();
    try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('runBackfillPipeline calls backfillDigests AFTER backfillSummaries', async () => {
    // Spy on the order of internal calls. Replace the four backfill methods
    // with stubs that just record the order in which they were invoked.
    const order: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const csAny = cs as any;
    csAny.backfillObservations = async () => { order.push('observations'); return []; };
    csAny.backfillSummaries = async () => { order.push('summaries'); return []; };
    csAny.backfillDigests = async () => { order.push('digests'); return { synced: 0, lastId: 0 }; };
    csAny.backfillPrompts = async () => { order.push('prompts'); return []; };

    await internals(cs).runBackfillPipeline(store, 'demo', {
      observations: 0,
      summaries: 0,
      prompts: 0,
      digests: 0,
    });

    expect(order).toEqual(['observations', 'summaries', 'digests', 'prompts']);
  });

  it('end-to-end pipeline indexes seeded digests with no other data', async () => {
    insertDigest(store, 'demo', 1700_000_000_000);
    insertDigest(store, 'demo', 1700_604_800_000);
    const seeded = listDigests(store, 'demo');

    await internals(cs).runBackfillPipeline(store, 'demo', {
      observations: 0,
      summaries: 0,
      prompts: 0,
      digests: 0,
    });

    // Both digests landed in Chroma.
    const digestIdsCaptured = fake.addCalls.flatMap(c => c.ids).filter(id => id.startsWith('digest_'));
    expect(digestIdsCaptured).toContain(`digest_${seeded[0].id}_summary`);
    expect(digestIdsCaptured).toContain(`digest_${seeded[1].id}_summary`);

    expect(ChromaSyncState.get('demo').digests).toBe(seeded[1].id);
    // sanity: watermark file actually persisted to disk.
    expect(existsSync(join(tmpDataDir, 'chroma-sync-state.json'))).toBe(true);
  });
});
