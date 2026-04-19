# Security Hardening Checklist

## Current Patch Set

This patch hardens the network-reachable Supabase Edge Function surface found in
`supabase/functions`.

| Area                                                  | Status      | Files                                                                                                     |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Dynamic CORS allowlist                                | Implemented | `supabase/functions/_shared/cors.ts`                                                                      |
| SSRF-safe outbound fetch helper                       | Implemented | `supabase/functions/_shared/safeFetch.ts`                                                                 |
| FAL webhook HMAC verification                         | Implemented | `supabase/functions/_shared/webhookAuth.ts`, `supabase/functions/fal-webhook/index.ts`                    |
| FAL webhook signed callback URLs                      | Implemented | `supabase/functions/mesh/index.ts`                                                                        |
| Mesh/conversation/image ownership guards              | Implemented | `supabase/functions/_shared/ownership.ts`, `supabase/functions/mesh/index.ts`                             |
| Chat token deduction after ownership proof            | Implemented | `supabase/functions/creative-chat/index.ts`, `supabase/functions/parametric-chat/index.ts`                |
| Provider image fetch hardening                        | Implemented | `supabase/functions/_shared/imageGen.ts`                                                                  |
| PostHog proxy header stripping and method restriction | Implemented | `supabase/functions/jackson-pollock/index.ts`                                                             |
| Stripe checkout lookup-key allowlists                 | Implemented | `supabase/functions/stripe-create-checkout-session/index.ts`                                              |
| Stripe webhook event idempotency ledger               | Implemented | `supabase/functions/stripe-webhook/index.ts`, `supabase/migrations/20260418120000_security_hardening.sql` |
| Token grant/purchase idempotency                      | Implemented | `supabase/schemas/functions.sql`, `supabase/migrations/20260418120000_security_hardening.sql`             |
| RPC execute revocation for token admin functions      | Implemented | `supabase/migrations/20260418120000_security_hardening.sql`                                               |
| Dependency non-breaking audit fixes                   | Implemented | `package-lock.json`                                                                                       |

## Endpoint Inventory

| Endpoint                         | Required protection                                                      | Main risks                                                                       | Patch status                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `fal-webhook`                    | FAL HMAC signature; UUID and mode validation; safe fetch                 | Unauthenticated mutation, SSRF, oversized model downloads                        | Signed callback verification and safe fetch added. Follow-up: bind FAL request IDs to rows if provider exposes them. |
| `mesh`                           | Supabase auth; owned conversation/images/mesh before service-role writes | Cross-user mesh/image access, token charge before validation, unsigned callbacks | Ownership checks and signed callbacks added.                                                                         |
| `creative-chat`                  | Supabase auth; owned conversation before token deduction                 | Token charge before ownership proof; model tool output parsing                   | Ownership-before-charge added. Follow-up: schema-validate tool payloads.                                             |
| `parametric-chat`                | Supabase auth; owned conversation before token deduction                 | Token charge before ownership proof; model-generated tool args/code              | Ownership-before-charge added. Follow-up: schema-validate tool args and cap generated code.                          |
| `stripe-webhook`                 | Stripe signature; event idempotency; RPC error handling                  | Replay/double credit, duplicate subscription rows, ignored RPC failures          | Event ledger, upsert, reference IDs, RPC error handling added.                                                       |
| `stripe-create-checkout-session` | Supabase auth; server-side lookup allowlists                             | Arbitrary Stripe lookup keys, inactive token packs                               | Subscription allowlist and active token pack validation added.                                                       |
| `stripe-create-portal-session`   | Supabase auth                                                            | Customer portal for missing customer IDs                                         | Follow-up: explicit missing-customer guard.                                                                          |
| `delete-user`                    | Supabase auth                                                            | Privileged user deletion and Stripe cancellation                                 | Follow-up: validate delete reason and audit background cleanup.                                                      |
| `title-generator`                | Supabase auth                                                            | Conversation/content reference ownership                                         | Follow-up: explicit conversation ownership guard.                                                                    |
| `prompt-generator`               | Supabase auth                                                            | Prompt/body size abuse                                                           | Follow-up: cap body size and validate type.                                                                          |
| `jackson-pollock`                | Fixed-host proxy only                                                    | Header leakage and unauthenticated relay                                         | Sensitive headers stripped and methods limited to GET/POST.                                                          |

## Required Environment

Set these before deploying the patched functions:

- `FAL_WEBHOOK_SECRET`: required outside local development. Mesh job callbacks include an HMAC signature derived from this secret, and `fal-webhook` rejects callbacks without a matching signature.
- `CORS_ALLOWED_ORIGINS`: comma-separated browser origins allowed to call functions. Example: `https://adam.new,https://www.adam.new`.
- `SAFE_FETCH_ALLOWED_HOSTS`: optional comma-separated host allowlist additions for provider file URLs. Defaults include common FAL and Google storage hosts.

