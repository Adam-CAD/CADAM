import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStepToolChoice,
  providerFor,
  supportsForcedToolChoice,
  thinkingEnabledFor,
  usesAdaptiveAnthropicThinking,
} from './modelCapabilities.ts';

// Parametric step 0 the way the chat route resolves it. The client never
// sends `thinking`, so it comes from the model alone.
function buildStep(modelId: string) {
  return buildStepToolChoice(modelId, thinkingEnabledFor(modelId));
}

describe('supportsForcedToolChoice', () => {
  it('rejects forced tool choice on Opus/Sonnet 5.5 in dotted and dashed ids', () => {
    for (const id of [
      'anthropic/claude-opus-5.5',
      'anthropic/claude-opus-5-5',
      'claude-opus-5-5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-sonnet-5-5',
      'claude-sonnet-5-5',
    ]) {
      assert.equal(supportsForcedToolChoice(id), false, id);
    }
  });

  it('rejects it on Fable/Mythos and later Opus/Sonnet 5.x releases', () => {
    for (const id of [
      'anthropic/claude-fable-5.1',
      'claude-mythos-5-1',
      'anthropic/claude-opus-5.6',
      'anthropic/claude-sonnet-5.7',
    ]) {
      assert.equal(supportsForcedToolChoice(id), false, id);
    }
  });

  it('keeps it on Opus 5, Sonnet 5, Opus 4.8 and non-Claude models', () => {
    for (const id of [
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-4.8',
      'claude-opus-4-8',
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-6.1-sol',
      'x-ai/grok-4.7',
      'google/gemini-3.8-flash',
    ]) {
      assert.equal(supportsForcedToolChoice(id), true, id);
    }
  });
});

describe('buildStepToolChoice', () => {
  it('sends neither a forced tool choice nor disabled thinking to Opus/Sonnet 5.5', () => {
    for (const id of [
      'anthropic/claude-opus-5.5',
      'anthropic/claude-opus-5-5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-sonnet-5-5',
    ]) {
      assert.deepEqual(
        buildStep(id),
        { forceBuildToolChoice: false, disableThinkingForBuildStep: false },
        id,
      );
    }
  });

  it('still forces the build tool with thinking off on Opus 5, Sonnet 5 and Opus 4.8', () => {
    for (const id of [
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-4.8',
      'anthropic/claude-opus-4-8',
    ]) {
      assert.deepEqual(
        buildStep(id),
        { forceBuildToolChoice: true, disableThinkingForBuildStep: true },
        id,
      );
    }
  });

  it('forces the build tool without touching thinking on other providers', () => {
    for (const id of [
      'openai/gpt-6.1-sol',
      'x-ai/grok-4.7',
      'google/gemini-3.8-flash',
    ]) {
      for (const thinking of [false, true]) {
        assert.deepEqual(
          buildStepToolChoice(id, thinking),
          { forceBuildToolChoice: true, disableThinkingForBuildStep: false },
          `${id} thinking=${thinking}`,
        );
      }
    }
  });
});

describe('thinkingEnabledFor', () => {
  it('turns thinking on for adaptive Anthropic models without a request', () => {
    for (const id of [
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-fable-5.1',
      'anthropic/claude-opus-4.8',
    ]) {
      assert.equal(thinkingEnabledFor(id), true, id);
    }
  });

  it('follows the request for everything else', () => {
    assert.equal(thinkingEnabledFor('anthropic/claude-sonnet-4.5'), false);
    assert.equal(thinkingEnabledFor('openai/gpt-6.1-sol'), false);
    assert.equal(thinkingEnabledFor('openai/gpt-6.1-sol', true), true);
  });
});

describe('usesAdaptiveAnthropicThinking', () => {
  it('matches the dashed ids buildChatModel sends to Anthropic', () => {
    assert.equal(usesAdaptiveAnthropicThinking('claude-opus-5-5'), true);
    assert.equal(usesAdaptiveAnthropicThinking('claude-sonnet-5-5'), true);
    assert.equal(usesAdaptiveAnthropicThinking('claude-opus-4-6'), true);
    assert.equal(usesAdaptiveAnthropicThinking('claude-sonnet-4-5'), false);
  });
});

describe('providerFor', () => {
  it('routes by id prefix', () => {
    assert.equal(providerFor('anthropic/claude-opus-5.5'), 'anthropic');
    assert.equal(providerFor('google/gemini-3.8-flash'), 'google');
    assert.equal(providerFor('openai/gpt-6.1-sol'), 'openrouter');
    assert.equal(providerFor('x-ai/grok-4.7'), 'openrouter');
  });
});
