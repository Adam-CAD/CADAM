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
  'Generate a concise, descriptive title under 80 characters for this CAD conversation. Return only the title. If unclear, return "New Conversation".';

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
          if (!isRecord(body)) {
            return json({ title: 'New Conversation' });
          }
          const trimmedText =
            typeof body.text === 'string' ? body.text.trim() : '';
          const text = trimmedText || textFromParts(body.parts);
          if (!text) return json({ title: 'New Conversation' });

          const title = await createAnthropicText({
            model: 'claude-haiku-4-5-20251001',
            maxTokens: 100,
            system: TITLE_SYSTEM_PROMPT,
            content: text,
          });
          return json({ title: title || 'New Conversation' });
        } catch {
          return json({ title: 'New Conversation' });
        }
      },
    },
  },
});
