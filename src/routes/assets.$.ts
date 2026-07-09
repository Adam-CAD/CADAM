import { createFileRoute } from '@tanstack/react-router';

// Existing files under /assets are served by the static layer and never reach
// the server function, so any request that lands here is for an asset that
// does not exist (e.g. a stale hash during deploy skew). It must be a 404 and
// must not be cacheable: the Vercel route config stamps a one-year immutable
// cache-control on every /assets path, and letting that header onto a
// fallthrough response poisons CDN and browser caches (see the June 2026
// incident where the SPA shell was cached as index-*.css for 20 days).
const missingAssetHeaders = {
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
};

export const Route = createFileRoute('/assets/$')({
  server: {
    handlers: {
      GET: () =>
        new Response('Not Found', {
          status: 404,
          headers: missingAssetHeaders,
        }),
      // RFC 9110 §9.3.2: HEAD responses must not carry a body.
      HEAD: () =>
        new Response(null, { status: 404, headers: missingAssetHeaders }),
    },
  },
});
