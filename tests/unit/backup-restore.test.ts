/// <reference types="node" />
// EXP-2: the nightly backup can be restored. Same steps as .github/workflows/backup.yml (data-only export,
// gzip, gpg AES-256 with a passphrase) and scripts/restore-backup.sh, against scratch databases.
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sh = (cmd: string, env: Record<string, string> = {}) =>
  execSync(cmd, { encoding: 'utf8', shell: '/bin/bash', env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
const psql = (db: string, sql: string) => execFileSync('psql', ['-X', '-q', '-At', '-d', db, '-c', sql], { encoding: 'utf8' }).trim();

function scratch(name: string, withTestData: boolean) {
  sh(`psql -X -q -d postgres -c "drop database if exists ${name}" -c "create database ${name}"`);
  sh(`psql -X -q -d ${name} -f tests/sql/auth_stub.sql`);
  sh(`for f in supabase/migrations/*.sql; do psql -X -q -d ${name} -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; done`);
  if (withTestData) sh(`psql -X -q -d ${name} -f tests/sql/schema_test.sql >/dev/null 2>&1 || true`);
  else psql(name, 'delete from app_config');
}

describe.skipIf(!process.env.PGHOST)('EXP-2 nightly backup', () => {
  it('EXP-2 an encrypted backup restores to the same balances and history, and only with the passphrase', () => {
    const src = `smsm_bk_src_${String(process.pid)}`;
    const dst = `smsm_bk_dst_${String(process.pid)}`;
    const dir = mkdtempSync(join(tmpdir(), 'smsm-bk-'));
    const pass = 'a long test passphrase for the restore drill';
    try {
      scratch(src, true);
      scratch(dst, false);
      const file = join(dir, 'b.sql.gz.gpg');
      sh(`$(test -x /usr/lib/postgresql/16/bin/pg_dump && echo /usr/lib/postgresql/16/bin/pg_dump || echo pg_dump) -d ${src} --data-only --schema=public 2>/dev/null | gzip -9 | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 3 --output ${file} 3<<<"$P"`, { P: pass });
      expect(sh(`head -c 200 ${file} | grep -c "insert\\|COPY" || true`).trim()).toBe('0');
      const url = `postgresql:///${dst}?host=${process.env.PGHOST ?? ''}`;
      expect(() => sh(`bash scripts/restore-backup.sh ${file} "${url}"`, { BACKUP_PASSPHRASE: 'wrong passphrase' })).toThrow();
      sh(`bash scripts/restore-backup.sh ${file} "${url}"`, { BACKUP_PASSPHRASE: pass });
      const nets = (db: string) => psql(db, 'select user_id || \':\' || net_pence from member_net order by 1');
      expect(nets(dst)).toBe(nets(src));
      expect(psql(dst, 'select count(*) from expenses')).toBe(psql(src, 'select count(*) from expenses'));
      expect(psql(dst, 'select count(*) from activity')).toBe(psql(src, 'select count(*) from activity'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      sh(`psql -X -q -d postgres -c "drop database if exists ${src}" -c "drop database if exists ${dst}"`);
    }
  }, 60_000);
});
