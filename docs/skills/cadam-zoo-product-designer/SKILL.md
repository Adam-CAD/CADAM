---
name: cadam-zoo-product-designer
description: Use when improving CADAM/text-to-CAD with a product-designer layer inspired by visible Zoo/KCL traces, or when using CADAM to plan printable parametric products through briefs, candidates, scoring, enriched prompts, web UI, and validation loops.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [cadam, text-to-cad, product-design, openscad, zoo-kcl]
    related_skills: [openscad-3d-print-modeling, test-driven-development]
---

# CADAM Zoo Product Designer

## Overview

Use this skill for CADAM work where the goal is a stronger text-to-CAD product-design workflow rather than a one-shot code generator. The approach is inspired by visible Zoo/KCL traces: observable tool calls, skill activations, project-file reads, source CAD edits, exports, and validation affordances.

Do not copy, infer, or claim hidden chain-of-thought. Use only visible trace artifacts and public UI/tool behavior.

## When to Use

Use when the user asks to:

- improve CADAM as a CAD/product-design system;
- build a web page or endpoint for CAD planning;
- analyze visible Zoo/KCL traces for workflow ideas;
- create general text-to-CAD product briefs and candidate strategies;
- rank printable/mechanical design variants;
- convert a selected strategy into an enriched OpenSCAD prompt;
- keep Gemini/Vertex optional and fallback-safe.

Do not use when:

- the task is only to model one object directly in OpenSCAD;
- the user wants private chain-of-thought extraction;
- there is no CADAM/text-to-CAD integration involved.

## Core Workflow

1. Read the user's CADAM brief and any visible trace file they provide.
2. Extract only observable workflow signals from traces:
   - skill/tool names;
   - file reads and project-state access;
   - CAD source operations;
   - export/validation actions;
   - repeated mechanical terms such as snap, click, cavity, volume, tolerance, center of mass.
3. Implement an offline, pure shared module first:
   - `extractProductBrief()`;
   - `proposeDesignCandidates()`;
   - `rankDesignCandidates()`;
   - `buildCandidateGenerationPrompt()`;
   - `summarizeZooWorkflowTrace()`;
   - provider readiness checks only.
4. Extend CADAM's parametric prompt without breaking existing creative flows.
5. Add a planning endpoint that does not require external providers.
6. Add a web UI where the user can submit many kinds of product prompts, compare candidates, and copy or send an enriched generation prompt.
7. Verify with tests, typecheck, lint, build, and a live endpoint call.

## Product Brief Fields

Track at least:

- object type;
- intended use;
- dimensions;
- materials;
- manufacturing process;
- robustness requirements;
- assembly requirements;
- cavities/internal volumes;
- constraints;
- inferred defaults;
- unknowns;
- aesthetic goals;
- safety caveats.

## Candidate Scoring

Score candidates by:

- geometric validity;
- printability;
- robustness;
- manufacturability;
- material efficiency;
- assembly ease;
- parametricity;
- aesthetic fit;
- stability;
- tolerance risk.

Use scores to guide the user, not to pretend there is certified engineering validation.

## Web UI Pattern

The first useful UI slice should include:

- a textarea with example prompts across multiple product families;
- an Analyze button that POSTs to `/api/product-design-plan`;
- a brief summary panel;
- ranked candidate cards;
- warnings and notes;
- a Generate CAD prompt action for each candidate;
- a copyable enriched prompt.

A later slice can send the selected candidate directly into the normal CADAM parametric chat and persist candidate branches.

## Gemini/Vertex Policy

Gemini is optional. The baseline must work without any Gemini credentials.

Use Gemini only as a readiness-gated enhancement for:

- visual review;
- reference-image critique;
- candidate proposal;
- prompt critique.

Never log or document secret values. If credentials appear, redact them as `[REDACTED]`.

## Verification Checklist

- [ ] Trace analysis is limited to visible Zoo/KCL artifacts.
- [ ] No hidden chain-of-thought is copied or claimed.
- [ ] Core planning logic is in a pure shared module.
- [ ] There is a test that fails before new behavior is implemented.
- [ ] Endpoint works without external provider calls.
- [ ] Web UI is general and not tied to a single product.
- [ ] Route tree is regenerated after adding TanStack routes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` has no new errors.
- [ ] `npm run build` passes.
- [ ] Final report distinguishes implemented features from future validation loops.

## Common Pitfalls

1. Overfitting examples to a single lamp or project. Keep examples varied: bracket, enclosure, jig, fixture, mechanism, adapter, multipart shell.
2. Treating trace text as private reasoning. Only use visible UI/tool/action evidence.
3. Calling Gemini in tests. Tests should be offline; Gemini readiness should be a data object.
4. Hand-editing generated route trees as the primary fix. Start Vite/TanStack to regenerate when possible.
5. Jumping directly to CAD generation. Planning, candidates, scoring, and enriched prompts make the CAD result more controllable.
