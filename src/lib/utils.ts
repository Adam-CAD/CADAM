import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Parameter } from '@shared/types';
import type { ModelConfig } from '../types/misc.ts';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validates and sanitizes a redirect URL to prevent open redirect attacks
 * Only allows relative paths or same-origin URLs
 * @param redirectUrl - The URL to validate
 * @param fallback - Fallback URL if validation fails (default: '/')
 * @returns A safe redirect URL
 */
export function validateRedirectUrl(
  redirectUrl: string | null,
  fallback: string = '/',
): string {
  // If no redirect URL provided, return fallback
  if (!redirectUrl) {
    return fallback;
  }

  try {
    // Decode the URL in case it was encoded
    const decodedUrl = decodeURIComponent(redirectUrl);

    // Check if it's a relative path (starts with /)
    if (decodedUrl.startsWith('/') && !decodedUrl.startsWith('//')) {
      // Additional check to prevent protocol-relative URLs (//example.com)
      // Remove any query parameters that could contain malicious data
      const url = new URL(decodedUrl, window.location.origin);

      // Ensure it's still on the same origin after URL parsing
      if (url.origin === window.location.origin) {
        return url.pathname + url.search + url.hash;
      }
    }

    // Check if it's a same-origin absolute URL
    const url = new URL(decodedUrl);
    if (url.origin === window.location.origin) {
      return url.pathname + url.search + url.hash;
    }

    // If we get here, it's an external URL or invalid - return fallback
    console.warn('Rejected redirect URL (external or invalid):', redirectUrl);
    return fallback;
  } catch (error) {
    // Invalid URL format - return fallback
    console.warn('Invalid redirect URL format:', redirectUrl, error);
    return fallback;
  }
}

/**
 * Server-side version of validateRedirectUrl for use in server components and API routes
 * @param redirectUrl - The URL to validate
 * @param requestOrigin - The origin from the request headers
 * @param fallback - Fallback URL if validation fails (default: '/')
 * @returns A safe redirect URL
 */
export function validateRedirectUrlServer(
  redirectUrl: string | null,
  requestOrigin: string | null,
  fallback: string = '/',
): string {
  // If no redirect URL or origin provided, return fallback
  if (!redirectUrl || !requestOrigin) {
    return fallback;
  }

  try {
    // Decode the URL in case it was encoded
    const decodedUrl = decodeURIComponent(redirectUrl);

    // Check if it's a relative path (starts with /)
    if (decodedUrl.startsWith('/') && !decodedUrl.startsWith('//')) {
      // Additional check to prevent protocol-relative URLs (//example.com)
      // Remove any query parameters that could contain malicious data
      const url = new URL(decodedUrl, requestOrigin);

      // Ensure it's still on the same origin after URL parsing
      if (url.origin === requestOrigin) {
        return url.pathname + url.search + url.hash;
      }
    }

    // Check if it's a same-origin absolute URL
    const url = new URL(decodedUrl);
    if (url.origin === requestOrigin) {
      return url.pathname + url.search + url.hash;
    }

    // If we get here, it's an external URL or invalid - return fallback
    console.warn('Rejected redirect URL (external or invalid):', redirectUrl);
    return fallback;
  } catch (error) {
    // Invalid URL format - return fallback
    console.warn('Invalid redirect URL format:', redirectUrl, error);
    return fallback;
  }
}

// `parseParameters` flattens `size = [10, 20, 30];` into the sliders
// `size[0]`, `size[1]`, `size[2]`. Writing one back means replacing a single
// element of the array literal, not looking for a `size[1] = ...` line.
function updateArrayItem(code: string, param: Parameter): string | undefined {
  const item = /^(.+)\[(\d+)\]$/.exec(param.name);
  if (!item) return undefined;
  const index = Number(item[2]);
  // parseParameters only reads unindented declarations above the first
  // module or function. Edit the last numeric declaration of the name that
  // has this element.
  const limit = code.search(/^(module |function )/m);
  const regex = new RegExp(
    `^(${escapeRegExp(item[1])}\\s*=\\s*\\[)([^\\];\\n]*)(\\];)`,
    'gm',
  );
  let last: RegExpMatchArray | undefined;
  for (const match of code.matchAll(regex)) {
    if (limit !== -1 && (match.index ?? 0) >= limit) break;
    const elements = match[2].split(',');
    if (
      index < elements.length &&
      elements.every((element) => /^\s*-?\d+(\.\d+)?\s*$/.test(element))
    )
      last = match;
  }
  if (!last) return code;
  const [whole, prefix, body, suffix] = last;
  const start = last.index ?? 0;
  const elements = body.split(',');
  const element = elements[index];
  const lead = element.slice(0, element.length - element.trimStart().length);
  const tail = element.slice(element.trimEnd().length);
  elements[index] = `${lead}${param.value}${tail}`;
  const edited = `${prefix}${elements.join(',')}${suffix}`;
  return code.slice(0, start) + edited + code.slice(start + whole.length);
}

