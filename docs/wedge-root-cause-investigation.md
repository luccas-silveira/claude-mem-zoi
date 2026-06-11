# Worker "healthy but not ready" wedge — root cause investigation

Investigator: read-only structural analysis (2026-06-11)
Affected versions: observed on 13.2.0 (worker), repo `claude-mem` 12.7.4-zoi.1
Trigger: `npm run build-and-sync` while sessions are active
Recurrence: at least 3x in one engineering session

## 1. Executive summary

`npm run build-and-sync` restarts the worker by chaining
`worker:restart && queue:clear`. During the window between the *old* worker
beginning graceful shutdown and the *new* worker completing
`initializeBackground()`, a SQLite `database is locked` error is thrown on
the very first call into `DatabaseManager.initialize()`. The error is
swallowed by a generic `try { ... } catch { logger.error(...) }` in
`WorkerService.initializeBackground()` with **no retry, no process exit,
no error flag flip**. The HTTP server is already listening because
`start()` listened *before* the background init was scheduled, so:

| endpoint        | response after lock error | source                                |
| --------------- | ------------------------- | ------------------------------------- |
| `/api/health`   | `200 ok`                  | `Server.ts:161` — static fields only  |
| `/api/readiness`| `503`                     | `Server.ts:178` — gated by `initializationCompleteFlag` |
| `/api/...`      | `503 "Service initializing"` | `worker-service.ts:240` middleware |

Hooks then enter the user-facing failure mode at
`worker-utils.ts:282`: `Worker is healthy but not ready; skipping hook
API call`. The worker is a permanently-wedged zombie until manually
killed.

Three independent flaws compound to produce this:

1. **No `PRAGMA busy_timeout`** anywhere in the SQLite layer. With `bun:sqlite`
   defaulting to a 0ms timeout, any concurrent writer in another process
   produces an immediate `SQLITE_BUSY`.
2. **`DatabaseManager.initialize()` opens the shared `Database` connection
   *without* applying any PRAGMAs** (WAL, busy_timeout, foreign_keys). The
   `SessionStore` / `SessionSearch` constructors only apply PRAGMAs when
   they themselves open the file (`dbPathOrDb` is a string); when handed a
   pre-opened `Database` object — exactly what `DatabaseManager` does — they
   skip the PRAGMA branch entirely. The shared worker connection therefore
   runs in **journal_mode = delete (rollback journal), busy_timeout = 0**.
3. **`initializeBackground()` has no failure path**. When DB init throws,
   the catch block at `worker-service.ts:424–426` only logs. The worker
   never sets a "failed" state, never crashes, never retries. The
   `initializationCompleteFlag` stays `false` forever and the `/api/health`
   endpoint keeps reporting OK.

Recommended fix: in the catch block, mark the worker as terminally
failed and call `process.exit(1)` so the next hook call lazy-spawns a
fresh worker. Also add `PRAGMA busy_timeout = 5000` (or higher) to the
shared connection, and apply WAL/foreign_keys PRAGMAs on the pre-opened
`Database` path inside `DatabaseManager.initialize()`. These three
changes are independently small and each removes one link in the
failure chain.

## 2. Reproduction (from logs, not synthetic)

Captured timeline from `~/.claude-mem/logs/claude-mem-2026-06-11.log`
around the most recent occurrence (timestamps verbatim):

