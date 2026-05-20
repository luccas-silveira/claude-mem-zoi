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
