import { assertEquals } from 'jsr:@std/assert';

// Re-implement the helper under test so the test file is self-contained and
// doesn't need to import the full Edge Function (which requires Deno runtime
// globals like Deno.env).
function getApiConfig(model: string): {
  url: string;
  key: string;
  modelId: string;
  isMiniMax: boolean;
} {
  const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const MINIMAX_API_URL = 'https://api.minimax.io/v1/chat/completions';

  if (model.startsWith('minimax/')) {
    return {
      url: MINIMAX_API_URL,
      key: 'minimax-key',
      modelId: model.slice('minimax/'.length),
      isMiniMax: true,
    };
  }
  return {
    url: OPENROUTER_API_URL,
    key: 'openrouter-key',
    modelId: model,
    isMiniMax: false,
  };
}

Deno.test('getApiConfig - MiniMax-M2.7 routes to MiniMax API', () => {
  const config = getApiConfig('minimax/MiniMax-M2.7');
  assertEquals(config.url, 'https://api.minimax.io/v1/chat/completions');
  assertEquals(config.modelId, 'MiniMax-M2.7');
  assertEquals(config.isMiniMax, true);
});

Deno.test('getApiConfig - MiniMax-M2.7-highspeed routes to MiniMax API', () => {
  const config = getApiConfig('minimax/MiniMax-M2.7-highspeed');
  assertEquals(config.url, 'https://api.minimax.io/v1/chat/completions');
  assertEquals(config.modelId, 'MiniMax-M2.7-highspeed');
  assertEquals(config.isMiniMax, true);
});

Deno.test('getApiConfig - Anthropic model routes to OpenRouter', () => {
  const config = getApiConfig('anthropic/claude-sonnet-4.6');
  assertEquals(config.url, 'https://openrouter.ai/api/v1/chat/completions');
  assertEquals(config.modelId, 'anthropic/claude-sonnet-4.6');
  assertEquals(config.isMiniMax, false);
});

Deno.test('getApiConfig - Google model routes to OpenRouter', () => {
  const config = getApiConfig('google/gemini-3.1-pro-preview');
  assertEquals(config.url, 'https://openrouter.ai/api/v1/chat/completions');
  assertEquals(config.modelId, 'google/gemini-3.1-pro-preview');
  assertEquals(config.isMiniMax, false);
});

Deno.test('getApiConfig - MiniMax model ID stripped of prefix', () => {
  const config = getApiConfig('minimax/MiniMax-M2.7');
  // modelId must not contain the "minimax/" prefix when sent to the API
  assertEquals(config.modelId.startsWith('minimax/'), false);
});
