# Codex Shared Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make claude-mem usable from Codex CLI so that Codex sessions read/write the same project memory bucket as Claude Code sessions in the same project.

**Architecture:** Ship claude-mem as a native Codex plugin. Codex 0.131.0 has built-in support for plugins, hooks, and MCP servers, and the codebase already contains a Codex adapter (`src/cli/adapters/codex.ts`), a Codex hooks manifest (`plugin/hooks/codex-hooks.json`), and a Codex plugin manifest (`plugin/.codex-plugin/plugin.json`). The remaining work is plumbing fixes (path resolution, MCP manifest split), git-root project keying so the two CLIs end up in the same memory bucket, and install documentation. No background daemon, no LaunchAgent, no new providers.

**Tech Stack:** TypeScript, Bun (runtime + test runner), Node (plugin scripts via `node`/`bun-runner.js`), Codex CLI 0.131.0 plugin format (`.codex-plugin/plugin.json`).

---

## Context for the Engineer

You may have zero prior context for claude-mem. Read these in order before starting:

- `README.md` — high-level overview of claude-mem
- `src/cli/adapters/codex.ts` — existing Codex hook adapter; production-ready, do NOT modify
- `src/services/worker-service.ts` lines 780–900 — CLI dispatcher (where `claude-mem hook codex <event>` resolves)
- `plugin/.codex-plugin/plugin.json` — Codex plugin manifest (will be edited)
- `plugin/hooks/codex-hooks.json` — Codex hook commands (will be edited)
- `plugin/.mcp.json` — Claude Code MCP server config; reference only, do NOT modify
- `src/utils/project-name.ts` — project keying logic (will be extended)
- `tests/utils/project-name.test.ts` — existing test patterns for project keying
- `~/.codex/.tmp/plugins/README.md` on user's machine — Codex plugin format spec
- `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.758/.mcp.json` on user's machine — reference `.mcp.json` for a working Codex plugin

Conventions to follow:
- Test runner is `bun:test`. Use `import { describe, it, expect } from 'bun:test'`.
- Run individual test files with `bun test tests/path/to/file.test.ts`.
- Run the full suite with `bun test`.
- Plugin paths in `.codex-plugin/plugin.json` are resolved **relative to the plugin root**, not relative to the manifest directory. Verified against `computer-use` plugin (`mcpServers: "./.mcp.json"` resolves to `<plugin-root>/.mcp.json`).
- Codex executes hook commands with `cwd = plugin install dir`. Verified against the `figma` plugin's `hooks.json` which uses `./scripts/...`.

---

## File Structure

### Files to create

| Path | Responsibility |
|------|----------------|
| `src/utils/git-root.ts` | Pure function `findGitRoot(cwd)` that walks up looking for `.git`. No imports from other claude-mem modules so it can be unit tested in isolation. |
| `tests/utils/git-root.test.ts` | Unit tests for `findGitRoot` with `tmpdir()` fixtures. |
| `plugin/.codex-plugin/.mcp.json` | Codex-specific MCP server registration with relative paths. |
| `docs/codex-install.md` | End-user install + troubleshooting documentation. |
| `docs/superpowers/plans/2026-05-20-codex-shared-memory.md` | This plan (already created). |

### Files to modify

| Path | Change |
|------|--------|
| `src/utils/project-name.ts` | Use git-root basename for `getProjectName` when `.git` is detected; include both git-root basename AND legacy basename in `getProjectContext.allProjects` so reads transparently pick up legacy data. |
| `tests/utils/project-name.test.ts` | Add tests covering git-root resolution and dual-key fallback. |
| `plugin/hooks/codex-hooks.json` | Replace `${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}` indirection with relative `./scripts/...` paths in all 5 event entries. |
| `plugin/.codex-plugin/plugin.json` | Point `mcpServers` at the new `./.codex-plugin/.mcp.json` instead of `./.mcp.json`. Bump `version`. |
| `plugin/.claude-plugin/plugin.json` | Bump `version` to match. |
| `.claude-plugin/marketplace.json` | Bump `plugins[0].version` to match. |
| `package.json` | Bump `version` to match. |
| `CHANGELOG.md` | Add entry under a new version header. |

