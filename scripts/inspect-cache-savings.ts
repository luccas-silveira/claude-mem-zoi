#!/usr/bin/env bun
/**
 * inspect-cache-savings.ts — Fase 5 metrics inspection script
 *
 * Read-only inspection of the local claude-mem state. Prints a summary table
 * for the most recent sessions plus a set of "are the four phases still
 * present?" markers so any drift is obvious without running the test suite.
 *
 * Usage:
 *   bun scripts/inspect-cache-savings.ts             # default: last 10 sessions
 *   bun scripts/inspect-cache-savings.ts 25          # last 25 sessions
 *   npx tsx scripts/inspect-cache-savings.ts         # works under Node if tsx is installed
 *
 * Environment variables consulted:
 *   CLAUDE_MEM_DATA_DIR        — overrides ~/.claude-mem as the data root
 *   CLAUDE_MEM_PREFILTER_ENABLED — printed back so you can confirm the live setting
 *   CLAUDE_MEM_PROVIDER        — printed back (claude / ollama / deepseek / openrouter / gemini)
 *
 * Side effects: NONE. The script opens the SQLite DB read-only and the
 * filesystem walk is read-only. No DB writes, no network. Safe to run
 * against a live worker.
 *
 * Implementation note: uses `bun:sqlite` (already a runtime dep for the
 * worker) when invoked via Bun. Under tsx/Node it falls back to spawning
 * the `sqlite3` CLI so we don't add a new better-sqlite3 dependency.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
function resolveDataDir(): string {
  const override = process.env.CLAUDE_MEM_DATA_DIR;
  if (override && override.trim() !== '') return resolve(override);
  return join(homedir(), '.claude-mem');
}

const DATA_DIR = resolveDataDir();
const DB_PATH = join(DATA_DIR, 'claude-mem.db');
const REPO_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Argument parsing (single optional positional: session limit)
// ---------------------------------------------------------------------------
function parseLimit(): number {
  const raw = process.argv[2];
  if (!raw) return 10;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 500) {
    console.error(`Invalid limit ${JSON.stringify(raw)}; using 10.`);
    return 10;
  }
  return n;
}

// ---------------------------------------------------------------------------
// SQLite shim — bun:sqlite when available, sqlite3 CLI fallback.
// ---------------------------------------------------------------------------
interface QueryRunner {
  all(sql: string): Array<Record<string, unknown>>;
  close(): void;
}

async function openDb(path: string): Promise<QueryRunner> {
  // Prefer the in-process driver (~Bun).
  try {
    const mod = await import('bun:sqlite');
    const Database = (mod as { Database: new (p: string, opts?: unknown) => unknown }).Database;
    const db = new Database(path, { readonly: true }) as {
      query: (sql: string) => { all: () => Array<Record<string, unknown>> };
      close: () => void;
    };
    return {
      all: (sql: string) => db.query(sql).all(),
      close: () => db.close(),
    };
  } catch {
    // Fall back to the sqlite3 CLI. We shell out and parse JSON output —
    // slower but works under plain Node without adding a dep.
    const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      throw new Error(
        'Neither bun:sqlite nor the `sqlite3` CLI is available. Install ' +
        'sqlite3 or run this script with Bun.'
      );
    }
    return {
      all: (sql: string) => {
        const r = spawnSync('sqlite3', ['-json', path, sql], { encoding: 'utf8' });
        if (r.status !== 0) {
          throw new Error(`sqlite3 CLI failed: ${r.stderr}`);
        }
        const out = (r.stdout ?? '').trim();
        if (out === '') return [];
        return JSON.parse(out) as Array<Record<string, unknown>>;
      },
      close: () => {},
    };
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
function header(title: string): void {
  console.log('');
  console.log(`=== ${title} ===`);
}

function formatRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i])).join('  ');
}

// ---------------------------------------------------------------------------
// Section 1 — Session summary table
// ---------------------------------------------------------------------------
async function printSessionTable(db: QueryRunner, limit: number): Promise<void> {
  header(`Last ${limit} sessions`);

  const rows = db.all(
    `SELECT
       s.id                 AS session_db_id,
       s.content_session_id AS content_session_id,
       s.memory_session_id  AS memory_session_id,
       s.project            AS project,
       s.started_at_epoch   AS started_at_epoch,
       (SELECT COUNT(*) FROM pending_messages pm WHERE pm.session_db_id = s.id)            AS pending_total,
       (SELECT COUNT(*) FROM observations o WHERE o.memory_session_id = s.memory_session_id) AS obs_count,
       (SELECT COUNT(DISTINCT o.type) FROM observations o WHERE o.memory_session_id = s.memory_session_id) AS distinct_types
     FROM sdk_sessions s
     ORDER BY s.started_at_epoch DESC
     LIMIT ${limit}`
  );

  if (rows.length === 0) {
    console.log('(no sessions found)');
    return;
  }

  // NOTE: pending_messages does not track a "skipped" status — the prefilter
  // drops events before they reach the queue. Adding a counter would mean a
  // schema change. For now, the skipped column is omitted.
  const widths = [10, 30, 20, 8, 8, 6];
  console.log(formatRow(['session', 'project', 'started', 'pending', 'obs', 'types'], widths));
  console.log(formatRow(['-'.repeat(10), '-'.repeat(30), '-'.repeat(20), '-'.repeat(8), '-'.repeat(8), '-'.repeat(6)], widths));
  for (const r of rows) {
    const short = String(r.content_session_id ?? '').slice(0, 8);
    const project = String(r.project ?? '').slice(0, 30);
    const started = r.started_at_epoch
      ? new Date(Number(r.started_at_epoch)).toISOString().slice(0, 19).replace('T', ' ')
      : '(unknown)';
    console.log(
      formatRow(
        [
          short,
          project,
          started,
          String(r.pending_total ?? 0),
          String(r.obs_count ?? 0),
          String(r.distinct_types ?? 0),
        ],
        widths,
      ),
    );
  }
  console.log('');
  console.log('NOTE: pre-filter skips are not currently persisted; ' +
    'add a counter to track them historically.');
}

// ---------------------------------------------------------------------------
// Section 2 — Mode JSON sizes
// ---------------------------------------------------------------------------
function printModeSizes(): void {
  header('Mode JSON sizes (Fase 4 target)');
  const modes = [
    'plugin/modes/code.json',
    'plugin/modes/code--pt-br.json',
  ];
  for (const rel of modes) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      console.log(`  ${rel}: (missing)`);
      continue;
    }
    const bytes = statSync(abs).size;
    console.log(`  ${rel}: ${bytes} bytes`);
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Phase markers
// ---------------------------------------------------------------------------
function printPhaseMarkers(): void {
  header('Phase markers (presence check)');
  const checks: Array<{ label: string; check: () => boolean }> = [
    {
      label: 'Fase 1 — PrefilterDecider.ts exists',
      check: () => existsSync(join(REPO_ROOT, 'src/services/worker/http/PrefilterDecider.ts')),
    },
    {
      label: 'Fase 1 — SessionReadCache.ts exists',
      check: () => existsSync(join(REPO_ROOT, 'src/services/worker/http/SessionReadCache.ts')),
    },
    {
      label: 'Fase 1 — CLAUDE_MEM_PREFILTER_ENABLED in SettingsDefaultsManager',
      check: () => {
        const p = join(REPO_ROOT, 'src/shared/SettingsDefaultsManager.ts');
        return existsSync(p) && readFileSync(p, 'utf8').includes('CLAUDE_MEM_PREFILTER_ENABLED');
      },
    },
    {
      label: 'Fase 2 — buildSystemPrompt exported from src/sdk/prompts.ts',
      check: () => {
        const p = join(REPO_ROOT, 'src/sdk/prompts.ts');
        return existsSync(p) && /export\s+function\s+buildSystemPrompt/.test(readFileSync(p, 'utf8'));
      },
    },
    {
      label: 'Fase 3 — SYSTEM_PROMPT_DYNAMIC_BOUNDARY in ClaudeProvider.ts',
      check: () => {
        const p = join(REPO_ROOT, 'src/services/worker/ClaudeProvider.ts');
        return existsSync(p) && readFileSync(p, 'utf8').includes('SYSTEM_PROMPT_DYNAMIC_BOUNDARY');
      },
    },
    {
      label: 'Fase 3 — cache_control: ephemeral in OpenRouterProvider.ts',
      check: () => {
        const p = join(REPO_ROOT, 'src/services/worker/OpenRouterProvider.ts');
        return existsSync(p) && /cache_control:\s*\{\s*type:\s*['"]ephemeral['"]\s*\}/.test(readFileSync(p, 'utf8'));
      },
    },
    {
      label: 'Fase 4 — code.json has no type_guidance key',
      check: () => {
        const p = join(REPO_ROOT, 'plugin/modes/code.json');
        if (!existsSync(p)) return false;
        const j = JSON.parse(readFileSync(p, 'utf8')) as { prompts?: Record<string, unknown> };
        return j.prompts !== undefined && !('type_guidance' in (j.prompts ?? {}));
      },
    },
  ];

  for (const c of checks) {
    let ok = false;
    try { ok = c.check(); } catch { ok = false; }
    console.log(`  [${ok ? 'OK ' : 'MISS'}] ${c.label}`);
  }
}

// ---------------------------------------------------------------------------
// Section 3.5 — DeepSeek cost split (session vs digest)
//
// Parses log lines emitted by DeepSeekProvider.queryDeepSeekMultiTurn and
// DeepSeekProvider.compressDigest. Both write a `DeepSeek API usage` line
// containing a `kind` field. Legacy logs without `kind` default to 'session'
// so historical data still rolls up sensibly. Pure parser — exported so the
// test suite can pin the regex without spawning the script.
// ---------------------------------------------------------------------------
export interface DeepSeekUsageEntry {
  kind: 'session' | 'digest';
  estimatedCostUSD: number;
}

export function parseDeepSeekUsageLine(line: string): DeepSeekUsageEntry | null {
  // Log shape (logger.ts → log()):
  //   [...] [INFO ] [SDK   ] DeepSeek API usage {kind=session, model=..., estimatedCostUSD=0.0042, ...}
  // The Logger writes context objects as `{k1=v1, k2=v2, ...}` at INFO level
  // and as pretty-printed JSON at DEBUG. We accept both — `kind=session` /
  // `"kind":"session"` and `estimatedCostUSD=0.0042` / `"estimatedCostUSD":"0.0042"`.
  if (!line.includes('DeepSeek API usage')) return null;
  const kindMatch = line.match(/(?:"kind"\s*:\s*"|kind=)(session|digest)\b/);
  const costMatch = line.match(/(?:"estimatedCostUSD"\s*:\s*"|estimatedCostUSD=)([0-9.]+)/);
  if (!costMatch) return null;
  const cost = Number(costMatch[1]);
  if (!Number.isFinite(cost)) return null;
  const kind = (kindMatch?.[1] as 'session' | 'digest' | undefined) ?? 'session';
  return { kind, estimatedCostUSD: cost };
}

function printDeepSeekCostSplit(): void {
  header('DeepSeek cost split (session vs digest)');
  const logsDir = join(DATA_DIR, 'logs');
  if (!existsSync(logsDir)) {
    console.log('  (no logs directory)');
    return;
  }
  let logFiles: string[] = [];
  try {
    logFiles = readdirSync(logsDir)
      .filter((f) => f.startsWith('claude-mem-') && f.endsWith('.log'))
      .map((f) => join(logsDir, f));
  } catch {
    console.log('  (failed to list logs directory)');
    return;
  }
  if (logFiles.length === 0) {
    console.log('  (no log files)');
    return;
  }
  let sessionCalls = 0;
  let sessionCost = 0;
  let digestCalls = 0;
  let digestCost = 0;
  for (const file of logFiles) {
    let content = '';
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      const entry = parseDeepSeekUsageLine(line);
      if (!entry) continue;
      if (entry.kind === 'digest') {
        digestCalls += 1;
        digestCost += entry.estimatedCostUSD;
      } else {
        sessionCalls += 1;
        sessionCost += entry.estimatedCostUSD;
      }
    }
  }
  console.log(
    `  DeepSeek calls — sessions: ${sessionCalls} calls, $${sessionCost.toFixed(4)}. ` +
    `digests: ${digestCalls} calls, $${digestCost.toFixed(4)}.`,
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Useful numbers
// ---------------------------------------------------------------------------
function printNumbers(): void {
  header('Mostly Useful Numbers');
  console.log(`  data dir:                       ${DATA_DIR}`);
  console.log(`  db path:                        ${DB_PATH}`);
  console.log(`  CLAUDE_MEM_PREFILTER_ENABLED:   ${process.env.CLAUDE_MEM_PREFILTER_ENABLED ?? '(unset)'}`);
  console.log(`  CLAUDE_MEM_PROVIDER:            ${process.env.CLAUDE_MEM_PROVIDER ?? '(unset)'}`);
  console.log(`  CLAUDE_MEM_DATA_DIR:            ${process.env.CLAUDE_MEM_DATA_DIR ?? '(unset)'}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`inspect-cache-savings — data root: ${DATA_DIR}`);

  if (!existsSync(DB_PATH)) {
    console.log(`(DB not found at ${DB_PATH}; skipping session table)`);
    printModeSizes();
    printPhaseMarkers();
    printDeepSeekCostSplit();
    printNumbers();
    return;
  }

  const limit = parseLimit();
  const db = await openDb(DB_PATH);
  try {
    await printSessionTable(db, limit);
  } finally {
    db.close();
  }

  printModeSizes();
  printPhaseMarkers();
  printDeepSeekCostSplit();
  printNumbers();
}

// Only auto-run when executed as a script (not when imported by the test suite
// for `parseDeepSeekUsageLine`). Bun sets `import.meta.main` on the entrypoint;
// the same check works under tsx/Node too since imports never set that flag.
if ((import.meta as { main?: boolean }).main) {
  main().catch((err: unknown) => {
    console.error('inspect-cache-savings failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
