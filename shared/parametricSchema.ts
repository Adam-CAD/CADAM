import { z } from 'zod';
import type { Parameter, ParametricPart } from './types.ts';

const parameterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

export const parameterSchema: z.ZodType<Parameter> = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
    .describe('Exact OpenSCAD variable name declared at the top of code.'),
  displayName: z.string().min(1),
  value: parameterValueSchema,
  defaultValue: parameterValueSchema,
  type: z
    .enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'])
    .optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  range: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
    })
    .optional(),
  options: z
    .array(
      z.object({
        value: z.union([z.string(), z.number()]),
        label: z.string().min(1),
      }),
    )
    .optional(),
  maxLength: z.number().optional(),
});

export const parametricPartSchema: z.ZodType<ParametricPart> = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .describe('Stable snake_case identifier for this part.'),
  displayName: z.string().min(1),
  description: z.string().min(1),
  colorParameter: z.string().optional(),
  parameterNames: z
    .array(z.string())
    .describe('Exact parameter names that control this part.'),
});

export const parametricArtifactSchema = z.object({
  title: z.string().min(1),
  version: z.string().default('v1'),
  code: z.string().min(20),
  parameters: z.array(parameterSchema),
  parts: z.array(parametricPartSchema).optional(),
  suggestions: z.array(z.string()).optional(),
});
