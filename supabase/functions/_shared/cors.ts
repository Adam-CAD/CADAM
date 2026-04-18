const DEFAULT_ALLOWED_ORIGINS = [
  'https://adam.new',
  'https://www.adam.new',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
];

function configuredAllowedOrigins() {
  const raw =
    Deno.env.get('CORS_ALLOWED_ORIGINS') || Deno.env.get('ADAM_URL') || '';
  const configured = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

export function getCorsHeaders(request?: Request) {
  const allowedOrigins = configuredAllowedOrigins();
  const requestOrigin = request?.headers.get('origin') ?? '';
  const allowedOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export const corsHeaders = getCorsHeaders();
