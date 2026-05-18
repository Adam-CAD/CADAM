import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import type { MeshFileType, Model } from './types.ts';
import { parametricArtifactSchema } from './parametricSchema.ts';
export {
  parameterSchema,
  parametricArtifactSchema,
  parametricPartSchema,
} from './parametricSchema.ts';

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

export const parametricCompileOutputSchema = z.object({
  status: z.literal('success'),
  message: z.string(),
  previewPath: z.string().optional(),
});

export const chatTools = {
  build_parametric_model: tool({
    description:
      'Create or update the complete OpenSCAD CAD artifact for the user.',
    inputSchema: parametricArtifactSchema,
    outputSchema: parametricCompileOutputSchema,
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

export type AppDataTypes = {
  'mesh-context': MeshContextData;
  'mesh-preferences': MeshPreferencesData;
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
  },
  AppDataTypes,
  AppTools
>;
