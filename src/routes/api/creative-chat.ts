import { createFileRoute } from '@tanstack/react-router';
import { handleAiChatRequest } from '@/server/aiChat';

export const Route = createFileRoute('/api/creative-chat')({
  server: {
    handlers: {
      GET: ({ request }) => handleAiChatRequest(request),
      POST: ({ request }) => handleAiChatRequest(request),
      OPTIONS: ({ request }) => handleAiChatRequest(request),
    },
  },
});
