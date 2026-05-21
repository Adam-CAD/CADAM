import assert from 'node:assert/strict';
import {
  PRODUCT_DESIGNER_PROMPT_EXTENSION,
  extractProductBrief,
  proposeDesignCandidates,
  rankDesignCandidates,
  summarizeZooWorkflowTrace,
  vertexGeminiReadiness,
} from '../shared/cadamProductDesigner.ts';

const lampPrompt = `Design a robust 3D-printable lamp. Split it into two parts: an exterior aesthetic PLA shell and an interior cheap PETG structural insert. Add a click/snap-fit system between the parts. Leave as much internal space as possible for ballast cavities that can be filled with sand or weights. Prioritize robustness, printability, and easy assembly.`;

const brief = extractProductBrief(lampPrompt);
assert.equal(brief.objectType, 'lamp');
assert.equal(brief.manufacturing, 'FDM 3D printing');
assert.ok(brief.materials.exterior?.includes('PLA'));
assert.ok(brief.materials.interior?.includes('PETG'));
assert.ok(brief.assemblyRequirements.some((item) => /snap|click/i.test(item)));
assert.ok(brief.cavities.some((item) => /ballast/i.test(item)));
assert.ok(brief.inferredDefaults.some((item) => /wall/i.test(item)));

const candidates = proposeDesignCandidates(brief);
assert.ok(candidates.length >= 4);
assert.ok(new Set(candidates.map((candidate) => candidate.strategy)).size >= 4);
assert.ok(candidates.some((candidate) => /baseline/i.test(candidate.strategy)));
assert.ok(candidates.some((candidate) => /modular|repair/i.test(candidate.strategy)));

const ranked = rankDesignCandidates([
  {
    ...candidates[0],
    cadCode: 'wall_thickness = 1; cube([20,20,20]);',
  },
  {
    ...candidates[1],
    cadCode: 'wall_thickness = 3; rib_count = 8; snap_clearance = 0.35; ballast_cavity_volume = 120;',
  },
]);
assert.equal(ranked[0].id, candidates[1].id);
assert.ok(ranked[0].score.overall > ranked[1].score.overall);
assert.ok(ranked[1].warnings.some((warning) => /wall/i.test(warning)));

const trace = `🧠 Activating skill: kcl-modeling\n📖 Reading user selections...\n📂 Listing project files and attachments...\n🔍 Searching built-in samples for: twist lock lamp base snap fit clip ballast cavities assembly\n✅ Read: main.kcl\n✅ Read: shadeDisk.kcl\nSupplemental analysis Beyond geometry creation, center of mass, volume, and surface area.`;
const summary = summarizeZooWorkflowTrace(trace);
assert.ok(summary.observableSkillRouting.some((item) => item.includes('kcl-modeling')));
assert.ok(summary.observableDesignStages.some((item) => /selection/i.test(item)));
assert.ok(summary.observableMechanicalConsiderations.some((item) => /snap|ballast/i.test(item)));
assert.ok(summary.limitations.some((item) => /visible/i.test(item)));

const noEnv = vertexGeminiReadiness({});
assert.equal(noEnv.available, false);
assert.ok(noEnv.missing.includes('GOOGLE_CLOUD_PROJECT'));

assert.ok(PRODUCT_DESIGNER_PROMPT_EXTENSION.includes('multiple design candidates'));
assert.ok(PRODUCT_DESIGNER_PROMPT_EXTENSION.includes('mechanical'));

console.log('cadam product designer tests passed');
