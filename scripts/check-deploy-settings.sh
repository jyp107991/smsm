#!/usr/bin/env bash
# Fails early, in plain words, if a GitHub secret or variable the deploy needs is missing or malformed.
# Prints names only, never values.
set -uo pipefail
bad=0
need() { if [ -z "${!1:-}" ]; then echo "MISSING: $1 ($2)"; bad=1; fi; }
need SUPABASE_ACCESS_TOKEN "GitHub → Settings → Secrets and variables → Actions → Secrets"
need SUPABASE_DB_PASSWORD "GitHub secret"
need CLOUDFLARE_API_TOKEN "GitHub secret"
need SUPABASE_PROJECT_REF "GitHub → Settings → Secrets and variables → Actions → Variables"
need CLOUDFLARE_ACCOUNT_ID "GitHub variable"
need VITE_SUPABASE_URL "GitHub variable"
need VITE_SUPABASE_PUBLISHABLE_KEY "GitHub variable"
[[ "${SUPABASE_ACCESS_TOKEN:-}" == sbp_* ]] || { echo "SUPABASE_ACCESS_TOKEN should start with sbp_"; bad=1; }
[[ "${SUPABASE_PROJECT_REF:-}" =~ ^[a-z]{20}$ ]] || { echo "SUPABASE_PROJECT_REF should be 20 lowercase letters"; bad=1; }
[[ "${VITE_SUPABASE_URL:-}" == "https://${SUPABASE_PROJECT_REF:-x}.supabase.co" ]] || { echo "VITE_SUPABASE_URL should be https://<project ref>.supabase.co with no trailing slash"; bad=1; }
[[ "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" == sb_publishable_* ]] || { echo "VITE_SUPABASE_PUBLISHABLE_KEY should start with sb_publishable_"; bad=1; }
[[ "${CLOUDFLARE_ACCOUNT_ID:-}" =~ ^[0-9a-f]{32}$ ]] || { echo "CLOUDFLARE_ACCOUNT_ID should be 32 characters of 0-9 and a-f"; bad=1; }
[ $bad = 0 ] && echo "All deploy settings present and well-formed."
exit $bad
