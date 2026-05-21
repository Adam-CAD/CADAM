import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const view = await readFile(new URL('src/views/ProductDesignerView.tsx', root), 'utf8');
const docs = await readFile(new URL('docs/CADAM_PRODUCT_DESIGNER.md', root), 'utf8');

assert.match(view, /CADAM_PRODUCT_DESIGNER_BRANCHES/);
assert.match(view, /localStorage\.getItem/);
assert.match(view, /localStorage\.setItem/);
assert.match(view, /Save branch/i);
assert.match(view, /Saved candidate branches/i);
assert.match(view, /restoreSavedBranch/);
assert.match(view, /productDesignerCandidateId/);
assert.match(docs, /localStorage branch persistence/i);

console.log('cadam product designer v4 tests passed');
