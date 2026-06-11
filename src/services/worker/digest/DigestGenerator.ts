/**
 * Plan F.2 (Fase 3): hierarchical compression background job.
 *
 * SAFETY POSTURE (non-negotiable):
 *   1. Every external call wrapped in try/catch — DB, LLM, parser. Failure of
 *      one period must never abort the others.
 *   2. signal.aborted is honored before every period iteration.
 *   3. LLM calls are strictly sequential (concurrency = 1).
 *   4. Total run time is capped by RUN_TIME_BUDGET_MS.
 *   5. Total digests per run capped by MAX_DIGESTS_PER_RUN.
 *   6. Settings are read once at the start; never re-read mid-loop.
 *   7. If digest is disabled → return zero immediately, no DB queries.
 *   8. Race-deleted period (zero obs after listing) → silent skip.
 *   9. Empty/unparseable LLM output → warn + skip + increment failed.
 *
 * The job MUST NOT throw under any circumstance: the caller fire-and-forgets it.
 */

import type { SessionStore } from '../../sqlite/SessionStore.js';
import type { SettingsDefaults } from '../../../shared/SettingsDefaultsManager.js';
import type { logger as LoggerNS } from '../../../utils/logger.js';
import type { ObservationRow, ObservationDigestRow } from '../../sqlite/types.js';
import { buildDigestPrompt } from '../../../sdk/prompts.js';
import { parseDigest } from '../../../sdk/parser.js';
import { listMissingPeriods, type PeriodKind } from './periods.js';

const MAX_DIGESTS_PER_RUN = 50;
const RUN_TIME_BUDGET_MS = 60_000;

export interface DigestProvider {
  compressDigest(prompt: string, signal: AbortSignal): Promise<string>;
}

export interface DigestGeneratorOptions {
  store: SessionStore;
  /**
   * Provider with a compressDigest method. At runtime we duck-type — non-DeepSeek
   * providers won't have this method yet, so we short-circuit with a warn log.
   */
  provider: Partial<DigestProvider> | unknown;
  settings: SettingsDefaults;
  logger: typeof LoggerNS;
}

export interface DigestRunResult {
  generated: number;
  skipped: number;
  failed: number;
}

