# Codex Shared Memory — Implementation Plan

## Goal

Enable shared project memory between Claude Code and Codex CLI sessions running in the same project, with bidirectional capture and read access.

## Outcome

When a user works in project `X` with either Claude Code or Codex CLI:
- Observations captured by one CLI become available to the other.
- Context is auto-injected into new sessions of either CLI from the shared memory bucket.
- No background daemon or LaunchAgent required.

## Architecture

Native Codex plugin path. Codex CLI 0.131.0 supports plugins, hooks, and MCP servers natively (verified: `--dangerously-bypass-hook-trust` flag exists; `codex mcp list` shows registered servers; `.codex-plugin/plugin.json` schema documented in `~/.codex/.tmp/plugins/README.md`).

```
Claude Code session ─┐
                     ├──► claude-mem worker (singleton, PID-locked)
                     │      ├── SQLite (~/.claude-mem/data.db)
                     │      └── Chroma (local vector store)
Codex CLI session  ──┘
```

Both CLIs trigger:
- `SessionStart` → worker injects shared context
- `UserPromptSubmit`/`PostToolUse` → worker records events
- `Stop` → worker summarises session into observations

The Codex adapter (`src/cli/adapters/codex.ts`) and worker hook command (`worker-service.ts` `hook codex <event>`) already exist and are production-quality. The bundled `plugin/hooks/codex-hooks.json` already wires every event. The MCP server (`plugin/scripts/mcp-server.cjs`) already auto-spawns the worker via `ensureWorkerStarted`.

The remaining work is plumbing fixes (path resolution, project keying, MCP manifest split) and install documentation.

## Resolved Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Read-only vs bidirectional from Codex | Bidirectional | Without write-side, Codex sessions disappear from memory. Native Codex hooks make bidirectional cheap. |
| 2 | Capture mechanism | Native Codex hooks (not file-watcher) | Codex 0.131.0 ships hook execution. No daemon needed. Determinism per event. |
| 3 | Capture lifecycle | Per-event via hooks | No LaunchAgent. Hooks fire inside Codex process. |
| 4 | Plugin distribution | Local install (`codex plugin marketplace add /local/path`) | No marketplace publishing. User clones fork, points Codex at clone. |
| 5 | Project keying | Normalise to git root (with fallback) | `basename(cwd)` splits memory if Codex/CC invoked from different subdirs. Git-root makes sharing actually shared. |
| 6 | Path resolution in hooks/MCP | Relative paths (`./scripts/…`) | Codex sets cwd to plugin install dir before exec. Same convention used by `figma` plugin. `CLAUDE_PLUGIN_ROOT` env var is Claude Code-only and won't resolve on Codex. |
| 7 | `.mcp.json` for Codex | Separate `plugin/.codex-plugin/.mcp.json` | Avoids breaking Claude Code which depends on env-var-based command in `plugin/.mcp.json`. |
| 8 | Memory migration | None; dual-key fallback on read | Search queries try git-root key first, fall back to legacy basename key if empty. Zero downtime, zero data loss. |
| 9 | Execution mode | Plan only (this document) | User reviews before any commits. |

## Work Items

