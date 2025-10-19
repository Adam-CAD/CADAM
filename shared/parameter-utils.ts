import type { Parameter, ParameterType } from './types.ts';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildParameterAssignmentRegex(name: string): RegExp {
  const escaped = escapeRegExp(name);
  return new RegExp(
    `(\\s*${escaped}\\s*=\\s*)([\\s\\S]*?)(;[ \\t\\f\\v]*(?:\\/\\/[^\\n]*)?)`,
    'm',
  );
}

export function serializeParameterValue(
  type: ParameterType | undefined,
  value: Parameter['value'],
): string {
  const resolvedType = type ?? inferParameterType(value);

  switch (resolvedType) {
    case 'number':
      return formatNumber(value as number);
    case 'boolean':
      return (value as boolean) ? 'true' : 'false';
    case 'string':
      return `"${escapeString(value as string)}"`;
    case 'number[]':
      return `[${(value as number[]).map(formatNumber).join(', ')}]`;
    case 'boolean[]':
      return `[${(value as boolean[]).map((item) => (item ? 'true' : 'false')).join(', ')}]`;
    case 'string[]':
      return `[${(value as string[])
        .map((item) => `"${escapeString(item)}"`)
        .join(', ')}]`;
    default:
      if (typeof value === 'string') {
        return `"${escapeString(value)}"`;
      }
      if (typeof value === 'number') {
        return formatNumber(value);
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      return `${value ?? ''}`;
  }
}

export function coerceParameterValue(
  param: Pick<Parameter, 'type' | 'defaultValue'>,
  raw: unknown,
): Parameter['value'] | null {
  const resolvedType = param.type ?? inferParameterType(param.defaultValue);

  switch (resolvedType) {
    case 'number': {
      const num = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const lowered = raw.trim().toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
      }
      return null;
    }
    case 'string': {
      if (raw === undefined || raw === null) return null;
      return String(raw);
    }
    case 'number[]': {
      const items = normaliseArrayInput(raw);
      if (items === null) return null;
      const numbers = items.map((item) =>
        typeof item === 'number' ? item : Number(item),
      );
      if (numbers.some((item) => !Number.isFinite(item))) {
        return null;
      }
      return numbers;
    }
    case 'boolean[]': {
      const items = normaliseArrayInput(raw);
      if (items === null) return null;
      const booleans: boolean[] = [];
      for (const item of items) {
        if (typeof item === 'boolean') {
          booleans.push(item);
          continue;
        }
        if (typeof item === 'string') {
          const lowered = item.trim().toLowerCase();
          if (lowered === 'true') {
            booleans.push(true);
            continue;
          }
          if (lowered === 'false') {
            booleans.push(false);
            continue;
          }
        }
        return null;
      }
      return booleans;
    }
    case 'string[]': {
      const items = normaliseArrayInput(raw);
      if (items === null) return null;
      const strings: string[] = [];
      for (const item of items) {
        if (typeof item === 'string') {
          strings.push(stripQuotes(item.trim()));
          continue;
        }
        return null;
      }
      return strings;
    }
    default:
      return null;
  }
}

function inferParameterType(
  value: Parameter['value'] | undefined,
): ParameterType | undefined {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) return 'number[]';
    if (value.every((item) => typeof item === 'boolean')) return 'boolean[]';
    if (value.every((item) => typeof item === 'string')) return 'string[]';
  } else {
    switch (typeof value) {
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'string':
        return 'string';
      default:
        return undefined;
    }
  }
  return undefined;
}

function formatNumber(value: number): string {
  return Number(value).toString();
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normaliseArrayInput(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner === '') return [];
      try {
        const parsed = JSON.parse(normaliseJsonArraySource(trimmed)) as unknown;
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Fallback to manual split
      }

      return inner.split(',').map((item) => item.trim());
    }
    return trimmed.split(',').map((item) => item.trim());
  }

  return null;
}

function normaliseJsonArraySource(source: string): string {
  // Replace single quotes with double quotes to improve JSON parse tolerance.
  return source.replace(/'/g, '"');
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
