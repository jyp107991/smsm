#!/usr/bin/env bash
# Restores an encrypted nightly backup (EXP-2) into a PostgreSQL database that already has the migrations
# applied (a fresh Supabase project after `supabase db push`, or a scratch database for a restore drill).
# Usage: BACKUP_PASSPHRASE=<the database password on the night of the backup> scripts/restore-backup.sh smsm-2026-11-18.sql.gz.gpg "postgresql://..."
# The passphrase is read from the environment so it never appears in shell history or process lists.
# Triggers and foreign-key checks are paused while loading (session_replication_role = replica): the rows
# were valid when exported, and replaying them must not write a second copy of their history.
set -euo pipefail
FILE=${1:?encrypted backup file}; DB=${2:?database URL}
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
umask 077
TMP=$(mktemp)
trap 'shred -u "$TMP" 2>/dev/null || rm -f "$TMP"' EXIT
if ! gpg --batch --quiet --pinentry-mode loopback --decrypt --passphrase-fd 3 "$FILE" 3<<<"$BACKUP_PASSPHRASE" > "$TMP" 2>/dev/null; then
  echo "Couldn't open $FILE: the passphrase is wrong, or the file is damaged."; exit 1
fi
# A newer pg_dump writes settings an older server doesn't know (e.g. transaction_timeout); skip those lines.
{ echo "set session_replication_role = replica;"; gunzip -c "$TMP" | grep -v -E '^SET transaction_timeout'; echo "set session_replication_role = default;"; } \
  | psql "$DB" -v ON_ERROR_STOP=1 -q
echo "Restored $FILE"
