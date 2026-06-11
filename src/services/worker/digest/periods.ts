/**
 * Plan F.2 (Fase 3): pure period-bound math for the DigestGenerator.
 *
 * NO I/O. All epoch math is UTC; we never look at the host TZ so DST and
 * local-clock skew can't shift the boundary. Weekly periods start Monday
 * 00:00:00.000 UTC; monthly periods start day 1 00:00:00.000 UTC.
 */

export type PeriodKind = 'weekly' | 'monthly';

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

/**
 * Snap an epoch to Monday 00:00 UTC of its week. Uses ISO weekday math
 * (Monday=1, Sunday=7) and shifts back to Monday.
 */
function weekStartUTC(epochMs: number): number {
  const d = new Date(epochMs);
  // getUTCDay(): Sunday=0..Saturday=6. Convert to ISO (Mon=0..Sun=6) so we
  // can subtract days cleanly to land on Monday.
  const dayIdxMonZero = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dayIdxMonZero,
    0, 0, 0, 0,
  );
  return monday;
}

/**
 * Snap an epoch to day-1 00:00 UTC of its calendar month.
 */
function monthStartUTC(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

/**
 * Return the day-1 of the next month after `epochMs`. Handles December rollover.
 */
function nextMonthStartUTC(epochMs: number): number {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  // m is 0-indexed; +1 lands in next month. If m=11 (Dec), Date.UTC(y, 12, 1)
  // correctly normalises to (y+1, Jan, 1).
  return Date.UTC(y, m + 1, 1, 0, 0, 0, 0);
}

/**
 * For a given epoch, return the [start, end) of the period containing it.
 * Weekly periods start Monday 00:00 UTC. Monthly periods start day 1 00:00 UTC.
 */
export function periodBounds(
  epochMs: number,
  kind: PeriodKind,
): { startEpoch: number; endEpoch: number } {
  if (kind === 'weekly') {
    const startEpoch = weekStartUTC(epochMs);
    return { startEpoch, endEpoch: startEpoch + MS_PER_WEEK };
  }
  const startEpoch = monthStartUTC(epochMs);
  const endEpoch = nextMonthStartUTC(startEpoch);
  return { startEpoch, endEpoch };
}

/**
 * Advance one period forward. Pure helper used by listMissingPeriods.
 */
function nextPeriodStart(startEpoch: number, kind: PeriodKind): number {
  if (kind === 'weekly') {
    return startEpoch + MS_PER_WEEK;
  }
  return nextMonthStartUTC(startEpoch);
}

/**
 * List all period bounds from oldest obs epoch up to `ageThresholdEpoch`,
 * skipping any periodStart already in `existingPeriods`.
 *
 * Stops generating periods once the period's start is >= ageThresholdEpoch
 * (we only digest fully-aged-out periods — the threshold is the cut-off).
 *
 * Caller passes existingPeriods as a Set<string> keyed by `${periodStart}`
 * so identity is exact even across multi-month spans.
 */
export function listMissingPeriods(
  oldestEpoch: number,
  ageThresholdEpoch: number,
  kind: PeriodKind,
  existingPeriods: Set<string>,
): Array<{ startEpoch: number; endEpoch: number }> {
  const out: Array<{ startEpoch: number; endEpoch: number }> = [];

  if (!Number.isFinite(oldestEpoch) || !Number.isFinite(ageThresholdEpoch)) {
    return out;
  }
  if (ageThresholdEpoch <= oldestEpoch) {
    return out;
  }

  // Start from the period containing oldestEpoch.
  let bounds = periodBounds(oldestEpoch, kind);

  // Guard against pathological loops (e.g. far-future epochs). Cap iterations
  // at 10 years of weekly periods (~520) so a corrupted epoch can never spin.
  const MAX_ITERATIONS = 10_000;
  let iterations = 0;

  while (bounds.startEpoch < ageThresholdEpoch && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const key = String(bounds.startEpoch);
    if (!existingPeriods.has(key)) {
      out.push({ startEpoch: bounds.startEpoch, endEpoch: bounds.endEpoch });
    }
    const next = nextPeriodStart(bounds.startEpoch, kind);
    // Sanity: prevent infinite loops if epoch math regressed.
    if (next <= bounds.startEpoch) break;
    bounds = { startEpoch: next, endEpoch: nextPeriodStart(next, kind) };
  }

  return out;
}
