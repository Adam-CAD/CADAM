/**
 * Utility functions for handling files
 */

import { Message } from '@shared/types';
import { getBuildParametricModelOutput } from '@shared/parametricParts';

/**
 * Creates a safe filename from a given string by removing/replacing invalid characters
 * @param baseFilename The original filename or title to sanitize
 * @param fallback Optional fallback string to use if baseFilename is empty
 * @returns A sanitized filename safe for saving to disk
 */
export function getSafeFilename(
  baseFilename: string,
  fallback?: string,
): string {
  // Use fallback if the baseFilename is empty
  const filename = baseFilename?.trim()
    ? baseFilename.trim()
    : fallback || 'file';

  // Replace any characters that aren't safe for filenames
  return filename
    .replace(/[/\\?%*:|"<>]/g, '-') // Replace invalid filename chars
    .replace(/\s+/g, '_'); // Replace spaces with underscores
}

/**
 * Extracts a meaningful filename from assistant message parts
 * @param message The assistant message to extract filename from
 * @param fallback Fallback filename if extraction fails
 * @returns A meaningful filename extracted from the message parts
 */
export function extractFilenameFromMessage(
  message: Message,
  fallback: string = 'model',
): string {
  let baseFilename = fallback;

  // For parametric messages, use the artifact title if available
  const artifact = getBuildParametricModelOutput(message.parts);
  const text = Array.isArray(message.parts)
    ? message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim()
    : '';

  if (artifact?.title) {
    baseFilename = artifact.title;
  } else if (text) {
    // Extract from the assistant message text
    const messageText = text;

    // Look for patterns like "Here is your [object name]" or similar
    const objectPatterns = [
      /here\s+is\s+your\s+(.+?)(?:\.|!|:|\n|$)/i,
      /i[''']?ve\s+created\s+(.+?)(?:\.|!|:|\n|$)/i,
      /created\s+(.+?)(?:\.|!|:|\n|$)/i,
      /made\s+(.+?)(?:\.|!|:|\n|$)/i,
      /generated\s+(.+?)(?:\.|!|:|\n|$)/i,
    ];

    for (const pattern of objectPatterns) {
      const match = messageText.match(pattern);
      if (match && match[1]) {
        baseFilename = match[1].trim();
        break;
      }
    }

    // If no pattern matched, use the first meaningful words from the message
    if (baseFilename === fallback) {
      const words = messageText
        .split(/\s+/)
        .filter(
          (word: string) =>
            word.length > 2 &&
            ![
              'the',
              'and',
              'for',
              'with',
              'your',
              'this',
              'that',
              'here',
              'there',
            ].includes(word.toLowerCase()),
        );

      if (words.length > 0) {
        baseFilename = words.slice(0, 3).join(' ');
      }
    }
  }

  return getSafeFilename(baseFilename);
}

/**
 * Checks if a conversation title is meaningful (not a default/generic title)
 * @param title The conversation title to check
 * @returns Whether the title is meaningful and can be used for filenames
 */
export function isMeaningfulTitle(title?: string): boolean {
  if (!title?.trim()) return false;

  const trimmed = title.trim();
  const defaultTitles = ['Chat', 'New Chat', 'Untitled', 'Conversation'];

  return !defaultTitles.includes(trimmed);
}

/**
 * Generates a meaningful filename for 3D model downloads
 * @param options Configuration object with title, message, modelName, and fallback
 * @returns A safe filename for the 3D model
 */
export function generate3DModelFilename({
  conversationTitle,
  assistantMessage,
  modelName,
  fallback = '3d-model',
}: {
  conversationTitle?: string;
  assistantMessage?: Message;
  modelName?: string;
  fallback?: string;
}): string {
  // First priority: use conversation title if meaningful
  if (isMeaningfulTitle(conversationTitle)) {
    return getSafeFilename(conversationTitle!);
  }

  // Second priority: extract from assistant message (most descriptive)
  if (assistantMessage) {
    return extractFilenameFromMessage(assistantMessage, fallback);
  }

  // Third priority: use model name if available
  if (modelName?.trim()) {
    return getSafeFilename(modelName);
  }

  // Final fallback
  return getSafeFilename(fallback);
}