### Files NOT to touch

- `plugin/.mcp.json` — Claude Code consumers depend on the existing `${CLAUDE_PLUGIN_ROOT}`-based command. Leave it alone.
- `plugin/hooks/hooks.json` — Claude Code's hook manifest. Leave it alone.
- `src/cli/adapters/codex.ts` — already complete.
- `src/services/worker-service.ts` — dispatcher already routes `hook codex` correctly.

---

## Task 1: Add `findGitRoot` helper with tests

**Files:**
- Create: `src/utils/git-root.ts`
- Create: `tests/utils/git-root.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/git-root.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { findGitRoot } from '../../src/utils/git-root';

describe('findGitRoot', () => {
  let root: string;
  let gitProjectRoot: string;
  let nestedDir: string;
  let nonGitDir: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'claude-mem-gitroot-'));
    gitProjectRoot = path.join(root, 'myproject');
    nestedDir = path.join(gitProjectRoot, 'src', 'deep');
    nonGitDir = path.join(root, 'no-git-here');

    mkdirSync(gitProjectRoot, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(nonGitDir, { recursive: true });
    writeFileSync(path.join(gitProjectRoot, '.git'), 'gitdir: /fake/worktree-pointer');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the directory containing .git when cwd is that directory', () => {
    expect(findGitRoot(gitProjectRoot)).toBe(gitProjectRoot);
  });

  it('walks up the tree to find .git from a nested directory', () => {
    expect(findGitRoot(nestedDir)).toBe(gitProjectRoot);
  });

  it('returns null when no .git is found anywhere up the tree', () => {
    expect(findGitRoot(nonGitDir)).toBeNull();
  });

  it('returns null for null or empty cwd', () => {
    expect(findGitRoot(null)).toBeNull();
    expect(findGitRoot(undefined)).toBeNull();
    expect(findGitRoot('')).toBeNull();
  });

  it('handles .git as a file (worktree) as well as a directory', () => {
    expect(findGitRoot(gitProjectRoot)).toBe(gitProjectRoot);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/utils/git-root.test.ts`
Expected: FAIL with `Cannot find module '../../src/utils/git-root'`.

- [ ] **Step 3: Implement the helper**

Create `src/utils/git-root.ts`:

```typescript
import { existsSync, statSync } from 'fs';
import path from 'path';

export function findGitRoot(cwd: string | null | undefined): string | null {
  if (!cwd || cwd.trim() === '') {
    return null;
  }

  let current: string;
  try {
    current = path.resolve(cwd);
  } catch {
    return null;
  }

  const root = path.parse(current).root;

  while (true) {
    const gitPath = path.join(current, '.git');
    if (existsSync(gitPath)) {
      try {
        statSync(gitPath);
        return current;
      } catch {
        return null;
      }
    }
    if (current === root) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/utils/git-root.test.ts`
Expected: PASS, 5 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/utils/git-root.ts tests/utils/git-root.test.ts
git commit -m "feat(utils): add findGitRoot helper for project keying"
```

---

## Task 2: Switch `getProjectName` to git-root with legacy fallback in `getProjectContext`

**Files:**
- Modify: `src/utils/project-name.ts`
- Modify: `tests/utils/project-name.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/project-name.test.ts` (inside the existing `describe('getProjectName', () => { ... })` or at the bottom of the file at module scope):

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getProjectName, getProjectContext } from '../../src/utils/project-name';

describe('getProjectName git-root resolution', () => {
  let root: string;
  let gitProjectRoot: string;
  let nestedDir: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'claude-mem-pname-'));
    gitProjectRoot = path.join(root, 'myproject');
    nestedDir = path.join(gitProjectRoot, 'src');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(path.join(gitProjectRoot, '.git'), 'gitdir: /fake');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns git-root basename when invoked from a nested directory inside a git repo', () => {
    expect(getProjectName(nestedDir)).toBe('myproject');
  });

  it('returns git-root basename when invoked from the git root itself', () => {
    expect(getProjectName(gitProjectRoot)).toBe('myproject');
  });

  it('falls back to plain basename when no .git exists', () => {
    const nonGit = path.join(root, 'no-git');
    mkdirSync(nonGit, { recursive: true });
    expect(getProjectName(nonGit)).toBe('no-git');
  });
});

describe('getProjectContext dual-key fallback', () => {
  let root: string;
  let gitProjectRoot: string;
  let nestedDir: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'claude-mem-pctx-'));
    gitProjectRoot = path.join(root, 'myproject');
    nestedDir = path.join(gitProjectRoot, 'src');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(path.join(gitProjectRoot, '.git'), 'gitdir: /fake');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('puts git-root basename first in allProjects and includes the legacy basename second when they differ', () => {
    const ctx = getProjectContext(nestedDir);
    expect(ctx.primary).toBe('myproject');
    expect(ctx.allProjects[0]).toBe('myproject');
    expect(ctx.allProjects).toContain('src');
  });

  it('does not duplicate keys when git-root basename equals legacy basename', () => {
    const ctx = getProjectContext(gitProjectRoot);
    expect(ctx.primary).toBe('myproject');
    expect(ctx.allProjects).toEqual(['myproject']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/utils/project-name.test.ts`
