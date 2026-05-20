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
