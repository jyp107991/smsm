#!/usr/bin/env bash
# Applies the auth stub and every migration in order to a scratch PostgreSQL 16 database, then runs each
# tests/sql/*_test.sql in name order (schema_test first: later files build on its data).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-sql.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=smsm_test_$$
psql -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database $DB" >/dev/null' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f tests/sql/auth_stub.sql
for f in supabase/migrations/*.sql; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1 | { grep -v NOTICE || true; }
done
TESTS=(tests/sql/schema_test.sql $(ls tests/sql/*_test.sql | grep -v schema_test.sql | sort))
OUT=""
for t in "${TESTS[@]}"; do OUT+=$(psql -q -d "$DB" -At -f "$t" 2>&1 | grep -v CONTEXT || true)$'\n'; done
PASS=$(grep -cx 't' <<<"$OUT" || true); FAIL=$(grep -cx 'f' <<<"$OUT" || true); ERR=$(grep -c 'ERROR' <<<"$OUT" || true)
WANT_PASS=$(cat "${TESTS[@]}" | grep -c ' as ok_'); WANT_ERR=$(cat "${TESTS[@]}" | grep -c 'expect error')
echo "checks passed $PASS/$WANT_PASS, failed $FAIL, refused $ERR/$WANT_ERR"
if [ "$PASS" != "$WANT_PASS" ] || [ "$FAIL" != 0 ] || [ "$ERR" != "$WANT_ERR" ]; then echo "$OUT"; exit 1; fi
