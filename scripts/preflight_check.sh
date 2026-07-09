#!/usr/bin/env bash
# Live-test every deploy credential BEFORE deploying, so a typo fails loudly with a
# name instead of a silent worker crash. Reads scripts/deploy.env.
#
#   scripts/preflight_check.sh
#
# Exits non-zero if any check fails. Safe to run repeatedly; makes no changes.
set -uo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="scripts/deploy.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found — copy scripts/deploy.env.example to it and fill in values."
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

req() { # req VARNAME
  local v="${!1:-}"
  if [[ -z "$v" || "$v" == *"<"* ]]; then bad "$1 is missing or still a placeholder"; return 1; fi
  return 0
}

echo "── Required values present ──"
for v in UPSTASH_REDIS_URL UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN \
         SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_PROJECT_REF \
         FLY_APP_NAME FLY_API_TOKEN; do
  req "$v" && ok "$v set"
done

echo "── Upstash REST (used by sim-command) ──"
if req UPSTASH_REDIS_REST_URL && req UPSTASH_REDIS_REST_TOKEN; then
  body="$(curl -s --max-time 15 "$UPSTASH_REDIS_REST_URL/PING" \
    -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" || true)"
  if [[ "$body" == *'"result":"PONG"'* ]]; then ok "Upstash REST PING → PONG";
  else bad "Upstash REST PING failed (URL/token wrong?): ${body:-<no response>}"; fi
fi

echo "── Upstash native URL shape (used by the worker) ──"
if req UPSTASH_REDIS_URL; then
  if [[ "$UPSTASH_REDIS_URL" == rediss://*:6379 || "$UPSTASH_REDIS_URL" == rediss://*:6379/* ]]; then
    ok "native URL looks right (rediss://…:6379)"
  else
    bad "native URL should look like rediss://default:<pwd>@<host>.upstash.io:6379"
  fi
  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -u "$UPSTASH_REDIS_URL" ping 2>/dev/null | grep -qi pong; then
      ok "native Redis PING → PONG"; else bad "native Redis PING failed"; fi
  else
    echo "  · redis-cli not installed — skipped live native ping (shape checked above)"
  fi
fi

echo "── Supabase REST (service role) ──"
if req SUPABASE_URL && req SUPABASE_SERVICE_ROLE_KEY; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    "$SUPABASE_URL/rest/v1/simulation_runs?select=id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" || true)"
  if [[ "$code" == "200" ]]; then ok "Supabase service-role read → 200";
  else bad "Supabase read returned $code (URL/service_role wrong, or table/migration missing)"; fi
fi

echo "── Fly app ──"
if command -v flyctl >/dev/null 2>&1; then
  if FLY_API_TOKEN="$FLY_API_TOKEN" flyctl status -a "$FLY_APP_NAME" >/dev/null 2>&1; then
    ok "Fly app '$FLY_APP_NAME' reachable with this token"
  else
    bad "Fly status failed — token invalid or app name '$FLY_APP_NAME' wrong"
  fi
else
  echo "  · flyctl not installed — skipped (install: https://fly.io/docs/flyctl/install/)"
fi

echo
echo "Result: $pass passed, $fail failed."
[[ $fail -eq 0 ]] && echo "✅ all credentials valid — safe to run scripts/setup_secrets.sh" \
                  || echo "❌ fix the ✗ items above before deploying."
exit $((fail > 0 ? 1 : 0))