Expected: FAIL on the new `git-root resolution` and `dual-key fallback` describes. The existing tests should still pass.

- [ ] **Step 3: Modify `src/utils/project-name.ts`**

Replace the contents of `src/utils/project-name.ts` with:

```typescript
import { homedir } from 'os'
import path from 'path';
import { logger } from './logger.js';
import { detectWorktree } from './worktree.js';
import { findGitRoot } from './git-root.js';

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return p.replace(/^~/, homedir())
  }
  return p
}

function legacyBasenameProjectName(cwd: string): string {
  const basename = path.basename(cwd);
  if (basename !== '') {
    return basename;
  }
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const driveMatch = cwd.match(/^([A-Z]):\\/i);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toUpperCase();
      const projectName = `drive-${driveLetter}`;
      logger.info('PROJECT_NAME', 'Drive root detected', { cwd, projectName });
      return projectName;
    }
  }
  logger.warn('PROJECT_NAME', 'Root directory detected, using fallback', { cwd });
  return 'unknown-project';
}

export function getProjectName(cwd: string | null | undefined): string {
  if (!cwd || cwd.trim() === '') {
    logger.warn('PROJECT_NAME', 'Empty cwd provided, using fallback', { cwd });
    return 'unknown-project';
  }

  const expanded = expandTilde(cwd);
  const gitRoot = findGitRoot(expanded);
  if (gitRoot) {
    return path.basename(gitRoot);
  }

  return legacyBasenameProjectName(expanded);
}

export interface ProjectContext {
  primary: string;
  parent: string | null;
  isWorktree: boolean;
  allProjects: string[];
}

export function getProjectContext(cwd: string | null | undefined): ProjectContext {
  const primary = getProjectName(cwd);

  if (!cwd) {
    return { primary, parent: null, isWorktree: false, allProjects: [primary] };
  }

  const expandedCwd = expandTilde(cwd);
  const worktreeInfo = detectWorktree(expandedCwd);
  const legacyBasename = legacyBasenameProjectName(expandedCwd);

  const baseAll: string[] = [primary];
  if (legacyBasename && legacyBasename !== primary && !baseAll.includes(legacyBasename)) {
    baseAll.push(legacyBasename);
  }

  if (worktreeInfo.isWorktree && worktreeInfo.parentProjectName) {
    const composite = `${worktreeInfo.parentProjectName}/${primary}`;
    const allProjects = [worktreeInfo.parentProjectName, composite];
    if (!allProjects.includes(legacyBasename) && legacyBasename !== composite) {
      allProjects.push(legacyBasename);
    }
    return {
      primary: composite,
      parent: worktreeInfo.parentProjectName,
      isWorktree: true,
      allProjects,
    };
  }

  return { primary, parent: null, isWorktree: false, allProjects: baseAll };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/utils/project-name.test.ts`
Expected: PASS for all describes, including the original tilde/edge-case ones (none were broken).

- [ ] **Step 5: Run the existing project-name-isolation tests to be sure**

