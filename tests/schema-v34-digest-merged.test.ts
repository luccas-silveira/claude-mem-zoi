/**
 * Schema v34 — observation_digests.merged_into_project column.
 *
 * Pairs the digest table with observations / session_summaries: any code that
 * matches `(project = ? OR merged_into_project = ?)` (queryObservations /
 * querySummaries / queryDigests) now resolves merged projects uniformly.
 *
 * The migration must:
 *   1. Add the column on a legacy DB that has observation_digests but no
 *      merged_into_project (idempotent — re-run is a no-op).
 *   2. Add a partial index `idx_digests_merged_into_project` where the column
 *      is non-null (cheap lookups for merged-project resolution).
 *   3. Record version 34 in schema_versions exactly once.
 *
 * Query layer must:
 *   - queryDigests: return rows where EITHER project matches OR
 *     merged_into_project matches.
 *   - queryDigestsMulti: same, but for a project list.
 *
 * Uses the in-memory SQLite pattern from tests/observation-digests-schema.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { MigrationRunner } from '../src/services/sqlite/migrations/runner.js';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import {
  queryDigests,
  queryDigestsMulti,
} from '../src/services/context/ObservationCompiler.js';
import type { ContextConfig } from '../src/services/context/types.js';

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface SchemaVersionRow {
  version: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the legacy v33 shape of observation_digests (no merged_into_project
 * column) so the v34 migration has something real to ALTER. Returns a raw
 * bun:sqlite Database with schema_versions records up to 33.
 */
