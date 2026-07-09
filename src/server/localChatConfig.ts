/**
 * Server-side local-chat configuration: reads `local-models.json` from the
 * project root. A model is active when it has a `baseUrl` set in the catalog.
 * Pure routing logic lives in `@shared/localModels`; this module wires
 * disk I/O for `aiChat`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isMissingLocalBaseUrl as isMissingLocalBaseUrlCore,
  isLocalModelId,
  parseLocalModelsJson,
  providerFor as providerForCore,
  type ChatProvider,
  type LocalModelConfig,
} from '@shared/localModels';
import { env } from './env';

export type { ChatProvider };

export type LocalChatState = {
  enabled: boolean;
  /** On-disk catalog, even when local chat is disabled. */
  catalog: LocalModelConfig[];
  /** Models with a configured baseUrl. */
  activeCatalog: LocalModelConfig[];
  hasAnthropicApiKey: boolean;
};

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// Cached after first read; restart the dev server after editing `local-models.json`.
let cachedCatalog: LocalModelConfig[] | undefined;

function loadCatalogFromDisk(): LocalModelConfig[] {
  if (cachedCatalog) return cachedCatalog;

  const userPath = path.join(projectRoot, 'local-models.json');
  if (!fs.existsSync(userPath)) {
    cachedCatalog = [];
    return cachedCatalog;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(userPath, 'utf8')) as unknown;
    cachedCatalog = parseLocalModelsJson(raw);
  } catch (error) {
    console.error(
      `Failed to load local-models.json from ${userPath}; using empty catalog.`,
      error,
    );
    cachedCatalog = [];
  }

  return cachedCatalog;
}

export function getLocalChatState(): LocalChatState {
  const catalog = loadCatalogFromDisk();
  const activeCatalog = catalog.filter((m) => m.baseUrl?.trim());

  return {
    enabled: activeCatalog.length > 0,
    catalog,
    activeCatalog,
    hasAnthropicApiKey: env('ANTHROPIC_API_KEY').trim().length > 0,
  };
}

export function providerFor(modelId: string): ChatProvider {
  const { activeCatalog } = getLocalChatState();
  return providerForCore(modelId, activeCatalog);
}

export function isActiveLocalModel(modelId: string): boolean {
  return isLocalModelId(modelId, getLocalChatState().activeCatalog);
}

export function getActiveLocalModel(
  modelId: string,
): LocalModelConfig | undefined {
  return getLocalChatState().activeCatalog.find(
    (model) => model.id === modelId,
  );
}

// Resolve local API key from env without exposing secrets to the client bundle.
// If `apiKey` is set in `local-models.json`, it is interpreted as the env var
// name (for example `DEEPSEEK_API_KEY`), not a raw secret.
export function localApiKeyForModel(
  model: LocalModelConfig,
): string | undefined {
  const configuredName = model.apiKey?.trim();
  if (!configuredName) return undefined;
  const configured = env(configuredName).trim();
  return configured || undefined;
}

// Client may show catalog ids whose baseUrl is missing on the server — reject
// those requests with a clear error.
export function isMissingLocalBaseUrl(modelId: string): boolean {
  const { catalog } = getLocalChatState();
  return isMissingLocalBaseUrlCore(modelId, catalog);
}
