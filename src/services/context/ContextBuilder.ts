
import path from 'path';
import { homedir } from 'os';
import { unlinkSync } from 'fs';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../utils/project-name.js';

import type { ContextInput, ContextConfig, Observation, SessionSummary } from './types.js';
import type { ObservationDigestRow } from '../sqlite/types.js';
import { loadContextConfig } from './ContextConfigLoader.js';
import { calculateTokenEconomics } from './TokenCalculator.js';
import {
  queryObservations,
  queryObservationsMulti,
  querySummaries,
  querySummariesMulti,
  queryDigests,
  queryDigestsMulti,
  getPriorSessionMessages,
  prepareSummariesForTimeline,
  buildTimeline,
  getFullObservationIds,
} from './ObservationCompiler.js';
import { renderHeader } from './sections/HeaderRenderer.js';
import { renderTimeline } from './sections/TimelineRenderer.js';
import { shouldShowSummary, renderSummaryFields } from './sections/SummaryRenderer.js';
import { renderPreviouslySection, renderFooter } from './sections/FooterRenderer.js';
import { renderAgentEmptyState } from './formatters/AgentFormatter.js';
import { renderHumanEmptyState } from './formatters/HumanFormatter.js';
import { renderDigests } from './formatters/DigestFormatter.js';

const VERSION_MARKER_PATH = path.join(
  homedir(),
  '.claude',
  'plugins',
  'marketplaces',
  'thedotmack',
  'plugin',
  '.install-version'
);

function initializeDatabase(): SessionStore | null {
  try {
    return new SessionStore();
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED') {
      try {
        unlinkSync(VERSION_MARKER_PATH);
      } catch (unlinkError) {
        if (unlinkError instanceof Error) {
          logger.debug('WORKER', 'Marker file cleanup failed (may not exist)', {}, unlinkError);
        } else {
          logger.debug('WORKER', 'Marker file cleanup failed (may not exist)', { error: String(unlinkError) });
        }
      }
      logger.error('WORKER', 'Native module rebuild needed - restart Claude Code to auto-fix');
      return null;
    }
    throw error;
  }
}

function renderEmptyState(project: string, forHuman: boolean): string {
  return forHuman ? renderHumanEmptyState(project) : renderAgentEmptyState(project);
}

/**
 * Exported for tests in tests/context-digests-injection.test.ts so the digest
 * mixing logic can be exercised against synthetic config + in-memory data
 * without depending on settings.json on disk. Pure function — no I/O.
 */
export function buildContextOutput(
  project: string,
  observations: Observation[],
  summaries: SessionSummary[],
  digests: ObservationDigestRow[],
  config: ContextConfig,
  cwd: string,
  sessionId: string | undefined,
  forHuman: boolean
): string {
  const output: string[] = [];

  const economics = calculateTokenEconomics(observations);

  output.push(...renderHeader(project, economics, config, forHuman));

  // Plan F.3 (Fase 4): historical digests render BEFORE the recent-observations
  // timeline so the reader sees long-term context first, then recent activity.
  // renderDigests returns [] when digests is empty (no header on empty block).
  output.push(...renderDigests(digests));

  const displaySummaries = summaries.slice(0, config.sessionCount);
  const summariesForTimeline = prepareSummariesForTimeline(displaySummaries, summaries);
  const timeline = buildTimeline(observations, summariesForTimeline);
  const fullObservationIds = getFullObservationIds(observations, config.fullObservationCount);

  output.push(...renderTimeline(timeline, fullObservationIds, config, cwd, forHuman));

  const mostRecentSummary = summaries[0];
  const mostRecentObservation = observations[0];

  if (shouldShowSummary(config, mostRecentSummary, mostRecentObservation)) {
    output.push(...renderSummaryFields(mostRecentSummary, forHuman));
  }

  const priorMessages = getPriorSessionMessages(observations, config, sessionId, cwd);
  output.push(...renderPreviouslySection(priorMessages, forHuman));

  output.push(...renderFooter(economics, config, forHuman));

  return output.join('\n').trimEnd();
}

export async function generateContext(
  input?: ContextInput,
  forHuman: boolean = false
): Promise<string> {
  const config = loadContextConfig();
  const cwd = input?.cwd ?? process.cwd();
  const context = getProjectContext(cwd);

  const projects = input?.projects?.length ? input.projects : context.allProjects;
  const project = projects[projects.length - 1] ?? context.primary;

  if (input?.full) {
    config.totalObservationCount = 999999;
    config.sessionCount = 999999;
  }

  const db = initializeDatabase();
  if (!db) {
    return '';
  }

  try {
    const observations = projects.length > 1
      ? queryObservationsMulti(db, projects, config)
      : queryObservations(db, project, config);
    const summaries = projects.length > 1
      ? querySummariesMulti(db, projects, config)
      : querySummaries(db, project, config);
    // Plan F.3 (Fase 4): pull observation_digests in parallel with obs/summaries.
    // queryDigests short-circuits to [] when config.digestCount <= 0 — no DB hit.
    const digests = projects.length > 1
      ? queryDigestsMulti(db, projects, config)
      : queryDigests(db, project, config);

    // Empty state fires only when ALL three sources are empty. If digests exist
    // for a project with no recent obs/summaries, we still render the header +
    // digest block — historical context is meaningful on its own.
    if (observations.length === 0 && summaries.length === 0 && digests.length === 0) {
      return renderEmptyState(project, forHuman);
    }

    const output = buildContextOutput(
      project,
      observations,
      summaries,
      digests,
      config,
      cwd,
      input?.session_id,
      forHuman
    );

    return output;
  } finally {
    db.close();
  }
}
