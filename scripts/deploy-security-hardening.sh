#!/usr/bin/env bash
set -euo pipefail

# Human-operated helper. Repository rules reserve remote Supabase migrations and
# function deployments for a human with production context.

required_env=(
  FAL_WEBHOOK_SECRET
  CORS_ALLOWED_ORIGINS
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
done

SAFE_FETCH_ALLOWED_HOSTS="${SAFE_FETCH_ALLOWED_HOSTS:-fal.media,v3.fal.media,storage.googleapis.com,replicate.delivery}"

echo "Setting Supabase function secrets"
supabase secrets set \
  FAL_WEBHOOK_SECRET="${FAL_WEBHOOK_SECRET}" \
  CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}" \
  SAFE_FETCH_ALLOWED_HOSTS="${SAFE_FETCH_ALLOWED_HOSTS}"

echo "Applying database migrations"
supabase db push

functions=(
  fal-webhook
  mesh
  creative-chat
  parametric-chat
  stripe-webhook
  stripe-create-checkout-session
  stripe-create-portal-session
  jackson-pollock
  delete-user
  prompt-generator
  title-generator
)

for fn in "${functions[@]}"; do
  echo "Deploying Supabase function: ${fn}"
  supabase functions deploy "${fn}"
done

echo "Security hardening deploy complete. Run the staging smoke tests in docs/security-hardening.md before production promotion."
