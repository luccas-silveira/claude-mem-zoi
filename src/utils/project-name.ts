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
  if (legacyBasename !== primary && !baseAll.includes(legacyBasename)) {
    baseAll.push(legacyBasename);
  }

  if (worktreeInfo.isWorktree && worktreeInfo.parentProjectName) {
    const composite = `${worktreeInfo.parentProjectName}/${primary}`;
    const allProjects = [worktreeInfo.parentProjectName, composite];
    if (
      legacyBasename !== primary &&
      !allProjects.includes(legacyBasename)
    ) {
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
