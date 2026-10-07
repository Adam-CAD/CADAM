// Per-model routing and capability gates for the chat route. Kept free of
// imports so the choices it makes for each model can be unit-tested with
// node:test (see modelCapabilities.test.ts).

export type ChatProvider = 'anthropic' | 'google' | 'openrouter';

export function providerFor(modelId: string): ChatProvider {
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('google/')) return 'google';
  return 'openrouter';
}

// Capability gates below accept either the OpenRouter alias (`anthropic/claude-…`)
// or the bare Anthropic ID — strip the prefix here so every gate is called the
// same way regardless of which form the caller has on hand. Drop *any* provider
// prefix (everything up to the last "/"), not just "anthropic/", so a model
// routed through another provider (e.g. "openrouter/anthropic/claude-fable-5")
// still matches the `^claude-…` regexes instead of silently slipping past them.
function bareModelId(modelId: string): string {
  const id = modelId.slice(modelId.lastIndexOf('/') + 1);
  // Anthropic's API uses dashes ("claude-opus-4-6"); the OpenRouter alias
  // uses dots ("claude-opus-4.6"). Normalize so the version regexes match
  // either form.
  return id.replace(/\./g, '-');
}

// The Claude 5 generation swaps the opus/sonnet/haiku tiers for code names
// ("claude-fable-5", "claude-mythos-5", …). Match the `claude-<codename>-5`
// shape rather than enumerating code names so future Claude 5 variants
// inherit the same capability gates without a list update. Versioned 4.x ids
// ("claude-opus-4-5", "claude-haiku-4-5") don't match: their tier name is
// followed by "-4", not "-5".
function isClaude5Model(modelId: string): boolean {
  return /^claude-[a-z]+-5\b/.test(bareModelId(modelId));
}

export function usesAdaptiveAnthropicThinking(modelId: string) {
  // The Claude 5 generation uses adaptive thinking, as do Claude Opus/Sonnet
  // 4.6+. Older 4.x models take the fixed-budget path.
  if (isClaude5Model(modelId)) return true;
  const match = /^claude-(?:opus|sonnet)-4-(\d+)/.exec(bareModelId(modelId));
  return match ? Number(match[1]) >= 6 : false;
}

// The reasoning-tier Claude 5 models (Fable, Mythos) reject a forced
// `tool_choice` outright ("tool_choice forces tool use is not compatible with
// this model"), and so do Opus 5.5 and Sonnet 5.5 ("tool_choice: type "tool"
// and "any" are not supported for this model"), which also 400 on the
// disabled thinking a forced step needs. Opus 5 and Sonnet 5 still accept a
// forced tool_choice on the first-party API, provided thinking is disabled for
// that step (see the per-step override in the parametric flow). Opus/Sonnet
// are matched from 5.5 up so a later point release inherits the auto-choice
// fallback instead of failing every parametric turn.
function rejectsForcedToolChoice(modelId: string): boolean {
  const id = bareModelId(modelId);
  if (/^claude-(?:fable|mythos)\b/.test(id)) return true;
  const match = /^claude-(?:opus|sonnet)-5-(\d+)/.exec(id);
  return match ? Number(match[1]) >= 5 : false;
}

// Whether a model accepts a forced `tool_choice` (type: "tool" / "any").
export function supportsForcedToolChoice(modelId: string): boolean {
  return !rejectsForcedToolChoice(modelId);
}

/**
 * Whether a chat request runs with thinking on.
 *
 * Adaptive-thinking Anthropic models (Claude 5 — Fable/Mythos — and
 * Opus/Sonnet 4.6+) get thinking enabled unconditionally: adaptive thinking
 * lets the model decide when and how much to think, and on Fable 5 omitting
 * it disables thinking entirely — no reasoning ever streams, and complex
 * parametric turns degrade (especially combined with the auto tool-choice
 * fallback). The client never sends `thinking: true` today, so without this
 * the Anthropic thinking branch is dead code.
 */
export function thinkingEnabledFor(
  modelId: string,
  requested?: boolean,
): boolean {
  return (
    (requested ?? false) ||
    (providerFor(modelId) === 'anthropic' &&
      usesAdaptiveAnthropicThinking(modelId))
  );
}

/**
 * How parametric step 0 asks for `build_parametric_model`: pinned with a
 * forced tool_choice when the model accepts one, with thinking turned off
 * for that step on a thinking-enabled Anthropic model. Models that reject
 * forced tool use get neither and fall back to auto tool choice.
 */
export function buildStepToolChoice(
  modelId: string,
  thinkingEnabled: boolean,
): { forceBuildToolChoice: boolean; disableThinkingForBuildStep: boolean } {
  const forceBuildToolChoice = supportsForcedToolChoice(modelId);
  return {
    forceBuildToolChoice,
    disableThinkingForBuildStep:
      forceBuildToolChoice &&
      thinkingEnabled &&
      providerFor(modelId) === 'anthropic',
  };
}