function parseDayCount(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseMaxObs(raw: string, fallback: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function periodLabel(startEpoch: number, kind: PeriodKind): string {
  const d = new Date(startEpoch);
  const iso = d.toISOString().split('T')[0];
  return kind === 'weekly' ? `week of ${iso}` : `month of ${iso.slice(0, 7)}`;
}

/**
 * Reduce array of observations into a JSON-serialized "dominant" list.
 * Used to roll up the parsed digest's dominant_types / dominant_concepts
 * when the LLM omits them — keeps the digest searchable even on a sparse model.
 */
function topN(values: string[], limit: number): string[] {
  if (values.length === 0) return [];
  const counts = new Map<string, number>();
  for (const v of values) {
    if (typeof v !== 'string' || !v.trim()) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/**
 * Parse a JSON-encoded array column (concepts / files_read / facts / etc.)
 * from an observation row. Returns [] on null/invalid/empty.
 */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // Some legacy rows store CSV; fall through.
  }
  // Best-effort CSV fallback.
  return raw.split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
}

export class DigestGenerator {
  constructor(private opts: DigestGeneratorOptions) {}

  /**
   * Best-effort compaction. NEVER throws. Each period is independent —
   * one failure does not abort the others.
   */
  async generateMissingDigests(signal: AbortSignal): Promise<DigestRunResult> {
    const result: DigestRunResult = { generated: 0, skipped: 0, failed: 0 };
    const { settings, logger } = this.opts;

    // SAFETY REQUIREMENT 7: short-circuit when disabled. No DB queries.
    if (settings.CLAUDE_MEM_DIGEST_ENABLED !== 'true') {
      return result;
    }

    // SAFETY REQUIREMENT 6: read settings once at run start.
    const minAgeDays = parseDayCount(settings.CLAUDE_MEM_DIGEST_MIN_AGE_DAYS, 30);
    const maxObsPer = parseMaxObs(settings.CLAUDE_MEM_DIGEST_MAX_OBS_PER, 100);
    const periodKindRaw = settings.CLAUDE_MEM_DIGEST_PERIOD;
    const periodKind: PeriodKind = periodKindRaw === 'monthly' ? 'monthly' : 'weekly';

    // SAFETY REQUIREMENT 5: provider duck-type — non-DeepSeek providers get
    // a single warn log and an early return rather than per-period spam.
    const provider = this.opts.provider as Partial<DigestProvider>;
    if (typeof provider?.compressDigest !== 'function') {
      logger.debug('DIGEST', 'Digest provider not supported, skipping');
      return result;
    }

    const startedAt = Date.now();
    const ageThresholdEpoch = startedAt - minAgeDays * 86_400_000;

    let projects: string[];
    try {
      projects = this.opts.store.listProjectsWithOldObservations(ageThresholdEpoch);
    } catch (err) {
      logger.warn('DIGEST', 'listProjectsWithOldObservations failed', undefined,
        err instanceof Error ? err : new Error(String(err)));
      return result;
    }

    if (projects.length === 0) {
      logger.info('DIGEST', 'No projects with old observations to digest');
      return result;
    }

    logger.info('DIGEST', 'Digest run starting', {
      projects: projects.length,
      periodKind,
      minAgeDays,
      maxObsPer,
    });

    for (const project of projects) {
      // SAFETY REQUIREMENT 2: honor abort between every iteration.
      if (signal.aborted) {
        logger.info('DIGEST', 'Aborted between projects', { processedSoFar: result });
        return result;
      }
      // SAFETY REQUIREMENT 4: time budget.
      if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) {
        logger.warn('DIGEST', 'Run time budget exceeded, stopping', { processedSoFar: result });
        return result;
      }

      let oldest: number | null;
      let existing: number[];
      try {
        oldest = this.opts.store.getOldestObservationEpoch(project);
        existing = this.opts.store.listExistingDigestPeriodStarts(project, periodKind);
      } catch (err) {
        logger.warn('DIGEST', 'Failed to enumerate project periods', { project },
          err instanceof Error ? err : new Error(String(err)));
        result.failed += 1;
        continue;
      }

      if (oldest === null) {
        continue;
      }

      const existingSet = new Set(existing.map(e => String(e)));
      const missing = listMissingPeriods(oldest, ageThresholdEpoch, periodKind, existingSet);

      if (missing.length === 0) {
        continue;
      }

      logger.info('DIGEST', 'Processing project digests', {
        project,
        missingPeriods: missing.length,
      });

      for (const period of missing) {
        // SAFETY REQUIREMENT 2: honor abort between every period iteration.
        if (signal.aborted) {
          logger.info('DIGEST', 'Aborted between periods', { project, processedSoFar: result });
          return result;
        }
        // SAFETY REQUIREMENT 5: hard cap on digests per run.
        if (result.generated + result.failed >= MAX_DIGESTS_PER_RUN) {
          logger.warn('DIGEST', 'MAX_DIGESTS_PER_RUN reached, stopping', {
            limit: MAX_DIGESTS_PER_RUN,
            processedSoFar: result,
          });
          return result;
        }
        // SAFETY REQUIREMENT 4: time budget.
        if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) {
          logger.warn('DIGEST', 'Run time budget exceeded mid-project, stopping', {
            project,
            processedSoFar: result,
          });
          return result;
        }

        await this.processOnePeriod(project, period.startEpoch, period.endEpoch, periodKind, maxObsPer, signal, result);
      }
    }

    logger.info('DIGEST', 'Digest run finished', {
      ...result,
      elapsedMs: Date.now() - startedAt,
    });

    return result;
  }

  /**
   * Process a single (project, period) tuple. Catches all errors locally so
   * the caller loop is unaffected by per-period failures.
   *
   * SAFETY REQUIREMENT 1: every external call is in its own try/catch.
   */
  private async processOnePeriod(
    project: string,
    startEpoch: number,
    endEpoch: number,
    periodKind: PeriodKind,
    maxObsPer: number,
    signal: AbortSignal,
    result: DigestRunResult,
  ): Promise<void> {
    const { logger } = this.opts;
    const label = periodLabel(startEpoch, periodKind);

    let obs: ObservationRow[];
    try {
      obs = this.opts.store.getObservationsForPeriod(project, startEpoch, endEpoch, maxObsPer);
    } catch (err) {
      logger.warn('DIGEST', 'getObservationsForPeriod failed', { project, label },
        err instanceof Error ? err : new Error(String(err)));
      result.failed += 1;
      return;
    }

    // SAFETY REQUIREMENT 8: race-deleted period (zero obs after listing).
    if (obs.length === 0) {
      result.skipped += 1;
      return;
    }

    let prompt: string;
    try {
      prompt = buildDigestPrompt(
        obs.map(o => ({
          type: o.type ?? null,
          title: o.title,
          subtitle: o.subtitle,
          narrative: o.narrative,
          facts: o.facts,
          concepts: o.concepts,
          files_read: o.files_read,
          files_modified: o.files_modified,
          created_at: o.created_at,
        })),
        label,
        project,
      );
    } catch (err) {
      logger.warn('DIGEST', 'buildDigestPrompt failed', { project, label },
        err instanceof Error ? err : new Error(String(err)));
      result.failed += 1;
      return;
    }

    let raw: string;
    try {
      const provider = this.opts.provider as DigestProvider;
      raw = await provider.compressDigest(prompt, signal);
    } catch (err) {
      // Abort propagation: not a digest failure per se.
      if (signal.aborted) return;
      logger.warn('DIGEST', 'compressDigest failed', { project, label },
        err instanceof Error ? err : new Error(String(err)));
      result.failed += 1;
      return;
    }

    // SAFETY REQUIREMENT 9: empty/unparseable XML → warn + skip + failed++.
    let parsed;
    try {
      parsed = parseDigest(raw);
    } catch (err) {
      logger.warn('DIGEST', 'parseDigest threw', { project, label },
        err instanceof Error ? err : new Error(String(err)));
      result.failed += 1;
      return;
    }
    if (!parsed) {
      logger.warn('DIGEST', 'Digest parse returned null', { project, label, rawChars: raw.length });
      result.failed += 1;
      return;
    }

    // Roll up dominant_types / dominant_concepts / files_touched if LLM left them empty.
    const allConcepts: string[] = [];
    const allFiles: string[] = [];
    const allTypes: string[] = [];
    for (const o of obs) {
      if (o.type) allTypes.push(o.type);
      for (const c of parseJsonArray(o.concepts)) allConcepts.push(c);
      for (const f of parseJsonArray(o.files_read)) allFiles.push(f);
      for (const f of parseJsonArray(o.files_modified)) allFiles.push(f);
    }
    const dominantTypes = parsed.dominant_types.length > 0
      ? parsed.dominant_types
      : topN(allTypes, 5);
    const dominantConcepts = parsed.dominant_concepts.length > 0
      ? parsed.dominant_concepts
      : topN(allConcepts, 8);
    const filesTouched = parsed.files_touched.length > 0
      ? parsed.files_touched
      : topN(allFiles, 15);

    const digest: Omit<ObservationDigestRow, 'id' | 'created_at' | 'created_at_epoch'> = {
      project,
      period_start_epoch: startEpoch,
      period_end_epoch: endEpoch,
      period_kind: periodKind,
      obs_count: obs.length,
      dominant_types: JSON.stringify(dominantTypes),
      dominant_concepts: JSON.stringify(dominantConcepts),
      summary_text: parsed.summary_text,
      facts: JSON.stringify(parsed.facts),
      files_touched: JSON.stringify(filesTouched),
    };

    let inserted: boolean;
    try {
      inserted = this.opts.store.insertObservationDigest(digest);
    } catch (err) {
      logger.warn('DIGEST', 'insertObservationDigest failed', { project, label },
        err instanceof Error ? err : new Error(String(err)));
      result.failed += 1;
      return;
    }

    if (inserted) {
      result.generated += 1;
      logger.info('DIGEST', 'Digest inserted', {
        project,
        label,
        obsCount: obs.length,
        summaryChars: parsed.summary_text.length,
      });
    } else {
      // Race: another worker (or earlier iteration) inserted concurrently.
      result.skipped += 1;
    }
  }
}
