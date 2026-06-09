import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import type { MeshFileType, Model } from './types.ts';

export const createMeshInputSchema = z.object({
  text: z.string().optional(),
  imageIds: z.array(z.string()).optional(),
  meshId: z.string().optional(),
  model: z.enum(['fast', 'quality', 'ultra']).optional(),
  meshTopology: z.enum(['quads', 'polys']).optional(),
  polygonCount: z.number().optional(),
});

export const createMeshOutputSchema = z.object({
  id: z.string(),
  fileType: z.enum(['glb', 'stl', 'obj', 'fbx']),
});

/**
 * A malformed `parameters` entry must never fail tool-input validation:
 * an invalid input turns the whole build_parametric_model call into a
 * `dynamic-tool` part the client never compiles, silently killing the
 * build turn. So every field degrades instead of erroring:
 *  - numeric fields accept `"50"` (models routinely quote numbers) and
 *    drop to undefined on anything else (`null`, `""`, `1e309`, objects),
 *  - string fields drop to undefined on non-strings,
 *  - a spec entry with a broken `name` collapses to null, which the
 *    merge layer (`applyParameterSpecs`) skips.
 * `.catch`/`.preprocess` don't change the JSON schema advertised to
 * providers — they only relax what we accept back.
 */
const lenientNumber = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  z.number().finite().optional(),
);

export const parameterSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Exact name of the top-of-file OpenSCAD variable this entry describes.',
    ),
  label: z
    .string()
    .optional()
    .catch(undefined)
    .describe(
      'Display name shown in the parameter panel. Defaults to a title-cased variable name.',
    ),
  type: z.enum(['number', 'string', 'boolean']).optional().catch(undefined),
  description: z
    .string()
    .optional()
    .catch(undefined)
    .describe('One short sentence on what the parameter controls.'),
  group: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Section heading grouping related parameters.'),
  min: lenientNumber
    .catch(undefined)
    .describe('Slider minimum for number parameters.'),
  max: lenientNumber
    .catch(undefined)
    .describe('Slider maximum for number parameters.'),
  step: lenientNumber
    .catch(undefined)
    .describe('Slider step for number parameters.'),
  unit: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Physical unit such as "mm" or "deg". Omit for unitless values.'),
  options: z
    .array(
      z.object({
        // Accept numbers too (models routinely emit `value: 80` for
        // numeric enums) and normalize to string — the merge layer
        // re-types against the parsed parameter.
        value: z
          .union([z.string(), z.number()])
          .transform((value) => String(value))
          .describe(
            'Option value exactly as it appears in the OpenSCAD source.',
          ),
        label: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined)
    .describe('Allowed values for enum-style parameters.'),
});

export const parametricArtifactSchema = z.object({
  title: z.string().min(1),
  version: z.string().default('v1'),
  code: z.string().min(20),
  // Nullish (not just optional) so a model that emits an explicit `null`
  // doesn't fail tool-input validation and stall the agent loop, and
  // `.catch(null)` so a structurally broken array degrades to the
  // comment-derived fallback instead of killing the build call.
  parameters: z
    .array(parameterSpecSchema)
    .nullish()
    .catch(null)
    .describe(
      'Typed schema for every user-editable variable declared at the top of `code`. This is the source of truth for the parameter panel: ranges, units, enum options, grouping, descriptions. Every entry must reference a variable that exists in the code.',
    ),
});

export const parametricCompileOutputSchema = z.object({
  status: z.literal('success'),
  message: z.string(),
  inspection: z
    .object({
      views: z.array(
        z.enum(['ISO', 'FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM']),
      ),
      imageAttached: z.boolean(),
    })
    .optional(),
});

export const answerUserSchema = z.object({
  message: z.string().min(1),
});

export const chatTools = {
  build_parametric_model: tool({
    description:
      'Create or update the complete OpenSCAD CAD artifact, including the typed parameter schema that drives the parameter panel. After the browser compiles it, inspect the returned multi-view preview sheet and call this tool again if the model needs another revision.',
    inputSchema: parametricArtifactSchema,
    outputSchema: parametricCompileOutputSchema,
  }),
  answer_user: tool({
    description:
      'Send the final user-facing chat message. Use this for normal non-CAD replies, and after a CAD build when the multi-view preview satisfies the user request.',
    inputSchema: answerUserSchema,
    outputSchema: answerUserSchema,
  }),
  create_mesh: tool({
    description:
      'Create a 3D mesh from text, images, or an existing mesh plus edit instructions.',
    inputSchema: createMeshInputSchema,
    outputSchema: createMeshOutputSchema,
  }),
};

export type AppTools = InferUITools<typeof chatTools>;

export type MeshContextData = {
  meshId: string;
  fileType: MeshFileType;
  filename?: string;
  boundingBox?: { x: number; y: number; z: number };
};

export type MeshPreferencesData = {
  topology: 'quads' | 'polys';
  polygonCount: number;
};

/**
 * Conversation-level signals the server emits as transient stream parts
 * (`writer.write({ transient: true, type: 'data-X', data })`). Transient
 * parts never land in `messages.parts` — they're side-channel updates the
 * client folds straight into the conversation query cache.
 *
 *  * `title-update`    fires once when the server generates a title for
 *    a fresh conversation; client updates `conversations.title`.
 *  * `suggestions-update` fires after each assistant turn finishes;
 *    client updates `conversations.settings.suggestions` so the pills
 *    below the input refresh in lock-step with the response.
 */
export type ConversationTitleUpdate = {
  conversationId: string;
  title: string;
};
export type ConversationSuggestionsUpdate = {
  conversationId: string;
  suggestions: string[];
};

export type AppDataTypes = {
  'mesh-context': MeshContextData;
  'mesh-preferences': MeshPreferencesData;
  'title-update': ConversationTitleUpdate;
  'suggestions-update': ConversationSuggestionsUpdate;
};

export const meshContextDataSchema = z.object({
  meshId: z.string(),
  fileType: z.enum(['glb', 'stl', 'obj', 'fbx']),
  filename: z.string().optional(),
  boundingBox: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .optional(),
});

export const meshPreferencesDataSchema = z.object({
  topology: z.enum(['quads', 'polys']),
  polygonCount: z.number(),
});

export type AppUIMessage = UIMessage<
  {
    model?: Model;
    billingTokens?: number;
    // The model's original OpenSCAD for this message's artifact, captured
    // lazily on the FIRST parameter edit (see `persistParameterEdit`).
    // Parameter edits rewrite the live `tool-build_parametric_model` input
    // code in place, which would otherwise move the derived `defaultValue`
    // to the edited value on every reload. Stashing the original here —
    // message metadata is UI-only and NOT sent to the model by
    // `convertToModelMessages` — lets the client re-derive stable defaults
    // (Reset / slider home / auto range) with no second code copy in the
    // model's context, no migration, and no storage cost on the (common)
    // never-edited artifacts.
    originalCode?: string;
  },
  AppDataTypes,
  AppTools
>;
