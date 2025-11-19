import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ModelConfig } from '@/types/misc';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const PARAMETRIC_MODELS: ModelConfig[] = [
  {
    id: 'google/gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    description: 'Latest Google model with excellent multi-modal capabilities',
    provider: 'Google',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    description: 'Latest Anthropic model with reliable CAD generation',
    provider: 'Anthropic',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
  {
    id: 'openai/gpt-5.1',
    name: 'GPT-5.1',
    description: 'Most advanced OpenAI model',
    provider: 'OpenAI',
    supportsTools: true,
    supportsThinking: true,
    supportsVision: true,
  },
];
