#!/usr/bin/env bash
# Smoke test of the live app (ENGINEERING §7): shell loads, version matches the commit, service worker is
# served, the database health check answers. Usage: scripts/smoke.sh <app url> <commit sha>
set -euo pipefail
APP=${1:?app url}; SHA=${2:?commit}
fail() { echo "SMOKE FAILED: $1"; exit 1; }
[ -n "$APP" ] || fail "no app URL found in the deploy output"
for i in 1 2 3 4 5 6; do
  got=$(curl -fsS "$APP/version.json" 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p') || true
  [ "$got" = "$SHA" ] && break
  sleep 10
done
[ "$got" = "$SHA" ] || fail "version.json says '${got:-nothing}', expected $SHA"
curl -fsS "$APP/" | grep -q '<div id="root">' || fail "app shell did not load"
curl -fsS -o /dev/null "$APP/sw.js" || fail "service worker not served"
curl -fsS -o /dev/null "$APP/manifest.webmanifest" || fail "manifest not served"
curl -fsS -X POST "${VITE_SUPABASE_URL}/rest/v1/rpc/health" -H "apikey: ${VITE_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" -d '{}' | grep -q '"ok": *true' || fail "database health check did not answer"
echo "Smoke test passed: $APP at ${SHA::7}"