Run: `bun test tests/utils/project-name-isolation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/project-name.ts tests/utils/project-name.test.ts
git commit -m "feat(utils): key projects by git root with legacy basename fallback in allProjects"
```

---

## Task 3: Verify search routes consume `allProjects`

**Files:**
- Read: `src/services/worker/http/routes/SearchRoutes.ts` lines 305–340
- Read: `src/cli/handlers/context.ts`

This task is **read-only verification**. We need to confirm that the dual-key fallback in `getProjectContext.allProjects` is actually consumed by the read path. If it is, no code change is needed. If it isn't, add a follow-up task.

- [ ] **Step 1: Inspect SearchRoutes.ts**

Read lines 305–340 of `src/services/worker/http/routes/SearchRoutes.ts`. Confirm that the handler either:
1. Reads `getProjectContext(cwd).allProjects` and uses all entries in its query (e.g. `WHERE project_name IN (...)`), OR
2. Builds the project filter from the `cwd` via `getProjectContext` already.

- [ ] **Step 2: Inspect context.ts handler**

Read `src/cli/handlers/context.ts`. This is the SessionStart injection handler. Confirm the same: it uses `getProjectContext` and queries by `allProjects`.

- [ ] **Step 3: If both consume `allProjects` correctly, commit a note**

If verification passes, no code change. Skip to next task — no commit needed.

- [ ] **Step 4: If either path queries by single project name only, add a fix**

Search for any line of the form `WHERE project_name = ?` or `WHERE project = ?` in:
- `src/services/worker/http/routes/SearchRoutes.ts`
- `src/services/worker/http/routes/MemoryRoutes.ts`
- `src/cli/handlers/context.ts`
- `src/services/sqlite/ObservationStore.ts` (if exists)

Replace each single-project query with a query that accepts an array and builds an `IN (...)` clause. Wire the array from `getProjectContext(cwd).allProjects`.

If you make any changes here, write a test in `tests/context-injection.test.ts` that:
1. Inserts an observation under the legacy basename key.
2. Calls the context handler with a cwd whose `getProjectContext.primary` is the git-root basename.
3. Asserts the legacy observation appears in the result.

- [ ] **Step 5: Commit (only if changes were made)**

```bash
git add src/services/worker/http/routes/SearchRoutes.ts src/cli/handlers/context.ts tests/context-injection.test.ts
git commit -m "fix(read): consume allProjects so legacy basename keys remain readable"
```

---

## Task 4: Fix Codex hook path resolution

**Files:**
- Modify: `plugin/hooks/codex-hooks.json`

- [ ] **Step 1: Write a parse-time assertion test**

Create `tests/codex-hooks-paths.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const hooksJsonPath = join(__dirname, '..', 'plugin', 'hooks', 'codex-hooks.json');
const hooks = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));

describe('Codex hooks path resolution', () => {
  const allCommands: string[] = [];
  for (const event of Object.values(hooks.hooks) as any[]) {
    for (const matcher of event) {
      for (const h of matcher.hooks) {
        if (typeof h.command === 'string') {
          allCommands.push(h.command);
        }
      }
    }
  }

  it('contains at least one hook command', () => {
    expect(allCommands.length).toBeGreaterThan(0);
  });

  it('no command references CLAUDE_PLUGIN_ROOT or PLUGIN_ROOT env vars', () => {
    for (const cmd of allCommands) {
      expect(cmd).not.toContain('CLAUDE_PLUGIN_ROOT');
      expect(cmd).not.toContain('PLUGIN_ROOT');
    }
  });

  it('every command uses a relative path beginning with ./', () => {
    for (const cmd of allCommands) {
      expect(cmd).toMatch(/(?:^|\s)\.\//);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/codex-hooks-paths.test.ts`
Expected: FAIL on `not.toContain('CLAUDE_PLUGIN_ROOT')` because the current file uses `${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}`.

- [ ] **Step 3: Rewrite `plugin/hooks/codex-hooks.json`**

Replace the entire file with:

