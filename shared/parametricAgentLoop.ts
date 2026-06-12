import type { AppUIMessage } from './chatAi.ts';
import { hasSuccessfulParametricBuild } from './parametricParts.ts';

type ToolMessagePart = Extract<
  AppUIMessage['parts'][number],
  { state: string }
>;

function isToolMessagePart(
  part: AppUIMessage['parts'][number],
): part is ToolMessagePart {
  return part.type.startsWith('tool-') && 'state' in part;
}

/**
 * Whether the parametric agent loop should auto-resubmit after the latest
 * assistant message. Mirrors the client `sendAutomaticallyWhen` gate in
 * ChatSession so the behavior stays unit-testable.
 */
export function shouldAutoContinueParametricBuild(
  messages: AppUIMessage[],
): boolean {
  const message = messages[messages.length - 1];
  if (!message || message.role !== 'assistant') return false;

  if (
    message.parts.some(
      (part) =>
        part.type === 'tool-answer_user' && part.state === 'output-available',
    )
  ) {
    return false;
  }

  const lastStepStartIndex = message.parts.reduce(
    (lastIndex, part, index) =>
      part.type === 'step-start' ? index : lastIndex,
    -1,
  );
  const toolParts = message.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolMessagePart);

  if (toolParts.length === 0) return false;

  const allResolved = toolParts.every(
    (part) =>
      part.state === 'output-available' || part.state === 'output-error',
  );
  if (!allResolved) return false;

  const answerUserPart = toolParts.find(
    (part) => part.type === 'tool-answer_user',
  );
  const hasBuildPart = toolParts.some(
    (part) => part.type === 'tool-build_parametric_model',
  );

  if (
    answerUserPart?.state === 'output-error' &&
    !hasSuccessfulParametricBuild(message.parts)
  ) {
    return true;
  }

  return hasBuildPart && !answerUserPart && allResolved;
}