### 1. Fix Codex hook path resolution
**File:** `plugin/hooks/codex-hooks.json`
Replace `_R="${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}"; …; exec node "$_P/scripts/…"` with relative `node ./scripts/…`. Affects all 5 hook entries (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`).

Worker-spawn hook may also need adjustment — currently calls `bun-runner.js` then `worker-service.cjs start`; relative path version is `node ./scripts/bun-runner.js ./scripts/worker-service.cjs start`.

### 2. Create Codex-specific MCP manifest
**File:** `plugin/.codex-plugin/.mcp.json` (new)
```json
{
  "mcpServers": {
    "claude-mem": {
      "command": "node",
      "args": ["./scripts/mcp-server.cjs"],
      "cwd": "."
    }
  }
}
```

### 3. Point Codex plugin manifest at the new MCP file
**File:** `plugin/.codex-plugin/plugin.json`
Change `"mcpServers": "./.mcp.json"` → `"mcpServers": "./.codex-plugin/.mcp.json"`.

Note: paths in `.codex-plugin/plugin.json` resolve relative to the plugin root (verified via `computer-use` plugin), not relative to the manifest directory.

### 4. Git-root project keying with legacy fallback
**File:** `src/utils/project-name.ts`
- New helper `findGitRoot(cwd)` walks up from `cwd` looking for `.git`. Returns `null` if not found.
- `getProjectName(cwd)` first tries `basename(gitRoot)` if a git root is detected; otherwise falls back to current `basename(cwd)` behaviour.
- Worktree handling continues via existing `detectWorktree`.

**File:** `src/services/worker-service.ts` (or `SessionManager.ts` where reads happen)
- When reading observations for a project, query primary key (git-root basename). If result is empty, retry with legacy basename(cwd) key. Log a debug entry when fallback hits so we can quantify orphan memories over time.

Risk: if existing memories live under `gitRoot-basename` already (the common case for projects always invoked from root), this is a no-op. If they don't, fallback transparently recovers them.

### 5. Version bump and changelog entry
**File:** `package.json` and `.claude-plugin/marketplace.json` and `plugin/.claude-plugin/plugin.json` and `plugin/.codex-plugin/plugin.json`
Bump from `12.7.4` (fork divergence point) to a fork-specific version like `12.7.4-zoi.1` so Claude Code's `installed_plugins.json` cache key (`13.2.0` from upstream) doesn't collide.

**File:** `CHANGELOG.md`
Add entry under a new version header documenting:
- Codex plugin support
- Git-root project keying with legacy fallback
- Path resolution fix in `codex-hooks.json`

### 6. Install documentation
**File:** `docs/codex-install.md` (new)
Step-by-step:
```bash
# clone fork to a stable location (NOT a temp dir — Codex points at this path)
git clone https://github.com/luccas-silveira/claude-mem-zoi.git ~/Code/claude-mem-zoi

# register as a Codex marketplace
codex plugin marketplace add claude-mem ~/Code/claude-mem-zoi

# install the plugin
codex plugin add claude-mem --marketplace claude-mem
```
Plus a note about the first-run trust prompt (Codex will ask the user to approve the hook commands).

### 7. Operational prerequisite: working LLM provider
DeepSeek balance currently exhausted (status 402). Either:
- Top up at `platform.deepseek.com`
- OR switch `CLAUDE_MEM_PROVIDER` in `~/.claude-mem/settings.json` to `gemini` (key already present) or `claude` (uses CLI auth)

Without a working provider, summarisation fails and no observations are written, so E2E test of the Codex install will appear to do nothing useful.

## Test Plan

Run after items 1–6 are implemented.

1. **Hook discovery.** `codex plugin add claude-mem --marketplace claude-mem` succeeds without error.
2. **MCP registration.** `codex mcp list` includes `claude-mem` with `enabled` status.
3. **First session — Codex.** From the test project root, run `codex`. Observe:
   - SessionStart hook fires (look for `Loading claude-mem context` status message).
   - Worker process appears in `ps aux | grep worker-service`.
   - `~/.claude-mem/worker.pid` exists and matches.
4. **Cross-CLI read.** Have Claude Code write an observation in the same project, then open Codex and ask it to recall the observation via `search`. Codex MCP `search` returns the CC-written observation.
5. **Cross-CLI write.** Reverse direction. Codex session completes (Stop fires), summary lands in SQLite. Open Claude Code in same project; CC SessionStart injects context including the Codex-written summary.
6. **Git-root keying.** Run Codex from `<project>/src/` subdir. Confirm session is keyed by git-root basename, not `src`.
7. **Legacy fallback.** Manually insert an observation with the legacy `basename(cwd)` key for a project where it differs from git-root. Run `search` from CC or Codex. Confirm fallback hits.

## Risks

| Risk | Mitigation |
|------|------------|
| Codex hook trust prompt scares user | Document in `docs/codex-install.md` with screenshot of expected prompt |
| Codex doesn't actually `chdir` to plugin dir before exec | Test item 1 catches this; fallback to wrapper script if confirmed broken |
| Concurrent CC + Codex sessions race on worker PID file | Worker spawner uses lockfile pattern; verify under load before declaring stable |
| `package.json` version bump breaks Claude Code's `cache/thedotmack/claude-mem/13.2.0/` pin | Use a pre-release suffix that doesn't change the major-pinned cache dir |
| User's git clone path changes (moves repo) | Marketplace registration is path-based; document re-running `codex plugin marketplace add` after relocation |

## Out of Scope

- Marketplace publishing (separate effort if usage grows)
- Cursor / Gemini CLI integrations (worker already supports them, but install docs and testing not included here)
- Schema changes to observations (Codex sessions reuse existing schema)
- Cross-machine memory sync (still single-machine; Chroma + SQLite live locally)