```json
{
  "description": "claude-mem Codex CLI hook integration",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_MEM_CODEX_HOOK=1 node ./scripts/version-check.js",
            "timeout": 5
          },
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs start",
            "timeout": 60
          },
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex context",
            "timeout": 60,
            "statusMessage": "Loading claude-mem context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex session-init",
            "timeout": 60
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "^Bash$|^mcp__.+__(read|view|cat)(_file|_files)?$",
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex file-context",
            "timeout": 30
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex observation",
            "timeout": 120
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/bun-runner.js ./scripts/worker-service.cjs hook codex summarize",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/codex-hooks-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `bun test`
Expected: All tests pass. Pay special attention to any test that loads `codex-hooks.json` (search for `codex-hooks` in `tests/`).

- [ ] **Step 6: Commit**

```bash
git add plugin/hooks/codex-hooks.json tests/codex-hooks-paths.test.ts
git commit -m "fix(codex-hooks): use relative paths so Codex CLI resolves commands without env vars"
```

---

## Task 5: Create Codex-specific MCP manifest

**Files:**
- Create: `plugin/.codex-plugin/.mcp.json`
- Modify: `plugin/.codex-plugin/plugin.json`

- [ ] **Step 1: Write a parse-time assertion test**

Create `tests/codex-mcp-manifest.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const pluginRoot = join(__dirname, '..', 'plugin');
const codexMcpPath = join(pluginRoot, '.codex-plugin', '.mcp.json');
const codexPluginManifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');

