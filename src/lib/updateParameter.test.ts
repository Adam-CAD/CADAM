import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateParameter } from './utils.ts';
import type { Parameter } from '@shared/types';

function numberParam(name: string, value: number): Parameter {
  return {
    name,
    displayName: name,
    value,
    defaultValue: value,
    type: 'number',
  };
}

describe('updateParameter', () => {
  it('rewrites a scalar assignment in place', () => {
    const code = 'cup_height = 100; // [50:5:200]\ncylinder(h=cup_height);';
    assert.equal(
      updateParameter(code, numberParam('cup_height', 120)),
      'cup_height = 120; // [50:5:200]\ncylinder(h=cup_height);',
    );
  });

  it('rewrites one component of a vector literal', () => {
    // `parseParameters` flattens `size = [30, 20, 10];` into size[0..2]
    // sliders — editing size[1] must rewrite the middle element, not
    // search for a nonexistent `size[1] = ...;` assignment.
    const code = 'size = [30, 20, 10]; // body\ncube(size);';
    assert.equal(
      updateParameter(code, numberParam('size[1]', 25)),
      'size = [30, 25, 10]; // body\ncube(size);',
    );
  });

  it('preserves spacing and trailing comments on vector rewrites', () => {
    const code = 'size = [ 30 , 20 , 10 ];   // [10:50]';
    assert.equal(
      updateParameter(code, numberParam('size[0]', 42)),
      'size = [ 42 , 20 , 10 ];   // [10:50]',
    );
  });

  it('leaves code untouched for an out-of-range vector index', () => {
    const code = 'size = [30, 20, 10];';
    assert.equal(updateParameter(code, numberParam('size[5]', 99)), code);
  });

  it('still matches a literal name[i] scalar assignment for strings', () => {
    // A string param whose *name* looks indexed must not go down the
    // vector path — only number components come from flattening.
    const code = 'label = "Cup"; // 24';
    const param: Parameter = {
      name: 'label',
      displayName: 'Label',
      value: 'Mug',
      defaultValue: 'Cup',
      type: 'string',
    };
    assert.equal(updateParameter(code, param), 'label = "Mug"; // 24');
  });
});
