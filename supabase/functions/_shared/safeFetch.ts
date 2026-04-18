type SafeFetchOptions = RequestInit & {
  allowedHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

const DEFAULT_ALLOWED_HOSTS = [
  'fal.media',
  'v3.fal.media',
  'storage.googleapis.com',
  'replicate.delivery',
  'cdn.jsdelivr.net',
];

function responseExceedsMaxBytesError() {
  return new Error('Response exceeds maximum allowed size');
}

function configuredAllowedHosts() {
  const raw = Deno.env.get('SAFE_FETCH_ALLOWED_HOSTS') ?? '';
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname: string, allowedHosts: string[]) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const allowed = allowedHost.toLowerCase();
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function isBlockedIp(hostname: string) {
  const lowerHost = hostname.toLowerCase();

  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
    return true;
  }

  if (lowerHost === '::1' || lowerHost === '[::1]') {
    return true;
  }

  const ipv4Match = lowerHost.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, aRaw, bRaw] = ipv4Match;
    const a = Number(aRaw);
    const b = Number(bRaw);

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return (
    lowerHost.startsWith('fc') ||
    lowerHost.startsWith('fd') ||
    lowerHost.startsWith('fe80:')
  );
}

async function assertSafeUrl(url: URL, allowedHosts: string[]) {
  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  if (isBlockedIp(url.hostname)) {
    throw new Error('Blocked private or local URL host');
  }

  if (!isAllowedHost(url.hostname, allowedHosts)) {
    throw new Error(`URL host is not allowlisted: ${url.hostname}`);
  }

  try {
    const addresses = await Deno.resolveDns(url.hostname, 'A');
    if (addresses.some(isBlockedIp)) {
      throw new Error('URL resolves to a blocked private or local address');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('blocked')) {
      throw error;
    }
  }
}

function boundedResponseBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  const reader = body.getReader();
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const error = responseExceedsMaxBytesError();
        await reader.cancel(error);
        controller.error(error);
        return;
      }

      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function boundResponse(response: Response, maxBytes: number) {
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader === null
    ? undefined
    : Number(contentLengthHeader);
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw responseExceedsMaxBytesError();
  }

  if (!response.body) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(boundedResponseBody(response.body, maxBytes), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
) {
  const {
    allowedHosts: extraAllowedHosts,
    maxBytes,
    timeoutMs,
    ...fetchOptions
  } = options;
  const url = input instanceof URL ? input : new URL(input);
  const allowedHosts = [
    ...DEFAULT_ALLOWED_HOSTS,
    ...configuredAllowedHosts(),
    ...(extraAllowedHosts ?? []),
  ];
  const maxResponseBytes = maxBytes ?? DEFAULT_MAX_BYTES;
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  await assertSafeUrl(url, allowedHosts);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      redirect: 'manual',
      signal: fetchOptions.signal ?? controller.signal,
    });

    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      const nextUrl = new URL(location, url);
      await assertSafeUrl(nextUrl, allowedHosts);
      return safeFetch(nextUrl, {
        ...fetchOptions,
        allowedHosts: extraAllowedHosts,
        timeoutMs: timeout,
        maxBytes: maxResponseBytes,
      });
    }

    return boundResponse(response, maxResponseBytes);
  } finally {
    clearTimeout(timeoutId);
  }
}
