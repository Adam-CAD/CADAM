import { createFileRoute } from '@tanstack/react-router';
import { localModelToPickerConfig } from '@shared/localModels';
import { getLocalChatState } from '@/server/localChatConfig';
import { json, preflight } from '@/server/api';

export const Route = createFileRoute('/api/local-models')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async () => {
        const { activeCatalog } = getLocalChatState();
        return json(activeCatalog.map(localModelToPickerConfig));
      },
    },
  },
});
