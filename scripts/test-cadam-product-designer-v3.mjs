import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const view = await readFile(new URL('src/views/ProductDesignerView.tsx', root), 'utf8');

assert.match(view, /Start CAD generation/i);
assert.match(view, /createAndCacheAiChat/);
assert.match(view, /persistUserMessage/);
assert.match(view, /ensureInputRecords/);
assert.match(view, /type:\s*'parametric'/);
assert.match(view, /apiUrl\('parametric-chat'\)/);
assert.match(view, /navigate\(\{\s*to:\s*'\/editor\/\$id'/s);
assert.match(view, /User must be authenticated|Sign in/i);
assert.match(view, /product_designer_candidate_id|productDesignerCandidateId/);

const docs = await readFile(new URL('docs/CADAM_PRODUCT_DESIGNER.md', root), 'utf8');
assert.match(docs, /Start CAD generation|send selected candidate/i);
assert.match(docs, /\/cadam\/product-designer/);

console.log('cadam product designer v3 tests passed');
