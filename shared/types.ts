import { Database } from './database.ts';
export type Model = string;

export type Message = Omit<
  Database['public']['Tables']['messages']['Row'],
  'content' | 'role'
> & {
  role: 'user' | 'assistant';
  content: Content;
};

export type CoreMessage = Pick<Message, 'id' | 'role' | 'content'>;

export type ToolCall = {
  name: string;
  status: 'pending' | 'error';
  id?: string;
  result?: { id: string };
};

export type Content = {
  text?: string;
  model?: Model;
  // When the user sends an error, its related to the fix with AI function
  // When the assistant sends an error, its related to any error that occurred during generation
  error?: string;
  artifact?: ParametricArtifact;
  index?: number;
  images?: string[];
  mesh?: Mesh;
  // For streaming support - shows in-progress tool calls
  toolCalls?: ToolCall[];
  thinking?: boolean;
};

export type MeshFileType = string;

export type Mesh = {
  id: string;
  fileType: MeshFileType;
};

export type ParametricArtifact = {
  title: string;
  version: string;
  code: string;
  parameters: Parameter[];
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

export type Conversation = Database['public']['Tables']['conversations']['Row'];