describe('Codex MCP manifest', () => {
  it('plugin/.codex-plugin/.mcp.json exists', () => {
    expect(existsSync(codexMcpPath)).toBe(true);
  });

  it('plugin/.codex-plugin/plugin.json references the codex-specific .mcp.json', () => {
    const manifest = JSON.parse(readFileSync(codexPluginManifestPath, 'utf-8'));
    expect(manifest.mcpServers).toBe('./.codex-plugin/.mcp.json');
  });

  it('codex .mcp.json registers a claude-mem server with relative command', () => {
    const mcp = JSON.parse(readFileSync(codexMcpPath, 'utf-8'));
    expect(mcp.mcpServers).toBeDefined();
    expect(mcp.mcpServers['claude-mem']).toBeDefined();
    expect(mcp.mcpServers['claude-mem'].command).toBe('node');
    expect(mcp.mcpServers['claude-mem'].args).toEqual(['./scripts/mcp-server.cjs']);
    expect(mcp.mcpServers['claude-mem'].cwd).toBe('.');
  });

  it('codex .mcp.json does NOT reference CLAUDE_PLUGIN_ROOT', () => {
    const raw = readFileSync(codexMcpPath, 'utf-8');
    expect(raw).not.toContain('CLAUDE_PLUGIN_ROOT');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/codex-mcp-manifest.test.ts`
Expected: FAIL with `existsSync(...) toBe true` (file does not exist yet).

- [ ] **Step 3: Create `plugin/.codex-plugin/.mcp.json`**

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

- [ ] **Step 4: Update `plugin/.codex-plugin/plugin.json`**

In `plugin/.codex-plugin/plugin.json`, change the `mcpServers` line from:

```json
  "mcpServers": "./.mcp.json",
```

to:

```json
  "mcpServers": "./.codex-plugin/.mcp.json",
```

Leave every other field (including `hooks`, `skills`, `interface`) untouched.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/codex-mcp-manifest.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/.codex-plugin/.mcp.json plugin/.codex-plugin/plugin.json tests/codex-mcp-manifest.test.ts
git commit -m "feat(codex): add Codex-specific .mcp.json so MCP server resolves without env vars"
```

---

## Task 6: Version bump and changelog entry

**Files:**
- Modify: `package.json`
- Modify: `plugin/.claude-plugin/plugin.json`
- Modify: `plugin/.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `CHANGELOG.md`

The version bump uses a fork-specific pre-release suffix so Claude Code's `cache/thedotmack/claude-mem/13.2.0/` cache pin (set by `installed_plugins.json`) is unaffected. Target version: `12.7.4-zoi.1`.

- [ ] **Step 1: Write a coherence test**

Create `tests/version-coherence.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const expectedVersion = '12.7.4-zoi.1';

const filesAndPaths: Array<{ file: string; pathFn: (j: any) => string }> = [
  { file: 'package.json', pathFn: j => j.version },
  { file: 'plugin/.claude-plugin/plugin.json', pathFn: j => j.version },
  { file: 'plugin/.codex-plugin/plugin.json', pathFn: j => j.version },
  { file: '.claude-plugin/marketplace.json', pathFn: j => j.plugins[0].version },
];

describe('version coherence across plugin manifests', () => {
  for (const { file, pathFn } of filesAndPaths) {
    it(`${file} pins to ${expectedVersion}`, () => {
      const data = JSON.parse(readFileSync(join(root, file), 'utf-8'));
      expect(pathFn(data)).toBe(expectedVersion);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/version-coherence.test.ts`
Expected: FAIL — all four files currently say `12.7.4`.

- [ ] **Step 3: Bump `package.json`**

In `package.json` change:
```json
"version": "12.7.4",
```
to:
```json
"version": "12.7.4-zoi.1",
```

- [ ] **Step 4: Bump `plugin/.claude-plugin/plugin.json`**

In `plugin/.claude-plugin/plugin.json` change:
```json
"version": "12.7.4",
```
to:
```json
"version": "12.7.4-zoi.1",
```

- [ ] **Step 5: Bump `plugin/.codex-plugin/plugin.json`**

In `plugin/.codex-plugin/plugin.json` change:
```json
"version": "12.7.4",
```
to:
```json
"version": "12.7.4-zoi.1",
```

- [ ] **Step 6: Bump `.claude-plugin/marketplace.json`**

In `.claude-plugin/marketplace.json` change:
```json
"version": "12.7.4",
```
(the one inside `plugins[0]`) to:
```json
"version": "12.7.4-zoi.1",
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test tests/version-coherence.test.ts`
Expected: PASS — all four files now report `12.7.4-zoi.1`.

- [ ] **Step 8: Add a CHANGELOG entry**

Prepend the following section to `CHANGELOG.md` immediately under the top heading (above the existing first version entry):

```markdown
## [12.7.4-zoi.1] - 2026-05-20

### Added
- Codex CLI plugin support: `.codex-plugin/.mcp.json` with relative paths so Codex can launch the MCP server.
- Git-root project keying in `getProjectName` so Claude Code and Codex sessions invoked from different subdirectories of the same repo share a memory bucket.

### Changed
- `getProjectContext.allProjects` now includes both the git-root basename and the legacy `basename(cwd)` key, allowing reads to transparently surface observations written under the older keying scheme.
- `plugin/hooks/codex-hooks.json` uses relative `./scripts/...` paths instead of `${CLAUDE_PLUGIN_ROOT}` indirection so commands resolve under Codex 0.131.0's hook execution model.

### Notes
- Fork-specific pre-release suffix `-zoi.1` to avoid colliding with upstream's `13.x` cache pin in `~/.claude/plugins/installed_plugins.json`.
```

- [ ] **Step 9: Run the full test suite**

Run: `bun test`
Expected: PASS, no regressions.

- [ ] **Step 10: Commit**

```bash
git add package.json plugin/.claude-plugin/plugin.json plugin/.codex-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md tests/version-coherence.test.ts
git commit -m "chore: bump version to 12.7.4-zoi.1 and document Codex plugin support"
```

---

## Task 7: Install documentation

**Files:**
- Create: `docs/codex-install.md`

- [ ] **Step 1: Write `docs/codex-install.md`**

```markdown
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
```

- [ ] **Step 2: Sanity-check the docs render**

Run: `cat docs/codex-install.md | head -20`
Expected: heading + prerequisites visible. No formatting errors.

- [ ] **Step 3: Commit**

```bash
git add docs/codex-install.md
git commit -m "docs: add Codex CLI install guide for claude-mem"
```

---

## Task 8: End-to-end install verification (manual)

This task is **manual verification**. It cannot be automated because it requires invoking the user's actual Codex CLI on their machine. Do NOT proceed without first confirming the LLM provider in `~/.claude-mem/settings.json` is working (DeepSeek balance was exhausted at the time of writing — check before running).

- [ ] **Step 1: Confirm provider is working**

Run: `claude-mem worker:status` (or inspect `~/.claude-mem/logs/worker.log` for recent 402 errors).
If `CLAUDE_MEM_PROVIDER=deepseek` and the log shows `status 402`, top up at `platform.deepseek.com` OR switch `CLAUDE_MEM_PROVIDER` to `gemini` or `claude` before continuing.

- [ ] **Step 2: Register the marketplace**

Run: `codex plugin marketplace add claude-mem /Users/luccassilveira/Desktop/Projetos_ZOI/claude_mem+ollama/claude-mem`
Expected: marketplace registration confirmation. No error.

- [ ] **Step 3: Install the plugin**

Run: `codex plugin add claude-mem --marketplace claude-mem`
Expected: install confirmation, no error.

- [ ] **Step 4: Verify MCP registration**

Run: `codex mcp list`
Expected: `claude-mem` row appears with status `enabled`.

- [ ] **Step 5: Start a Codex session in a test repo**

Open a terminal in a git-managed project root.
Run: `codex`
Expected: status line briefly shows `Loading claude-mem context`. Session opens normally.

- [ ] **Step 6: Inspect the worker**

In another terminal: `ps aux | grep worker-service.cjs | grep -v grep`
Expected: one row showing the worker process.

- [ ] **Step 7: Write an observation from Claude Code in the same repo**

Open Claude Code in the same repo. Do a small piece of work that triggers an observation (e.g., ask Claude to read a file and explain it). End the Claude Code session so `Stop` fires and the summary lands.

- [ ] **Step 8: Read it back from Codex**

Reopen Codex in the same repo. In the chat, ask: "Search memory for the most recent observation." Codex should call the `search` MCP tool and return the observation Claude Code wrote.

- [ ] **Step 9: Reverse direction**

In the open Codex session, do a small piece of work and end the session.
Reopen Claude Code in the same repo. SessionStart should inject context including the Codex-written summary.

- [ ] **Step 10: Verify git-root keying**

In the same repo, `cd src/` (a subdirectory).
Run: `codex`
Expected: SessionStart fires, worker logs show the project keyed by the git-root basename (NOT `src`).
Confirm with: `grep "project_name" ~/.claude-mem/logs/worker.log | tail -5`

- [ ] **Step 11: Document the result**

If all 10 steps above pass, append a `## Verification log` section to `CHANGELOG.md` under the 12.7.4-zoi.1 entry with a one-line confirmation and the date. Commit:

```bash
git add CHANGELOG.md
git commit -m "docs: log successful end-to-end verification of Codex shared memory"
```

If any step fails, do NOT mark the plan complete. File the failure as a follow-up issue and stop.

---

## Self-Review Checklist

After completing all tasks above, run this checklist before declaring done:

1. **Spec coverage.** Every decision from the grilling session (bidirectional capture via native Codex hooks; local-install distribution; relative path resolution; separate Codex `.mcp.json`; git-root keying; dual-key fallback; version bump; install docs) maps to at least one task above. ✓
2. **No placeholders.** Search this plan for `TBD`, `TODO`, `appropriate`, `similar to`, `fill in`. Expected: zero hits.
3. **Type consistency.** `findGitRoot` is called by `getProjectName`; both functions have stable signatures across Task 1 and Task 2. `getProjectContext.allProjects` is referenced in Task 3 with the exact field name. Versions in Task 6 are identical (`12.7.4-zoi.1`) across all four manifest files.
4. **Hook command parity.** Every hook in Task 4's rewritten `codex-hooks.json` matches the original event list (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) and preserves matchers and timeouts.

If any check fails, fix inline and re-run only the affected steps.

---

## Out of Scope (do NOT do)

- Marketplace publishing on a Codex registry — local install only.
- Cursor or Gemini CLI integrations — worker already supports them but install docs are not part of this plan.
- Modifying `plugin/.mcp.json` or `plugin/hooks/hooks.json` (Claude Code paths) — leave them alone.
- Touching `src/cli/adapters/codex.ts` or the worker dispatcher — already production-quality.
- Cross-machine memory sync — still single-machine; Chroma + SQLite live locally.