```
00:38:50.345  [SYSTEM]      Shutdown initiated                         (old worker, perform GracefulShutdown step 1)
              ...                                                       (old worker's later "Worker shutdown complete" never appears in the log — graceful shutdown stalled)
00:38:51.687  [SYSTEM]      Restarting worker                          (NEW process, restart CLI handler)
00:38:51.696  [SYSTEM] ERR  Shutdown request failed unexpectedly
                            Unable to connect. Is the computer able to access the url?
00:38:51.702  [SYSTEM]      Worker restart spawned {pid=20479}
00:38:51.870  [SYSTEM]      HTTP server started                       (new worker — listens BEFORE init)
00:38:51.875  [SYSTEM]      Worker started
00:38:51.876  [WORKER]      Background initialization starting...
00:38:51.879  [SYSTEM]      ChromaMcpManager initialized (lazy)
00:38:51.879  [WORKER]      Initializing database manager...
00:38:51.880  [SYSTEM] ERR  Background initialization failed database is locked
00:38:51.880  [WORKER] ERR  Worktree adoption failed (background) database is locked

  [hooks now wedge for every subsequent prompt:]

00:39:33.107  [SYSTEM] WARN Worker is healthy but not ready; skipping hook API call
00:39:34.949  [SYSTEM] WARN Worker is healthy but not ready; skipping hook API call
... (repeats for ~5 minutes until user kills the worker process by hand)
```

Reproduction steps (mechanical):

1. Open a Claude Code session — let it ENQUEUE a couple of in-flight
   observations so that `sessionManager.shutdownAll()` will have work
   to drain.
2. From a shell in the repo, run `npm run build-and-sync`.
3. While the script is running, fire one more tool call in the
   Claude Code session (a `Bash` or `Read`).

What happens internally:

- The repo's `npm run worker:restart` runs `bun plugin/scripts/worker-service.cjs restart`,
  hitting `case 'restart'` (`worker-service.ts:904`):
    - `httpShutdown(port)` to the *old* worker.
    - `waitForPortFree(port, 5000)` then `spawnDaemon(__filename, port)`.
- In parallel, the *old* worker's `performGracefulShutdown` is still
  running. The old worker logs `Shutdown initiated` (00:38:50.345)
  but **never logs `Worker shutdown complete`** in the captured trace.
  It is stuck waiting on `sessionManager.shutdownAll()` because at
  least three sessions had in-flight generators / queue work, and the
  HTTP server already closed (so the second `httpShutdown` from the
  `restart` CLI hits ECONNREFUSED).
- The OS keeps the SQLite file lock alive as long as the old `bun`
  process is alive. The old process is alive because graceful shutdown
  is blocked.
- The new daemon spawns at 00:38:51.702. By 00:38:51.880 it tries
  `new Database(DB_PATH)` inside `DatabaseManager.initialize()`.
  The pre-existing rollback-journal lock on the database file is
  detected immediately (no `busy_timeout` to wait on). SQLITE_BUSY
  surfaces as `database is locked`, the `await this.dbManager.initialize()`
  promise rejects, control jumps to the catch block, and that is the
  end of `initializeBackground`.

