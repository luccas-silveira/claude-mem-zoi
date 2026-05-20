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
