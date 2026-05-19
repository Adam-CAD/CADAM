import type {
  AppUIMessage,
  MeshContextData,
  MeshPreferencesData,
} from './chatAi.ts';
import type { ParametricArtifact } from './types.ts';

export function asParametricParts(parts: unknown): AppUIMessage['parts'] {
  return Array.isArray(parts) ? (parts as AppUIMessage['parts']) : [];
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
    .map((part) => part.text)
    .join('');
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
    typeof artifact.title === 'string' && typeof artifact.code === 'string'
  );
}
