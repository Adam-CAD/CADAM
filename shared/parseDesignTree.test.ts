import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import parseDesignTree from './parseDesignTree.ts';

describe('parseDesignTree', () => {
  it('parses a valid single node', () => {
    const result = parseDesignTree(
      '// @cadam-node {"id":"base","kind":"part","name":"Base","params":["width","height"],"moduleName":"base"}',
    );

    assert.deepEqual(result, {
      nodes: [
        {
          id: 'base',
          kind: 'part',
          name: 'Base',
          params: ['width', 'height'],
          moduleName: 'base',
        },
      ],
      warnings: [],
    });
  });

  it('parses valid parent and child nodes', () => {
    const result = parseDesignTree(`
// @cadam-node {"id":"assembly","kind":"group","name":"Assembly"}
// @cadam-node {"id":"base-cut","kind":"operation","name":"Base cut","parentId":"assembly"}
`);

    assert.deepEqual(result.nodes, [
      { id: 'assembly', kind: 'group', name: 'Assembly' },
      {
        id: 'base-cut',
        kind: 'operation',
        name: 'Base cut',
        parentId: 'assembly',
      },
    ]);
    assert.deepEqual(result.warnings, []);
  });

  it('returns a warning for invalid JSON', () => {
    const result = parseDesignTree('// @cadam-node {"id":"base","kind":"part"');

    assert.deepEqual(result.nodes, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'invalid-json');
  });

  it('returns a warning for duplicate ids', () => {
    const result = parseDesignTree(`
// @cadam-node {"id":"base","kind":"part"}
// @cadam-node {"id":"base","kind":"operation"}
`);

    assert.deepEqual(result.nodes, [
      { id: 'base', kind: 'part', name: 'base' },
    ]);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'duplicate-id');
    assert.equal(result.warnings[0].id, 'base');
  });

  it('returns a warning for missing id', () => {
    const result = parseDesignTree('// @cadam-node {"kind":"part"}');

    assert.deepEqual(result.nodes, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'missing-id');
  });

  it('returns a warning for missing kind', () => {
    const result = parseDesignTree('// @cadam-node {"id":"base"}');

    assert.deepEqual(result.nodes, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'missing-kind');
    assert.equal(result.warnings[0].id, 'base');
  });

  it('returns a warning for unknown kind', () => {
    const result = parseDesignTree(
      '// @cadam-node {"id":"base","kind":"sketch"}',
    );

    assert.deepEqual(result.nodes, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'unknown-kind');
    assert.equal(result.warnings[0].kind, 'sketch');
  });

  it('returns a warning for non-string params entries', () => {
    const result = parseDesignTree(
      '// @cadam-node {"id":"base","kind":"part","params":["width",42,"height"]}',
    );

    assert.deepEqual(result.nodes, [
      { id: 'base', kind: 'part', name: 'base', params: ['width', 'height'] },
    ]);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'invalid-param-entry');
    assert.equal(result.warnings[0].id, 'base');
  });

  it('returns an empty result when there are no annotations', () => {
    const result = parseDesignTree(`
width = 10;
module base() {
  cube([width, 20, 5]);
}
`);

    assert.deepEqual(result, { nodes: [], warnings: [] });
  });
});
