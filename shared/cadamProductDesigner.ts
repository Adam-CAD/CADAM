export type ProductBrief = {
  objectType: string;
  intendedUse?: string;
  dimensions: Record<string, number | string>;
  materials: Record<string, string>;
  manufacturing?: string;
  robustnessRequirements: string[];
  assemblyRequirements: string[];
  cavities: string[];
  constraints: string[];
  inferredDefaults: string[];
  unknowns: string[];
  aestheticGoals: string[];
  safetyConstraints: string[];
};

export type CandidateScore = {
  geometricValidity: number;
  printability: number;
  robustness: number;
  manufacturability: number;
  materialEfficiency: number;
  assemblyEase: number;
  parametricity: number;
  aestheticFit: number;
  stability: number;
  toleranceRisk: number;
  overall: number;
};

export type DesignCandidate = {
  id: string;
  title: string;
  strategy: string;
  cadCode?: string;
  parameters?: Record<string, unknown>;
  score?: CandidateScore;
  notes: string[];
  warnings: string[];
  failureRisks: string[];
  parentId?: string;
  generation: number;
};

export type ZooWorkflowSummary = {
  observableSkillRouting: string[];
  observableDesignStages: string[];
  observableMechanicalConsiderations: string[];
  observableCadGenerationPatterns: string[];
  observableProjectStateUse: string[];
  observableValidationOrRepair: string[];
  cadamImprovementOpportunities: string[];
  limitations: string[];
};

export type ProductDesignPlan = {
  brief: ProductBrief;
  candidates: DesignCandidate[];
  generationPrompts?: Record<string, string>;
  traceSummary?: ZooWorkflowSummary;
  gemini: ReturnType<typeof vertexGeminiReadiness>;
};

export type CandidateGenerationPromptInput = {
  originalPrompt: string;
  brief: ProductBrief;
  candidate: DesignCandidate;
  extraInstructions?: string;
};

export const PRODUCT_DESIGNER_PROMPT_EXTENSION = `
# CADAM product-designer workflow
For practical mechanical/product CAD requests, behave as a product design partner, not a single-shot code generator.

Before calling build_parametric_model, internally structure the task as:
- product brief: object type, use, dimensions, materials, manufacturing method, robustness, assembly, cavities, tolerances, printability, aesthetic goals, unknowns, inferred defaults, and safety caveats.
- multiple design candidates when useful: explore meaningfully different strategies such as robust baseline, print-optimized, material-efficient, premium/aesthetic, mechanically reinforced, modular/repairable, or task-specific alternatives.
- candidate evaluation: compare geometric validity, printability, robustness, manufacturability, material efficiency, assembly ease, parametricity, aesthetic fit, stability, tolerance risk, and complexity.
- variant evolution: when the user picks or praises a candidate, preserve that branch and generate descendants rather than restarting.

Mechanical heuristics for FDM:
- Prefer explicit top-level parameters with Customizer comments for wall thickness, clearances, rib count, boss diameters, snap clearances, ballast cavities, vents, and material-specific parts.
- For snap/click fits, expose clearance and flexure dimensions; use PETG/nylon-like assumptions for flexing parts and warn about brittle PLA snaps.
- For lamps, separate visible PLA shells from cheaper/stronger PETG inserts when requested, preserve large ballast cavities, route cables safely, leave heat/ventilation clearance, and label electrical safety assumptions.
- If images are present, use them for silhouette/proportion/feature extraction and compare generated previews against them when possible.
- Keep failures structured: if CAD cannot be made valid, explain the failure and emit the smallest repairable artifact instead of vague prose.
`;

