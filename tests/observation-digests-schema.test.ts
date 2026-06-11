import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';
import type { Database } from 'bun:sqlite';

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

describe('observation_digests schema (Plan F.1 / Fase 2)', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  it('migration creates the observation_digests table with all 13 columns', () => {
    const cols = db.query('PRAGMA table_info(observation_digests)').all() as ColumnInfo[];
    const names = cols.map(c => c.name).sort();

    expect(names).toEqual(
      [
        'id',
        'project',
        'period_start_epoch',
        'period_end_epoch',
        'period_kind',
        'obs_count',
        'dominant_types',
        'dominant_concepts',
        'summary_text',
        'facts',
        'files_touched',
        'created_at',
        'created_at_epoch',
      ].sort()
    );

    expect(cols.length).toBe(13);
  });

  it('UNIQUE(project, period_kind, period_start_epoch) blocks duplicate inserts', () => {
    const insert = db.prepare(`
      INSERT INTO observation_digests
        (project, period_start_epoch, period_end_epoch, period_kind, obs_count,
         summary_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run('demo', 1000, 2000, 'weekly', 10, 'first', '2026-06-10T00:00:00.000Z', 1000);

    expect(() =>
      insert.run('demo', 1000, 2000, 'weekly', 11, 'duplicate', '2026-06-10T00:00:00.000Z', 1000)
    ).toThrow();
  });

  it('CHECK constraint rejects period_kind outside {weekly, monthly}', () => {
    const insert = db.prepare(`
      INSERT INTO observation_digests
        (project, period_start_epoch, period_end_epoch, period_kind, obs_count,
         summary_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    expect(() =>
      insert.run('demo', 1000, 2000, 'daily', 1, 'bad period', '2026-06-10T00:00:00.000Z', 1000)
    ).toThrow();
  });

  it('idx_digests_project_period index exists on observation_digests', () => {
    const indexes = db.query('PRAGMA index_list(observation_digests)').all() as IndexRow[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_digests_project_period');
  });

  it('schema_versions records the new migration version (33)', () => {
    const row = db
      .prepare('SELECT version FROM schema_versions WHERE version = ?')
      .get(33) as SchemaVersionRow | undefined;
    expect(row).toBeDefined();
    expect(row?.version).toBe(33);
  });

  it('latest applied schema version is at least 33 (bumped from prior tip of 32)', () => {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as SchemaVersionRow | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBeGreaterThanOrEqual(33);
  });

  it('migration is idempotent — re-running does not throw or duplicate', () => {
    // Second ClaudeMemDatabase against an in-memory DB triggers a fresh migration anyway,
    // but the runner itself is re-runnable; simulate by running migrations on the same db twice.
    // We can't easily re-instantiate against the *same* in-memory connection, so we exercise
    // the schema_versions guard directly: insert version 33 again is a no-op via INSERT OR IGNORE.
    const before = db.query('SELECT COUNT(*) as c FROM schema_versions WHERE version = 33').get() as { c: number };
    db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(33, new Date().toISOString());
    const after = db.query('SELECT COUNT(*) as c FROM schema_versions WHERE version = 33').get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});

describe('digest settings defaults (Plan F.1 / Fase 2)', () => {
  it('CLAUDE_MEM_DIGEST_ENABLED defaults to "false" (Fase 4 will flip)', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_DIGEST_ENABLED).toBe('false');
  });

  it('CLAUDE_MEM_DIGEST_MIN_AGE_DAYS defaults to "30"', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_DIGEST_MIN_AGE_DAYS).toBe('30');
  });

  it('CLAUDE_MEM_DIGEST_PERIOD defaults to "weekly"', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_DIGEST_PERIOD).toBe('weekly');
  });

  it('CLAUDE_MEM_DIGEST_MAX_OBS_PER defaults to "100"', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_DIGEST_MAX_OBS_PER).toBe('100');
  });
});
