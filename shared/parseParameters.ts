import type {
  Parameter,
  ParameterOption,
  ParameterRange,
  ParameterType,
} from './types.ts';

/**
 * Extract editable parameters from a piece of OpenSCAD source.
 *
 * This is the single source of truth for "what does this CAD model expose
 * as a slider/input?" — the model only emits the OpenSCAD `code`, and we
 * derive parameter metadata client-side from the variable declarations at
 * the top of the file. That removes the divergent-UI problem we had when
 * different models (Claude vs Gemini) produced different shaped
 * parameter arrays for the same code: now the same source always renders
 * the same `<ParameterSection>`, regardless of provider.
 *
 * The format the model is told to emit is the Customizer-style annotation
 * vocabulary:
 *
 *     // Description of the parameter
 *     name = 10; // [1:50]              ← min:max
 *     name = 10; // [1:1:50]            ← min:step:max
 *     name = "red"; // [red, green, blue]  ← enum options
 *     name = "label"; // 20             ← maxLength for strings, step for numbers
 *     \/* [Group Name] *\/              ← starts a new group section
 *
 * Variable declarations after the first `module` or `function` keyword
 * are NOT exposed (they're implementation, not API).
 *
 * TODO: Use AST parser instead of regex.  Regex breaks on multi-line
 * expressions, nested arrays, and any clever OpenSCAD trick. An AST
 * parser would handle that gracefully — for now, the regex covers the
 * shapes the model actually emits.
 */
export default function parseParameters(script: string): Parameter[] {
  // Limit to the top of the file. Anything below the first `module` or
  // `function` is internal logic that the user shouldn't tweak as a
  // parameter.
  script = script.split(/^(module |function )/m)[0];

  const parameters: Record<string, Parameter> = {};
  const parameterRegex =
    /^([a-z0-9A-Z_$]+)\s*=\s*([^;]+);[\t\f\cK ]*(\/\/[^\n]*)?/gm;
  const groupRegex = /^\/\*\s*\[([^\]]+)\]\s*\*\//gm;

  // Build a list of source ranges keyed by group, so a `/* [Group] */`
  // marker influences only the variables declared below it.
  const groupSections: { id: string; group: string; code: string }[] = [
    { id: '', group: '', code: script },
  ];
  let tmpGroup;
  while ((tmpGroup = groupRegex.exec(script))) {
    groupSections.push({
      id: tmpGroup[0],
      group: tmpGroup[1].trim(),
      code: '',
    });
  }
  groupSections.forEach((group, index) => {
    const nextGroup = groupSections[index + 1];
    const startIndex = script.indexOf(group.id);
    const endIndex = nextGroup ? script.indexOf(nextGroup.id) : script.length;
    group.code = script.substring(startIndex, endIndex);
  });
  if (groupSections.length > 1) {
    groupSections[0].code = script.substring(
      0,
      script.indexOf(groupSections[1].id),
    );
  }

  groupSections.forEach((groupSection) => {
    let match;
    while ((match = parameterRegex.exec(groupSection.code)) !== null) {
      const name = match[1];
      const value = match[2];
      let typeAndValue:
        | { value: Parameter['value']; type: Parameter['type'] }
        | undefined;
      try {
        typeAndValue = convertType(value);
      } catch {
        continue;
      }
      if (!typeAndValue) continue;

      let description: Parameter['description'] = undefined;
      let options: ParameterOption[] = [];
      let range: ParameterRange = {};

      // Skip values that reference another variable or span lines —
      // they're computed expressions, not constants. Once we hit one,
      // bail out of THIS group section because anything further is
      // probably derived from it.
      if (
        value !== 'true' &&
        value !== 'false' &&
        (value.match(/^[a-zA-Z_]/) || value.split('\n').length > 1)
      ) {
        continue;
      }

      // The trailing `// ...` comment carries Customizer-style hints.
      if (match[3]) {
        const rawComment = match[3].replace(/^\/\/\s*/, '').trim();
        const cleaned = rawComment.replace(/^\[+|\]+$/g, '');

        if (!isNaN(Number(rawComment))) {
          // Bare number — step for numerics, maxLength for strings.
          if (typeAndValue.type === 'string') {
            range = { max: parseFloat(cleaned) };
          } else {
            range = { step: parseFloat(cleaned) };
          }
        } else if (rawComment.startsWith('[') && cleaned.includes(',')) {
          // `[a, b:Label, c]` — enum options. `value:Label` lets the
          // model pick a human label distinct from the underlying value.
          options = cleaned
            .trim()
            .split(',')
            .map((option) => {
              const parts = option.trim().split(':');
              let optionValue: ParameterOption['value'] = parts[0];
              const label: ParameterOption['label'] = parts[1];
              if (typeAndValue.type === 'number') {
                optionValue = parseFloat(optionValue);
              }
              return { value: optionValue, label };
            });
        } else if (cleaned.match(/([0-9]+:?)+/)) {
          // `[min:max]` or `[min:step:max]` — slider bounds.
          const [min, maxOrStep, max] = cleaned.trim().split(':');
          if (min && (maxOrStep || max)) {
            range = { min: parseFloat(min) };
          }
          if (max || maxOrStep || min) {
            range = { ...range, max: parseFloat(max || maxOrStep || min) };
          }
          if (max && maxOrStep) {
            range = { ...range, step: parseFloat(maxOrStep) };
          }
        }
      }

      // The description is the last `// ...` comment on the line
      // IMMEDIATELY above the variable declaration.
      let above = script.split(
        new RegExp(`^${escapeRegExp(match[0])}`, 'gm'),
      )[0];
      if (above.endsWith('\n')) above = above.slice(0, -1);
      const splitted = above.split('\n').reverse();
      const lastLineBeforeDefinition = splitted[0];
      if (lastLineBeforeDefinition.trim().startsWith('//')) {
        description = lastLineBeforeDefinition.replace(/^\/\/\/*\s*/, '');
        if (description.length === 0) description = undefined;
      }

      // Snake_case → Title Case for the visible label. `$fn` gets a
      // special name because OpenSCAD users recognise it as resolution.
      let displayName = name
        .replace(/_/g, ' ')
        .split(' ')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ');
      if (name === '$fn') displayName = 'Resolution';

      // Flatten `name = [a, b, c]` (number[]) into N scalar sliders
      // `name[0]`, `name[1]`, ... — far easier to manipulate via the
      // sidebar than a single multi-value field.
      if (
        typeAndValue.type === 'number[]' &&
        Array.isArray(typeAndValue.value)
      ) {
        const labels = numberArrayLabels(name, typeAndValue.value.length);
        typeAndValue.value.forEach((itemValue, index) => {
          parameters[`${name}[${index}]`] = {
            description,
            group: groupSection.group,
            name: `${name}[${index}]`,
            displayName: displayNameForArrayItem(displayName, labels[index]),
            defaultValue: itemValue,
            range,
            options,
            value: itemValue,
            type: 'number',
          };
        });
        continue;
      }

      parameters[name] = {
        description,
        group: groupSection.group,
        name,
        displayName,
        defaultValue: typeAndValue.value,
        range,
        options,
        ...typeAndValue,
      };
    }
  });

  return Object.values(parameters);
}