const MM_DIMENSION = /(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/gi;

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function inferObjectType(lower: string): string {
  if (/lamp|lampara|lámpara|shade|diffuser/.test(lower)) return 'lamp';
  if (
    /enclosure|case|box|housing|caja|gabinete|electronics|electronica|electr[oó]nica/.test(
      lower,
    )
  )
    return 'enclosure';
  if (
    /jig|fixture|plantilla|drill guide|guia de perforaci[oó]n|guía de perforaci[oó]n/.test(
      lower,
    )
  )
    return 'jig/fixture';
  if (/clip|snap|bracket|mount|soporte|fastener|wall mount|pared/.test(lower))
    return 'connector/fixture';
  if (
    /gear|engranaje|pulley|polea|hinge|bisagra|mechanism|mecanismo/.test(lower)
  )
    return 'mechanism';
  if (/planter|maceta/.test(lower)) return 'planter';
  return 'physical product';
}

export function extractProductBrief(prompt: string): ProductBrief {
  const lower = prompt.toLowerCase();
  const dimensions: Record<string, number | string> = {};
  let match: RegExpExecArray | null;
  while ((match = MM_DIMENSION.exec(prompt))) {
    dimensions[`dimension_${Object.keys(dimensions).length + 1}`] =
      `${match[1]}${match[2]}`;
  }

  const materials: Record<string, string> = {};
  if (has(lower, /pla/))
    materials.exterior = 'PLA aesthetic shell or visible part';
  if (has(lower, /petg/))
    materials.interior = 'PETG structural insert or cheap interior part';
  if (has(lower, /nylon|pa6|pa12/))
    materials.flexures = 'nylon-family material for fatigue-resistant flexures';

  const assemblyRequirements = unique([
    has(lower, /snap|click|clip|pres[s-]?fit|encastre/)
      ? 'snap/click-fit assembly with explicit clearances'
      : '',
    has(lower, /screw|m3|m4|bolt|tornillo/)
      ? 'screw/fastener-compatible assembly'
      : '',
    has(lower, /split|separate|two parts|dos piezas|modular/)
      ? 'separate printable parts with clear assembly order'
      : '',
  ]);

  const cavities = unique([
    has(lower, /ballast|lastre|sand|weights|yeso|plaster/)
      ? 'large ballast cavities for sand/plaster/weights'
      : '',
    has(lower, /cavity|void|cabidad|cavidad|internal space/)
      ? 'preserve internal voids where structurally safe'
      : '',
    has(lower, /cable|wire|led|e14|lamp holder|portal[aá]mparas/)
      ? 'cable/lamp-holder routing cavity'
      : '',
  ]);

  const robustnessRequirements = unique([
    has(lower, /robust|strong|strength|rigid|resistente|structural/)
      ? 'robust load paths with ribs/gussets where useful'
      : '',
    has(lower, /easy assembly|facil|fácil/)
      ? 'easy hand assembly and low tool burden'
      : '',
    has(lower, /printability|3d.print|fdm|imprimir/)
      ? 'FDM-printable geometry with manageable overhangs'
      : '',
  ]);

  const constraints = unique([
    has(lower, /as much internal space|mayor espacio|maximum internal/)
      ? 'maximize usable internal space'
      : '',
    has(lower, /cheap|barato/)
      ? 'use low-cost material where hidden or non-aesthetic'
      : '',
    has(lower, /aesthetic|premium|est[eé]tico/)
      ? 'protect the visible exterior appearance'
      : '',
  ]);

  const aestheticGoals = unique([
    has(lower, /aesthetic|premium|est[eé]tico/)
      ? 'clean visible shell with hidden structural mechanics'
      : '',
  ]);

  const safetyConstraints = unique([
    inferObjectType(lower) === 'lamp'
      ? 'electrical/heat safety must be reviewed before real use'
      : '',
    has(lower, /load|hanging|weight|lastre/)
      ? 'ballast/load-bearing assumptions are practical heuristics, not certification'
      : '',
  ]);

  const inferredDefaults = unique([
    'units in millimeters',
    'default FDM wall thickness 2.4-3.2 mm unless prompt says otherwise',
    'snap-fit clearance starts around 0.25-0.45 mm and must be tuned per printer/material',
    'use grouped top-level OpenSCAD parameters with Customizer ranges',
    inferObjectType(lower) === 'lamp'
      ? 'separate heat/electrical components from printed plastic with clearance and ventilation'
      : '',
  ]);

  const unknowns = unique([
    Object.keys(dimensions).length === 0 ? 'exact external dimensions' : '',
    assemblyRequirements.length === 0
      ? 'preferred fastening/assembly method'
      : '',
    'printer/nozzle/material profile and tolerance calibration',
  ]);

  return {
    objectType: inferObjectType(lower),
    intendedUse:
      inferObjectType(lower) === 'lamp'
        ? 'functional/decorative lamp product'
        : undefined,
    dimensions,
    materials,
    manufacturing: has(lower, /cnc|milling|machining|fresado/)
      ? 'CNC/machining'
      : 'FDM 3D printing',
    robustnessRequirements,
    assemblyRequirements,
    cavities,
    constraints,
    inferredDefaults,
    unknowns,
    aestheticGoals,
    safetyConstraints,
  };
}

function makeCandidate(
  id: string,
  title: string,
  strategy: string,
  notes: string[],
): DesignCandidate {
  return {
    id,
    title,
    strategy,
    notes,
    warnings: [],
    failureRisks: [],
    generation: 1,
  };
}

export function proposeDesignCandidates(
  brief: ProductBrief,
): DesignCandidate[] {
  const object =
    brief.objectType === 'physical product' ? 'product' : brief.objectType;
  const base = [
    makeCandidate(
      'baseline-robust',
      `${object} robust baseline`,
      'baseline robust parametric design',
      [
        'Prioritizes simple manifold geometry, conservative walls, and easy preview/export.',
      ],
    ),
    makeCandidate(
      'print-optimized',
      `${object} print-optimized`,
      'print-optimized low-support design',
      [
        'Chooses orientations, splits, and overhang reductions that should slice reliably on FDM.',
      ],
    ),
    makeCandidate(
      'material-efficient',
      `${object} material-efficient`,
      'material-efficient hollow/ribbed design',
      [
        'Uses shells, ribs, and cavities to reduce filament while preserving stiffness.',
      ],
    ),
    makeCandidate(
      'premium-visible',
      `${object} premium exterior`,
      'premium/aesthetic visible-shell design',
      [
        'Keeps structural mechanics hidden behind a cleaner external silhouette.',
      ],
    ),
    makeCandidate(
      'modular-repairable',
      `${object} modular repairable`,
      'modular/repairable assembly design',
      [
        'Separates hidden structural inserts, visible shells, and replaceable connectors when useful.',
      ],
    ),
  ];

  if (brief.objectType === 'lamp') {
    base.push(
      makeCandidate(
        'lamp-ballast-insert',
        'lamp ballast insert architecture',
        'lamp-specific PLA shell + PETG insert + ballast cavities',
        [
          'Explicitly models PLA outer shell, PETG inner skeleton, snap/click fit, cable path, holder clearance, vents, and ballast reservoirs.',
        ],
      ),
    );
  }

  if (brief.objectType === 'enclosure') {
    base.push(
      makeCandidate(
        'enclosure-serviceable-snap',
        'serviceable electronics enclosure',
        'two-part enclosure with snap tabs, screw bosses, vents, and cable exits',
        [
          'Balances snap-fit convenience with screw-boss fallback, PCB standoffs, ventilation, and labelled clearances.',
        ],
      ),
    );
  }

  if (brief.objectType === 'connector/fixture') {
    base.push(
      makeCandidate(
        'fixture-load-path',
        'load-path optimized fixture',
        'bracket/fixture with reinforced bosses, screw slots, ribs, and printable flexures',
        [
          'Keeps forces flowing through ribs and bosses while exposing clearance and fastener parameters.',
        ],
      ),
    );
  }

  if (brief.objectType === 'jig/fixture') {
    base.push(
      makeCandidate(
        'jig-accurate-guide',
        'accurate workshop jig',
        'datum-driven jig with bushings, registration faces, clamps, and tolerance offsets',
        [
          'Prioritizes repeatable datums, replaceable wear inserts, and clear alignment features over ornament.',
        ],
      ),
    );
  }

  if (brief.objectType === 'mechanism') {
    base.push(
      makeCandidate(
        'mechanism-clearance-prototype',
        'clearance-first mechanism prototype',
        'mechanism with exposed pivots, stops, service gaps, and iteration-friendly parameters',
        [
          'Treats friction, layer orientation, axle clearance, and sacrificial iteration features as first-class constraints.',
        ],
      ),
    );
  }

  return base;
}

function scoreFromCode(
  candidate: DesignCandidate,
  brief: ProductBrief,
): CandidateScore {
  const code = (candidate.cadCode ?? '').toLowerCase();
  const strategy = candidate.strategy.toLowerCase();
  const mentions = (terms: RegExp) => terms.test(code) || terms.test(strategy);
  const wallThin = /wall_?thickness\s*=\s*(0?\.\d|1(?:\.\d)?)/.test(code);
  const hasParams = /[a-z][a-z0-9_]+\s*=/.test(code);
  const hasModules = /module\s+[a-z0-9_]+/.test(code);

  const score: CandidateScore = {
    geometricValidity: hasModules || code.length === 0 ? 7 : 5,
    printability:
      6 +
      (mentions(/print|fdm|overhang|support|orientation|wall/) ? 1 : 0) -
      (wallThin ? 3 : 0),
    robustness:
      5 +
      (mentions(/rib|gusset|boss|insert|petg|reinforce|structural/) ? 2 : 0),
    manufacturability:
      6 + (mentions(/clearance|tolerance|assembly|split|part/) ? 1 : 0),
    materialEfficiency:
      5 + (mentions(/hollow|cavity|void|rib|ballast/) ? 2 : 0),
    assemblyEase: 5 + (mentions(/snap|click|clip|screw|pin|clearance/) ? 2 : 0),
    parametricity: hasParams ? 8 : 4,
    aestheticFit: 5 + (mentions(/shell|aesthetic|premium|visible/) ? 2 : 0),
    stability: 5 + (mentions(/ballast|base|center|weight|lastre/) ? 2 : 0),
    toleranceRisk:
      7 -
      (mentions(/snap|click|press/) && !mentions(/clearance|tolerance/)
        ? 2
        : 0),
    overall: 0,
  };

  if (
    brief.cavities.length > 0 &&
    !mentions(/cavity|void|ballast|hollow|lastre/)
  )
    score.materialEfficiency -= 2;
  if (
    brief.assemblyRequirements.length > 0 &&
    !mentions(/snap|click|clip|screw|pin|assembly|clearance/)
  )
    score.assemblyEase -= 2;

  const entries = Object.entries(score).filter(
    ([key]) => key !== 'overall',
  ) as [keyof CandidateScore, number][];
  score.overall = Number(
    (
      entries.reduce(
        (sum, [, value]) => sum + Math.max(0, Math.min(10, value)),
        0,
      ) / entries.length
    ).toFixed(2),
  );
  return score;
}

export function rankDesignCandidates(
  candidates: DesignCandidate[],
  brief: ProductBrief = extractProductBrief(''),
): DesignCandidate[] {
  return candidates
    .map((candidate) => {
      const score = scoreFromCode(candidate, brief);
      const warnings = [...candidate.warnings];
      const code = (candidate.cadCode ?? '').toLowerCase();
      if (/wall_?thickness\s*=\s*(0?\.\d|1(?:\.\d)?)/.test(code)) {
        warnings.push(
          'Wall thickness appears too thin for robust FDM mechanical parts.',
        );
      }
      if (/snap|click|press/.test(code) && !/clearance|tolerance/.test(code)) {
        warnings.push(
          'Snap/click feature lacks explicit clearance/tolerance parameters.',
        );
      }
      if (
        brief.objectType === 'lamp' &&
        !/vent|heat|clearance|cable|holder/.test(code) &&
        candidate.cadCode
      ) {
        warnings.push(
          'Lamp design should include heat/electrical clearance and cable/holder assumptions.',
        );
      }
      return { ...candidate, score, warnings };
    })
    .sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0));
}

