import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Message, Model, Parameter } from '@shared/types';
import { ModelConfig } from '../types/misc.ts';

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

export function updateParameter(code: string, param: Parameter): string {
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
    id: 'anthropic/claude-opus-4.6',
    name: 'Claude Opus 4.6',
    description: 'Most powerful Anthropic model for complex reasoning',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    description: 'Most powerful OpenAI model with adaptive reasoning',
    provider: 'OpenAI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    description: 'Daily driver Anthropic model for reliable CAD generation',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'minimax/MiniMax-M2.7',
    name: 'MiniMax M2.7',
    description: 'Peak Performance. Ultimate Value. Master the Complex',
    provider: 'MiniMax',
    supportsTools: true,
    supportsThinking: false,
    supportsVision: false,
  },
  {
    id: 'minimax/MiniMax-M2.7-highspeed',
    name: 'MiniMax M2.7 Highspeed',
    description: 'Same performance, faster and more agile',
    provider: 'MiniMax',
    supportsTools: true,
    supportsThinking: false,
    supportsVision: false,
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

export function getBackupModel({
  message,
  parentMessage,
  type,
}: {
  message: Message;
  parentMessage?: Message;
  type: 'parametric' | 'creative';
}): Model {
  if (message.content.model) {
    return message.content.model;
  }
  if (parentMessage?.content.model) {
    return parentMessage.content.model;
  }
  if (type === 'parametric') {
    return 'fast';
  } else {
    return 'quality';
  }
}
