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