export function summarizeZooWorkflowTrace(
  traceMarkdown: string,
): ZooWorkflowSummary {
  const text = traceMarkdown.replace(/\s+/g, ' ');
  const activated = Array.from(
    text.matchAll(/Activating skill:\s*([a-z0-9-]+)/gi),
  ).map((match) => match[1]);
  return {
    observableSkillRouting: unique([
      ...activated.map((skill) => `visible activation of ${skill}`),
      /mechanical/i.test(text)
        ? 'mechanical-engineering capability appears in visible routing'
        : '',
      /knowledge|samples/i.test(text)
        ? 'knowledge/sample search is part of the visible workflow'
        : '',
    ]),
    observableDesignStages: unique([
      /Reading user selections/i.test(text)
        ? 'reads current user selection/project context before editing'
        : '',
      /Listing project files/i.test(text)
        ? 'lists project files and attachments'
        : '',
      /Read:/i.test(text)
        ? 'reads existing CAD files before proposing changes'
        : '',
      /built-in samples|knowledge sources/i.test(text)
        ? 'searches knowledge/samples for analogous CAD features'
        : '',
      /Export current part/i.test(text)
        ? 'supports current-part export as a workflow endpoint'
        : '',
    ]),
    observableMechanicalConsiderations: unique([
      /snap|click|detent|clip/i.test(text)
        ? 'snap/click/detent mechanisms are explicit design concerns'
        : '',
      /ballast|lastre|yeso|cavit/i.test(text)
        ? 'ballast cavities and internal volume are explicit design concerns'
        : '',
      /PLA|PETG/i.test(text)
        ? 'visible/material split between PLA and PETG is considered'
        : '',
      /center of mass|volume|surface area/i.test(text)
        ? 'derived properties such as volume, surface area, and center of mass are exposed'
        : '',
    ]),
    observableCadGenerationPatterns: unique([
      /sketch|extrude|revolve|fillet|chamfer|shell|hole/i.test(text)
        ? 'feature-based CAD operations are available in the visible interface'
        : '',
      /kcl/i.test(text)
        ? 'parametric KCL files and variables are the visible source artifact'
        : '',
      /appearance|color/i.test(text)
        ? 'visual material/appearance metadata is part of generated code'
        : '',
      /project files/i.test(text)
        ? 'multi-file assemblies are a normal project shape'
        : '',
    ]),
    observableProjectStateUse: unique([
      /user selections/i.test(text) ? 'current selection state is read' : '',
      /Project Files/i.test(text)
        ? 'project file tree influences the workflow'
        : '',
      /attachments|image/i.test(text)
        ? 'attachments/images are accepted as reference context'
        : '',
    ]),
    observableValidationOrRepair: unique([
      /Logs|View KCL source code|Export part/i.test(text)
        ? 'logs/source/export affordances support validation loops'
        : '',
      /Supplemental analysis/i.test(text)
        ? 'post-generation analysis is visible as a companion capability'
        : '',
    ]),
    cadamImprovementOpportunities: [
      'Add structured product brief extraction before CAD generation.',
      'Generate and rank multiple candidate strategies instead of one immediate artifact for complex product prompts.',
      'Surface mechanical warnings for walls, snaps, tolerances, ballast, cable paths, and heat-sensitive lamp features.',
      'Preserve candidate families/branches so selected winners can evolve through follow-up generations.',
      'Keep optional image/visual critique behind provider readiness checks and graceful fallbacks.',
    ],
    limitations: [
      'Summary is inferred only from visible trace text and UI/action labels.',
      'No hidden chain-of-thought, private prompts, APIs, or proprietary implementation details are used.',
      'Trace snippets are noisy UI exports, so counts and stages are heuristic rather than authoritative telemetry.',
    ],
  };
}

