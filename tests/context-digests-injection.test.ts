/**
 * Plan F.3 (Fase 4): context injection mixes observation_digests into the
 * rendered context block. Tests the query (queryDigests / queryDigestsMulti),
 * the renderer (renderDigests), and the integration via buildContextOutput.
 *
 * Uses the same in-memory SQLite pattern as tests/observation-digests-schema.test.ts
 * — no settings.json on disk, no real DB path resolution.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import {
  queryDigests,
  queryDigestsMulti,
} from '../src/services/context/ObservationCompiler.js';
import {
  renderDigests,
  MAX_DIGEST_PREVIEW_CHARS,
} from '../src/services/context/formatters/DigestFormatter.js';
import { buildContextOutput } from '../src/services/context/ContextBuilder.js';
import { ModeManager } from '../src/services/domain/ModeManager.js';
import type { ContextConfig, Observation, SessionSummary } from '../src/services/context/types.js';
import type { ObservationDigestRow } from '../src/services/sqlite/types.js';

// AgentFormatter renders the legend via ModeManager.getActiveMode(); load the
// default 'code' mode once so buildContextOutput integration tests don't crash.
beforeAll(() => {
  try { ModeManager.getInstance().loadMode('code'); } catch { /* already loaded */ }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedDigest(store: SessionStore, opts: {
  project: string;
  periodStartEpoch: number;
  periodEndEpoch?: number;
  periodKind?: 'weekly' | 'monthly';
  obsCount?: number;
  summaryText?: string;
  facts?: string[] | null;
  dominantTypes?: string[] | null;
  dominantConcepts?: string[] | null;
  filesTouched?: string[] | null;
  createdAtEpoch?: number;
}): void {
  const created = opts.createdAtEpoch ?? opts.periodStartEpoch;
  store.db.prepare(`
    INSERT INTO observation_digests (
      project, period_start_epoch, period_end_epoch, period_kind, obs_count,
      dominant_types, dominant_concepts, summary_text, facts, files_touched,
      created_at, created_at_epoch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.project,
    opts.periodStartEpoch,
    opts.periodEndEpoch ?? opts.periodStartEpoch + 7 * 86_400_000,
    opts.periodKind ?? 'weekly',
    opts.obsCount ?? 100,
    opts.dominantTypes === null ? null : JSON.stringify(opts.dominantTypes ?? ['bugfix', 'feature']),
    opts.dominantConcepts === null ? null : JSON.stringify(opts.dominantConcepts ?? ['caching']),
    opts.summaryText ?? `summary for ${opts.project} week ${opts.periodStartEpoch}`,
    opts.facts === null ? null : JSON.stringify(opts.facts ?? ['fact A', 'fact B']),
    opts.filesTouched === null ? null : JSON.stringify(opts.filesTouched ?? ['src/foo.ts']),
    new Date(created).toISOString(),
    created,
  );
}

function makeConfig(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    totalObservationCount: 50,
    fullObservationCount: 0,
    sessionCount: 10,
    digestCount: 5,
    showReadTokens: false,
    showWorkTokens: false,
    showSavingsAmount: false,
    showSavingsPercent: false,
    observationTypes: new Set(['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change']),
    observationConcepts: new Set(['caching', 'database', 'security']),
    fullObservationField: 'narrative',
    showLastSummary: false,
    showLastMessage: false,
    ...overrides,
  };
}

const UTC_2026_05_04 = Date.parse('2026-05-04T00:00:00.000Z');
const UTC_2026_05_11 = Date.parse('2026-05-11T00:00:00.000Z');
const UTC_2026_05_18 = Date.parse('2026-05-18T00:00:00.000Z');
const UTC_2026_05_25 = Date.parse('2026-05-25T00:00:00.000Z');
const WEEK_MS = 7 * 86_400_000;

// ---------------------------------------------------------------------------
// queryDigests
// ---------------------------------------------------------------------------

describe('queryDigests (Plan F.3 / Fase 4)', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('returns [] when digestCount = 0 even if rows exist', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04 });
    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 0 }));
    expect(rows).toEqual([]);
  });

  it('returns [] when digestCount is negative', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04 });
    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: -1 }));
    expect(rows).toEqual([]);
  });

  it('returns [] when table is empty', () => {
    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 5 }));
    expect(rows).toEqual([]);
  });

  it('respects digestCount limit (DESC by period_start_epoch)', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04 });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_11 });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_18 });

    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 2 }));
    expect(rows.length).toBe(2);
    // DESC order: most recent first
    expect(rows[0].period_start_epoch).toBe(UTC_2026_05_18);
    expect(rows[1].period_start_epoch).toBe(UTC_2026_05_11);
  });

  it('filters by project — other projects are excluded', () => {
    seedDigest(store, { project: 'alpha', periodStartEpoch: UTC_2026_05_04 });
    seedDigest(store, { project: 'beta',  periodStartEpoch: UTC_2026_05_11 });

    const rows = queryDigests(store, 'alpha', makeConfig({ digestCount: 5 }));
    expect(rows.length).toBe(1);
    expect(rows[0].project).toBe('alpha');
  });
});

// ---------------------------------------------------------------------------
// queryDigestsMulti
// ---------------------------------------------------------------------------

describe('queryDigestsMulti (Plan F.3 / Fase 4)', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('returns [] when digestCount = 0', () => {
    seedDigest(store, { project: 'a', periodStartEpoch: UTC_2026_05_04 });
    const rows = queryDigestsMulti(store, ['a', 'b'], makeConfig({ digestCount: 0 }));
    expect(rows).toEqual([]);
  });

  it('returns [] when projects array is empty', () => {
    seedDigest(store, { project: 'a', periodStartEpoch: UTC_2026_05_04 });
    const rows = queryDigestsMulti(store, [], makeConfig({ digestCount: 5 }));
    expect(rows).toEqual([]);
  });

  it('combines rows across multiple projects, DESC by period_start_epoch', () => {
    seedDigest(store, { project: 'alpha', periodStartEpoch: UTC_2026_05_04 });
    seedDigest(store, { project: 'beta',  periodStartEpoch: UTC_2026_05_11 });
    seedDigest(store, { project: 'alpha', periodStartEpoch: UTC_2026_05_18 });

    const rows = queryDigestsMulti(store, ['alpha', 'beta'], makeConfig({ digestCount: 5 }));
    expect(rows.length).toBe(3);
    expect(rows.map(r => r.period_start_epoch)).toEqual([
      UTC_2026_05_18,
      UTC_2026_05_11,
      UTC_2026_05_04,
    ]);
  });
});

// ---------------------------------------------------------------------------
// renderDigests
// ---------------------------------------------------------------------------

describe('renderDigests (Plan F.3 / Fase 4)', () => {
  it('returns [] on empty input — no header', () => {
    const out = renderDigests([]);
    expect(out).toEqual([]);
  });

  it('emits a header and one bullet per digest, oldest-first', () => {
    const rows: ObservationDigestRow[] = [
      // Caller passes DESC by period_start_epoch (matches queryDigests output)
      {
        id: 3, project: 'demo', merged_into_project: null,
        period_start_epoch: UTC_2026_05_18, period_end_epoch: UTC_2026_05_18 + WEEK_MS,
        period_kind: 'weekly', obs_count: 30,
        dominant_types: null, dominant_concepts: null,
        summary_text: 'Third week summary',
        facts: null, files_touched: null,
        created_at: 'x', created_at_epoch: UTC_2026_05_18,
      },
      {
        id: 2, project: 'demo', merged_into_project: null,
        period_start_epoch: UTC_2026_05_11, period_end_epoch: UTC_2026_05_11 + WEEK_MS,
        period_kind: 'weekly', obs_count: 20,
        dominant_types: null, dominant_concepts: null,
        summary_text: 'Second week summary',
        facts: null, files_touched: null,
        created_at: 'x', created_at_epoch: UTC_2026_05_11,
      },
      {
        id: 1, project: 'demo', merged_into_project: null,
        period_start_epoch: UTC_2026_05_04, period_end_epoch: UTC_2026_05_04 + WEEK_MS,
        period_kind: 'weekly', obs_count: 10,
        dominant_types: null, dominant_concepts: null,
        summary_text: 'First week summary',
        facts: null, files_touched: null,
        created_at: 'x', created_at_epoch: UTC_2026_05_04,
      },
    ];
    const out = renderDigests(rows);

    expect(out[0]).toBe('## Historical context (3 weekly digests)');
    // Oldest first
    expect(out[1]).toContain('2026-05-04');
    expect(out[1]).toContain('First week summary');
    expect(out[2]).toContain('2026-05-11');
    expect(out[2]).toContain('Second week summary');
    expect(out[3]).toContain('2026-05-18');
    expect(out[3]).toContain('Third week summary');
  });

  it('truncates summary_text longer than MAX_DIGEST_PREVIEW_CHARS', () => {
    const longText = 'A'.repeat(MAX_DIGEST_PREVIEW_CHARS + 500);
    const rows: ObservationDigestRow[] = [{
      id: 1, project: 'demo', merged_into_project: null,
      period_start_epoch: UTC_2026_05_04, period_end_epoch: UTC_2026_05_04 + WEEK_MS,
      period_kind: 'weekly', obs_count: 5,
      dominant_types: null, dominant_concepts: null,
      summary_text: longText,
      facts: null, files_touched: null,
      created_at: 'x', created_at_epoch: UTC_2026_05_04,
    }];
    const out = renderDigests(rows);
    const bullet = out[1];
    // The 'A' run inside the bullet must be exactly MAX_DIGEST_PREVIEW_CHARS chars,
    // not the full long string.
    const aMatch = bullet.match(/A+/);
    expect(aMatch).not.toBeNull();
    expect(aMatch![0].length).toBe(MAX_DIGEST_PREVIEW_CHARS);
  });

  it('defensively handles empty summary_text (no crash, no colon-prefix)', () => {
    const rows: ObservationDigestRow[] = [{
      id: 1, project: 'demo', merged_into_project: null,
      period_start_epoch: UTC_2026_05_04, period_end_epoch: UTC_2026_05_04 + WEEK_MS,
      period_kind: 'weekly', obs_count: 5,
      dominant_types: null, dominant_concepts: null,
      summary_text: '',
      facts: null, files_touched: null,
      created_at: 'x', created_at_epoch: UTC_2026_05_04,
    }];
    const out = renderDigests(rows);
    // No colon since preview is empty
    expect(out[1].endsWith(': ')).toBe(false);
    expect(out[1]).toContain('2026-05-04');
    expect(out[1]).toContain('5 obs');
  });

  it('defensively handles null JSON arrays (dominant_types / facts / files_touched)', () => {
    const rows: ObservationDigestRow[] = [{
      id: 1, project: 'demo', merged_into_project: null,
      period_start_epoch: UTC_2026_05_04, period_end_epoch: UTC_2026_05_04 + WEEK_MS,
      period_kind: 'weekly', obs_count: 5,
      dominant_types: null, dominant_concepts: null,
      summary_text: 'hello',
      facts: null, files_touched: null,
      created_at: 'x', created_at_epoch: UTC_2026_05_04,
    }];
    expect(() => renderDigests(rows)).not.toThrow();
    const out = renderDigests(rows);
    expect(out[1]).toContain('hello');
  });

  it('header uses period_kind label when all rows agree', () => {
    const rows: ObservationDigestRow[] = [
      {
        id: 1, project: 'demo', merged_into_project: null,
        period_start_epoch: UTC_2026_05_04, period_end_epoch: UTC_2026_05_04 + 30 * 86_400_000,
        period_kind: 'monthly', obs_count: 100,
        dominant_types: null, dominant_concepts: null,
        summary_text: 'May',
        facts: null, files_touched: null,
        created_at: 'x', created_at_epoch: UTC_2026_05_04,
      },
    ];
    const out = renderDigests(rows);
    expect(out[0]).toBe('## Historical context (1 monthly digests)');
  });
});

// ---------------------------------------------------------------------------
// Integration via buildContextOutput
// ---------------------------------------------------------------------------

describe('buildContextOutput digest mixing (Plan F.3 / Fase 4)', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  function renderForProject(
    project: string,
    digestCount: number,
  ): { output: string; digestsQueried: ObservationDigestRow[] } {
    const config = makeConfig({ digestCount });
    const digests = queryDigests(store, project, config);
    const observations: Observation[] = [];
    const summaries: SessionSummary[] = [];
    const output = buildContextOutput(
      project,
      observations,
      summaries,
      digests,
      config,
      '/tmp/test-cwd',
      undefined,
      false,
    );
    return { output, digestsQueried: digests };
  }

  it('empty digest table with digestCount=5 → output has NO "Historical context" header', () => {
    // No digests seeded.
    // Need at least one observation so we don't trip the empty-state path.
    // For this test, we render directly without any obs (digest path emits no header
    // because digests is []).
    const config = makeConfig({ digestCount: 5 });
    const out = buildContextOutput(
      'demo',
      [], [], [],
      config,
      '/tmp/x',
      undefined,
      false,
    );
    expect(out).not.toContain('Historical context');
  });

  it('3 digests + digestCount=5 → header + all 3 bullets', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04, summaryText: 'week one' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_11, summaryText: 'week two' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_18, summaryText: 'week three' });

    const { output } = renderForProject('demo', 5);

    expect(output).toContain('## Historical context (3 weekly digests)');
    expect(output).toContain('week one');
    expect(output).toContain('week two');
    expect(output).toContain('week three');
    // Oldest-first ordering
    const i1 = output.indexOf('week one');
    const i2 = output.indexOf('week two');
    const i3 = output.indexOf('week three');
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  it('3 digests + digestCount=2 → only 2 rendered (most recent)', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04, summaryText: 'week one' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_11, summaryText: 'week two' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_18, summaryText: 'week three' });

    const { output, digestsQueried } = renderForProject('demo', 2);

    expect(digestsQueried.length).toBe(2);
    expect(output).toContain('## Historical context (2 weekly digests)');
    // Most recent two: weeks two and three
    expect(output).toContain('week two');
    expect(output).toContain('week three');
    expect(output).not.toContain('week one');
  });

  it('3 digests + digestCount=0 → no query made AND no header', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04 });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_11 });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_18 });

    // Verify the "no query" promise by spying on prepare. queryDigests must
    // short-circuit to [] without touching the DB.
    let prepareCallCount = 0;
    const realPrepare = store.db.prepare.bind(store.db);
    (store.db as unknown as { prepare: typeof realPrepare }).prepare = ((sql: string) => {
      if (sql.includes('observation_digests')) prepareCallCount += 1;
      return realPrepare(sql);
    }) as typeof realPrepare;

    try {
      const config = makeConfig({ digestCount: 0 });
      const digests = queryDigests(store, 'demo', config);
      expect(digests).toEqual([]);
      expect(prepareCallCount).toBe(0);

      const out = buildContextOutput(
        'demo', [], [], digests, config, '/tmp/x', undefined, false,
      );
      expect(out).not.toContain('Historical context');
    } finally {
      (store.db as unknown as { prepare: typeof realPrepare }).prepare = realPrepare;
    }
  });

  it('long summary_text in DB → preview truncated to MAX_DIGEST_PREVIEW_CHARS in output', () => {
    const longText = 'B'.repeat(MAX_DIGEST_PREVIEW_CHARS + 1000);
    seedDigest(store, {
      project: 'demo',
      periodStartEpoch: UTC_2026_05_04,
      summaryText: longText,
    });

    const { output } = renderForProject('demo', 5);

    // Find the long-text bullet — count the run of B's.
    const match = output.match(/B+/);
    expect(match).not.toBeNull();
    expect(match![0].length).toBe(MAX_DIGEST_PREVIEW_CHARS);
  });

  it('multi-project: digests from multiple projects appear together, oldest-first', () => {
    seedDigest(store, { project: 'alpha', periodStartEpoch: UTC_2026_05_04, summaryText: 'A1' });
    seedDigest(store, { project: 'beta',  periodStartEpoch: UTC_2026_05_11, summaryText: 'B1' });
    seedDigest(store, { project: 'alpha', periodStartEpoch: UTC_2026_05_18, summaryText: 'A2' });

    const config = makeConfig({ digestCount: 5 });
    const digests = queryDigestsMulti(store, ['alpha', 'beta'], config);
    const out = buildContextOutput(
      'alpha', [], [], digests, config, '/tmp/x', undefined, false,
    );

    expect(out).toContain('## Historical context (3 weekly digests)');
    // Oldest first: A1 (May 4), B1 (May 11), A2 (May 18).
    const iA1 = out.indexOf('A1');
    const iB1 = out.indexOf('B1');
    const iA2 = out.indexOf('A2');
    expect(iA1).toBeLessThan(iB1);
    expect(iB1).toBeLessThan(iA2);
  });

  it('order: when both obs + digests exist, digests block appears BEFORE recent obs timeline', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04, summaryText: 'historical' });

    // Synthetic observation. The TimelineRenderer's day header marker is
    // `### `, so we look for the position of that to anchor the test.
    const obs: Observation = {
      id: 99,
      memory_session_id: 'mem-99',
      platform_source: 'claude',
      type: 'bugfix',
      title: 'recent obs title',
      subtitle: null,
      narrative: 'narrative body',
      facts: null,
      concepts: null,
      files_read: null,
      files_modified: null,
      discovery_tokens: 0,
      created_at: '2026-06-01T12:00:00.000Z',
      created_at_epoch: Date.parse('2026-06-01T12:00:00.000Z'),
    };

    const config = makeConfig({ digestCount: 5 });
    const digests = queryDigests(store, 'demo', config);
    const out = buildContextOutput(
      'demo',
      [obs],
      [],
      digests,
      config,
      '/tmp/x',
      undefined,
      false,
    );

    const iDigest = out.indexOf('## Historical context');
    const iDayHeader = out.indexOf('### ');
    expect(iDigest).toBeGreaterThan(-1);
    expect(iDayHeader).toBeGreaterThan(-1);
    expect(iDigest).toBeLessThan(iDayHeader);
  });

  it('determinism: same DB state → byte-identical output across two calls', () => {
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_04, summaryText: 'w1' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_11, summaryText: 'w2' });
    seedDigest(store, { project: 'demo', periodStartEpoch: UTC_2026_05_18, summaryText: 'w3' });

    const config = makeConfig({ digestCount: 5 });

    const out1 = renderDigests(queryDigests(store, 'demo', config)).join('\n');
    const out2 = renderDigests(queryDigests(store, 'demo', config)).join('\n');

    expect(out1).toBe(out2);
  });
});
