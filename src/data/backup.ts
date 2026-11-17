/**
 * EXP-1 (the JSON backup part): everything the household has entered, from the phone's own copy, so it
 * works offline too (OFF-3). Deleted entries are included (they are history), and changes still waiting
 * to sync are applied, so the file is what the person sees. Restoring it is S7's import.
 */
import { activeDataLayer } from './context';
import { keys } from './keys';
import type { DataLayer } from './queryClient';

export const BACKUP_FORMAT = 'smsm-backup-1';

export function backupJson(opts: { appVersion: string }, layer: DataLayer = activeDataLayer()): string {
  const uid = layer.me() ?? '';
  const read = (key: readonly unknown[]): unknown => layer.client.getQueryData(key) ?? null;
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
    },
    null,
    2,
  );
}
