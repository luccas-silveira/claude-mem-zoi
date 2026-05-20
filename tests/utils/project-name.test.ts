
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { homedir, tmpdir } from 'os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { getProjectName, getProjectContext } from '../../src/utils/project-name.js';

// ---------------------------------------------------------------------------
// Module-level worktree mock
// When _syntheticWorktree is set, detectWorktree returns the supplied data for
// any cwd. When null the inlined real logic runs (so existing filesystem-based
// worktree tests continue to pass without change).
// ---------------------------------------------------------------------------

interface SyntheticWorktree { parentProjectName: string }
let _syntheticWorktree: SyntheticWorktree | null = null;

function _realDetectWorktree(cwd: string) {
  const NOT_A_WORKTREE = {
    isWorktree: false as const, worktreeName: null, parentRepoPath: null, parentProjectName: null,
  };
  const gitPath = path.join(cwd, '.git');
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(gitPath); } catch { return NOT_A_WORKTREE; }
  if (!stat.isFile()) return NOT_A_WORKTREE;
  let content: string;
  try { content = readFileSync(gitPath, 'utf-8').trim(); } catch { return NOT_A_WORKTREE; }
  const match = content.match(/^gitdir:\s*(.+)$/);
  if (!match) return NOT_A_WORKTREE;
  const worktreesMatch = match[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);
  if (!worktreesMatch) return NOT_A_WORKTREE;
  return {
    isWorktree: true as const,
    worktreeName: path.basename(cwd),
    parentRepoPath: worktreesMatch[1],
    parentProjectName: path.basename(worktreesMatch[1]),
  };
}

mock.module('../../src/utils/worktree.js', () => ({
  detectWorktree: (cwd: string) => {
    if (_syntheticWorktree) {
      return {
        isWorktree: true as const,
        worktreeName: path.basename(cwd),
        parentRepoPath: null,
        parentProjectName: _syntheticWorktree.parentProjectName,
      };
    }
    return _realDetectWorktree(cwd);
  },
}));

describe('getProjectName', () => {
  describe('tilde expansion', () => {
    it('resolves bare ~ to home directory basename', () => {
      const home = homedir();
      const expected = home.split('/').pop() || home.split('\\').pop() || '';
      expect(getProjectName('~')).toBe(expected);
    });

    it('resolves ~/subpath to subpath', () => {
      expect(getProjectName('~/projects/my-app')).toBe('my-app');
    });

    it('resolves ~/ to home directory basename', () => {
      const home = homedir();
      const expected = home.split('/').pop() || home.split('\\').pop() || '';
      expect(getProjectName('~/')).toBe(expected);
    });
  });

  describe('normal paths', () => {
    it('extracts basename from absolute path', () => {
      expect(getProjectName('/home/user/my-project')).toBe('my-project');
    });

    it('extracts basename from nested path', () => {
      expect(getProjectName('/Users/test/work/deep/nested/project')).toBe('project');
    });

    it('handles trailing slash', () => {
      expect(getProjectName('/home/user/my-project/')).toBe('my-project');
    });
  });

  describe('edge cases', () => {
    it('returns unknown-project for null', () => {
      expect(getProjectName(null)).toBe('unknown-project');
    });

    it('returns unknown-project for undefined', () => {
      expect(getProjectName(undefined)).toBe('unknown-project');
    });

    it('returns unknown-project for empty string', () => {
      expect(getProjectName('')).toBe('unknown-project');
    });

    it('returns unknown-project for whitespace', () => {
      expect(getProjectName('   ')).toBe('unknown-project');
    });
  });

  describe('realistic scenarios from #1478', () => {
    it('handles ~ the same as full home path', () => {
      const home = homedir();
      expect(getProjectName('~')).toBe(getProjectName(home));
    });

    it('handles ~/projects/app the same as /full/path/projects/app', () => {
      const home = homedir();
      expect(getProjectName('~/projects/app')).toBe(
        getProjectName(`${home}/projects/app`)
      );
    });
  });
});

