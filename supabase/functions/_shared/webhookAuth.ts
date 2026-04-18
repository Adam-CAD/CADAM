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

export function signedWebhookUrl(baseUrl: string, id: string, mode?: string) {
  const url = new URL('/functions/v1/fal-webhook', baseUrl);
  url.searchParams.set('id', id);
  if (mode) url.searchParams.set('mode', mode);

  const secret = Deno.env.get('FAL_WEBHOOK_SECRET');
  if (secret) url.searchParams.set('secret', secret);

  return url.toString();
}
