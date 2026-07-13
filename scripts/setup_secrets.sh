#!/usr/bin/env bash
# Push every deploy secret from ONE source (scripts/deploy.env) to its three homes:
#   • Fly app       — worker runtime secrets (native Redis URL + Supabase)
#   • Supabase       — sim-command edge-function secrets (Upstash REST + Supabase,
#                      plus FLY_API_TOKEN + FLY_APP_NAME so it can wake a
#                      scaled-to-zero worker via the Fly Machines API)
#   • GitHub Actions — only what CI needs to deploy (FLY_API_TOKEN + FLY_APP_NAME)
#
# Single source of truth → the three copies can never drift. Idempotent: re-run any
# time a value changes; every command overwrites in place, so there is nothing to reset.
#
#   scripts/preflight_check.sh   # run this FIRST
#   scripts/setup_secrets.sh
#
# Requires the CLIs for whichever targets you want to sync (each is optional and skipped
# with a clear message if absent): flyctl, supabase, gh — each already authenticated
# (fly auth login / supabase login / gh auth login).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="scripts/deploy.env"
[[ -f "$ENV_FILE" ]] || { echo "❌ $ENV_FILE not found (copy deploy.env.example)"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

need() { [[ -n "${!1:-}" && "${!1}" != *"<"* ]] || { echo "❌ $1 missing/placeholder in $ENV_FILE"; exit 1; }; }
for v in UPSTASH_REDIS_URL UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN \
         SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_PROJECT_REF \
         FLY_APP_NAME FLY_API_TOKEN; do need "$v"; done

echo "▶ Fly worker secrets ($FLY_APP_NAME)"
if command -v flyctl >/dev/null 2>&1; then
  FLY_API_TOKEN="$FLY_API_TOKEN" flyctl secrets set -a "$FLY_APP_NAME" \
    UPSTASH_REDIS_URL="$UPSTASH_REDIS_URL" \
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
  echo "  ✓ Fly secrets set (SCSIM_ENGINE comes from sim-worker/fly.toml on deploy)"
else
  echo "  · flyctl not found — set these three on the Fly dashboard instead."
fi

echo "▶ Supabase edge-function secrets ($SUPABASE_PROJECT_REF)"
if command -v supabase >/dev/null 2>&1; then
  supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
    UPSTASH_REDIS_REST_URL="$UPSTASH_REDIS_REST_URL" \
    UPSTASH_REDIS_REST_TOKEN="$UPSTASH_REDIS_REST_TOKEN" \
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    FLY_API_TOKEN="$FLY_API_TOKEN" \
    FLY_APP_NAME="$FLY_APP_NAME"
  echo "  ✓ Supabase function secrets set (incl. Fly wake creds for scale-to-zero)"
else
  echo "  · supabase CLI not found — set these on Supabase → Edge Functions → Secrets."
fi

echo "▶ GitHub Actions (only what CI needs to deploy)"
if command -v gh >/dev/null 2>&1; then
  printf '%s' "$FLY_API_TOKEN" | gh secret set FLY_API_TOKEN
  gh variable set FLY_APP_NAME --body "$FLY_APP_NAME"
  echo "  ✓ FLY_API_TOKEN secret + FLY_APP_NAME variable set"
else
  echo "  · gh CLI not found — add FLY_API_TOKEN (secret) + FLY_APP_NAME (variable) in"
  echo "    GitHub → Settings → Secrets and variables → Actions."
fi

echo
echo "✅ Done. Deploy: GitHub → Actions → 'Deploy sim-worker to Fly' → Run workflow (main)."
echo "   Confirm: fly logs -a $FLY_APP_NAME  → 'engine mode: scsim …' + 'sim-worker starting'."
