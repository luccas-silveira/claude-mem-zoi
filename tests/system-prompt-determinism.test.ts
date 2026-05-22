import { describe, expect, it } from 'bun:test';

import { buildSystemPrompt, buildInitUserPrompt, buildContinuationUserPrompt, generateTypeGuidance, generateConceptGuidance } from '../src/sdk/prompts.js';
import type { ModeConfig } from '../src/services/domain/types.js';

const fixtureMode: ModeConfig = {
  name: 'test-mode',
  description: 'fixture mode for determinism tests',
  version: '0.0.0',
  observation_types: [
    { id: 'bugfix',    label: 'Bugfix',    description: 'something was broken, now fixed', emoji: 'B', work_emoji: 'W' },
    { id: 'discovery', label: 'Discovery', description: 'd', emoji: 'D', work_emoji: 'W' },
    { id: 'decision',  label: 'Decision',  description: 'd', emoji: 'D', work_emoji: 'W' },
  ],
  observation_concepts: [
    { id: 'how-it-works', label: 'How It Works', description: 'understanding mechanisms' },
    { id: 'concept_a',    label: 'A',            description: 'a' },
  ],
  prompts: {
    system_identity:        'SYSTEM_IDENTITY_TEXT',
    observer_role:          'OBSERVER_ROLE_TEXT',
    spatial_awareness:      'SPATIAL_AWARENESS_TEXT',
    recording_focus:        'RECORDING_FOCUS_TEXT',
    skip_guidance:          'SKIP_GUIDANCE_TEXT',
    type_guidance:          'TYPE_GUIDANCE_TEXT',
    concept_guidance:       'CONCEPT_GUIDANCE_TEXT',
    field_guidance:         'FIELD_GUIDANCE_TEXT',
    output_format_header:   'OUTPUT_FORMAT_HEADER_TEXT',
    format_examples:        'FORMAT_EXAMPLES_TEXT',
    footer:                 'FOOTER_TEXT',

    xml_title_placeholder:     'TITLE_PLACEHOLDER',
    xml_subtitle_placeholder:  'SUBTITLE_PLACEHOLDER',
    xml_fact_placeholder:      'FACT_PLACEHOLDER',
    xml_narrative_placeholder: 'NARRATIVE_PLACEHOLDER',
    xml_concept_placeholder:   'CONCEPT_PLACEHOLDER',
    xml_file_placeholder:      'FILE_PLACEHOLDER',

    xml_summary_request_placeholder:      'SUMMARY_REQUEST',
    xml_summary_investigated_placeholder: 'SUMMARY_INVESTIGATED',
    xml_summary_learned_placeholder:      'SUMMARY_LEARNED',
    xml_summary_completed_placeholder:    'SUMMARY_COMPLETED',
    xml_summary_next_steps_placeholder:   'SUMMARY_NEXT_STEPS',
    xml_summary_notes_placeholder:        'SUMMARY_NOTES',

    header_memory_start:       'HEADER_MEMORY_START',
    header_memory_continued:   'HEADER_MEMORY_CONTINUED',
    header_summary_checkpoint: 'HEADER_SUMMARY_CHECKPOINT',

    continuation_greeting:    'CONTINUATION_GREETING',
    continuation_instruction: 'CONTINUATION_INSTRUCTION',

    summary_instruction:        'SUMMARY_INSTRUCTION',
    summary_context_label:      'SUMMARY_CONTEXT_LABEL',
    summary_format_instruction: 'SUMMARY_FORMAT_INSTRUCTION',
    summary_footer:             'SUMMARY_FOOTER',
  },
};

describe('buildSystemPrompt', () => {
  it('is deterministic — same mode produces identical bytes across calls', () => {
    const a = buildSystemPrompt(fixtureMode);
    const b = buildSystemPrompt(fixtureMode);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('includes the stable observer scaffold and excludes per-turn dynamic fields', () => {
    const prompt = buildSystemPrompt(fixtureMode);

    // Stable content present.
    expect(prompt).toContain('SYSTEM_IDENTITY_TEXT');
    expect(prompt).toContain('OBSERVER_ROLE_TEXT');
    expect(prompt).toContain('<observation>');
    expect(prompt).toContain('FOOTER_TEXT');

    // No per-session dynamic content leaks into the cached system prompt.
    expect(prompt).not.toContain('<user_request>');
    expect(prompt).not.toContain('<requested_at>');
    expect(prompt).not.toContain('HEADER_MEMORY_START');
    expect(prompt).not.toContain('HEADER_MEMORY_CONTINUED');
    expect(prompt).not.toContain('CONTINUATION_GREETING');
  });
});

describe('buildInitUserPrompt', () => {
  it('contains the per-turn user_request envelope and the session header', () => {
    const prompt = buildInitUserPrompt('proj', 'sess-1', 'do something', fixtureMode);
    expect(prompt).toContain('<user_request>do something</user_request>');
    expect(prompt).toContain('HEADER_MEMORY_START');
  });

  it('omits the stable system scaffolding', () => {
    const prompt = buildInitUserPrompt('proj', 'sess-1', 'do something', fixtureMode);
    expect(prompt).not.toContain('SYSTEM_IDENTITY_TEXT');
    expect(prompt).not.toContain('OBSERVER_ROLE_TEXT');
    expect(prompt).not.toContain('<observation>');
    expect(prompt).not.toContain('FOOTER_TEXT');
  });
});

describe('generateTypeGuidance / generateConceptGuidance', () => {
  it('produce byte-deterministic output across calls', () => {
    const t1 = generateTypeGuidance(fixtureMode);
    const t2 = generateTypeGuidance(fixtureMode);
    const c1 = generateConceptGuidance(fixtureMode);
    const c2 = generateConceptGuidance(fixtureMode);
    expect(t1).toBe(t2);
    expect(c1).toBe(c2);
    expect(t1.length).toBeGreaterThan(0);
    expect(c1.length).toBeGreaterThan(0);
  });

  it('buildSystemPrompt embeds the programmatically generated type and concept IDs', () => {
    const prompt = buildSystemPrompt(fixtureMode);
    expect(prompt).toContain('- bugfix:');
    expect(prompt).toContain('- discovery:');
    expect(prompt).toContain('- how-it-works:');
    expect(prompt).toContain('- concept_a:');
  });
});

describe('buildContinuationUserPrompt', () => {
  it('contains continuation greeting, user_request, and continued header', () => {
    const prompt = buildContinuationUserPrompt('next thing', 2, 'sess-1', fixtureMode);
    expect(prompt).toContain('CONTINUATION_GREETING');
    expect(prompt).toContain('<user_request>next thing</user_request>');
    expect(prompt).toContain('CONTINUATION_INSTRUCTION');
    expect(prompt).toContain('HEADER_MEMORY_CONTINUED');
  });

  it('omits the stable system scaffolding', () => {
    const prompt = buildContinuationUserPrompt('next thing', 2, 'sess-1', fixtureMode);
    expect(prompt).not.toContain('SYSTEM_IDENTITY_TEXT');
    expect(prompt).not.toContain('OBSERVER_ROLE_TEXT');
    expect(prompt).not.toContain('<observation>');
  });
});
