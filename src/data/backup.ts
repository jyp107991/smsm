/**
 * EXP-1 (the JSON backup part): everything the household has entered, from the phone's own copy, so it
 * works offline too (OFF-3). Deleted entries are included (they are history), and changes still waiting
 * to sync are applied, so the file is what the person sees. Restoring it is S7's (imports.ts restorePlan,
 * restoreBackup), which reads format 1 and 2.
 *
 * Format 2 (S7) adds chapters, regular payments, comments and the household's import rules (keep rules only).
 */
import type { ImportRuleRow } from './api';
import { activeDataLayer } from './context';
import { keys } from './keys';
import type { DataLayer } from './queryClient';
import { overlay, overlayRules } from './writes';

export const BACKUP_FORMAT = 'smsm-backup-2';

export function backupJson(opts: { appVersion: string }, layer: DataLayer = activeDataLayer()): string {
  const uid = layer.me() ?? '';
  const read = (key: readonly unknown[]): unknown => layer.client.getQueryData(key) ?? null;
  const rows = <R extends { id: string }>(key: readonly unknown[], table: 'chapters' | 'recurring' | 'comments'): R[] =>
    overlay(layer.client.getQueryData<R[]>(key) ?? [], layer.waiting(), table);
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      app_version: opts.appVersion,
      exported_at: layer.now().toISOString(),
      household: layer.household(),
      members: layer.members(),
      categories: read(keys.categories(uid)) ?? [],
      expenses: layer.entries(),
      settlements: layer.settlements(),
      category_memory: layer.memory(),
      change_requests: read(keys.changes(uid)) ?? [],
      chapters: rows(keys.chapters(uid), 'chapters'),
      recurring: rows(keys.recurring(uid), 'recurring'),
      comments: rows(keys.comments(uid), 'comments'),
      // Only the household's keep rules: a skip rule stays on the phone that made it.
      import_rules: overlayRules(layer.client.getQueryData<ImportRuleRow[]>(keys.importRules(uid)) ?? [], layer.waiting()).filter((r) => r.decision === 'keep'),
    },
    null,
    2,
  );
}
