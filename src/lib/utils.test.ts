import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import parseParameters from '../../shared/parseParameters.ts';
import { updateParameter } from './utils.ts';

function edit(code: string, name: string, value: number) {
  const param = parseParameters(code).find((p) => p.name === name);
  assert.ok(param, `parameter ${name} not found`);
  return updateParameter(code, { ...param, value });
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

  it('edits the declaration parseParameters exposes when a name repeats', () => {
    const dup = 'size = [1, 2]; // [1:9]\nsize = [3, 4]; // [1:9]\n';
    assert.equal(
      edit(dup, 'size[0]', 8),
      'size = [1, 2]; // [1:9]\nsize = [8, 4]; // [1:9]\n',
    );
  });

  it('ignores declarations the parser does not expose', () => {
    const base = 'size = [1, 2]; // [1:9]\n';
    assert.equal(
      edit(base + 'size = ["a", "b"];\n', 'size[0]', 8),
      'size = [8, 2]; // [1:9]\nsize = ["a", "b"];\n',
    );
    assert.equal(
      edit(base + 'size = [.5, 1e3];\n', 'size[0]', 8),
      'size = [8, 2]; // [1:9]\nsize = [.5, 1e3];\n',
    );
    assert.equal(
      edit(base + 'if (x) {\n  size = [5, 6];\n}\n', 'size[0]', 8),
      'size = [8, 2]; // [1:9]\nif (x) {\n  size = [5, 6];\n}\n',
    );
    assert.equal(
      edit(base + 'module m() {}\nsize = [5, 6];\n', 'size[0]', 8),
      'size = [8, 2]; // [1:9]\nmodule m() {}\nsize = [5, 6];\n',
    );
  });

  it('follows the parser across declarations of different length', () => {
    const code = 'size = [1, 2, 3];\nsize = [4, 5];\n';
    assert.equal(
      edit(code, 'size[2]', 9),
      'size = [1, 2, 9];\nsize = [4, 5];\n',
    );
    assert.equal(
      edit(code, 'size[0]', 9),
      'size = [1, 2, 3];\nsize = [9, 5];\n',
    );
  });

  it('skips multi-line declarations the parser does not expose', () => {
    const code = 'size = [1, 2];\nsize = [3,\n 4];\n';
    assert.equal(
      edit(code, 'size[0]', 9),
      'size = [9, 2];\nsize = [3,\n 4];\n',
    );
  });

  it('keeps scalar parameters working', () => {
    assert.equal(
      edit('width = 4; // [1:9]\n', 'width', 6),
      'width = 6; // [1:9]\n',
    );
  });
});
