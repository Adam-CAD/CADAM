import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Parameter } from '@shared/types';
import parseParameters from '../../shared/parseParameters.ts';
import { updateParameter } from './utils.ts';

function edit(code: string, name: string, value: number) {
  const param = parseParameters(code).find((p) => p.name === name);
  assert.ok(param, `parameter ${name} not found`);
  return updateParameter(code, { ...param, value } as Parameter);
}

describe('updateParameter on flattened array parameters', () => {
  const code = 'size = [10, 20, 30]; // [1:100]\ncube(size);\n';

  it('rewrites only the edited element', () => {
    assert.equal(
      edit(code, 'size[1]', 55),
      'size = [10, 55, 30]; // [1:100]\ncube(size);\n',
    );
  });

  it('applies edits to several elements in sequence', () => {
    const next = edit(edit(code, 'size[0]', 5), 'size[2]', 7.5);
    assert.equal(next, 'size = [5, 20, 7.5]; // [1:100]\ncube(size);\n');
  });

  it('handles the full parameter list the editor passes in', () => {
    const params = parseParameters(code).map((p) =>
      p.name === 'size[2]' ? { ...p, value: 12 } : p,
    );
    const next = params.reduce(
      (acc, param) => updateParameter(acc, param),
      code,
    );
    assert.equal(next, 'size = [10, 20, 12]; // [1:100]\ncube(size);\n');
  });

  it('keeps scalar parameters working', () => {
    assert.equal(
      edit('width = 4; // [1:9]\n', 'width', 6),
      'width = 6; // [1:9]\n',
    );
  });
});