The next user prompt walks through `ensureWorkerRunning` → `isWorkerPortAlive`
(true, the new worker's HTTP server is up) → `waitForWorkerReadiness`
(`/api/readiness` → 503 every poll) → after 10s the
`HOOK_READINESS_TIMEOUT_MS` budget elapses → log line at
`worker-utils.ts:282` and hook returns `false`.

## 3. Hypothesis matrix

### H1 (CONFIRMED) — DB-lock-during-init crashes background init silently

Evidence:

- `worker-service.ts:347–348` calls `await this.dbManager.initialize()`.
- `worker-service.ts:424–426` catches *any* throw, logs once, and returns.
- `worker-service.ts:391` (where `initializationCompleteFlag = true` is
  set) is *inside* the try block and is unreachable if DB init throws.
- Log at 00:38:51.880 captures the exact throw and the swallow.

Once swallowed, the worker is wedged: `Server.ts:178–189` returns 503
on `/api/readiness` while `Server.ts:161` happily returns 200 on
`/api/health`.

This single fact is the user-facing symptom and the only failure mode
that *requires* manual cleanup to escape.

### H2 (CONFIRMED) — Shared SQLite connection runs with no PRAGMAs

Evidence:

- `DatabaseManager.ts:17–32`:
  ```ts
  async initialize(): Promise<void> {
    this.db = new Database(DB_PATH);          // <-- bare open, no PRAGMAs
    this.sessionStore = new SessionStore(this.db);
    this.sessionSearch = new SessionSearch(this.db);
    ...
  }
  ```
- `SessionStore.ts:34–47`:
  ```ts
  constructor(dbPathOrDb: string | Database = DB_PATH) {
    if (dbPathOrDb instanceof Database) {
      this.db = dbPathOrDb;                   // <-- pre-opened path: PRAGMAs SKIPPED
    } else {
      ...
      this.db = new Database(dbPathOrDb);
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
      this.db.run('PRAGMA foreign_keys = ON');
      this.db.run('PRAGMA journal_size_limit = 4194304');
    }
    this.initializeSchema();
    ...
  }
  ```
- `SessionSearch.ts:23–30` mirrors the same skip-on-pre-opened branch.
- `grep -rn "busy_timeout\|busyTimeout" src/` returns zero hits.

Consequences for the shared worker connection:

- `journal_mode = delete` (the SQLite default), not WAL. Readers and
  writers cannot interleave; any other connection's write transaction
  locks out all opens.
- `busy_timeout = 0`. `SQLITE_BUSY` is raised immediately, with no
  wait window.
- `foreign_keys = OFF`. (Likely separate latent risk for
  cascade-delete tests, not this wedge.)

This is the *enabler* for H1: an instantaneous external lock window
(from queue:clear, from the old worker's graceful shutdown still
holding fds, or from a transcript watcher in the new worker started
slightly later) is enough to trigger SQLITE_BUSY.

Note: `scripts/clear-failed-queue.ts:77` runs `PRAGMA journal_mode = WAL`
on its own connection. That promotes the database file to WAL mode
*globally* — but **only after** queue:clear opened it. If queue:clear
runs before the new worker (it cannot in `build-and-sync`, but it can
in other orderings), the worker would inherit WAL. If the worker opens
*first* with default delete-journal and a writer arrives, the worker
forces an exclusive lock, which is what surfaces here.

### H3 (CONTRIBUTING) — `npm run build-and-sync` shell chain has a race

The chain is:

```
npm run build && npm run sync-marketplace && sleep 1
  && (cd ~/.claude/plugins/marketplaces/thedotmack && npm run worker:restart)
  && npm run queue:clear
```

- `worker:restart` runs the `case 'restart'` block in `worker-service.ts:904–921`.
  That block does `httpShutdown(port)` then `waitForPortFree(port, 5000)` then
  `spawnDaemon`. It exits 0 as soon as the daemon is *spawned*, not as soon
  as it is *ready*.
- `queue:clear` then runs `scripts/clear-failed-queue.ts` which opens the
  DB and `DELETE`s rows. This is a writer.
- In the same window, the *old* worker is still in `performGracefulShutdown`
  — its `dbManager.close()` runs *after* `sessionManager.shutdownAll()` in
  `GracefulShutdown.ts:38–53`. If sessions are draining, the old worker's
  SQLite handle is still open.
- Plus, the new worker's `initializeBackground` runs `dbManager.initialize()`
  and a `UPDATE pending_messages SET status='pending' WHERE status='processing'`
  sweep (`worker-service.ts:350–358`) — another writer.

Up to four processes can be holding/contending the same SQLite file at
the same point in time: old worker (graceful-shutdown-stalled), new
worker (init), queue:clear, and the previous worker's `chroma-mcp`
subprocess writing through `ChromaSyncState`. With `busy_timeout = 0`
and `journal_mode = delete`, any contention is fatal.

The chain itself is not buggy in isolation. It only matters because
H1 + H2 do not tolerate it.

### H4 (DISPROVEN) — Ollama / nomic-embed-text dependency blocks ChromaSync init

Suspected because the troubleshooting doc mentioned `ollama serve` as
part of the manual recovery.

Evidence against:

- `worker-service.ts:340–345`: `ChromaMcpManager.getInstance()` is the
  only thing initialised on the Chroma path during background init and
  it is **explicitly lazy** — the comment says "lazy - connects on
  first use". Confirmed in `ChromaMcpManager.ts:36–41`: `getInstance()`
  returns the singleton, it never calls `ensureConnected()`.
- `ChromaSync.backfillAllProjects` is fired *after* the worker has
  already flipped `initializationCompleteFlag = true`
  (`worker-service.ts:398–402`). It runs in a `.then().catch()` chain
  that is logged as "non-blocking". A failure here cannot wedge the
  worker.
- The embedding model (`nomic-embed-text` / Ollama) lives inside the
  `chroma-mcp` Python subprocess, which is only spawned on the *first*
  `callTool()` invocation of `ChromaMcpManager`. Background init never
  calls a tool.
- The log at 00:38:51.879 confirms `ChromaMcpManager initialized (lazy
  - connects on first use)` — the lazy init path executed and did not
  contact Ollama.

Ollama-down is a real *separate* failure mode (it would manifest as
`Backfill failed (non-blocking)` or `Deep probe failed at query stage`
errors in the log), but it cannot cause `/api/readiness` to return 503.

### H5 (DISPROVEN) — Race between `Port still bound after shutdown` and queue:clear

`Port still bound after shutdown` is logged by `worker-service.ts:909`
*only* when `waitForPortFree(port, 5000)` returns false, in which case
`process.exit(1)` is called and no daemon is spawned. The captured
trace shows the daemon *did* spawn (`Worker restart spawned`), so this
branch was not hit. The port-still-bound case is benign for this wedge
because it bails before the new worker can wedge.

### H6 (CONTRIBUTING, not root) — `httpShutdown` mis-detects connection refused on Bun

`HealthMonitor.ts:102–110`: the ECONNREFUSED detection only fires when
`error.message.includes('ECONNREFUSED')`. Bun's `fetch()` raises
`Unable to connect. Is the computer able to access the url?` on
connection refused — the substring check misses, the error is logged
as "Shutdown request failed unexpectedly", but the function still
returns false and the restart still proceeds. Cosmetic.

## 4. Recommended fix (specific, minimal, layered)

Three changes, each independent. **(A)** is sufficient to make the
wedge self-healing (worker dies, next hook lazy-spawns a fresh one).
**(B)** removes the SQLITE_BUSY root cause. **(C)** is best-practice
hardening that prevents future regressions of the same shape.

### (A) Stop swallowing init failures — exit the process

File: `src/services/worker-service.ts`, lines **424–426**.

Current:

```ts
} catch (error) {
  logger.error('SYSTEM', 'Background initialization failed', {}, error instanceof Error ? error : undefined);
}
```

Proposed:

```ts
} catch (error) {
  logger.error('SYSTEM', 'Background initialization failed', {}, error instanceof Error ? error : undefined);
  // The worker is now wedged: HTTP is up but /api/readiness will return
  // 503 forever because `initializationCompleteFlag` never flipped. Exit
  // so the wrapper / next hook call lazy-spawns a fresh daemon, instead
  // of leaving a half-alive zombie that breaks every subsequent hook.
  try { await this.shutdown(); } catch { /* best-effort */ }
  // The HTTP shutdown also runs inside shutdown(); if it fails (DB still
  // locked → graceful close hangs), force-exit on a short fallback timer.
  setTimeout(() => process.exit(1), 2000).unref();
  return;
}
```

Effect: the wedged state ceases to exist. Worker either initialises or
dies. The `case '--daemon'` handler at `worker-service.ts:1042–1083`
plus the lazy-spawn path at `worker-utils.ts:277–330` already handle
"worker not running" cleanly, so a restart loop is *normal* recovery,
not a fault.

Risk: if DB-lock failures are persistent (not transient), the worker
will exit repeatedly on every hook-driven respawn. That is loud but
*correct* behaviour — the user sees rapid retry instead of silent
wedge, and the log spells out the cause. Mitigate via (B).

### (B) Apply busy_timeout + WAL to the shared connection

File: `src/services/worker/DatabaseManager.ts`, line **18**.

Current:

```ts
async initialize(): Promise<void> {
  this.db = new Database(DB_PATH);

  this.sessionStore = new SessionStore(this.db);
  this.sessionSearch = new SessionSearch(this.db);
  ...
}
```

Proposed:

```ts
async initialize(): Promise<void> {
  this.db = new Database(DB_PATH);

  // The Database object is shared with SessionStore / SessionSearch.
  // Their constructors only apply PRAGMAs when they open the file
  // themselves; when handed an already-open Database (this path), the
  // PRAGMA branch is skipped. Apply them here so the shared worker
  // connection runs in WAL mode and waits on transient contention
  // (queue:clear, transcript watcher, hand-off from a previous worker
  // process) instead of failing immediately with SQLITE_BUSY.
  this.db.run('PRAGMA journal_mode = WAL');
  this.db.run('PRAGMA synchronous = NORMAL');
  this.db.run('PRAGMA foreign_keys = ON');
  this.db.run('PRAGMA busy_timeout = 5000');
  this.db.run('PRAGMA journal_size_limit = 4194304');

  this.sessionStore = new SessionStore(this.db);
  this.sessionSearch = new SessionSearch(this.db);
  ...
}
```

Effect: the SQLITE_BUSY → wedge chain is broken at its origin. A 5s
busy_timeout is enough to absorb the entire build-and-sync race window
(observed: 1.5s old-worker shutdown stall + a ~1ms queue:clear write).

Risk: minimal. WAL is already the convention everywhere else in this
codebase; this just closes a gap. busy_timeout = 5000 is well below
the worker's existing 10s HOOK_READINESS_WAIT and 30s READINESS_WAIT
budgets.

### (C) Defence in depth: add `busy_timeout` to every SessionStore/SessionSearch open

Files: `src/services/sqlite/SessionStore.ts` line 46,
`src/services/sqlite/SessionSearch.ts` line 29.

Add `this.db.run('PRAGMA busy_timeout = 5000');` after the existing
PRAGMA block in each. This prevents the same wedge if any other code
path opens the DB without going through `DatabaseManager`
(e.g. `clear-failed-queue.ts`, `regenerate-claude-md.ts`,
`adoptMergedWorktrees`, the ChromaSync.backfillAllProjects fallback
`new SessionStore()` path at `ChromaSync.ts:1092`).

Risk: none — purely additive.

### Out of scope but worth noting

- `case 'restart'` at `worker-service.ts:904–921` should
  `waitForReadiness` on the new daemon before exiting 0, otherwise
  `build-and-sync`'s subsequent `queue:clear` step races against
  worker init. Easy follow-up.
- `HealthMonitor.ts:103` should also match Bun's "Unable to connect"
  / `cause.code === 'ECONNREFUSED'` shape to avoid the misleading
  "Shutdown request failed unexpectedly" log line. Cosmetic.

## 5. Risk assessment of the recommended fix

| change | blast radius | reversible? | confidence |
| ------ | ------------ | ----------- | ---------- |
| (A) exit on init failure | only the daemon process; recovery is the same as a normal restart | yes — single 3-line block, trivially revertable | high |
| (B) PRAGMAs on shared connection | the shared worker SQLite connection; affects every read/write through DatabaseManager | yes — 5 lines, no schema change | high |
| (C) busy_timeout in SessionStore/SessionSearch | every connection opened via these classes | yes — single line each | high |

No data-layout changes. No API contract changes. No new dependencies.
No changes to hook protocol. The only externally visible behaviour
change is: a worker that previously wedged is now a worker that
exits-and-respawns once on the same condition (and after (B), does
not even hit the wedge condition in the first place).

## 6. Test plan to verify the fix

### Unit-style (offline)

1. Write a test that constructs `DatabaseManager`, externally opens
   the same DB file from a second `bun:sqlite` connection in default
   journal mode, holds an exclusive write transaction, and asserts
   that `DatabaseManager.initialize()` succeeds within ~3s rather
   than throwing immediately. Verifies (B).
2. Write a test that forces `dbManager.initialize` to throw (mock or
   bad path) and asserts that the worker process attempts to call
   `shutdown` and then exit. Verifies (A).

### Integration / smoke

3. Reproduce by hand from a clean state:
   - Start a Claude Code session, fire 2–3 tool calls so queue depth > 0.
   - In a second shell, `npm run build-and-sync`.
   - Fire one more tool call in the session during the restart window.
   - **Before fix**: hooks log `Worker is healthy but not ready` and
     UserPromptSubmit is blocked. PID file and `CAPTURE_BROKEN` need
     manual cleanup.
   - **After fix (A)**: in the worst case the daemon process exits
     once with a clean "Background initialization failed" error, then
     the next hook lazy-spawns a fresh daemon that reaches "ready"
     cleanly (log: `Core initialization complete (DB + search ready)`).
   - **After fix (B)**: no exit needed, `dbManager.initialize()`
     simply waits up to 5s for the foreign lock and succeeds.

4. Grep `~/.claude-mem/logs/` for `healthy but not ready` over a week
   of normal use after the fix lands. Expectation: zero hits.

5. `lsof ~/.claude-mem/claude-mem.db` immediately after
   `build-and-sync`: expect a single worker process (plus possibly a
   short-lived queue:clear writer) — no duplicate / zombie holders.

### Regression guard

6. Add a test that asserts every public DB-opening constructor
   (`SessionStore`, `SessionSearch`) issues `PRAGMA busy_timeout` and
   `PRAGMA journal_mode = WAL` — fails if a future refactor drops
   either. Keeps (C) honest.

## 7. Confidence and gaps

Confidence: **high** on the wedge mechanism itself. The log evidence
is direct: `database is locked` → swallowed by the catch block →
`initializationCompleteFlag` never flips → `Worker is healthy but not
ready` appears within seconds and persists. Both the missing PRAGMA
and the missing exit-on-failure are observable in source.

Open questions worth a follow-up log capture (do not block the fix):

- Which process exactly holds the DB lock at 00:38:51.880 — the old
  worker's stuck `performGracefulShutdown`, the `queue:clear` subprocess,
  or both? `lsof` snapshots at the moment of failure would settle this,
  but it does not change the recommended fix — (A) + (B) work
  regardless of which process is the holder.
- Why does the old worker's `performGracefulShutdown` not complete?
  `sessionManager.shutdownAll()` is the likely culprit (it awaits
  in-flight generator promises) but is outside the scope of this
  investigation. Worth a separate review of the shutdown timeout
  guarantees once the immediate wedge is closed.

## 8. Related files (for follow-up)

- `src/services/worker-service.ts` — `initializeBackground` swallow site (424–426)
- `src/services/worker/DatabaseManager.ts` — bare `new Database(DB_PATH)` (17–32)
- `src/services/sqlite/SessionStore.ts` — pre-opened branch skips PRAGMAs (34–47)
- `src/services/sqlite/SessionSearch.ts` — same pattern (23–35)
- `src/services/server/Server.ts` — `/api/health` vs `/api/readiness` divergence (160–190)
- `src/shared/worker-utils.ts` — `Worker is healthy but not ready` log site (282)
- `src/services/infrastructure/GracefulShutdown.ts` — shutdown ordering (30–58)
- `scripts/clear-failed-queue.ts` — concurrent DB writer (76–119)
- `package.json` — `build-and-sync` chain (line 69)
