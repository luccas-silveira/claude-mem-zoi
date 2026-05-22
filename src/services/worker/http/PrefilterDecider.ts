/**
 * Pure deterministic pre-filter for noisy tool_use events.
 *
 * Runs inside `ingestObservation()` (see `shared.ts`) after project /
 * skip-tools / session-memory-meta filters but before the privacy check.
 *
 * Five filters, evaluated in order — bail on first match:
 *   1. bash_trivial   — short, error-free Bash outputs.
 *   2. search_empty   — Glob/Grep with zero matches.
 *   3. read_small     — short, error-free Read responses.
 *   4. read_dup       — Read of a file already Read in this session.
 *   5. oversized      — combined input+response above max budget.
 *
 * The function is pure (no I/O, no logger) so it can be exhaustively tested.
 * State for `read_dup` comes in via the `readCache` parameter.
 */

import type { ObservationPayload } from './shared.js';
import type { SessionReadCache } from './SessionReadCache.js';
import type { SettingsDefaults } from '../../../shared/SettingsDefaultsManager.js';

export type PrefilterDecision =
  | { skip: true; reason: string }
  | { skip: false };

const ERROR_NEEDLES = ['error', 'fail', 'exception', 'traceback'];

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function containsErrorMarker(stringified: string): boolean {
  const lower = stringified.toLowerCase();
  return ERROR_NEEDLES.some(needle => lower.includes(needle));
}

function hasIsErrorFlag(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const obj = response as Record<string, unknown>;
  return obj.isError === true || obj.is_error === true;
}

/**
 * Real Bash output length = stdout + stderr (skips field-name overhead).
 *
 * Claude Code's Bash tool_response carries ~50 chars of envelope (stdout,
 * stderr, interrupted, isImage, noOutputExpected keys) even for empty
 * output, so stringify-length comparison was incorrectly forgiving. When
 * the response is the expected object shape, measure the actual payload.
 * Falls back to stringified length for non-object responses.
 */
function bashOutputLen(response: unknown, stringified: string): number {
  if (response && typeof response === 'object') {
    const obj = response as { stdout?: unknown; stderr?: unknown };
    if (typeof obj.stdout === 'string' || typeof obj.stderr === 'string') {
      const out = typeof obj.stdout === 'string' ? obj.stdout.length : 0;
      const err = typeof obj.stderr === 'string' ? obj.stderr.length : 0;
      return out + err;
    }
  }
  return stringified.length;
}

/**
 * Real Read content length (skips field-name overhead).
 *
 * Like Bash, Read responses carry envelope keys. When the shape is the
 * expected object with a `content` / `file` / `text` string, measure that
 * string directly. Falls back to stringified length otherwise.
 */
function readContentLen(response: unknown, stringified: string): number {
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    for (const key of ['content', 'file', 'text', 'output']) {
      const v = obj[key];
      if (typeof v === 'string') return v.length;
    }
  }
  return stringified.length;
}

function extractFilePath(toolInput: unknown): string | undefined {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  const input = toolInput as { file_path?: unknown; notebook_path?: unknown };
  const fp = input.file_path ?? input.notebook_path;
  return typeof fp === 'string' && fp.length > 0 ? fp : undefined;
}

export function decidePrefilter(
  payload: ObservationPayload,
  readCache: SessionReadCache,
  settings: SettingsDefaults,
): PrefilterDecision {
  const bashMin = parseIntSafe(settings.CLAUDE_MEM_PREFILTER_BASH_MIN_OUTPUT, 80);
  const readMin = parseIntSafe(settings.CLAUDE_MEM_PREFILTER_READ_MIN_BYTES, 500);
  const maxTotal = parseIntSafe(settings.CLAUDE_MEM_PREFILTER_MAX_TOTAL_CHARS, 50_000);
  const dedupReads = settings.CLAUDE_MEM_PREFILTER_DEDUP_READS !== 'false';

  const toolName = payload.toolName;
  const responseStr = payload.toolResponse !== undefined
    ? JSON.stringify(payload.toolResponse)
    : '{}';
  const inputStr = payload.toolInput !== undefined
    ? JSON.stringify(payload.toolInput)
    : '{}';

  // 1. bash_trivial — measures actual stdout+stderr, not envelope+fields.
  if (toolName === 'Bash') {
    const outLen = bashOutputLen(payload.toolResponse, responseStr);
    if (
      outLen <= bashMin &&
      !containsErrorMarker(responseStr) &&
      !hasIsErrorFlag(payload.toolResponse)
    ) {
      return { skip: true, reason: 'bash_trivial' };
    }
  }

  // 2. search_empty (Glob / Grep with zero matches)
  if (toolName === 'Glob' || toolName === 'Grep') {
    if (
      responseStr.includes('No matches found') ||
      responseStr === '[]' ||
      /\bnumFiles":\s*0\b/.test(responseStr)
    ) {
      return { skip: true, reason: 'search_empty' };
    }
  }

  // 3. read_small (must come BEFORE read_dup — order matters).
  // Measures actual content, not envelope+fields.
  if (toolName === 'Read') {
    const contentLen = readContentLen(payload.toolResponse, responseStr);
    if (contentLen <= readMin && !containsErrorMarker(responseStr)) {
      return { skip: true, reason: 'read_small' };
    }

    // 4. read_dup
    if (dedupReads) {
      const filePath = extractFilePath(payload.toolInput);
      if (filePath && readCache.hasRead(payload.contentSessionId, filePath)) {
        return { skip: true, reason: 'read_dup' };
      }
    }
  }

  // 5. oversized — combined input+response above the max budget.
  if (inputStr.length + responseStr.length > maxTotal) {
    return { skip: true, reason: 'oversized' };
  }

  return { skip: false };
}

/**
 * Update the session read cache after a payload has passed the pre-filter.
 *
 * - Read: mark the file path as read.
 * - Edit/Write/NotebookEdit: invalidate the cached entry so the next Read
 *   of that file is treated as fresh signal.
 *
 * Side-effect helper — kept separate from `decidePrefilter` so the decider
 * stays pure for testing.
 */
export function updateReadCache(
  payload: ObservationPayload,
  readCache: SessionReadCache,
): void {
  const filePath = extractFilePath(payload.toolInput);
  if (!filePath) return;

  if (payload.toolName === 'Read') {
    readCache.markRead(payload.contentSessionId, filePath);
    return;
  }

  if (
    payload.toolName === 'Edit' ||
    payload.toolName === 'Write' ||
    payload.toolName === 'NotebookEdit'
  ) {
    readCache.invalidate(payload.contentSessionId, filePath);
  }
}
