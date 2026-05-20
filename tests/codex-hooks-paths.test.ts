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

  it('every command references ${CLAUDE_PLUGIN_ROOT} for script paths', () => {
    for (const cmd of allCommands) {
      expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/');
    }
  });

  it('no command uses bare ./ relative paths (Codex hooks run from project cwd, not plugin dir)', () => {
    for (const cmd of allCommands) {
      expect(cmd).not.toMatch(/(?:^|\s)\.\/scripts\//);
    }
  });

  it('no command uses legacy ${PLUGIN_ROOT:-...} fallback indirection', () => {
    for (const cmd of allCommands) {
      expect(cmd).not.toContain(':-$PLUGIN_ROOT');
    }
  });
});
