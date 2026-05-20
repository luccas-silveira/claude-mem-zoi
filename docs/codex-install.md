# Installing claude-mem in Codex CLI

This fork of claude-mem ships native Codex 0.131.0+ support. Once installed, both Claude Code and Codex sessions in the same git repository share the same memory bucket.

## Prerequisites

- Codex CLI 0.131.0 or later (verify with `codex --version`)
- This fork cloned to a stable local path (NOT a temporary directory — Codex remembers the path)
- A working LLM provider configured for claude-mem in `~/.claude-mem/settings.json` (see main README)

## One-time setup

```bash
# 1. Clone the fork to a stable location
git clone https://github.com/luccas-silveira/claude-mem-zoi.git ~/Code/claude-mem-zoi

# 2. Install dependencies + build
cd ~/Code/claude-mem-zoi
bun install
bun run build

# 3. Register the local clone as a Codex marketplace
codex plugin marketplace add claude-mem ~/Code/claude-mem-zoi

# 4. Install the plugin
codex plugin add claude-mem --marketplace claude-mem
```

## Trust prompt on first run

The first time you start a Codex session in a project where the plugin is active, Codex will prompt you to approve the hook commands (something like `node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex context`). Approve them. The approval is persisted per plugin version.

If you want to skip the prompt for scripted scenarios only, you can use:

```bash
codex --dangerously-bypass-hook-trust ...
```

Only use that flag if you trust the plugin source — this fork lives at `luccas-silveira/claude-mem-zoi` and contains only the code you cloned.

## Verifying the install

After installing, in a new shell:

```bash
# 1. Plugin shows up as enabled
codex plugin list | grep claude-mem

# 2. MCP server is registered with status enabled
codex mcp list | grep claude-mem
```

Then `cd` into any git repo and run `codex`. On session start you should see a `Loading claude-mem context` status flash; the worker process appears in `ps aux | grep worker-service.cjs`.

## Shared memory between Claude Code and Codex

Project bucketing uses the **git repository root**, not the current directory. So:

- `codex` invoked from `/repo/src` and Claude Code invoked from `/repo` → same memory bucket (git-root basename: `repo`).
- `codex` invoked from `/some/dir/without-git/myproject` → falls back to `basename(cwd) = myproject`.

If you have older observations that were keyed by a subdirectory's basename (because you invoked Claude Code from `/repo/src` historically), they remain readable automatically — `getProjectContext.allProjects` includes both the git-root key and the legacy basename key during reads.

## Uninstalling

```bash
codex plugin remove claude-mem
codex plugin marketplace remove claude-mem
```

This does not touch `~/.claude-mem/` data. Claude Code's installation is independent and unaffected.

## Troubleshooting

- **Hooks silently do nothing.** Check `~/.claude-mem/logs/worker.log`. Most common cause is the provider being out of credit (status 402) or unreachable.
- **`codex mcp list` shows the server as disabled.** Re-run `codex plugin add claude-mem --marketplace claude-mem` to refresh the registration.
- **Codex picks up a stale plugin version after you edit the fork.** Run `codex plugin marketplace upgrade claude-mem` then `codex plugin add claude-mem --marketplace claude-mem` again.
