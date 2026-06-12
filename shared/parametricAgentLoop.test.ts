import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppUIMessage } from './chatAi.ts';
import { shouldAutoContinueParametricBuild } from './parametricAgentLoop.ts';

function assistant(parts: AppUIMessage['parts']): AppUIMessage[] {
  return [{ id: 'a1', role: 'assistant', parts, metadata: {} }];
}

describe('shouldAutoContinueParametricBuild', () => {
  it('continues after a successful build awaiting inspection', () => {
    assert.equal(
      shouldAutoContinueParametricBuild(
        assistant([
          {
            type: 'tool-build_parametric_model',
            toolCallId: 't1',
            state: 'output-available',
            input: {
              title: 'Stand',
              version: 'v1',
              code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
            },
            output: { status: 'success', message: 'ok' },
          },
        ]),
      ),
      true,
    );
  });

  it('continues after answer_user is rejected before any successful build', () => {
    assert.equal(
      shouldAutoContinueParametricBuild(
        assistant([
          {
            type: 'tool-answer_user',
            toolCallId: 't1',
            state: 'output-error',
            input: { message: 'Done.' },
            errorText: 'build first',
          },
        ]),
      ),
      true,
    );
  });

  it('stops once answer_user succeeds', () => {
    assert.equal(
      shouldAutoContinueParametricBuild(
        assistant([
          {
            type: 'tool-build_parametric_model',
            toolCallId: 't1',
            state: 'output-available',
            input: {
              title: 'Stand',
              version: 'v1',
              code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
            },
            output: { status: 'success', message: 'ok' },
          },
          {
            type: 'tool-answer_user',
            toolCallId: 't2',
            state: 'output-available',
            input: { message: 'Done.' },
            output: { message: 'Done.' },
          },
        ]),
      ),
      false,
    );
  });

  it('does not continue on plain text with no tool calls', () => {
    assert.equal(
      shouldAutoContinueParametricBuild(
        assistant([
          { type: 'text', text: 'Here is a phone stand.', state: 'done' },
        ]),
      ),
      false,
    );
  });
});
