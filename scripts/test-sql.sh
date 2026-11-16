#!/usr/bin/env bash
# Applies the auth stub and schema (twice, to prove it re-runs) to a scratch database, then runs the checks.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-sql.sh
set -euo pipefail
DB=smsm_test_$$
psql -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database $DB" >/dev/null' EXIT
psql -q -d $DB -v ON_ERROR_STOP=1 -f tests/sql/auth_stub.sql
psql -q -d $DB -v ON_ERROR_STOP=1 -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
psql -q -d $DB -v ON_ERROR_STOP=1 -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
for f in supabase/migrations/*.sql; do [ -e "$f" ] && psql -q -d $DB -v ON_ERROR_STOP=1 -f "$f"; done
OUT=$(psql -q -d $DB -At -f tests/sql/schema_test.sql 2>&1 | grep -v CONTEXT || true)
PASS=$(grep -cx 't' <<<"$OUT" || true); FAIL=$(grep -cx 'f' <<<"$OUT" || true); ERR=$(grep -c 'ERROR' <<<"$OUT" || true)
WANT_PASS=$(grep -c ' as ok_' tests/sql/schema_test.sql); WANT_ERR=$(grep -c 'expect error' tests/sql/schema_test.sql)
echo "checks passed $PASS/$WANT_PASS, failed $FAIL, refused $ERR/$WANT_ERR"
if [ "$PASS" != "$WANT_PASS" ] || [ "$FAIL" != 0 ] || [ "$ERR" != "$WANT_ERR" ]; then echo "$OUT"; exit 1; fi
