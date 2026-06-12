import type {
  AppUIMessage,
  MeshContextData,
  MeshPreferencesData,
} from './chatAi.ts';
import type { ParametricArtifact } from './types.ts';

/**
 * Narrow an unknown DB jsonb value into the AI SDK's UI part array.
 *
 * Every callsite (`messages.parts` from supabase, draft message rows held
 * in cache, etc.) crosses an untrusted boundary, so a bare
 * `parts as AppUIMessage['parts']` would let a malformed row or an
 * upstream SDK shape change crash the renderer before any part-specific
 * narrowing runs.
 *
 * Element-level validation is intentionally minimal: we require each
 * element to be a non-null object with a string `type` discriminator,
 * which is what every downstream `switch (part.type)` already keys on.
 * Beyond that we trust the SDK union — adding a full zod schema for the
 * dozen+ part shapes would have to be kept in lock-step with the AI SDK
 * release on every bump, and silently rejected parts (e.g. a new
 * `source-document`) would degrade messages instead of just rendering
 * what we know how to render.
 */
export function asParametricParts(parts: unknown): AppUIMessage['parts'] {
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (part): part is AppUIMessage['parts'][number] =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof (part as { type: unknown }).type === 'string',
  );
}

export function getMeshContextPart(
  parts: unknown,
): MeshContextData | undefined {
  const list = asParametricParts(parts);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const part = list[index];
    if (part.type === 'data-mesh-context') return part.data;
  }
  return undefined;
}

export function getMeshPreferencesPart(
  parts: unknown,
): MeshPreferencesData | undefined {
  const list = asParametricParts(parts);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const part = list[index];
    if (part.type === 'data-mesh-preferences') return part.data;
  }
  return undefined;
}

export function getParametricText(parts: unknown): string {
  return asParametricParts(parts)
    .filter((part) => part.type === 'text')
    .map((part) => cleanAssistantText(part.text))
    .join('');
}

function answerUserPartText(
  part: AppUIMessage['parts'][number],
): string | undefined {
  if (part.type !== 'tool-answer_user') return undefined;
  const fromOutput =
    part.state === 'output-available' &&
    'output' in part &&
    typeof part.output === 'object' &&
    part.output !== null &&
    'message' in part.output &&
    typeof part.output.message === 'string'
      ? part.output.message
      : undefined;
  const fromInput =
    'input' in part &&
    typeof part.input === 'object' &&
    part.input !== null &&
    'message' in part.input &&
    typeof part.input.message === 'string'
      ? part.input.message
      : undefined;
  const message = fromOutput ?? fromInput;
  return message ? cleanAssistantText(message) : undefined;
}

/** Text that may contain salvageable OpenSCAD outside the build tool. */
export function getAssistantSalvageText(parts: unknown): string {
  const chunks: string[] = [];
  for (const part of asParametricParts(parts)) {
    if (part.type === 'text') {
      const text = cleanAssistantText(part.text).trim();
      if (text) chunks.push(text);
      continue;
    }
    const answerText = answerUserPartText(part);
    if (answerText?.trim()) chunks.push(answerText.trim());
  }
  return chunks.join('\n\n');
}

export function cleanAssistantText(text: string): string {
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, '');

  const metadataLeak =
    /(?:^|\n)\s*,?\s*(?:"?(?:viewpoint_state|zoom_info|title|version)"?\s*:)/i.exec(
      text,
    );
  if (metadataLeak) {
    const before = text.slice(0, metadataLeak.index);
    const leaked = text.slice(metadataLeak.index);
    const proseStart =
      /\b(?:Done|Here(?:'s| is)?|This|I(?:'ve| created| updated| made| added| fixed)|The model)\b/i.exec(
        leaked,
      );
    text = before + (proseStart ? leaked.slice(proseStart.index) : '');
  }

  const attachmentLeak =
    /(?:^|\n)[^\n{}]*(?:alt=media|preview sheet attached automatically)[^\n{}]*[})]?\s*/i.exec(
      text,
    );
  if (attachmentLeak) {
    text =
      text.slice(0, attachmentLeak.index) +
      text.slice(attachmentLeak.index + attachmentLeak[0].length);
  }

  text = text.replace(
    /(?:^|\n)\s*[^{}\n]*(?:\.png|\.jpe?g|\.webp|\.gif)[^{}\n]*[})]?\s*/gi,
    '\n',
  );

  const marker = /Drafting final message:\s*/i.exec(text);
  if (!marker) return text;

  const draft = text.slice(marker.index + marker[0].length).trimStart();
  if (!draft) return '';

  const quote = draft[0];
  if (quote !== '"' && quote !== "'") return draft;

  const quoteEnd = draft.indexOf(quote, 1);
  if (quoteEnd === -1) return draft.slice(1).trim();

  return draft.slice(1, quoteEnd).trim();
}

export function getBuildParametricModelPart(parts: unknown) {
  const parametricParts = asParametricParts(parts);
  for (let index = parametricParts.length - 1; index >= 0; index -= 1) {
    const part = parametricParts[index];
    if (part.type === 'tool-build_parametric_model') return part;
  }
  return undefined;
}

