import { useConversation } from '@/contexts/ConversationContext';
import { CREATIVE_MODELS, PARAMETRIC_MODELS } from '@/lib/utils';
import { Message } from '@shared/types';

export function ModelButton({ message }: { message: Message }) {
  const { conversation } = useConversation();
  let model;
  if (conversation.type === 'parametric') {
    model =
      PARAMETRIC_MODELS.find((model) => model.id === message.content.model) ||
      PARAMETRIC_MODELS[0];
  } else {
    model =
      CREATIVE_MODELS.find((model) => model.id === message.content.model) ||
      CREATIVE_MODELS[0];
  }

  return (
    <span className="h-6 w-fit text-nowrap rounded-lg border border-adam-neutral-700 bg-adam-bg-secondary-dark px-2 pb-0.5 pt-1 text-xs text-adam-text-primary transition-all duration-100 ease-in-out">
      {model.name}
    </span>
  );
}
