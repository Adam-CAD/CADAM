import { Database } from './database.ts';
import type { AppUIMessage } from './chatAi.ts';
export type Model = string;
export type CreativeModel = 'quality' | 'fast' | 'ultra';

export type Prompt = {
  text?: string;
  images?: string[];
  mesh?: string;
  model?: Model;
};

type MessageRow = Database['public']['Tables']['messages']['Row'];

export type Message = Pick<
  MessageRow,
  'conversation_id' | 'created_at' | 'id' | 'parent_message_id' | 'rating'
> & {
  role: 'user' | 'assistant';
  metadata: AppUIMessage['metadata'];
  parts: AppUIMessage['parts'];
};

export type MeshFileType = Database['public']['Enums']['mesh_file_type'];

export type Mesh = {
  id: string;
  fileType: MeshFileType;
};

export type MeshData = Omit<
  Database['public']['Tables']['meshes']['Row'],
  'prompt'
> & {
  prompt: Prompt;
};

export type ParametricArtifact = {
  title: string;
  version: string;
  code: string;
  // Model-authored typed interface for the top-of-file variables in `code`.
  // Optional (and nullish-tolerant) so artifacts persisted before the schema
  // existed — and models that omit it — keep working via the Customizer
  // comment fallback in `parseParameters`. See `applyParameterSpecs`.
  parameters?: ParameterSpec[] | null;
};

/**
 * One entry of the structured parameter schema the model emits alongside
 * the OpenSCAD source in `build_parametric_model`. The code remains the
 * ground truth for which variables exist and their current values; specs
 * carry the presentation metadata (ranges, units, labels, groups, enum
 * options) that previously had to be reverse-engineered from Customizer
 * comments by regex.
 */
export type ParameterSpec = {
  /** Exact name of the top-of-file OpenSCAD variable this spec describes. */
  name: string;
  /** Display name for the parameter panel; defaults to a title-cased name. */
  label?: string;
  type?: 'number' | 'string' | 'boolean';
  description?: string;
  /** Section heading grouping related parameters. */
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Physical unit shown next to the value, e.g. "mm" or "deg". */
  unit?: string;
  /**
   * Allowed values for enum-style parameters. Values are strings exactly as
   * they appear in the source (numbers as plain strings) — kept union-free
   * so every provider's JSON-schema subset accepts the tool definition.
   */
  options?: { value: string; label?: string }[];
};

export type ParameterOption = { value: string | number; label: string };

export type ParameterRange = { min?: number; max?: number; step?: number };

export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export type Parameter = {
  name: string;
  displayName: string;
  value: string | boolean | number | string[] | number[] | boolean[];
  defaultValue: string | boolean | number | string[] | number[] | boolean[];
  // Type should always exist, but old messages don't have it.
  type?: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
  /** Physical unit from the model-authored spec, e.g. "mm" or "deg". */
  unit?: string;
};

export type Conversation = Omit<
  Database['public']['Tables']['conversations']['Row'],
  'settings'
> & {
  settings: ConversationSettings;
};

export type GenerationStatus = Database['public']['Enums']['generation-status'];

export type ConversationSettings = {
  model?: Model;
  /**
   * Per-conversation follow-up suggestions rendered as pills above the
   * chat input. Regenerated server-side after each non-tool-call
   * assistant turn — see `emitConversationSuggestions` in
   * `src/server/aiChat.ts`.
   */
  suggestions?: string[];
} | null;

export type Profile = Database['public']['Tables']['profiles']['Row'];
