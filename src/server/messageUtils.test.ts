import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppUIMessage } from '@shared/chatAi';
import { findLatestBuildToolCallId } from './messageUtils.ts';

function buildToolPart(
  toolCallId: string,
  state:
    | 'output-available'
    | 'input-available'
    | 'output-error' = 'output-available',
): AppUIMessage['parts'][number] {
  return {
    type: 'tool-build_parametric_model',
    toolCallId,
    state,
    input: { code: 'cube(1);' },
    ...(state === 'output-available'
      ? {
          output: {
            status: 'success' as const,
            message: 'ok',
            inspection: { views: ['ISO'] as const, imageAttached: true },
          },
        }
      : state === 'output-error'
        ? { errorText: 'failed' }
        : {}),
  } as AppUIMessage['parts'][number];
}

describe('findLatestBuildToolCallId', () => {
  it('returns null for an empty branch', () => {
    assert.equal(findLatestBuildToolCallId([]), null);
  });

  it('returns the only completed build tool call', () => {
    const messages: AppUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [buildToolPart('call-1')],
      },
    ];
    assert.equal(findLatestBuildToolCallId(messages), 'call-1');
  });

  it('returns the latest build across assistant messages', () => {
    const messages: AppUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [buildToolPart('call-1')],
      },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'taller' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [buildToolPart('call-2')],
      },
    ];
    assert.equal(findLatestBuildToolCallId(messages), 'call-2');
  });

  it('returns the last completed build part within one assistant message', () => {
    const messages: AppUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [buildToolPart('call-1'), buildToolPart('call-2')],
      },
    ];
    assert.equal(findLatestBuildToolCallId(messages), 'call-2');
  });

  it('ignores non-output build tool parts', () => {
    const messages: AppUIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          buildToolPart('call-error', 'output-error'),
          buildToolPart('call-pending', 'input-available'),
          buildToolPart('call-done'),
        ],
      },
    ];
    assert.equal(findLatestBuildToolCallId(messages), 'call-done');
  });
});
