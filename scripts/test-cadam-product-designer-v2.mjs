import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildCandidateGenerationPrompt,
  extractProductBrief,
  proposeDesignCandidates,
  rankDesignCandidates,
} from '../shared/cadamProductDesigner.ts';

const root = new URL('../', import.meta.url);

const productPrompts = [
  'soporte de pared FDM con tornillos M4, clip flexible y tolerancia ajustable',
  'caja electronica para ESP32 con tapa snap fit, ventilacion y bosses para tornillos',
  'jig de perforacion parametrico con bujes metalicos y guia de alineacion',
];

for (const prompt of productPrompts) {
  const brief = extractProductBrief(prompt);
  assert.notEqual(brief.objectType, 'lamp', `Should not overfit to lamps: ${prompt}`);
  assert.equal(brief.manufacturing, 'FDM 3D printing');
  const ranked = rankDesignCandidates(proposeDesignCandidates(brief), brief);
  assert.ok(ranked.length >= 5, 'Should generate several product-design strategies');
  assert.ok(ranked.some((candidate) => /robust|print|modular|fixture|enclosure|jig/i.test(`${candidate.id} ${candidate.title} ${candidate.strategy}`)));
  const generationPrompt = buildCandidateGenerationPrompt({
    originalPrompt: prompt,
    brief,
    candidate: ranked[0],
  });
  assert.match(generationPrompt, /Selected design candidate/i);
  assert.match(generationPrompt, /OpenSCAD/i);
  assert.match(generationPrompt, /Customizer/i);
  assert.match(generationPrompt, /tolerance|clearance/i);
}

const view = await readFile(new URL('src/views/ProductDesignerView.tsx', root), 'utf8');
assert.match(view, /CADAM Product Designer/i);
assert.match(view, /apiJson\('product-design-plan'/s);
assert.match(view, /Generate CAD prompt/i);
assert.doesNotMatch(view, /PRISMA/i);

const route = await readFile(new URL('src/routes/_layout/product-designer.tsx', root), 'utf8');
assert.match(route, /createFileRoute\('\/_layout\/product-designer'\)/);

const docs = await readFile(new URL('docs/CADAM_PRODUCT_DESIGNER.md', root), 'utf8');
assert.match(docs, /general CADAM/i);
assert.match(docs, /Zoo\/KCL visible trace/i);
assert.match(docs, /not.*chain-of-thought|No hidden chain-of-thought/is);
assert.match(docs, /web/i);
assert.doesNotMatch(docs, /PRISMA/i);

const skill = await readFile(new URL('docs/skills/cadam-zoo-product-designer/SKILL.md', root), 'utf8');
assert.ok(skill.startsWith('---\n'));
assert.match(skill, /name: cadam-zoo-product-designer/);
assert.match(skill, /visible Zoo\/KCL traces/i);
assert.match(skill, /Verification Checklist/i);

console.log('cadam product designer v2 tests passed');
