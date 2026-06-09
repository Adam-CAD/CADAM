import type { Parameter, ParameterOption, ParameterSpec } from './types.ts';

/**
 * Overlay the model-authored parameter schema (`artifact.parameters`) onto
 * the parameters parsed from the OpenSCAD source.
 *
 * The code stays the ground truth for which parameters EXIST and what value
 * they currently hold — `parseParameters` extracts those. The structured
 * schema is the source of truth for presentation metadata: ranges, units,
 * labels, descriptions, groups, and enum options.
 *
 * The parse doubles as the validator on the schema:
 *  - spec entries that don't match a variable in the code are ignored,
 *  - nonsensical ranges (min > max, step <= 0) fall back to comment-derived
 *    metadata instead of breaking the sliders,
 *  - parameters without a spec keep their comment-derived metadata,
 * so artifacts persisted before the schema existed — and models that omit
 * it — render exactly as before.
 */
// Caps on model- and DB-sourced metadata. Persisted parts re-enter without
// zod validation (see `asParametricParts`), and ShareView renders other
// people's artifacts — unbounded specs would let one malicious shared link
// burn every viewer's memory and render time.
const MAX_SPECS = 100;
const MAX_OPTIONS = 50;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_GROUP_LENGTH = 60;
const MAX_OPTION_LENGTH = 120;
const MAX_UNIT_LENGTH = 4;
// Bounds beyond any physical CAD dimension (1e9 mm = 1000 km) are noise,
// and extreme magnitudes (1e308, 5e-324) break the slider's percent and
// decimal math downstream.
const MAX_BOUND_MAGNITUDE = 1e9;
const MIN_STEP = 1e-9;

export default function applyParameterSpecs(
  parameters: Parameter[],
  specs: ParameterSpec[] | null | undefined,
): Parameter[] {
  if (!Array.isArray(specs) || specs.length === 0) return parameters;

  const byName = new Map<string, ParameterSpec>();
  for (const spec of specs.slice(0, MAX_SPECS)) {
    if (
      spec &&
      typeof spec === 'object' &&
      typeof spec.name === 'string' &&
      !byName.has(spec.name)
    ) {
      byName.set(spec.name, spec);
    }
  }

  return parameters.map((parameter) => {
    // `size[2]`-style names come from flattened vector declarations — fall
    // back to a spec on the base vector name so one `size` entry covers all
    // of its components.
    const baseName = parameter.name.replace(/\[\d+\]$/, '');
    const exact = byName.get(parameter.name);
    const spec = exact ?? byName.get(baseName);
    if (!spec) return parameter;

    const merged: Parameter = { ...parameter };

    // Every field is re-checked with `typeof` even though the live tool
    // path is zod-validated: persisted message parts re-enter through
    // `asParametricParts`, which does NOT validate `parameters`, and a
    // non-string label/description would crash React as a child node —
    // taking down ShareView for every viewer of a shared link.
    //
    // Vector components matched via the base name keep their derived axis
    // label ("Body Width") — sharing one label across every axis would make
    // the sliders indistinguishable.
    if (typeof exact?.label === 'string' && exact.label) {
      merged.displayName = exact.label.slice(0, MAX_LABEL_LENGTH);
    }
    if (typeof spec.description === 'string' && spec.description) {
      merged.description = spec.description.slice(0, MAX_DESCRIPTION_LENGTH);
    }
    if (typeof spec.group === 'string' && spec.group) {
      merged.group = spec.group.slice(0, MAX_GROUP_LENGTH);
    }
    if (typeof spec.unit === 'string' && spec.unit.trim()) {
      // The unit renders in a fixed ~4-character span next to the value —
      // cap it so a runaway model string can't blow up the layout.
      merged.unit = spec.unit.trim().slice(0, MAX_UNIT_LENGTH);
    }

    // Numeric bounds only apply to number parameters. For strings the
    // parse-land `range.max` doubles as maxLength, so a numeric range spec
    // on a string variable is a contradiction, not an instruction.
    if (parameter.type === 'number' || parameter.type === undefined) {
      const range = { ...parameter.range };
      if (typeof spec.min === 'number' && isSaneBound(spec.min)) {
        range.min = spec.min;
      }
      if (typeof spec.max === 'number' && isSaneBound(spec.max)) {
        range.max = spec.max;
      }
      if (
        typeof spec.step === 'number' &&
        isSaneBound(spec.step) &&
        spec.step >= MIN_STEP
      ) {
        range.step = spec.step;
      }
      // The code's current value is ground truth — a bound that excludes it
      // would render a slider pinned outside its own value (and the next
      // track interaction would silently rewrite the geometry), so expand
      // the offending bound to contain it.
      if (typeof parameter.value === 'number') {
        if (range.min !== undefined && range.min > parameter.value) {
          range.min = parameter.value;
        }
        if (range.max !== undefined && range.max < parameter.value) {
          range.max = parameter.value;
        }
      }
      // `>=`: a zero-span range NaNs the slider's percent math.
      const degenerate =
        range.min !== undefined &&
        range.max !== undefined &&
        range.min >= range.max;
      merged.range = degenerate ? parameter.range : range;
    }

    if (Array.isArray(spec.options) && spec.options.length > 0) {
      const options: ParameterOption[] = [];
      const seenValues = new Set<string>();
      for (const option of spec.options.slice(0, MAX_OPTIONS)) {
        if (!option || typeof option !== 'object') continue;
        const raw = (option as { value?: unknown }).value;
        if (typeof raw !== 'string' || raw.length === 0) continue;
        if (raw.length > MAX_OPTION_LENGTH) continue;
        // Duplicate values would render duplicate select entries (and
        // duplicate React keys) — first occurrence wins.
        if (seenValues.has(raw)) continue;
        seenValues.add(raw);
        // `Number`, not `parseFloat` — "80mm" must be rejected, not read
        // as 80 and silently diverge from what the code would accept.
        const value = parameter.type === 'number' ? Number(raw) : raw;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        const label =
          typeof option.label === 'string' && option.label
            ? option.label.slice(0, MAX_OPTION_LENGTH)
            : raw;
        options.push({ value, label });
      }
      if (options.length > 0) merged.options = options;
    }

    return merged;
  });
}

// Finite and within physical-CAD magnitude — see MAX_BOUND_MAGNITUDE.
function isSaneBound(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_BOUND_MAGNITUDE;
}
