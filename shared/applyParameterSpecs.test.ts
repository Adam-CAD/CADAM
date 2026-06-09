import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import applyParameterSpecs from './applyParameterSpecs.ts';
import parseParameters from './parseParameters.ts';
import type { ParameterSpec } from './types.ts';

const CODE = `
cup_height = 100; // [50:5:200]
style = "round";
size = [30, 20, 10];

module body() {}
`;

describe('applyParameterSpecs', () => {
  it('returns parsed parameters untouched when no specs are given', () => {
    const parsed = parseParameters(CODE);
    assert.deepEqual(applyParameterSpecs(parsed, undefined), parsed);
    assert.deepEqual(applyParameterSpecs(parsed, null), parsed);
    assert.deepEqual(applyParameterSpecs(parsed, []), parsed);
  });

  it('overlays spec metadata over comment-derived metadata', () => {
    const specs: ParameterSpec[] = [
      {
        name: 'cup_height',
        label: 'Cup Height',
        description: 'Outer height of the mug body',
        group: 'Body',
        min: 60,
        max: 180,
        step: 10,
        unit: 'mm',
      },
    ];
    const [cupHeight] = applyParameterSpecs(parseParameters(CODE), specs);
    assert.equal(cupHeight.name, 'cup_height');
    assert.equal(cupHeight.displayName, 'Cup Height');
    assert.equal(cupHeight.description, 'Outer height of the mug body');
    assert.equal(cupHeight.group, 'Body');
    assert.equal(cupHeight.unit, 'mm');
    // Spec range wins over the `// [50:5:200]` Customizer comment.
    assert.deepEqual(cupHeight.range, { min: 60, max: 180, step: 10 });
    // Value and default still come from the code.
    assert.equal(cupHeight.value, 100);
    assert.equal(cupHeight.defaultValue, 100);
  });

  it('drops spec entries that reference variables missing from the code', () => {
    const parsed = parseParameters(CODE);
    const result = applyParameterSpecs(parsed, [
      { name: 'phantom_variable', min: 0, max: 1 },
    ]);
    assert.deepEqual(result, parsed);
  });

  it('keeps comment-derived metadata for parameters without a spec', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'style', options: [{ value: 'round' }, { value: 'hex' }] },
    ]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    assert.deepEqual(cupHeight?.range, { min: 50, step: 5, max: 200 });
  });

  it('applies enum options, coercing values for number parameters', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      {
        name: 'style',
        options: [{ value: 'round', label: 'Round' }, { value: 'hex' }],
      },
      {
        name: 'cup_height',
        options: [{ value: '80' }, { value: '120' }, { value: 'tall' }],
      },
    ]);
    const style = result.find((param) => param.name === 'style');
    assert.deepEqual(style?.options, [
      { value: 'round', label: 'Round' },
      { value: 'hex', label: 'hex' },
    ]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    // 'tall' is not a number — coerced out rather than corrupting the list.
    assert.deepEqual(cupHeight?.options, [
      { value: 80, label: '80' },
      { value: 120, label: '120' },
    ]);
  });

  it('spreads a base-name spec across flattened vector components', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'size', min: 5, max: 50, unit: 'mm', label: 'Size' },
    ]);
    const components = result.filter((param) => param.name.startsWith('size['));
    assert.equal(components.length, 3);
    for (const component of components) {
      assert.deepEqual(component.range, { min: 5, max: 50 });
      assert.equal(component.unit, 'mm');
    }
    // Axis labels stay distinct — the shared label must not collapse them.
    assert.notEqual(components[0].displayName, components[1].displayName);
  });

  it('expands a bound that excludes the current code value', () => {
    // cup_height is 100 in the code — a min-only spec above it would pin
    // the slider outside its own value and rewrite geometry on first drag.
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', min: 150 },
    ]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    assert.equal(cupHeight?.range?.min, 100);

    const shrunk = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', min: 20, max: 60 },
    ]);
    assert.deepEqual(
      shrunk.find((param) => param.name === 'cup_height')?.range,
      { min: 20, max: 100, step: 5 },
    );
  });

  it('rejects a zero-span range (min === max)', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', min: 100, max: 100 },
    ]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    assert.deepEqual(cupHeight?.range, { min: 50, step: 5, max: 200 });
  });

  it('ignores numeric range specs on string parameters', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'style', min: 1, max: 10 },
    ]);
    const style = result.find((param) => param.name === 'style');
    // range.max means maxLength for strings — a numeric range spec on a
    // string variable must not leak into it.
    assert.deepEqual(style?.range, {});
  });

  it('ignores non-string presentation fields from unvalidated persisted parts', () => {
    const parsed = parseParameters(CODE);
    const result = applyParameterSpecs(parsed, [
      {
        name: 'cup_height',
        label: { nested: true },
        description: 42,
        group: [],
        unit: { mm: true },
      },
    ] as unknown as ParameterSpec[]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    const original = parsed.find((param) => param.name === 'cup_height');
    assert.equal(cupHeight?.displayName, original?.displayName);
    assert.equal(cupHeight?.description, original?.description);
    assert.equal(cupHeight?.unit, undefined);
  });

  it('caps unit length so it cannot blow up the layout', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', unit: '  millimeters  ' },
    ]);
    assert.equal(
      result.find((param) => param.name === 'cup_height')?.unit,
      'mill',
    );
  });

  it('rejects option values with unit suffixes for number parameters', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', options: [{ value: '80mm' }, { value: '120' }] },
    ]);
    // parseFloat would read "80mm" as 80 — Number() must reject it.
    assert.deepEqual(
      result.find((param) => param.name === 'cup_height')?.options,
      [{ value: 120, label: '120' }],
    );
  });

  it('rejects inverted ranges and non-positive steps from a bad spec', () => {
    const result = applyParameterSpecs(parseParameters(CODE), [
      { name: 'cup_height', min: 200, max: 50, step: -5 },
    ]);
    const cupHeight = result.find((param) => param.name === 'cup_height');
    // Falls back to the comment-derived range instead of breaking sliders.
    assert.deepEqual(cupHeight?.range, { min: 50, step: 5, max: 200 });
  });

  it('tolerates malformed spec entries from an untrusted tool input', () => {
    const parsed = parseParameters(CODE);
    const result = applyParameterSpecs(parsed, [
      null,
      42,
      { noName: true },
      { name: 'style', options: [null, { value: 7 }] },
    ] as unknown as ParameterSpec[]);
    assert.equal(result.length, parsed.length);
    const style = result.find((param) => param.name === 'style');
    // No usable options survive validation — comment-derived (empty) kept.
    assert.deepEqual(style?.options, []);
  });
});
