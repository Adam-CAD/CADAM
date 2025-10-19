import {
  assert,
  assertEquals,
  assertFalse,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import type { Parameter } from '@shared/types.ts';
import {
  buildParameterAssignmentRegex,
  coerceParameterValue,
  serializeParameterValue,
} from '@shared/parameter-utils.ts';

Deno.test('serializeParameterValue formats scalar and array types', () => {
  assertEquals(serializeParameterValue('number', 42), '42');
  assertEquals(serializeParameterValue('boolean', true), 'true');
  assertEquals(
    serializeParameterValue('string', 'hello "world"'),
    '"hello \\"world\\""',
  );
  assertEquals(serializeParameterValue('number[]', [1, 2, 3]), '[1, 2, 3]');
  assertEquals(
    serializeParameterValue('boolean[]', [true, false]),
    '[true, false]',
  );
  assertEquals(
    serializeParameterValue('string[]', ['a', 'b c']),
    '["a", "b c"]',
  );
});

Deno.test('coerceParameterValue accepts diverse array inputs', () => {
  const numberTarget: Pick<Parameter, 'type' | 'defaultValue'> = {
    type: 'number[]',
    defaultValue: [],
  };
  const booleanTarget: Pick<Parameter, 'type' | 'defaultValue'> = {
    type: 'boolean[]',
    defaultValue: [],
  };
  const stringTarget: Pick<Parameter, 'type' | 'defaultValue'> = {
    type: 'string[]',
    defaultValue: [],
  };

  assertEquals(coerceParameterValue(numberTarget, '[1, 2, 3]'), [1, 2, 3]);
  assertEquals(coerceParameterValue(numberTarget, ['4', 5]), [4, 5]);

  assertEquals(
    coerceParameterValue(booleanTarget, '["true", false, "False"]'),
    [true, false, false],
  );

  assertEquals(coerceParameterValue(stringTarget, '[alpha, "beta", gamma]'), [
    'alpha',
    'beta',
    'gamma',
  ]);
});

Deno.test(
  'buildParameterAssignmentRegex matches multi-line assignments',
  () => {
    const code = `
gap = [
  10,
  20,
  30,
]; // comment
`;
    const regex = buildParameterAssignmentRegex('gap');
    const match = regex.exec(code);
    assert(match);
    assert(match![2].includes('\n  20,\n'));
    assertEquals(
      code.replace(regex, (_substring, prefix, _value, suffix) => {
        assert(prefix.trimStart().startsWith('gap'));
        return `${prefix}[0, 1]${suffix}`;
      }),
      `
gap = [0, 1]; // comment
`,
    );

    const missing = buildParameterAssignmentRegex('missing');
    assertFalse(missing.test(code));
  },
);
