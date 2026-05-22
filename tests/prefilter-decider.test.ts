import { describe, it, expect, beforeEach } from 'bun:test';
import { decidePrefilter, updateReadCache } from '../src/services/worker/http/PrefilterDecider.js';
import { SessionReadCache } from '../src/services/worker/http/SessionReadCache.js';
import type { ObservationPayload } from '../src/services/worker/http/shared.js';
import type { SettingsDefaults } from '../src/shared/SettingsDefaultsManager.js';

const SETTINGS: SettingsDefaults = {
  CLAUDE_MEM_PREFILTER_ENABLED: 'true',
  CLAUDE_MEM_PREFILTER_BASH_MIN_OUTPUT: '80',
  CLAUDE_MEM_PREFILTER_READ_MIN_BYTES: '500',
  CLAUDE_MEM_PREFILTER_MAX_TOTAL_CHARS: '50000',
  CLAUDE_MEM_PREFILTER_DEDUP_READS: 'true',
} as SettingsDefaults;

function makePayload(overrides: Partial<ObservationPayload>): ObservationPayload {
  return {
    contentSessionId: 'sess-1',
    toolName: 'Bash',
    toolInput: {},
    toolResponse: {},
    ...overrides,
  };
}

describe('decidePrefilter', () => {
  let cache: SessionReadCache;

  beforeEach(() => {
    cache = new SessionReadCache();
  });

  it('skips trivial Bash output (short, no error markers)', () => {
    const payload = makePayload({
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      toolResponse: 'hi\n',
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: true, reason: 'bash_trivial' });
  });

  it('keeps Bash output containing error markers (signal, not noise)', () => {
    const payload = makePayload({
      toolName: 'Bash',
      toolInput: { command: 'ls /nope' },
      toolResponse: 'ls: /nope: No such file (error)',
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: false });
  });

  it('keeps Bash output with isError flag even when short', () => {
    const payload = makePayload({
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolResponse: { stdout: 'x', isError: true },
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: false });
  });

  it('skips empty Glob/Grep search results', () => {
    const glob = decidePrefilter(
      makePayload({
        toolName: 'Glob',
        toolInput: { pattern: '**/*.foo' },
        toolResponse: 'No matches found',
      }),
      cache,
      SETTINGS,
    );
    expect(glob).toEqual({ skip: true, reason: 'search_empty' });

    const grep = decidePrefilter(
      makePayload({ toolName: 'Grep', toolResponse: [] }),
      cache,
      SETTINGS,
    );
    expect(grep).toEqual({ skip: true, reason: 'search_empty' });

    const numFiles = decidePrefilter(
      makePayload({
        toolName: 'Glob',
        toolResponse: { numFiles: 0, files: [] },
      }),
      cache,
      SETTINGS,
    );
    expect(numFiles).toEqual({ skip: true, reason: 'search_empty' });
  });

  it('skips small error-free Read responses', () => {
    const payload = makePayload({
      toolName: 'Read',
      toolInput: { file_path: '/tmp/foo.txt' },
      toolResponse: 'hello world',
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: true, reason: 'read_small' });
  });

  it('skips duplicate Read of the same file in the same session', () => {
    const big = 'x'.repeat(800);
    const first = makePayload({
      toolName: 'Read',
      toolInput: { file_path: '/tmp/a.ts' },
      toolResponse: big,
    });
    expect(decidePrefilter(first, cache, SETTINGS)).toEqual({ skip: false });
    updateReadCache(first, cache);

    const second = decidePrefilter(first, cache, SETTINGS);
    expect(second).toEqual({ skip: true, reason: 'read_dup' });
  });

  it('invalidates the read cache on Edit so subsequent Read is fresh signal', () => {
    const big = 'x'.repeat(800);
    const read = makePayload({
      toolName: 'Read',
      toolInput: { file_path: '/tmp/a.ts' },
      toolResponse: big,
    });
    updateReadCache(read, cache);
    expect(cache.hasRead('sess-1', '/tmp/a.ts')).toBe(true);

    const edit = makePayload({
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/a.ts' },
      toolResponse: 'edited',
    });
    updateReadCache(edit, cache);
    expect(cache.hasRead('sess-1', '/tmp/a.ts')).toBe(false);

    // Now a re-Read should pass (not a dup)
    expect(decidePrefilter(read, cache, SETTINGS)).toEqual({ skip: false });
  });

  it('skips oversized combined input+response payloads', () => {
    const huge = 'y'.repeat(60_000);
    const payload = makePayload({
      toolName: 'Bash',
      toolInput: { command: 'cat big.log' },
      toolResponse: huge,
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: true, reason: 'oversized' });
  });

  it('read_small boundary: stringified length exactly == readMin skips (<= semantics)', () => {
    // JSON.stringify wraps string in quotes -> +2 chars. Aim for stringified length == 500.
    const body = 'x'.repeat(498);
    const payload = makePayload({
      toolName: 'Read',
      toolInput: { file_path: '/tmp/boundary.txt' },
      toolResponse: body,
    });
    expect(JSON.stringify(payload.toolResponse).length).toBe(500);
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: true, reason: 'read_small' });
  });

  it('oversized boundary: total chars exactly == max does NOT skip; max+1 does (strict > semantics)', () => {
    // toolInput = { file_path: '/src/app.ts' } -> JSON.stringify length 26.
    // responseStr length needs to bring total to exactly 50000 -> 49974 -> body length 49972.
    const inputObj = { file_path: '/src/app.ts' };
    const inputLen = JSON.stringify(inputObj).length;

    const bodyEq = 'a'.repeat(50_000 - inputLen - 2);
    const eqPayload = makePayload({
      toolName: 'Read',
      toolInput: inputObj,
      toolResponse: bodyEq,
    });
    const totalEq = JSON.stringify(eqPayload.toolInput).length
      + JSON.stringify(eqPayload.toolResponse).length;
    expect(totalEq).toBe(50_000);
    expect(decidePrefilter(eqPayload, cache, SETTINGS)).toEqual({ skip: false });

    const bodyOver = 'a'.repeat(50_001 - inputLen - 2);
    const overPayload = makePayload({
      toolName: 'Read',
      toolInput: inputObj,
      toolResponse: bodyOver,
    });
    const totalOver = JSON.stringify(overPayload.toolInput).length
      + JSON.stringify(overPayload.toolResponse).length;
    expect(totalOver).toBe(50_001);
    expect(decidePrefilter(overPayload, cache, SETTINGS)).toEqual({ skip: true, reason: 'oversized' });
  });

  it('happy path: regular Read of a substantive file passes through', () => {
    const body = 'x'.repeat(800);
    const payload = makePayload({
      toolName: 'Read',
      toolInput: { file_path: '/src/app.ts' },
      toolResponse: body,
    });
    const decision = decidePrefilter(payload, cache, SETTINGS);
    expect(decision).toEqual({ skip: false });
  });
});
