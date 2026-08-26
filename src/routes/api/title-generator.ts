import { createFileRoute } from '@tanstack/react-router';

import { createAnthropicText } from '@/server/anthropic';
import {
  isRecord,
  isUnauthorizedError,
  json,
  methodNotAllowed,
  preflight,
  requireUser,
} from '@/server/api';

const TITLE_SYSTEM_PROMPT =
  'Generate a concise, descriptive title under 80 characters for this ' +
  'CAD conversation. Return only the title. If unclear, return ' +
  '"New Conversation".';

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .flatMap((part) =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n')
    .trim();
}

function textFromChatCompletion(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const choices = data.choices;
  if (!Array.isArray(choices)) return null;
  const first: unknown = choices[0];
  const message = isRecord(first) ? first.message : null;
  const content = isRecord(message) ? message.content : null;
  return typeof content === 'string' ? content : null;
}

function textFromGemini(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const candidates = data.candidates;
  if (!Array.isArray(candidates)) return null;
  const first: unknown = candidates[0];
  const content = isRecord(first) ? first.content : null;
  const parts = isRecord(content) ? content.parts : null;
  if (!Array.isArray(parts)) return null;
  const part: unknown = parts[0];
  const value = isRecord(part) ? part.text : null;
  return typeof value === 'string' ? value : null;
}

async function openRouterTitle(text: string): Promise<string | null> {
  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-5.6-sol',
        max_tokens: 100,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    },
  );
  if (!response.ok) return null;
  return textFromChatCompletion(await response.json());
}

async function googleTitle(text: string): Promise<string | null> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    'gemini-3.8-flash:generateContent';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GOOGLE_API_KEY ?? '',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TITLE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 100 },
    }),
  });
  if (!response.ok) return null;
  return textFromGemini(await response.json());
}

/**
 * Generate a title with whichever provider is configured.
 *
 * Anthropic stays the default (unchanged for the hosted app). A self-hosted
 * instance configured only with an OpenRouter or Google key would otherwise
 * get every conversation stuck on "New Conversation", since the previous
 * implementation always called Anthropic. Fall back to those providers — the
 * same set the chat supports, where OpenAI models are served through
 * OpenRouter — when no Anthropic key is set. Returns null when none is set.
 */
async function generateTitleText(text: string): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropicText({
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 100,
      system: TITLE_SYSTEM_PROMPT,
      content: text,
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    return openRouterTitle(text);
  }

  if (process.env.GOOGLE_API_KEY) {
    return googleTitle(text);
  }

  return null;
}

export const Route = createFileRoute('/api/title-generator')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          await requireUser(request);
        } catch (err) {
          if (isUnauthorizedError(err)) {
            return json({ error: 'Unauthorized' }, 401);
          }
          throw err;
        }

        try {
          const body: unknown = await request.json();
          if (!isRecord(body)) return json({ title: 'New Conversation' });
          const trimmedText =
            typeof body.text === 'string' ? body.text.trim() : '';
          const text = trimmedText || textFromParts(body.parts);
          if (!text) return json({ title: 'New Conversation' });

          const title = await generateTitleText(text);
          return json({ title: title?.trim() || 'New Conversation' });
        } catch {
          return json({ title: 'New Conversation' });
        }
      },
    },
  },
});