## Human Deployment Handoff

The repository rules reserve remote database pushes and Supabase function
deployment for a human operator with production context. The commands below are
handoff steps for that operator; AI agents should not run them.

1. Run the production duplicate-data preflight before applying unique indexes:

```sql
\i supabase/security-preflight.sql
```

If either query returns rows, resolve the duplicates before running the migration.

2. Apply the database migration:

```bash
supabase db push
```

3. Set production secrets:

```bash
supabase secrets set FAL_WEBHOOK_SECRET=...
supabase secrets set CORS_ALLOWED_ORIGINS=https://adam.new,https://www.adam.new
supabase secrets set SAFE_FETCH_ALLOWED_HOSTS=fal.media,v3.fal.media,storage.googleapis.com,replicate.delivery
```

4. Deploy changed functions:

```bash
supabase functions deploy fal-webhook
supabase functions deploy mesh
supabase functions deploy creative-chat
supabase functions deploy parametric-chat
supabase functions deploy stripe-webhook
supabase functions deploy stripe-create-checkout-session
supabase functions deploy stripe-create-portal-session
supabase functions deploy jackson-pollock
supabase functions deploy delete-user
supabase functions deploy prompt-generator
supabase functions deploy title-generator
```

The human operator can also use the deploy helper after exporting the required
secrets:

```bash
export FAL_WEBHOOK_SECRET=...
export CORS_ALLOWED_ORIGINS=https://adam.new,https://www.adam.new
./scripts/deploy-security-hardening.sh
```

5. Run verification:

```bash
npm run build
npm run lint
npm audit --audit-level=moderate
```

6. Run Supabase/Deno verification in an environment with Deno installed:

```bash
npm run lint:supabase
```

7. Confirm the `Security Gates` workflow runs for every future PR:

```bash
npm run lint
npm run build
npm audit --audit-level=high
deno lint --config supabase/deno.json supabase
```

Use `--audit-level=high` in CI until the Vite/esbuild major upgrade is scheduled, because the remaining moderate advisory requires a breaking Vite upgrade.

## Security Smoke Tests

Run these against local Supabase or a staging deployment:

1. `fal-webhook` rejects a valid pending mesh ID without a valid HMAC signature.
2. `fal-webhook` rejects `model_glb.url` values pointing to `http://localhost`, `http://127.0.0.1`, private RFC1918 addresses, and `http://169.254.169.254`.
3. `fal-webhook` accepts only expected provider HTTPS hosts.
4. `mesh` rejects a `conversationId` owned by another user before deducting tokens.
5. `mesh` rejects `images` entries that are raw `http` or `https` URLs.
6. `mesh` rejects an upscale `meshId` not owned by the authenticated user.
7. `creative-chat` and `parametric-chat` reject foreign/private conversations before token deduction.
8. `stripe-create-checkout-session` rejects unknown subscription lookup keys.
9. `stripe-create-checkout-session` rejects token pack lookup keys unless they exist and are active in `token_pack_products`.
10. Replaying the same Stripe event ID returns 200 without a second mutation.
11. Replaying the same token pack checkout session credits purchased tokens once.
12. Failed token RPCs in Stripe webhook paths return 500 so Stripe retries.

## Staging Release Gate

Do not promote this patch to production until all of these pass in staging:

1. Browser calls from `https://adam.new` and `https://www.adam.new` receive matching `access-control-allow-origin` headers.
2. Browser calls from an unlisted origin do not receive a permissive CORS origin.
3. A full mesh generation reaches FAL and the callback completes through the HMAC-signed webhook URL.
4. A mesh preview and mesh upscale both reject resources created by a different user.
5. A token-pack checkout credits tokens exactly once after two Stripe replay attempts.
6. A subscription renewal event grants tokens once and does not shorten a newer expiry when an older event is replayed later.
7. OpenRouter-backed chat still streams normally after the ownership-before-charge change.
8. PostHog capture still works through `jackson-pollock` without forwarding browser auth headers.

## Remaining Work

1. Add schema validation for all request bodies with explicit max lengths and enum checks.
2. Add schema validation for AI tool payloads before executing tool calls.
3. Bind FAL queue request IDs to mesh/preview rows if FAL exposes a stable request ID in callbacks.
4. Add explicit ownership checks to `title-generator`.
5. Add explicit missing-customer handling to `stripe-create-portal-session`.
6. Validate `delete-user` request body and deletion reason.
7. Decide whether to force-upgrade Vite to clear the remaining `esbuild` dev-server audit advisory.
8. Re-run full Shannon review after these patches are deployed to staging.
