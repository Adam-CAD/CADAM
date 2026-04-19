export function requireSharedSecret(request: Request, secretName: string) {
  const configuredSecret = Deno.env.get(secretName);
  const isLocal = Deno.env.get('ENVIRONMENT') === 'local';

  if (!configuredSecret) {
    if (isLocal) return;
    throw new Error(`${secretName} is not configured`);
  }

  const url = new URL(request.url);
  const providedSecret =
    request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret');

  if (providedSecret !== configuredSecret) {
    throw new Error('Invalid webhook secret');
  }
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}

async function hmacSha256(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

function webhookSignaturePayload(id: string, mode?: string | null) {
  return `${id}:${mode ?? ''}`;
}

export async function verifySignedWebhookUrl(
  request: Request,
  secretName: string,
  id: string,
  mode?: string | null,
) {
  const configuredSecret = Deno.env.get(secretName);
  const isLocal = Deno.env.get('ENVIRONMENT') === 'local';

  if (!configuredSecret) {
    if (isLocal) return;
    throw new Error(`${secretName} is not configured`);
  }

  const url = new URL(request.url);
  const providedSignature = url.searchParams.get('signature') ?? '';
  const expectedSignature = await hmacSha256(
    configuredSecret,
    webhookSignaturePayload(id, mode),
  );

  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    throw new Error('Invalid webhook signature');
  }
}

export async function signedWebhookUrl(
  baseUrl: string,
  id: string,
  mode?: string,
) {
  const url = new URL('/functions/v1/fal-webhook', baseUrl);
  url.searchParams.set('id', id);
  if (mode) url.searchParams.set('mode', mode);

  const secret = Deno.env.get('FAL_WEBHOOK_SECRET');
  if (secret) {
    url.searchParams.set(
      'signature',
      await hmacSha256(secret, webhookSignaturePayload(id, mode)),
    );
  }

  return url.toString();
}
