/**
 * Pure routing logic for the local OpenAI-compatible model catalog
 * (`local-models.json`). No env or disk I/O — `localChatConfig.ts` wires
 * server env + file reads; `utils.ts` loads the catalog for the client picker.
 */
import { z } from 'zod';

// Shape of each entry in `local-models.json`.
const localModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  supportsTools: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  useForAux: z.boolean().optional(),
});

export type LocalModelConfig = z.infer<typeof localModelSchema>;

// UI model-picker shape; cloud entries in `utils.ts` use the same fields.
export type PickerModelConfig = {
  id: string;
  name: string;
  description: string;
  provider?: string;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  disabled?: boolean;
};

export type ChatProvider = 'anthropic' | 'google' | 'openrouter' | 'local';

// Parse and validate a raw `local-models.json` payload; skip invalid entries.
// skip second occurence of local model with same model id
export function parseLocalModelsJson(raw: unknown): LocalModelConfig[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  return raw.flatMap((entry) => {
    const parsed = localModelSchema.safeParse(entry);
    if (!parsed.success || seenIds.has(parsed.data.id)) return [];
    seenIds.add(parsed.data.id);
    return [parsed.data];
  });
}

export function isLocalModelId(
  id: string,
  localModels: LocalModelConfig[],
): boolean {
  return localModels.some((model) => model.id === id);
}

// One catalog entry may be marked `useForAux` for lightweight tasks (conversation
// titles, suggestion pills) when `ANTHROPIC_API_KEY` is unset.
export function getAuxiliaryLocalModel(
  localModels: LocalModelConfig[],
): LocalModelConfig | undefined {
  return localModels.find((model) => model.useForAux === true);
}

// Vercel AI SDK OpenRouter provider expects baseURL to include `/v1` (its default
// is `https://openrouter.ai/api/v1`). LM Studio and similar servers often
// advertise the bare host; append `/v1` when missing.
export function normalizeOpenRouterBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const base = trimmed.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

// Cloud ids with a provider prefix keep their direct routes; catalog ids with a
// configured baseUrl route to their own OpenAI-compatible server; everything
// else goes through OpenRouter.
export function providerFor(
  modelId: string,
  localModels: LocalModelConfig[],
): ChatProvider {
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('google/')) return 'google';
  const localModel = localModels.find((m) => m.id === modelId);
  if (localModel?.baseUrl?.trim()) return 'local';
  return 'openrouter';
}

// Catalog ids without a baseUrl cannot be routed — callers reject those
// requests with a clear error instead of falling through to OpenRouter.
export function isMissingLocalBaseUrl(
  modelId: string,
  catalogOnDisk: LocalModelConfig[],
): boolean {
  const model = catalogOnDisk.find((m) => m.id === modelId);
  return !!model && !model.baseUrl?.trim();
}

// Parametric CAD requires tool calling — grey out catalog entries that explicitly
// opt out via `supportsTools: false`.
export function localModelToPickerConfig(
  model: LocalModelConfig,
): PickerModelConfig {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    provider: 'Local',
    supportsTools: model.supportsTools ?? true,
    supportsThinking: model.supportsThinking ?? false,
    supportsVision: model.supportsVision ?? false,
    disabled: model.supportsTools === false,
  };
}

// Returns parsed, valid catalog entries that have a baseUrl configured.
export function getLocalModels(rawJson: unknown): LocalModelConfig[] {
  return parseLocalModelsJson(rawJson).filter((m) => !!m.baseUrl?.trim());
}
