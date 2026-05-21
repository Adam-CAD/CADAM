# CADAM Product Designer

This document describes a general CADAM improvement layer for text-to-CAD product work. It is not tied to any single lamp, client project, or model family.

## Purpose

CADAM should act less like a one-shot CAD code generator and more like a product-design assistant:

1. read the user's product request;
2. extract a structured brief;
3. propose several mechanically different candidate strategies;
4. rank them by printability, robustness, manufacturability, tolerances, assembly, parametricity, and aesthetics;
5. turn the selected candidate into an enriched OpenSCAD prompt;
6. later validate generated CAD with geometry/export/slicing feedback.

## Source of inspiration: Zoo/KCL visible trace

The reference file analyzed for this work is:

`/home/juanpighelfi/Documents/CADAM+/zookeeper-trace .md`

Only visible trace data was used: tool names, skill activations, UI/action labels, file reads, exports, visible KCL terms, and observable workflow steps. No hidden chain-of-thought is used, copied, inferred, or required.

Observable patterns extracted from the trace include:

- explicit routing into CAD/mechanical/knowledge capabilities;
- reading current selections and project files before editing;
- searching knowledge sources and built-in samples;
- working with parametric source artifacts;
- exporting current parts;
- using validation loops and repair loops;
- exposing or considering volume, surface area, center of mass, snap/click fits, ballast cavities, material splits, and mechanical constraints.

## Implemented architecture

Core module:

`shared/cadamProductDesigner.ts`

Responsibilities:

- `extractProductBrief(prompt)`: creates a structured brief from natural language.
- `proposeDesignCandidates(brief)`: creates multiple candidate architectures.
- `rankDesignCandidates(candidates, brief)`: scores and sorts candidates.
- `buildCandidateGenerationPrompt(input)`: converts a selected candidate into a generation-ready OpenSCAD prompt.
- `summarizeZooWorkflowTrace(markdown)`: summarizes visible Zoo/KCL trace patterns.
- `vertexGeminiReadiness(env)`: checks optional Gemini/Vertex readiness without calling the provider or exposing secrets.
- `PRODUCT_DESIGNER_PROMPT_EXTENSION`: extends CADAM parametric chat behavior.

Server endpoint:

`src/server/productDesignPlan.ts`

Route:

`src/routes/api/product-design-plan.ts`

Endpoint:

`POST /cadam/api/product-design-plan`

Web UI:

`src/views/ProductDesignerView.tsx`

Route:

`/cadam/product-designer`

The web page lets a user submit a product request, inspect the extracted brief, compare ranked candidate strategies, copy an enriched prompt for CAD generation, or use `Start CAD generation` to create a normal CADAM parametric conversation from the selected candidate.

## API usage

```bash
curl -sS http://127.0.0.1:3000/cadam/api/product-design-plan \
  -H 'content-type: application/json' \
  -d '{"prompt":"soporte de pared FDM con tornillos M4, clip flexible y tolerancia ajustable"}'
```

Response shape:

- `brief`: structured product brief;
- `candidates`: ranked design candidates;
- `generationPrompts`: candidate id to enriched OpenSCAD generation prompt;
- `traceSummary`: only present when `traceMarkdown` is provided;
- `gemini`: readiness status only.

## Product families to support

The layer should be useful for many models, including:

- brackets and wall mounts;
- electronics enclosures;
- snap-fit cases;
- jigs and fixtures;
- drilling guides;
- simple mechanisms;
- clips and fasteners;
- aesthetic shells over hidden inserts;
- multipart assemblies;
- weighted bases or stability-critical products;
- printable adapters and repair parts.

## Optional Gemini/Vertex role

Gemini/Vertex is optional. The baseline must work offline with heuristics and the configured CADAM provider stack.

When available, Gemini can be added later as:

- visual/reference reviewer;
- candidate proposer;
- CAD prompt critic;
- mechanical-risk reviewer;
- comparison judge between generated renders and source images.

The readiness helper only returns missing variable names and non-secret settings. It must never print API keys, tokens, credential JSON, connection strings, or private local paths containing secrets.

## Current limitations

Implemented now:

- general brief extraction;
- candidate generation and ranking;
- enriched prompt creation;
- visible-trace summarization;
- endpoint;
- web page;
- direct `Start CAD generation` action from a selected candidate into the normal CADAM parametric chat;
- localStorage branch persistence for selected candidate prompts;
- parametric system-prompt extension;
- offline tests.

Still to build:

- server-side branch/generation history beyond localStorage and conversation/message metadata;
- generated CAD validation with compile/export feedback;
- volume/bounding-box/center-of-mass analysis;
- slicer/printability gates;
- visual comparison loop for image references;
- real skill/tool router beyond prompt extension and heuristics;
- optional Gemini reviewer/proposer loop.

## Verification commands

```bash
node --experimental-strip-types scripts/test-cadam-product-designer.mjs
node --experimental-strip-types scripts/test-cadam-product-designer-v2.mjs
node --experimental-strip-types scripts/test-cadam-product-designer-v3.mjs
node --experimental-strip-types scripts/test-cadam-product-designer-v4.mjs
npm run typecheck
npm run lint
npm run build
```

TanStack route tree note: after adding a route, start Vite once so `src/routeTree.gen.ts` is regenerated, then rerun typecheck.