function numberArrayLabels(name: string, length: number) {
  if (length === 2) return ['X', 'Y'];
  if (length !== 3) return Array.from({ length }, (_, i) => `${i + 1}`);
  const lowerName = name.toLowerCase();
  if (
    lowerName.includes('size') ||
    lowerName.includes('dimension') ||
    lowerName.includes('body') ||
    lowerName.includes('torso') ||
    lowerName.includes('head') ||
    lowerName.includes('foot') ||
    lowerName.includes('base')
  ) {
    return ['Width', 'Depth', 'Height'];
  }
  return ['X', 'Y', 'Z'];
}

function displayNameForArrayItem(displayName: string, label: string) {
  if (['Width', 'Depth', 'Height'].includes(label)) {
    return displayName.replace(/\s+Size$/i, '') + ` ${label}`;
  }
  return `${displayName} ${label}`;
}

function convertType(rawValue: string): {
  value: Parameter['value'];
  type: ParameterType;
} {
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return { value: parseFloat(rawValue), type: 'number' };
  }
  if (rawValue === 'true' || rawValue === 'false') {
    return { value: rawValue === 'true', type: 'boolean' };
  }
  if (/^".*"$/.test(rawValue)) {
    return { value: rawValue.replace(/^"(.*)"$/, '$1'), type: 'string' };
  }
  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    const arrayValue = rawValue
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim());
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => /^\d+(\.\d+)?$/.test(item))
    ) {
      return {
        value: arrayValue.map((item) => parseFloat(item)),
        type: 'number[]',
      };
    }
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => /^".*"$/.test(item))
    ) {
      return {
        value: arrayValue.map((item) => item.slice(1, -1)),
        type: 'string[]',
      };
    }
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => item === 'true' || item === 'false')
    ) {
      return {
        value: arrayValue.map((item) => item === 'true'),
        type: 'boolean[]',
      };
    }
    throw new Error(`Invalid array value: ${rawValue}`);
  }
  throw new Error(`Invalid value: ${rawValue}`);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
