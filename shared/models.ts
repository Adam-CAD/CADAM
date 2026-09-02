import type { Model } from './types';

// Model ids persisted in conversation settings (and submitted by stale
// clients) outlive the picker catalog. Map retired ids to their successors
// so old conversations keep resolving to a routable, correctly priced model.
export const LEGACY_MODEL_IDS: Record<string, Model> = {
  'openai/gpt-5.5': 'openai/gpt-5.6-sol',
  'google/gemini-3.6-flash': 'google/gemini-3.8-flash',
  'google/gemini-3.7-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-fable-5': 'anthropic/claude-fable-5.1',
  'z-ai/glm-5.2': 'z-ai/glm-5.3',
  'stealth/ox-alpha': 'z-ai/glm-5.3-flash',
};

export function normalizeModelId(model: Model): Model {
  return LEGACY_MODEL_IDS[model] ?? model;
}
