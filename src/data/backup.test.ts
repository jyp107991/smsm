/** EXP-1 (the JSON backup part): everything entered, from the phone's copy, offline too. */
import { afterEach, describe, expect, it } from 'vitest';
import { pence } from '../core/money';
import { categoryId, couple, JAE_ID, TODAY } from '../../tests/fixtures/couple';
import { BACKUP_FORMAT, backupJson } from './backup';
import { addExpense, deleteExpense, saveCategory } from './mutations';
import type { DataLayer } from './queryClient';

let open: DataLayer | null = null;
afterEach(async () => { await open?.dispose(); open = null; });

describe('backup', () => {
  it('EXP-1 OFF-3: the household, people, categories and every entry, deleted and still waiting ones included', async () => {
    const { layer, network } = couple();
    open = layer;
    await layer.ready;
    network.set(false);
    const kept = addExpense({ description: 'Tesco', amount: pence(4250), date: TODAY, categoryId: null, payer: JAE_ID, split: { mode: 'treat' } }, layer);
    const gone = addExpense({ description: 'Gum', amount: pence(100), date: TODAY, categoryId: null, payer: JAE_ID, split: { mode: 'treat' } }, layer);
    deleteExpense(gone, layer);
    const data = JSON.parse(backupJson({ appVersion: '0.1.0' }, layer)) as Record<string, unknown>;
    expect(data['format']).toBe(BACKUP_FORMAT);
    expect((data['household'] as { join_code: string }).join_code).toBe('AB12CD');
    expect((data['members'] as unknown[]).length).toBe(2);
    expect((data['categories'] as unknown[]).length).toBe(12);
    const expenses = data['expenses'] as { id: string; deleted_at: string | null }[];
    expect(expenses.map((e) => e.id).sort()).toEqual([kept, gone].sort());
    expect(expenses.find((e) => e.id === gone)?.deleted_at).not.toBeNull();
  });

  it('EXP-1 OFF-3: a category made or changed while offline is in the backup, so its entries keep it when restored', async () => {
    // S9 data-safety pass: the file had the categories as last fetched, so a category still waiting to sync was
    // missing (an entry in it came back from a restore with no category) and an edit waiting to sync was not in it.
    const { layer, network } = couple();
    open = layer;
    await layer.ready;
    network.set(false);
    const pets = saveCategory({ name: 'Pets', emoji: '🐾', colour: 'moss' }, layer);
    saveCategory({ id: categoryId('Groceries'), name: 'Groceries', emoji: '🥕', colour: 'moss' }, layer);
    const vet = addExpense({ description: 'Vet', amount: pence(3000), date: TODAY, categoryId: pets, payer: JAE_ID, split: { mode: 'treat' } }, layer);
    const data = JSON.parse(backupJson({ appVersion: '0.1.0' }, layer)) as { categories: { id: string; name: string; emoji: string }[]; expenses: { id: string; category_id: string | null }[] };
    expect(data.categories.length).toBe(13);
    expect(data.categories.find((c) => c.id === pets)).toMatchObject({ name: 'Pets', emoji: '🐾' });
    expect(data.categories.find((c) => c.id === categoryId('Groceries'))?.emoji).toBe('🥕');
    expect(data.expenses.find((e) => e.id === vet)?.category_id).toBe(pets);
  });
});