export function getBuildParametricModelOutput(
  parts: unknown,
): ParametricArtifact | undefined {
  const part = getBuildParametricModelPart(parts);
  if (!part || part.state === 'input-streaming') return undefined;

  if ('input' in part && isParametricArtifact(part.input)) {
    return part.input;
  }
  if (part.state === 'output-available' && isParametricArtifact(part.output)) {
    return part.output;
  }
  return undefined;
}

export const getBuildParametricModelArtifact = getBuildParametricModelOutput;

export function hasPendingBuildParametricModel(parts: unknown): boolean {
  const part = getBuildParametricModelPart(parts);
  return part?.state === 'input-streaming' || part?.state === 'input-available';
}

export function replaceBuildParametricModelOutput(
  parts: unknown,
  artifact: ParametricArtifact,
): AppUIMessage['parts'] {
  const parametricParts = asParametricParts(parts);
  let targetIndex = -1;
  for (let index = parametricParts.length - 1; index >= 0; index -= 1) {
    const part = parametricParts[index];
    if (
      part.type === 'tool-build_parametric_model' &&
      part.state !== 'input-streaming'
    ) {
      targetIndex = index;
      break;
    }
  }

  return parametricParts.map((part, index) => {
    if (
      index === targetIndex &&
      part.type === 'tool-build_parametric_model' &&
      part.state !== 'input-streaming'
    ) {
      return { ...part, input: artifact };
    }
    return part;
  });
}

export function isParametricArtifact(
  value: unknown,
): value is ParametricArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const artifact = value as Partial<ParametricArtifact>;
  // Title + code are the only load-bearing fields. `version` is metadata
  // and `parts` is optional. Parameters are derived client-side from
  // `code` via `parseParameters` so we don't check for them here either.
  return (
    typeof artifact.title === 'string' &&
    artifact.title.trim().length > 0 &&
    typeof artifact.code === 'string' &&
    artifact.code.trim().length >= 20
  );
}

export function hasParametricBuildAttempt(parts: unknown): boolean {
  return asParametricParts(parts).some(
    (part) => part.type === 'tool-build_parametric_model',
  );
}

export function hasSuccessfulParametricBuild(parts: unknown): boolean {
  return asParametricParts(parts).some(
    (part) =>
      part.type === 'tool-build_parametric_model' &&
      part.state === 'output-available' &&
      isParametricArtifact(part.input),
  );
}

export function hasPendingClientToolCall(parts: unknown): boolean {
  return asParametricParts(parts).some(
    (part) =>
      part.type.startsWith('tool-') &&
      'state' in part &&
      part.state === 'input-available',
  );
}

export function parametricTurnMissingBuild(parts: unknown): boolean {
  const parametricParts = asParametricParts(parts);
  if (parametricParts.length === 0) return false;
  if (hasSuccessfulParametricBuild(parametricParts)) return false;
  if (hasPendingBuildParametricModel(parametricParts)) return false;
  return !hasParametricBuildAttempt(parametricParts);
}

export function hasViewableParametricArtifact(parts: unknown): boolean {
  return asParametricParts(parts).some(
    (part) =>
      part.type === 'tool-build_parametric_model' &&
      part.state !== 'input-streaming' &&
      'input' in part &&
      isParametricArtifact(part.input),
  );
}

export function canSalvageParametricBuildFromText(parts: unknown): boolean {
  return !!extractScadFromText(getAssistantSalvageText(parts));
}

/** True when a parametric turn ended with no model and no in-flight tool work. */
export function shouldReportMissingParametricBuild(parts: unknown): boolean {
  if (
    hasPendingClientToolCall(parts) ||
    hasPendingBuildParametricModel(parts)
  ) {
    return false;
  }
  if (
    hasSuccessfulParametricBuild(parts) ||
    hasViewableParametricArtifact(parts)
  ) {
    return false;
  }
  if (canSalvageParametricBuildFromText(parts)) {
    return false;
  }
  return parametricTurnMissingBuild(parts) || hasParametricBuildAttempt(parts);
}

const OPENSCAD_HINT =
  /\b(module|cube|cylinder|sphere|difference|union|intersection|linear_extrude|rotate_extrude|import|color|hull|minkowski)\s*\(/i;

function looksLikeOpenSCAD(code: string): boolean {
  return OPENSCAD_HINT.test(code);
}

/**
 * Recover OpenSCAD the model pasted into markdown despite the tool-only rule.
 * Used as a salvage path when `build_parametric_model` was never called.
 */
export function extractScadFromText(text: string): string | undefined {
  const fencePatterns = [
    /```(?:openscad|scad|open-scad)?\s*\n([\s\S]*?)```/gi,
    /```\s*\n([\s\S]*?)```/gi,
  ];
  for (const fencePattern of fencePatterns) {
    for (const match of text.matchAll(fencePattern)) {
      const code = match[1]?.trim();
      if (code && code.length >= 20 && looksLikeOpenSCAD(code)) {
        return code;
      }
    }
  }
  return undefined;
}

export function extractScadFromAssistantParts(
  parts: unknown,
): string | undefined {
  return extractScadFromText(getAssistantSalvageText(parts));
}

export const MISSING_BUILD_NOTICE =
  "I wasn't able to generate a 3D model for this request. Please try again or rephrase your prompt.";
