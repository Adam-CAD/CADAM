import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanAssistantText,
  extractScadFromText,
  getAssistantSalvageText,
  isParametricArtifact,
  parametricTurnMissingBuild,
  shouldReportMissingParametricBuild,
} from './parametricParts.ts';

describe('parametric assistant text cleanup', () => {
  it('removes leaked view metadata before final prose', () => {
    assert.equal(
      cleanAssistantText(
        ', viewpoint_state:{"distance":624},"zoom_info":A fallback automatic framing was used instead.}ளர்This 12 DOF robot arm is ready.',
      ),
      'This 12 DOF robot arm is ready.',
    );
  });

  it('removes metadata-only fragments', () => {
    assert.equal(
      cleanAssistantText(',title:Detailed San Francisco,version:v1}'),
      '',
    );
  });
});

describe('parametric build detection', () => {
  it('rejects artifacts with code shorter than 20 characters', () => {
    assert.equal(
      isParametricArtifact({ title: 'Stand', version: 'v1', code: 'cube(1);' }),
      false,
    );
  });

  it('accepts valid artifacts', () => {
    assert.equal(
      isParametricArtifact({
        title: 'Phone stand',
        version: 'v1',
        code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
      }),
      true,
    );
  });

  it('detects turns that finished without any build tool call', () => {
    assert.equal(
      parametricTurnMissingBuild([
        { type: 'text', text: 'Here is a phone stand design.', state: 'done' },
      ]),
      true,
    );
    assert.equal(
      parametricTurnMissingBuild([
        {
          type: 'tool-build_parametric_model',
          state: 'output-available',
          input: {
            title: 'Stand',
            version: 'v1',
            code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
          },
        },
      ]),
      false,
    );
  });

  it('does not report missing build while a client tool is still pending', () => {
    assert.equal(
      shouldReportMissingParametricBuild([
        {
          type: 'tool-build_parametric_model',
          toolCallId: 't1',
          state: 'input-available',
          input: {
            title: 'Stand',
            version: 'v1',
            code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
          },
        },
      ]),
      false,
    );
  });

  it('reports when every build attempt failed with invalid artifacts', () => {
    assert.equal(
      shouldReportMissingParametricBuild([
        {
          type: 'tool-build_parametric_model',
          toolCallId: 't1',
          state: 'output-error',
          input: { title: 'Stand', version: 'v1', code: 'bad' },
          errorText: 'invalid artifact',
        },
      ]),
      true,
    );
  });

  it('does not report when a failed build still has viewable code', () => {
    assert.equal(
      shouldReportMissingParametricBuild([
        {
          type: 'tool-build_parametric_model',
          toolCallId: 't1',
          state: 'output-error',
          input: {
            title: 'Stand',
            version: 'v1',
            code: 'module phone_stand() { cube([10, 20, 30]); } phone_stand();',
          },
          errorText: 'compile failed',
        },
      ]),
      false,
    );
  });
});

describe('extractScadFromText', () => {
  it('extracts fenced OpenSCAD code blocks', () => {
    const code =
      'module phone_stand() {\n  cube([40, 60, 10]);\n}\nphone_stand();';
    assert.equal(
      extractScadFromText(
        `Here is the model:\n\`\`\`openscad\n${code}\n\`\`\``,
      ),
      code,
    );
  });

  it('ignores non-OpenSCAD fenced blocks', () => {
    assert.equal(
      extractScadFromText('```python\nprint("hello")\n```'),
      undefined,
    );
  });

  it('extracts generic fenced blocks that look like OpenSCAD', () => {
    const code =
      'module phone_stand() {\n  cube([40, 60, 10]);\n}\nphone_stand();';
    assert.equal(extractScadFromText(`\`\`\`\n${code}\n\`\`\``), code);
  });

  it('reads salvage text from answer_user tool messages', () => {
    const text = getAssistantSalvageText([
      {
        type: 'tool-answer_user',
        toolCallId: 't1',
        state: 'output-available',
        input: { message: 'Done.' },
        output: {
          message:
            '```\nmodule phone_stand() { cube([10, 20, 30]); } phone_stand();\n```',
        },
      },
    ]);
    assert.match(text, /module phone_stand/);
  });
});
