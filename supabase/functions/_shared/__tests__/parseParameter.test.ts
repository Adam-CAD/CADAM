import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import parseParameters from '../parseParameter.ts';

Deno.test('parseParameters reads multi-line array assignments', () => {
  const script = `
/* [Dimensions] */
widths = [
  10,
  20,
  30,
];

// Number of segments
segments = 24;
`;

  const parameters = parseParameters(script);
  const widths = parameters.find((param) => param.name === 'widths');
  const segments = parameters.find((param) => param.name === 'segments');

  assertEquals(widths?.type, 'number[]');
  assertEquals(widths?.defaultValue, [10, 20, 30]);
  assertEquals(segments?.type, 'number');
  assertEquals(segments?.defaultValue, 24);
});