function buildLegacyV33Db(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE schema_versions (
      id INTEGER PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  // Pre-record all migrations up to and including 33 so the v34 runner only
  // executes the new migration step.
  const now = new Date().toISOString();
  const insertVersion = db.prepare(
    'INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)'
  );
  for (const v of [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]) {
    insertVersion.run(v, now);
  }

  db.run(`
    CREATE TABLE observation_digests (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      project              TEXT    NOT NULL,
      period_start_epoch   INTEGER NOT NULL,
      period_end_epoch     INTEGER NOT NULL,
      period_kind          TEXT    NOT NULL CHECK(period_kind IN ('weekly', 'monthly')),
      obs_count            INTEGER NOT NULL,
      dominant_types       TEXT,
      dominant_concepts    TEXT,
      summary_text         TEXT    NOT NULL,
      facts                TEXT,
      files_touched        TEXT,
      created_at           TEXT    NOT NULL,
      created_at_epoch     INTEGER NOT NULL,
      UNIQUE(project, period_kind, period_start_epoch)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_digests_project_period
      ON observation_digests(project, period_kind, period_start_epoch DESC)
  `);

  return db;
}

function seedDigest(
  db: Database,
  opts: {
    project: string;
    periodStartEpoch: number;
    mergedIntoProject?: string | null;
    periodKind?: 'weekly' | 'monthly';
    summaryText?: string;
  }
): void {
  const created = opts.periodStartEpoch;
  const cols = db.query('PRAGMA table_info(observation_digests)').all() as ColumnInfo[];
  const hasMerged = cols.some((c) => c.name === 'merged_into_project');

  if (hasMerged) {
    db.prepare(
      `INSERT INTO observation_digests (
         project, merged_into_project, period_start_epoch, period_end_epoch,
         period_kind, obs_count, summary_text, created_at, created_at_epoch
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.project,
      opts.mergedIntoProject ?? null,
      opts.periodStartEpoch,
      opts.periodStartEpoch + 7 * 86_400_000,
      opts.periodKind ?? 'weekly',
      10,
      opts.summaryText ?? `summary ${opts.project} ${opts.periodStartEpoch}`,
      new Date(created).toISOString(),
      created
    );
  } else {
    db.prepare(
      `INSERT INTO observation_digests (
         project, period_start_epoch, period_end_epoch,
         period_kind, obs_count, summary_text, created_at, created_at_epoch
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.project,
      opts.periodStartEpoch,
      opts.periodStartEpoch + 7 * 86_400_000,
      opts.periodKind ?? 'weekly',
      10,
      opts.summaryText ?? `summary ${opts.project} ${opts.periodStartEpoch}`,
      new Date(created).toISOString(),
      created
    );
  }
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

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe('schema v34: observation_digests.merged_into_project', () => {
  it('adds the merged_into_project column on a legacy DB without it', () => {
    const db = buildLegacyV33Db();

    const before = db.query('PRAGMA table_info(observation_digests)').all() as ColumnInfo[];
    expect(before.some((c) => c.name === 'merged_into_project')).toBe(false);

    const runner = new MigrationRunner(db);
    runner.runAllMigrations();

    const after = db.query('PRAGMA table_info(observation_digests)').all() as ColumnInfo[];
    expect(after.some((c) => c.name === 'merged_into_project')).toBe(true);

    const versionRow = db
      .prepare('SELECT version FROM schema_versions WHERE version = ?')
      .get(34) as SchemaVersionRow | undefined;
    expect(versionRow?.version).toBe(34);

    db.close();
  });

  it('creates the partial index idx_digests_merged_into_project', () => {
    const db = buildLegacyV33Db();
    new MigrationRunner(db).runAllMigrations();

    const indexes = db.query('PRAGMA index_list(observation_digests)').all() as IndexRow[];
    const merged = indexes.find((i) => i.name === 'idx_digests_merged_into_project');
    expect(merged).toBeDefined();
    // It's a partial index, so the `partial` flag should be 1.
    expect(merged!.partial).toBe(1);

    db.close();
  });

  it('migration is idempotent — re-running does not throw or duplicate version', () => {
    const db = buildLegacyV33Db();
    new MigrationRunner(db).runAllMigrations();

    const before = db
      .query('SELECT COUNT(*) AS c FROM schema_versions WHERE version = 34')
      .get() as { c: number };

    // Re-run the migrations a second time on the same DB.
    expect(() => new MigrationRunner(db).runAllMigrations()).not.toThrow();

    const after = db
      .query('SELECT COUNT(*) AS c FROM schema_versions WHERE version = 34')
      .get() as { c: number };
    expect(after.c).toBe(before.c);
    expect(after.c).toBe(1);

    // Column is still there exactly once.
    const cols = db.query('PRAGMA table_info(observation_digests)').all() as ColumnInfo[];
    const mergedCols = cols.filter((c) => c.name === 'merged_into_project');
    expect(mergedCols.length).toBe(1);

    db.close();
  });

  it('schema_versions records version 34 on a fresh DB built via ClaudeMemDatabase', () => {
    const cm = new ClaudeMemDatabase(':memory:');
    try {
      const row = cm.db
        .prepare('SELECT version FROM schema_versions WHERE version = ?')
        .get(34) as SchemaVersionRow | undefined;
      expect(row?.version).toBe(34);

      const max = cm.db
        .prepare('SELECT MAX(version) AS version FROM schema_versions')
        .get() as SchemaVersionRow | undefined;
      expect(max?.version).toBeGreaterThanOrEqual(34);
    } finally {
      cm.db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Query layer tests
// ---------------------------------------------------------------------------

describe('queryDigests honours merged_into_project (schema v34)', () => {
  let store: SessionStore;

  beforeEach(() => {
    const cm = new ClaudeMemDatabase(':memory:');
    store = new SessionStore(cm.db);
  });

  afterEach(() => {
    try { store.db.close(); } catch { /* ignore */ }
  });

  it('returns digests where project = ? OR merged_into_project = ?', () => {
    const week = Date.parse('2026-05-04T00:00:00.000Z');

    // Same project: matches via project = ?.
    seedDigest(store.db, { project: 'demo', periodStartEpoch: week, summaryText: 'self' });

    // Different physical project, merged into 'demo': matches via merged_into_project = ?.
    seedDigest(store.db, {
      project: 'demo-legacy',
      mergedIntoProject: 'demo',
      periodStartEpoch: week + 86_400_000,
      summaryText: 'merged-in',
    });

    // Totally unrelated project — must NOT match.
    seedDigest(store.db, {
      project: 'other',
      periodStartEpoch: week + 2 * 86_400_000,
      summaryText: 'unrelated',
    });

    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 10 }));
    const texts = rows.map((r) => r.summary_text).sort();
    expect(texts).toEqual(['merged-in', 'self']);
  });

  it('queryDigestsMulti returns digests across multiple merge targets', () => {
    const week = Date.parse('2026-05-04T00:00:00.000Z');

    // 'alpha' physical project.
    seedDigest(store.db, { project: 'alpha', periodStartEpoch: week, summaryText: 'alpha-self' });

    // Old 'alpha-legacy' rows merged into 'alpha'.
    seedDigest(store.db, {
      project: 'alpha-legacy',
      mergedIntoProject: 'alpha',
      periodStartEpoch: week + 86_400_000,
      summaryText: 'alpha-merged',
    });

    // 'beta' physical project.
    seedDigest(store.db, { project: 'beta', periodStartEpoch: week + 2 * 86_400_000, summaryText: 'beta-self' });

    // Old 'beta-old' merged into 'beta'.
    seedDigest(store.db, {
      project: 'beta-old',
      mergedIntoProject: 'beta',
      periodStartEpoch: week + 3 * 86_400_000,
      summaryText: 'beta-merged',
    });

    // Unrelated.
    seedDigest(store.db, {
      project: 'gamma',
      periodStartEpoch: week + 4 * 86_400_000,
      summaryText: 'gamma-unrelated',
    });

    const rows = queryDigestsMulti(store, ['alpha', 'beta'], makeConfig({ digestCount: 20 }));
    const texts = rows.map((r) => r.summary_text).sort();
    expect(texts).toEqual(['alpha-merged', 'alpha-self', 'beta-merged', 'beta-self']);
  });

  it('queryDigests respects digestCount=0 short-circuit even when merge rows exist', () => {
    const week = Date.parse('2026-05-04T00:00:00.000Z');
    seedDigest(store.db, {
      project: 'demo-legacy',
      mergedIntoProject: 'demo',
      periodStartEpoch: week,
    });
    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 0 }));
    expect(rows).toEqual([]);
  });

  it('returned rows include the merged_into_project column (typed as string | null)', () => {
    const week = Date.parse('2026-05-04T00:00:00.000Z');
    seedDigest(store.db, {
      project: 'demo-legacy',
      mergedIntoProject: 'demo',
      periodStartEpoch: week,
    });
    const rows = queryDigests(store, 'demo', makeConfig({ digestCount: 5 }));
    expect(rows.length).toBe(1);
    expect(rows[0].merged_into_project).toBe('demo');
    expect(rows[0].project).toBe('demo-legacy');
  });
});
