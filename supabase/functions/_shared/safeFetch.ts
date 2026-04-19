type SafeFetchOptions = RequestInit & {
  allowedHosts?: string[];
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

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
  const lowerHost = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
    return true;
  }

  if (lowerHost === '::' || lowerHost === '::1') {
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
    /^fe[89ab]/.test(lowerHost)
  );
}

async function resolveHostAddresses(hostname: string) {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  const addresses = [
    ...(ipv4Result.status === 'fulfilled' ? ipv4Result.value : []),
    ...(ipv6Result.status === 'fulfilled' ? ipv6Result.value : []),
  ];

  if (addresses.length === 0) {
    throw new Error('Unable to resolve URL host');
  }

  return addresses;
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

  const addresses = await resolveHostAddresses(url.hostname);
  if (addresses.some(isBlockedIp)) {
    throw new Error('URL resolves to a blocked private or local address');
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
  const contentLength =
    contentLengthHeader === null ? undefined : Number(contentLengthHeader);
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
  return await safeFetchWithRedirectDepth(input, options, 0);
}

async function safeFetchWithRedirectDepth(
  input: string | URL,
  options: SafeFetchOptions,
  redirectDepth: number,
) {
  const {
    allowedHosts: extraAllowedHosts,
    maxBytes,
    maxRedirects,
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
  const redirectLimit = maxRedirects ?? DEFAULT_MAX_REDIRECTS;

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
      if (redirectDepth >= redirectLimit) {
        throw new Error('Too many redirects');
      }

      const nextUrl = new URL(location, url);
      await assertSafeUrl(nextUrl, allowedHosts);
      // DNS can still change between validation and connection. This helper
      // blocks obvious app-layer SSRF paths; production egress rules should
      // enforce private-network blocking as the final boundary.
      return safeFetchWithRedirectDepth(
        nextUrl,
        {
          ...fetchOptions,
          allowedHosts: extraAllowedHosts,
          maxRedirects: redirectLimit,
          timeoutMs: timeout,
          maxBytes: maxResponseBytes,
        },
        redirectDepth + 1,
      );
    }

    return boundResponse(response, maxResponseBytes);
  } finally {
    clearTimeout(timeoutId);
  }
}
