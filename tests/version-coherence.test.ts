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
