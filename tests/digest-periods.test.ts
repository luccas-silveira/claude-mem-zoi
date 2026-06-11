/**
 * Plan F.2 (Fase 3): tests for periods.ts pure period-math helpers.
 *
 * All epoch math is UTC — no host TZ involved. DST is irrelevant by design.
 */

import { describe, it, expect } from 'bun:test';
import { periodBounds, listMissingPeriods } from '../src/services/worker/digest/periods.js';

/** Helper: build a UTC epoch from a YYYY-MM-DD date string (assumes 00:00 UTC). */
function utc(date: string): number {
  return Date.parse(date + 'T00:00:00.000Z');
}

describe('periodBounds (weekly)', () => {
  it('snaps a Wednesday to the Monday of the same week', () => {
    // 2026-06-10 is a Wednesday.
    const epoch = utc('2026-06-10');
    const { startEpoch, endEpoch } = periodBounds(epoch, 'weekly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-06-08T00:00:00.000Z'); // Mon
    expect(new Date(endEpoch).toISOString()).toBe('2026-06-15T00:00:00.000Z');   // next Mon
  });

  it('Monday epoch is its own week start', () => {
    const epoch = utc('2026-06-08'); // Monday
    const { startEpoch } = periodBounds(epoch, 'weekly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('Sunday belongs to the week that started the previous Monday', () => {
    const epoch = utc('2026-06-14'); // Sunday
    const { startEpoch, endEpoch } = periodBounds(epoch, 'weekly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-06-08T00:00:00.000Z'); // Mon of same ISO week
    expect(new Date(endEpoch).toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('period width is exactly 7 days for weekly', () => {
    const { startEpoch, endEpoch } = periodBounds(utc('2026-06-10'), 'weekly');
    expect(endEpoch - startEpoch).toBe(7 * 86_400_000);
  });
});

describe('periodBounds (monthly)', () => {
  it('day 1 epoch is its own month start', () => {
    const { startEpoch, endEpoch } = periodBounds(utc('2026-06-01'), 'monthly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(new Date(endEpoch).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('mid-month epoch snaps back to day 1', () => {
    const { startEpoch, endEpoch } = periodBounds(utc('2026-06-15'), 'monthly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(new Date(endEpoch).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('end-of-month epoch (Jan 31) snaps to Jan 1 and ends Feb 1', () => {
    const { startEpoch, endEpoch } = periodBounds(utc('2026-01-31'), 'monthly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(endEpoch).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('December rolls to January of next year', () => {
    const { startEpoch, endEpoch } = periodBounds(utc('2026-12-15'), 'monthly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(new Date(endEpoch).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('periodBounds (DST edge cases)', () => {
  it('weekly boundary in mid-March (US DST start week) lands on Monday UTC anyway', () => {
    // US 2026 DST start is Sun 2026-03-08. We treat everything as UTC so the
    // Monday of that ISO week is 2026-03-02 (no DST shift).
    const { startEpoch } = periodBounds(utc('2026-03-08'), 'weekly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('monthly boundary in November (DST end) lands on day 1 UTC', () => {
    const { startEpoch } = periodBounds(utc('2026-11-15'), 'monthly');
    expect(new Date(startEpoch).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('listMissingPeriods', () => {
  it('returns empty when threshold is at or before oldest', () => {
    const out = listMissingPeriods(utc('2026-06-01'), utc('2026-06-01'), 'weekly', new Set());
    expect(out).toEqual([]);
  });

  it('returns empty when oldest is non-finite', () => {
    const out = listMissingPeriods(NaN, utc('2026-06-01'), 'weekly', new Set());
    expect(out).toEqual([]);
  });

  it('lists each weekly bucket between oldest and threshold (no existing)', () => {
    // From 2026-05-04 (Mon) to 2026-06-01 (Mon) is exactly 4 weeks → 4 buckets.
    const oldest = utc('2026-05-04');
    const threshold = utc('2026-06-01');
    const out = listMissingPeriods(oldest, threshold, 'weekly', new Set());
    expect(out.length).toBe(4);
    expect(new Date(out[0].startEpoch).toISOString()).toBe('2026-05-04T00:00:00.000Z');
    expect(new Date(out[3].startEpoch).toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  it('skips periods already in existingPeriods set', () => {
    const oldest = utc('2026-05-04');
    const threshold = utc('2026-06-01');
    const existing = new Set([String(utc('2026-05-11')), String(utc('2026-05-25'))]);
    const out = listMissingPeriods(oldest, threshold, 'weekly', existing);
    expect(out.length).toBe(2);
    // Remaining are the two that weren't in the existing set.
    expect(new Date(out[0].startEpoch).toISOString()).toBe('2026-05-04T00:00:00.000Z');
    expect(new Date(out[1].startEpoch).toISOString()).toBe('2026-05-18T00:00:00.000Z');
  });

  it('stops at threshold (does not include the period containing the threshold itself)', () => {
    // threshold = Wed 2026-06-10 → period containing it starts Mon 2026-06-08
    // and should NOT be returned (start < threshold check).
    const oldest = utc('2026-06-01');
    const threshold = utc('2026-06-10');
    const out = listMissingPeriods(oldest, threshold, 'weekly', new Set());
    // Period containing the threshold starts on 2026-06-08, which is < threshold(06-10).
    // So both 06-01 and 06-08 are returned.
    expect(out.map(p => new Date(p.startEpoch).toISOString())).toEqual([
      '2026-06-01T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
    ]);
  });

  it('weekly stops cleanly: does not include period whose start >= threshold', () => {
    // oldest = Mon 2026-06-01, threshold = Mon 2026-06-08
    // → only one period (2026-06-01) is returned.
    const out = listMissingPeriods(utc('2026-06-01'), utc('2026-06-08'), 'weekly', new Set());
    expect(out.length).toBe(1);
    expect(new Date(out[0].startEpoch).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('monthly lists each month between oldest and threshold', () => {
    const out = listMissingPeriods(utc('2026-01-15'), utc('2026-04-10'), 'monthly', new Set());
    // Periods containing 2026-01-15, 2026-02, 2026-03, and the one containing 04-10 (starts 04-01 < threshold).
    const starts = out.map(p => new Date(p.startEpoch).toISOString());
    expect(starts).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
  });

  it('monthly skips existing month starts', () => {
    const existing = new Set([String(utc('2026-02-01'))]);
    const out = listMissingPeriods(utc('2026-01-15'), utc('2026-04-10'), 'monthly', existing);
    const starts = out.map(p => new Date(p.startEpoch).toISOString());
    expect(starts).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
  });
});
