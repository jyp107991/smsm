#!/usr/bin/env bash
# Smoke test of the live app (ENGINEERING §7): shell loads, version matches the commit, service worker is
# served, the database health check answers. Usage: scripts/smoke.sh <app url> <commit sha>
set -euo pipefail
APP=${1:-}; SHA=${2:-}
fail() { echo "SMOKE FAILED: $1"; exit 1; }
[ -n "$APP" ] || fail "no app URL found in the deploy output"
[ -n "$SHA" ] || fail "no commit given"
for i in 1 2 3 4 5 6; do
  got=$(curl -fsS "$APP/version.json" 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p') || true
  [ "$got" = "$SHA" ] && break
  sleep 10
done
[ "$got" = "$SHA" ] || fail "version.json says '${got:-nothing}', expected $SHA"
# Unknown paths fall back to index.html with status 200, so check content, not just status.
page=$(curl -fsS "$APP/") || fail "app shell did not load"
grep -q '<div id="root">' <<<"$page" || fail "app shell did not load"
sw=$(curl -fsS "$APP/sw.js") || fail "service worker not served"
grep -q 'precache' <<<"$sw" || fail "sw.js is not the service worker"
manifest=$(curl -fsS "$APP/manifest.webmanifest") || fail "manifest not served"
grep -q '"name"' <<<"$manifest" || fail "manifest.webmanifest is not the manifest"
health=$(curl -fsS -X POST "${VITE_SUPABASE_URL}/rest/v1/rpc/health" -H "apikey: ${VITE_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" -d '{}') || fail "database health check did not answer"
grep -q '"ok": *true' <<<"$health" || fail "database health check did not answer"
# S8 (NOT-1): the push function has made its keys (the deploy calls it with ?init=1 just before this), so a phone's
# push_public_key() answers. health() says so without the publishable key reaching push_config.
for i in 1 2 3 4 5 6; do
  grep -q '"push": *true' <<<"$health" && break
  sleep 10
  health=$(curl -fsS -X POST "${VITE_SUPABASE_URL}/rest/v1/rpc/health" -H "apikey: ${VITE_SUPABASE_PUBLISHABLE_KEY}" \
    -H "Content-Type: application/json" -d '{}') || true
done
grep -q '"push": *true' <<<"$health" || fail "the push function has not made its keys (push_public_key() would answer nothing)"
echo "Smoke test passed: $APP at ${SHA::7}"
