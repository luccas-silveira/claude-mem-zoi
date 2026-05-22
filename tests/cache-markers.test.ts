import { describe, expect, it } from 'bun:test';

import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from '../src/sdk/prompts.js';
import type { ModeConfig } from '../src/services/domain/types.js';
import { OpenRouterProvider } from '../src/services/worker/OpenRouterProvider.js';
import type { ConversationMessage } from '../src/services/worker-types.js';

const fixtureMode: ModeConfig = {
  name: 'test-mode',
  description: 'fixture mode for cache-marker tests',
  version: '0.0.0',
  observation_types: [
    { id: 'discovery', label: 'Discovery', description: 'd', emoji: 'D', work_emoji: 'W' },
    { id: 'decision',  label: 'Decision',  description: 'd', emoji: 'D', work_emoji: 'W' },
  ],
  observation_concepts: [
    { id: 'concept_a', label: 'A', description: 'a' },
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

describe('Anthropic Agent SDK cache boundary marker', () => {
  it('exports SYSTEM_PROMPT_DYNAMIC_BOUNDARY as the documented literal', () => {
    expect(SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
  });

  it('pairs cleanly with a non-empty buildSystemPrompt() prefix', () => {
    const stable = buildSystemPrompt(fixtureMode);
    expect(stable.length).toBeGreaterThan(0);
    // The two values together form the canonical `string[]` form we pass to
    // query({ options: { systemPrompt: [stable, BOUNDARY] }}).
    const arr: string[] = [stable, SYSTEM_PROMPT_DYNAMIC_BOUNDARY];
    expect(arr[0]).toBe(stable);
    expect(arr[1]).toBe('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
  });
});

describe('OpenRouterProvider.conversationToOpenAIMessages', () => {
  // Construct without invoking real DB/session — only the message-shaping path is exercised.
  const provider = new OpenRouterProvider({} as any, {} as any);
  const conversation: ConversationMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ];

  it('emits a content-array system block with cache_control for anthropic/* models', () => {
    const messages = (provider as any).conversationToOpenAIMessages(
      conversation,
      'STABLE_SYSTEM_PROMPT',
      'anthropic/claude-haiku-4-5'
    );
    expect(messages.length).toBe(3);
    const sys = messages[0];
    expect(sys.role).toBe('system');
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content[0]).toEqual({
      type: 'text',
      text: 'STABLE_SYSTEM_PROMPT',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('emits a plain-string system block for non-Anthropic models', () => {
    const messages = (provider as any).conversationToOpenAIMessages(
      conversation,
      'STABLE_SYSTEM_PROMPT',
      'mistralai/mistral-large'
    );
    expect(messages.length).toBe(3);
    const sys = messages[0];
    expect(sys.role).toBe('system');
    expect(typeof sys.content).toBe('string');
    expect(sys.content).toBe('STABLE_SYSTEM_PROMPT');
  });

  it('omits the system message entirely when systemPrompt is empty', () => {
    const withUndefined = (provider as any).conversationToOpenAIMessages(
      conversation,
      undefined,
      'anthropic/claude-haiku-4-5'
    );
    expect(withUndefined.length).toBe(2);
    expect(withUndefined[0].role).toBe('user');

    const withEmpty = (provider as any).conversationToOpenAIMessages(
      conversation,
      '',
      'anthropic/claude-haiku-4-5'
    );
    expect(withEmpty.length).toBe(2);
    expect(withEmpty[0].role).toBe('user');
  });
});
