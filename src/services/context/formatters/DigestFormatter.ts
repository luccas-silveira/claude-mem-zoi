/**
 * Plan F.3 (Fase 4): compact renderer for observation_digests rows.
 *
 * Produces a `## Historical context (N weekly digests)` block followed by one
 * bullet per digest. Token-conscious by design — summary_text is truncated to
 * a constant preview width, and JSON arrays (dominant_types, etc.) are NOT
 * decoded into the output to keep the block readable as plain markdown.
 *
 * Empty input returns []. The caller must not see a header on an empty block.
 */

import type { ObservationDigestRow } from '../../sqlite/types.js';

export const MAX_DIGEST_PREVIEW_CHARS = 200;

/**
 * Format an epoch (ms since 1970, UTC) as `YYYY-MM-DD`. No timezone math —
 * always UTC so the rendered block is deterministic across host timezones.
 */
function formatPeriodStart(epoch: number): string {
  const d = new Date(epoch);
  // Defensive: invalid dates become empty strings rather than 'Invalid Date'.
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Truncate to MAX_DIGEST_PREVIEW_CHARS, collapsing newlines and runs of
 * whitespace into single spaces. Defensive against undefined/null callers.
 */
function previewSummary(text: string | null | undefined): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_DIGEST_PREVIEW_CHARS) return collapsed;
  // Truncate at the boundary, then strip trailing markdown punctuation that
  // would otherwise emit a half-open header / code-fence / list-bullet into
  // the parent injection block.
  return collapsed
    .slice(0, MAX_DIGEST_PREVIEW_CHARS)
    .replace(/[#*`\-_\[\(\s]+$/, '')
    .trimEnd();
}

/**
 * Pick a single label for the period kind in the header. We avoid mixing
 * weekly + monthly into a generic plural when the digests are homogeneous,
 * because in practice CLAUDE_MEM_DIGEST_PERIOD picks one kind per project.
 */
function inferPeriodLabel(digests: ObservationDigestRow[]): string {
  if (digests.length === 0) return '';
  const first = digests[0].period_kind;
  const allSame = digests.every(d => d.period_kind === first);
  return allSame ? first : 'mixed';
}

export function renderDigests(digests: ObservationDigestRow[]): string[] {
  if (digests.length === 0) return [];

  const periodLabel = inferPeriodLabel(digests);
  const output: string[] = [];

  output.push(`## Historical context (${digests.length} ${periodLabel} digests)`);

  // Render oldest-first per Plan F.3 spec. Input from queryDigests is
  // already DESC by period_start_epoch, so we walk it in reverse — no
  // sort needed (and no mutation of caller's array).
  for (let i = digests.length - 1; i >= 0; i--) {
    const d = digests[i];
    const date = formatPeriodStart(d.period_start_epoch);
    const project = d.project ?? '';
    const preview = previewSummary(d.summary_text);
    const head = date
      ? `${d.period_kind} ${date} · ${project} · ${d.obs_count} obs`
      : `${d.period_kind} ${project} · ${d.obs_count} obs`;
    output.push(preview ? `- ${head}: ${preview}` : `- ${head}`);
  }

  output.push('');
  return output;
}
