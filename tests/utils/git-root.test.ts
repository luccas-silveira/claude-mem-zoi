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
  let normalRepoDir: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'claude-mem-gitroot-'));
    gitProjectRoot = path.join(root, 'myproject');
    nestedDir = path.join(gitProjectRoot, 'src', 'deep');
    nonGitDir = path.join(root, 'no-git-here');
    normalRepoDir = path.join(root, 'normal-repo');

    mkdirSync(gitProjectRoot, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(nonGitDir, { recursive: true });
    writeFileSync(path.join(gitProjectRoot, '.git'), 'gitdir: /fake/worktree-pointer');
    mkdirSync(normalRepoDir, { recursive: true });
    mkdirSync(path.join(normalRepoDir, '.git'));
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

  it('handles .git as a directory (normal repo) as well as a file (worktree)', () => {
    expect(findGitRoot(normalRepoDir)).toBe(normalRepoDir);
  });
});