describe('getProjectContext', () => {
  it('returns primary project name for normal path', () => {
    const ctx = getProjectContext('/home/user/my-project');
    expect(ctx.primary).toBe('my-project');
    expect(ctx.parent).toBeNull();
    expect(ctx.isWorktree).toBe(false);
    expect(ctx.allProjects).toEqual(['my-project']);
  });

  it('resolves ~ path correctly', () => {
    const home = homedir();
    const ctx = getProjectContext('~');
    const ctxHome = getProjectContext(home);
    expect(ctx.primary).toBe(ctxHome.primary);
  });

  it('returns unknown-project context for null', () => {
    const ctx = getProjectContext(null);
    expect(ctx.primary).toBe('unknown-project');
    expect(ctx.parent).toBeNull();
  });

  describe('worktree isolation', () => {
    let tmp: string;
    let mainRepo: string;
    let worktreeCheckout: string;

    beforeAll(async () => {
      const { mkdtempSync, mkdirSync, writeFileSync } = await import('fs');
      const { join } = await import('path');
      const { tmpdir } = await import('os');

      tmp = mkdtempSync(join(tmpdir(), 'cm-wt-'));
      mainRepo = join(tmp, 'main-repo');
      const worktreeGitDir = join(mainRepo, '.git', 'worktrees', 'my-worktree');
      worktreeCheckout = join(tmp, 'my-worktree');

      mkdirSync(worktreeGitDir, { recursive: true });
      mkdirSync(worktreeCheckout, { recursive: true });
      writeFileSync(
        join(worktreeCheckout, '.git'),
        `gitdir: ${worktreeGitDir}\n`
      );
    });

    afterAll(async () => {
      const { rmSync } = await import('fs');
      rmSync(tmp, { recursive: true, force: true });
    });

    it('uses parent/worktree composite as primary when in a worktree', () => {
      const ctx = getProjectContext(worktreeCheckout);
      expect(ctx.isWorktree).toBe(true);
      expect(ctx.primary).toBe('main-repo/my-worktree');
      expect(ctx.parent).toBe('main-repo');
      expect(ctx.allProjects).toEqual(['main-repo', 'main-repo/my-worktree']);
    });

    it('write-path call sites resolve to composite name in worktrees', () => {
      const project = getProjectContext(worktreeCheckout).primary;
      expect(project).toBe('main-repo/my-worktree');
      expect(project).not.toBe('main-repo');
      expect(project).not.toBe('my-worktree');
    });
  });
});

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

  it('includes legacy basename in allProjects when in a worktree and legacy basename differs from parent and composite', () => {
    // Arrange: create a tmp git project dir with a subdirectory 'src'.
    // getProjectName(srcDir) walks up to 'myproject' via findGitRoot →
    // primary = 'myproject'.  The synthetic worktree override makes
    // detectWorktree(srcDir) report parentProjectName = 'parentrepo', so
    // composite = 'parentrepo/myproject'.  legacyBasename = 'src' ≠ primary,
    // and 'src' is not in [parent, composite], so it lands in allProjects.
    const wtTmp = mkdtempSync(path.join(tmpdir(), 'cm-wt-dual-'));
    try {
      const projectDir = path.join(wtTmp, 'myproject');
      const srcDir = path.join(projectDir, 'src');
      mkdirSync(srcDir, { recursive: true });
      // A '.git' file at projectDir makes findGitRoot(srcDir) resolve 'myproject'.
      writeFileSync(path.join(projectDir, '.git'), 'gitdir: /fake\n');

      // Enable synthetic worktree mode for the duration of this test.
      _syntheticWorktree = { parentProjectName: 'parentrepo' };
      try {
        const ctx = getProjectContext(srcDir);

        expect(ctx.primary).toBe('parentrepo/myproject');
        expect(ctx.parent).toBe('parentrepo');
        expect(ctx.isWorktree).toBe(true);
        expect(ctx.allProjects).toContain('parentrepo');
        expect(ctx.allProjects).toContain('parentrepo/myproject');
        expect(ctx.allProjects).toContain('src');
      } finally {
        _syntheticWorktree = null; // always restore so other tests are unaffected
      }
    } finally {
      rmSync(wtTmp, { recursive: true, force: true });
    }
  });
});
