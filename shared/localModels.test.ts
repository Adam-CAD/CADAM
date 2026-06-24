import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getAuxiliaryLocalModel,
  isMissingLocalBaseUrl,
  isLocalModelId,
  localModelToPickerConfig,
  normalizeOpenRouterBaseUrl,
  parseLocalModelsJson,
  providerFor,
} from './localModels.ts';

const sampleLocalModels = parseLocalModelsJson([
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen',
    description: 'Local',
    baseUrl: 'http://localhost:1234',
  },
]);

describe('parseLocalModelsJson', () => {
  it('returns an empty array for non-array input', () => {
    assert.deepEqual(parseLocalModelsJson(null), []);
    assert.deepEqual(parseLocalModelsJson({}), []);
  });

  it('parses valid entries and skips invalid ones', () => {
    assert.deepEqual(
      parseLocalModelsJson([
        {
          id: 'qwen2.5-coder-7b',
          name: 'Qwen',
          description: 'Local coder',
          supportsTools: true,
        },
        { id: '', name: 'Bad', description: 'x' },
      ]),
      [
        {
          id: 'qwen2.5-coder-7b',
          name: 'Qwen',
          description: 'Local coder',
          supportsTools: true,
        },
      ],
    );
  });
});

describe('isLocalModelId', () => {
  it('detects catalog ids', () => {
    assert.equal(isLocalModelId('qwen2.5-coder-7b', sampleLocalModels), true);
    assert.equal(isLocalModelId('openai/gpt-5.5', sampleLocalModels), false);
  });
});

describe('getAuxiliaryLocalModel', () => {
  it('returns the model marked useForAux', () => {
    const models = parseLocalModelsJson([
      { id: 'local-chat', name: 'Chat', description: 'Chat model' },
      {
        id: 'local-aux',
        name: 'Aux',
        description: 'Aux model',
        useForAux: true,
      },
    ]);
    assert.equal(getAuxiliaryLocalModel(models)?.id, 'local-aux');
  });
});

describe('localModelToPickerConfig', () => {
  it('maps catalog entries to picker config', () => {
    assert.deepEqual(localModelToPickerConfig(sampleLocalModels[0]!), {
      id: 'qwen2.5-coder-7b',
      name: 'Qwen',
      description: 'Local',
      provider: 'Local',
      supportsTools: true,
      supportsThinking: false,
      supportsVision: false,
      disabled: false,
    });
  });
});

describe('normalizeOpenRouterBaseUrl', () => {
  it('returns undefined when unset', () => {
    assert.equal(normalizeOpenRouterBaseUrl(''), undefined);
    assert.equal(normalizeOpenRouterBaseUrl('   '), undefined);
  });

  it('appends /v1 when missing', () => {
    assert.equal(
      normalizeOpenRouterBaseUrl('http://localhost:1234'),
      'http://localhost:1234/v1',
    );
  });

  it('preserves an existing /v1 suffix', () => {
    assert.equal(
      normalizeOpenRouterBaseUrl('http://localhost:1234/v1/'),
      'http://localhost:1234/v1',
    );
  });
});

describe('providerFor', () => {
  it('keeps cloud providers on their direct routes', () => {
    assert.equal(
      providerFor('anthropic/claude-opus-4.8', sampleLocalModels),
      'anthropic',
    );
    assert.equal(
      providerFor('google/gemini-3.1-pro-preview', sampleLocalModels),
      'google',
    );
    assert.equal(
      providerFor('openai/gpt-5.5', sampleLocalModels),
      'openrouter',
    );
  });

  it('routes catalog ids with a baseUrl locally', () => {
    assert.equal(providerFor('qwen2.5-coder-7b', sampleLocalModels), 'local');
  });

  it('falls back to openrouter for catalog ids without a baseUrl', () => {
    const noUrlModels = parseLocalModelsJson([
      { id: 'qwen2.5-coder-7b', name: 'Qwen', description: 'Local' },
    ]);
    assert.equal(providerFor('qwen2.5-coder-7b', noUrlModels), 'openrouter');
  });
});

describe('isMissingLocalBaseUrl', () => {
  it('is true when catalog lists the model but has no baseUrl', () => {
    const noUrlModels = parseLocalModelsJson([
      { id: 'qwen2.5-coder-7b', name: 'Qwen', description: 'Local' },
    ]);
    assert.equal(isMissingLocalBaseUrl('qwen2.5-coder-7b', noUrlModels), true);
    assert.equal(isMissingLocalBaseUrl('openai/gpt-5.5', noUrlModels), false);
  });

  it('is false when the catalog model has a baseUrl', () => {
    assert.equal(
      isMissingLocalBaseUrl('qwen2.5-coder-7b', sampleLocalModels),
      false,
    );
  });
});