export function updateParameter(code: string, param: Parameter): string {
  if (param.type === 'number' || !param.type) {
    const updated = updateArrayItem(code, param);
    if (updated !== undefined) return updated;
  }
  const escapedName = escapeRegExp(param.name);
  const regex = new RegExp(
    `^\\s*(${escapedName}\\s*=\\s*)[^;]+;([\\t\\f\\cK ]*\\/\\/[^\n]*)?`,
    'm',
  );
  // Default to assuming the type is number
  if (!param.type) {
    return code.replace(regex, `$1${param.value};$2`);
  }
  switch (param.type) {
    case 'string':
      return code.replace(
        regex,
        `$1"${escapeReplacement(escapeQuotes(param.value as string))}";$2`,
      );
    case 'number':
      return code.replace(regex, `$1${param.value};$2`);
    case 'boolean':
      return code.replace(regex, `$1${param.value};$2`);
    case 'string[]':
      return code.replace(
        regex,
        `$1[${(param.value as string[])
          .map((value) => escapeReplacement(escapeQuotes(value)))
          .map((value) => `"${value}"`)
          .join(',')}];$2`,
      );
    case 'number[]':
      return code.replace(
        regex,
        `$1[${(param.value as number[]).join(',')}];$2`,
      );
    case 'boolean[]':
      return code.replace(
        regex,
        `$1[${(param.value as boolean[]).join(',')}];$2`,
      );
    default:
      return code;
  }
}

export function getDiffString(param: Parameter) {
  let diffString: string = '';
  let diffNumber: number = 0;
  // Default to assuming the type is number
  if (!param.type) {
    diffNumber =
      Math.round((Number(param.value) - Number(param.defaultValue)) * 10) / 10;
    diffString = diffNumber > 0 ? `+${diffNumber}` : `${diffNumber}`;
    return diffString;
  }
  switch (param.type) {
    case 'number':
      diffNumber =
        Math.round((Number(param.value) - Number(param.defaultValue)) * 10) /
        10;
      diffString = diffNumber > 0 ? `+${diffNumber}` : `${diffNumber}`;
      break;
    case 'boolean':
      diffString = param.value ? 'true' : 'false';
      break;
    case 'string':
      diffString = param.value as string;
      break;
    case 'string[]':
      diffString = (param.value as string[])
        .map((value, index) => {
          if (value !== (param.defaultValue as string[])[index]) {
            return value;
          }
        })
        .filter((value) => value !== undefined)
        .join('\n');
      break;
    case 'number[]':
      diffString = (param.value as number[])
        .map((value, index) => {
          const diffNumber =
            Math.round(
              (Number(value) -
                Number((param.defaultValue as number[])[index])) *
                10,
            ) / 10;
          if (diffNumber !== 0) {
            return diffNumber > 0 ? `+${diffNumber}` : `${diffNumber}`;
          }
        })
        .filter((value) => value !== undefined)
        .join('\n');
      break;
    case 'boolean[]':
      diffString = (param.value as boolean[])
        .map((value, index) => {
          if (value !== (param.defaultValue as boolean[])[index]) {
            return value ? 'true' : 'false';
          }
        })
        .filter((value) => value !== undefined)
        .join('\n');
      break;
    default:
      diffString = '';
  }
  return diffString;
}

export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export function escapeReplacement(string: string) {
  return string.replace(/\$/g, '$$$$');
}

export function escapeQuotes(string: string) {
  return string.replace(/"/g, '\\"');
}

export function getInitials(fullName: string | null) {
  if (fullName) {
    return fullName
      .split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase();
  }
  return 'U';
}

export const PARAMETRIC_MODELS: ModelConfig[] = [
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    description: 'Latest Google model with excellent multi-modal capabilities',
    provider: 'Google',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Fast, token-efficient Google model for everyday tasks',
    provider: 'Google',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-fable-5.1',
    name: 'Claude Fable 5.1',
    description: 'Most capable Anthropic model; best reasoning at highest cost',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
    description: 'Powerful Anthropic model for complex reasoning',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    description: 'Frontier Anthropic model balancing speed and reasoning',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'openai/gpt-6-astra',
    name: 'GPT-6 Astra',
    description:
      'OpenAI flagship model for long-horizon engineering and analysis',
    provider: 'OpenAI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'openai/gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    description: 'OpenAI model for reliable CAD generation',
    provider: 'OpenAI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'x-ai/grok-4.7',
    name: 'Grok 4.7',
    description: 'Latest xAI model with frontier coding and STEM performance',
    provider: 'xAI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'moonshotai/kimi-k3',
    name: 'Kimi K3',
    description:
      'Moonshot AI reasoning model for complex coding and agentic work',
    provider: 'Moonshot AI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'deepseek/deepseek-v4-pro-0813',
    name: 'DeepSeek V4 Pro',
    description:
      'DeepSeek mixture-of-experts model with a 1M-token context at low cost',
    provider: 'DeepSeek',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: false,
  },
  {
    id: 'z-ai/glm-5.3',
    name: 'GLM 5.3',
    description: 'Z.AI model with strong agentic coding and reasoning',
    provider: 'Z.AI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: false,
  },
  {
    id: 'z-ai/glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    description: 'Fast, low-cost Z.AI multimodal model for everyday tasks',
    provider: 'Z.AI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
];

export const CREATIVE_MODELS: ModelConfig[] = [
  {
    id: 'ultra',
    name: 'Max Quality',
    description: 'Highest quality mesh and clean topology',
    timeEstimate: '5-6 minutes',
  },
  {
    id: 'quality',
    name: 'Draft',
    description: 'Rough quality for quick iterations',
    timeEstimate: '~45 seconds',
  },
  {
    id: 'fast',
    name: 'Textureless',
    description: 'Faster, with simpler, textureless output.',
    timeEstimate: '60-90 seconds',
  },
];

// Whether the selected parametric model can accept image / STL-render inputs.
// Unknown ids (e.g. historical messages tagged with a removed model) fall back
// to `true` so older saved rows still render normally.
export function parametricModelSupportsVision(modelId: string): boolean {
  const cfg = PARAMETRIC_MODELS.find((m) => m.id === modelId);
  return cfg?.supportsVision !== false;
}
