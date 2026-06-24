import { env } from './env.ts';
import type { AppUIMessage } from '@shared/chatAi';

export function reformatSignedUrl(signedUrl: string): string {
  const supabaseHost = (
    env('ENVIRONMENT') === 'local' ? env('NGROK_URL') : env('VITE_SUPABASE_URL')
  ).trim();

  const url = new URL(signedUrl);
  return `${supabaseHost}${url.pathname}${url.search}`;
}

/**
 * Latest `build_parametric_model` with `output-available` on the branch.
 * `buildHydratedMessages` uses this so local parametric only re-downloads
 * one inspection preview per request (newest-to-oldest walk).
 */
export function findLatestBuildToolCallId(
  messages: AppUIMessage[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex--
    ) {
      const part = message.parts[partIndex];
      if (
        part.type === 'tool-build_parametric_model' &&
        part.state === 'output-available' &&
        'toolCallId' in part &&
        typeof part.toolCallId === 'string'
      ) {
        return part.toolCallId;
      }
    }
  }
  return null;
}