export function buildCandidateGenerationPrompt({
  originalPrompt,
  brief,
  candidate,
  extraInstructions,
}: CandidateGenerationPromptInput): string {
  const score = candidate.score
    ? `overall ${candidate.score.overall}/10`
    : 'not scored';
  const list = (label: string, values: string[]) =>
    values.length > 0
      ? `- ${label}: ${values.join('; ')}`
      : `- ${label}: not specified; infer conservative defaults and expose them as parameters`;

  return [
    'Use CADAM parametric mode to generate editable OpenSCAD for the selected product-design candidate.',
    '',
    `Original user prompt: ${originalPrompt}`,
    '',
    'Product brief:',
    `- object type: ${brief.objectType}`,
    `- intended use: ${brief.intendedUse ?? 'not specified'}`,
    `- manufacturing: ${brief.manufacturing ?? 'FDM 3D printing'}`,
    `- dimensions: ${JSON.stringify(brief.dimensions)}`,
    `- materials: ${JSON.stringify(brief.materials)}`,
    list('robustness requirements', brief.robustnessRequirements),
    list('assembly requirements', brief.assemblyRequirements),
    list('cavities/internal volumes', brief.cavities),
    list('constraints', brief.constraints),
    list('aesthetic goals', brief.aestheticGoals),
    list('safety constraints', brief.safetyConstraints),
    list('unknowns to keep parametric', brief.unknowns),
    '',
    'Selected design candidate:',
    `- id: ${candidate.id}`,
    `- title: ${candidate.title}`,
    `- strategy: ${candidate.strategy}`,
    `- score: ${score}`,
    `- notes: ${candidate.notes.join('; ') || 'none'}`,
    `- warnings: ${candidate.warnings.join('; ') || 'none'}`,
    '',
    'CAD output requirements:',
    '- Return one self-contained OpenSCAD file with a top-level PART selector and assembly preview.',
    '- Use millimeters and grouped Customizer parameters for primary dimensions, wall thickness, tolerances, clearances, fasteners, ribs, cavities, and material-specific parts.',
    '- Include printability notes in comments: orientation, supports, material assumptions, and clearance tuning.',
    '- Prefer simple manifold boolean structure, named modules, and repairable subassemblies over decorative one-shot geometry.',
    '- If a requirement is unsafe or underspecified, encode a conservative default as a parameter and explain it in comments rather than silently dropping it.',
    extraInstructions ? `\nExtra instructions:\n${extraInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function vertexGeminiReadiness(
  env: Record<string, string | undefined> = typeof process === 'undefined'
    ? {}
    : process.env,
): { available: boolean; missing: string[]; model: string; location: string } {
  const required = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION'];
  const missing = required.filter((key) => !env[key]);
  const hasApiKeyOrAdc = Boolean(
    env.GOOGLE_API_KEY ||
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.GOOGLE_GENAI_USE_VERTEXAI,
  );
  if (!hasApiKeyOrAdc)
    missing.push(
      'GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS/GOOGLE_GENAI_USE_VERTEXAI',
    );
  return {
    available: missing.length === 0,
    missing,
    model: env.VERTEX_GEMINI_MODEL ?? 'gemini-3.1-pro-preview',
    location: env.GOOGLE_CLOUD_LOCATION ?? 'global',
  };
}
