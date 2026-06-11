/**
 * Fase 5 — Anti-pattern guards for the prompt-cache + prefilter stack.
 *
 * Capstone test for the work in `plans/2026-05-22-prompt-cache-prefilter.md`.
 * Each assertion is a static, byte-level check on a source file so that a
 * future refactor that silently un-does any of the four production phases
 * will fail the build.
 *
 * No network, no DB, no async I/O — every read is synchronous so the test
 * is safe to run in any environment.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

/**
 * Walks `dir` recursively, returning every absolute file path that matches
 * `match` (default: all files). Used by the "where does this string live?"
 * guards below — keeps the surface tight.
 */
function walk(dir: string, match: (path: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  const stack: string[] = [abs];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        stack.push(p);
      } else if (e.isFile() && match(p)) {
        out.push(p);
      }
    }
  }
  return out;
}

function filesContaining(dir: string, needle: string, ext: RegExp = /\.(ts|tsx|js|cjs|mjs|json)$/): string[] {
  return walk(dir, (p) => ext.test(p)).filter((p) => {
    try { return readFileSync(p, 'utf8').includes(needle); } catch { return false; }
  });
}

// ---------------------------------------------------------------------------
// Fase 1 — Hook-layer prefilter is wired in.
// ---------------------------------------------------------------------------
describe('Fase 1 — prefilter wiring', () => {
  it('SettingsDefaultsManager exposes CLAUDE_MEM_PREFILTER_ENABLED', () => {
    const src = read('src/shared/SettingsDefaultsManager.ts');
    expect(src).toContain('CLAUDE_MEM_PREFILTER_ENABLED');
  });

  it('worker/http/shared.ts wires decidePrefilter into the ingest path', () => {
    const src = read('src/services/worker/http/shared.ts');
    expect(src).toContain('decidePrefilter');
  });

  it('PrefilterDecider.ts exists', () => {
    expect(exists('src/services/worker/http/PrefilterDecider.ts')).toBe(true);
  });

  it('SessionReadCache.ts exists', () => {
    expect(exists('src/services/worker/http/SessionReadCache.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fase 2 — Stable system prompt split out from per-turn user content.
// ---------------------------------------------------------------------------
describe('Fase 2 — system/user split', () => {
  it('src/sdk/prompts.ts exports the three split builders', () => {
    const src = read('src/sdk/prompts.ts');
    expect(src).toMatch(/export\s+function\s+buildSystemPrompt\b/);
    expect(src).toMatch(/export\s+function\s+buildInitUserPrompt\b/);
    expect(src).toMatch(/export\s+function\s+buildContinuationUserPrompt\b/);
  });

  const providers = [
    'src/services/worker/OllamaProvider.ts',
    'src/services/worker/DeepSeekProvider.ts',
    'src/services/worker/OpenRouterProvider.ts',
    'src/services/worker/GeminiProvider.ts',
  ];
  for (const rel of providers) {
    it(`${rel.split('/').pop()} sets session.systemPrompt via buildSystemPrompt`, () => {
      const src = read(rel);
      expect(src).toContain('session.systemPrompt = buildSystemPrompt');
    });
  }
});

// ---------------------------------------------------------------------------
// Fase 3 — Explicit cache markers for Claude SDK & OpenRouter (Anthropic).
// ---------------------------------------------------------------------------
describe('Fase 3 — explicit cache markers', () => {
  it('ClaudeProvider imports SYSTEM_PROMPT_DYNAMIC_BOUNDARY from the agent SDK', () => {
    const src = read('src/services/worker/ClaudeProvider.ts');
    // Permissive match: either named import on a single line or part of a
    // multi-line import block from @anthropic-ai/claude-agent-sdk.
    expect(src).toContain('SYSTEM_PROMPT_DYNAMIC_BOUNDARY');
    expect(src).toContain('@anthropic-ai/claude-agent-sdk');
    expect(src).toMatch(/SYSTEM_PROMPT_DYNAMIC_BOUNDARY[\s\S]{0,500}@anthropic-ai\/claude-agent-sdk|@anthropic-ai\/claude-agent-sdk[\s\S]{0,500}SYSTEM_PROMPT_DYNAMIC_BOUNDARY/);
  });

  it('OpenRouterProvider declares cache_control: { type: "ephemeral" }', () => {
    const src = read('src/services/worker/OpenRouterProvider.ts');
    expect(src).toMatch(/cache_control:\s*\{\s*type:\s*['"]ephemeral['"]\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// Fase 4 — Mode JSON slimmed; guidance generators live in src/sdk/prompts.ts.
// ---------------------------------------------------------------------------
describe('Fase 4 — mode JSON slim + programmatic guidance', () => {
  it('plugin/modes/code.json has no type_guidance / concept_guidance keys', () => {
    const raw = read('plugin/modes/code.json');
    const parsed = JSON.parse(raw) as { prompts?: Record<string, unknown> };
    expect(parsed.prompts).toBeDefined();
    expect(parsed.prompts!).not.toHaveProperty('type_guidance');
    expect(parsed.prompts!).not.toHaveProperty('concept_guidance');
  });

  it('src/sdk/prompts.ts defines generateTypeGuidance and generateConceptGuidance', () => {
    const src = read('src/sdk/prompts.ts');
    expect(src).toMatch(/function\s+generateTypeGuidance\b/);
    expect(src).toMatch(/function\s+generateConceptGuidance\b/);
  });
});

// ---------------------------------------------------------------------------
// Plan F.3 (Fase 4) — observation_digests mixed into context injection.
// These markers ensure the digest pipeline (query + render + setting) stays
// wired up so future refactors don't silently un-do the historical-context block.
// ---------------------------------------------------------------------------
describe('Plan F.3 (Fase 4) — context digest injection markers', () => {
  it('SettingsDefaultsManager exposes CLAUDE_MEM_CONTEXT_DIGESTS', () => {
    const src = read('src/shared/SettingsDefaultsManager.ts');
    expect(src).toContain('CLAUDE_MEM_CONTEXT_DIGESTS');
  });

  it('ObservationCompiler exports queryDigests and queryDigestsMulti', () => {
    const src = read('src/services/context/ObservationCompiler.ts');
    expect(src).toMatch(/export\s+function\s+queryDigests\b/);
    expect(src).toMatch(/export\s+function\s+queryDigestsMulti\b/);
  });

  it('DigestFormatter.ts exists and exports renderDigests', () => {
    expect(exists('src/services/context/formatters/DigestFormatter.ts')).toBe(true);
    const src = read('src/services/context/formatters/DigestFormatter.ts');
    expect(src).toMatch(/export\s+function\s+renderDigests\b/);
  });
});

// ---------------------------------------------------------------------------
// Plan F.4 (Fase 5) — observation_digests indexed in Chroma.
// These markers ensure the digest indexing pipeline (ChromaSync.syncDigest +
// SessionStore.getLatestDigestForPeriod) stays wired up so future refactors
// don't silently un-do the historical-context semantic-search hook.
// ---------------------------------------------------------------------------
describe('Plan F.4 (Fase 5) — ChromaSync digest indexing markers', () => {
  it('ChromaSync exports syncDigest', () => {
    const src = read('src/services/sync/ChromaSync.ts');
    expect(src).toMatch(/\bsyncDigest\b\s*\(/);
  });

  it('SessionStore exports getLatestDigestForPeriod', () => {
    const src = read('src/services/sqlite/SessionStore.ts');
    expect(src).toMatch(/\bgetLatestDigestForPeriod\b\s*\(/);
  });

  it('DigestGenerator wires an optional chromaSync into its options', () => {
    const src = read('src/services/worker/digest/DigestGenerator.ts');
    expect(src).toMatch(/chromaSync\?:\s*ChromaSync/);
    expect(src).toContain('syncDigest');
  });

  it('worker-service passes chromaSync into DigestGenerator', () => {
    const src = read('src/services/worker-service.ts');
    expect(src).toMatch(/chromaSync:\s*this\.dbManager\.getChromaSync\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Anti-pattern guards — these are what catch regressions, not the wiring.
// ---------------------------------------------------------------------------
describe('Anti-pattern — never attach cache_control to user/assistant turns', () => {
  // The whole point of Fase 3 is that the STABLE system block is the cache
  // anchor. If a future refactor moves cache_control onto a per-turn user or
  // assistant message, the cache hit rate collapses to zero.
  // Object-literal targeting: `role: 'user'` followed by a comma identifies a
  // real message object (`{ role: 'user', content: ... }`); the union type
  // declaration uses `|` instead of `,` and so is correctly skipped. Window of
  // 500 chars (~15 lines) tolerates benign linebreaks inside the message
  // literal.
  it('OpenRouterProvider does not attach cache_control to a user role', () => {
    const src = read('src/services/worker/OpenRouterProvider.ts');
    const re = /role:\s*['"]user['"]\s*,[\s\S]{0,500}cache_control|cache_control[\s\S]{0,500}role:\s*['"]user['"]\s*,/;
    expect(re.test(src)).toBe(false);
  });

  it('OpenRouterProvider does not attach cache_control to an assistant role', () => {
    const src = read('src/services/worker/OpenRouterProvider.ts');
    const re = /role:\s*['"]assistant['"]\s*,[\s\S]{0,500}cache_control|cache_control[\s\S]{0,500}role:\s*['"]assistant['"]\s*,/;
    expect(re.test(src)).toBe(false);
  });
});

/**
 * Extract the source of a top-level `export function NAME` declaration.
 *
 * Strategy: top-level function declarations in this codebase end with a `}`
 * at column 0 of its own line (lint-enforced). We scan line-by-line from
 * the `export function NAME` line until we find a line that is exactly `}`
 * (optionally trailing whitespace). Cheap, robust against `${...}` template
 * literal interpolations that confuse a naive brace counter.
 *
 * Returns the substring from `export` through the matching closing `}`.
 */
function extractExportedFunctionBody(src: string, name: string): string {
  const lines = src.split('\n');
  const head = `export function ${name}`;
  const startLine = lines.findIndex((l) => l.includes(head));
  if (startLine === -1) throw new Error(`extractExportedFunctionBody: ${name} not found`);
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^\}\s*$/.test(lines[i])) {
      return lines.slice(startLine, i + 1).join('\n');
    }
  }
  throw new Error(`extractExportedFunctionBody: no column-0 '}' after ${name}`);
}

describe('Anti-pattern — buildSystemPrompt must be byte-deterministic', () => {
  // The system prompt is the cache anchor. If it ever embeds a Date, random,
  // or process-derived value, the cached prefix changes every turn and the
  // savings evaporate.
  it('body does not reference Date, Math.random, or process.', () => {
    const src = read('src/sdk/prompts.ts');
    const body = extractExportedFunctionBody(src, 'buildSystemPrompt');
    expect(body).not.toContain('Date');
    expect(body).not.toMatch(/Math\.random/);
    expect(body).not.toMatch(/\bprocess\./);
  });
});

describe('Anti-pattern — PrefilterDecider must stay pure', () => {
  // The decider is on the hot path. Pulling in a logger, fs, Date.now, or
  // Math.random would either tank performance or break determinism (which is
  // what makes the unit tests trustworthy in the first place).
  it('does not import logger / fs and does not call Date.now / Math.random', () => {
    const rel = 'src/services/worker/http/PrefilterDecider.ts';
    if (!exists(rel)) {
      throw new Error(`${rel} is missing — Fase 1 not applied`);
    }
    const src = read(rel);
    expect(src).not.toMatch(/from\s+['"][^'"]*logger[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(src).not.toMatch(/from\s+['"]fs['"]/);
    expect(src).not.toMatch(/\bDate\.now\b/);
    expect(src).not.toMatch(/Math\.random/);
  });
});

describe('Anti-pattern — CLAUDE_MEM_PREFILTER_* settings confined to expected files', () => {
  // If somebody adds a new consumer of these env vars without updating this
  // allowlist, the test fails — forcing them to think about whether their
  // code path needs to participate in the prefilter contract.
  const ALLOWED = new Set([
    'SettingsDefaultsManager.ts',
    'PrefilterDecider.ts',
    'shared.ts',
    'prefilter-decider.test.ts',
    'cache-savings-guards.test.ts',
  ]);

  it('CLAUDE_MEM_PREFILTER_ only appears in the allowlisted basenames', () => {
    const hits = [
      ...filesContaining('src', 'CLAUDE_MEM_PREFILTER_'),
      ...filesContaining('tests', 'CLAUDE_MEM_PREFILTER_'),
    ];
    const offenders = hits
      .map((p) => p.split('/').pop()!)
      .filter((base) => !ALLOWED.has(base));
    expect(offenders).toEqual([]);
  });
});

describe('Anti-pattern — SYSTEM_PROMPT_DYNAMIC_BOUNDARY confined to ClaudeProvider', () => {
  // The boundary marker is an agent-SDK-specific concept. Leaking it into
  // other providers would either be dead code (other providers ignore it) or
  // a sign that someone is trying to reimplement Anthropic-specific caching
  // outside the right path.
  it('SYSTEM_PROMPT_DYNAMIC_BOUNDARY only appears under ClaudeProvider.ts', () => {
    const hits = filesContaining('src', 'SYSTEM_PROMPT_DYNAMIC_BOUNDARY');
    const offenders = hits.filter((p) => !p.endsWith('ClaudeProvider.ts'));
    expect(offenders).toEqual([]);
  });
});
