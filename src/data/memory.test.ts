/**
 * CAT-3, CAT-4: what a person chooses teaches the app. `rememberChoice` queues a write to category_memory
 * (it works offline, never delays a save, isn't counted as a waiting change) and the memory the screens
 * read has it at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { couple, categoryId, HID, JAE_ID, SAM_ID } from '../../tests/fixtures/couple';
import { rememberChoice } from './mutations';
import type { DataLayer } from './queryClient';
import { memoryMap } from './rows';

let open: DataLayer | null = null;
afterEach(async () => { await open?.dispose(); open = null; });

describe('category memory', () => {
  it('CAT-3: a chosen category is remembered for the description, normalised, and reaches the server', async () => {
    const { layer, controls } = couple();
    open = layer;
    await layer.ready;
    rememberChoice('  Sainsbury’s ', { categoryId: categoryId('Household') }, layer);
    // At once, before the server has answered.
    expect(layer.memory().map((m) => [m.key, m.category_id])).toEqual([['sainsbury’s', categoryId('Household')]]);
    expect(layer.waiting()).toHaveLength(0);
    await layer.idle();
    expect(controls.tables.categoryMemory).toMatchObject([{ household_id: HID, key: 'sainsbury’s', category_id: categoryId('Household'), source: 'user', uses: 1 }]);
  });

  it('CAT-4: a split is remembered the same way; choosing only one keeps the other', async () => {
    const { layer, controls } = couple();
    open = layer;
    await layer.ready;
    rememberChoice('netflix', { split: { mode: 'ratio', ratio: { [JAE_ID]: 70, [SAM_ID]: 30 } } }, layer);
    rememberChoice('netflix', { categoryId: categoryId('Subscriptions') }, layer);
    await layer.idle();
    const [row] = controls.tables.categoryMemory;
    expect(row).toMatchObject({ key: 'netflix', category_id: categoryId('Subscriptions'), split_mode: 'ratio', split_params: { [JAE_ID]: 70, [SAM_ID]: 30 }, uses: 2 });
    expect(memoryMap(layer.memory()).get('netflix')).toEqual({
      categoryId: categoryId('Subscriptions'), split: { mode: 'ratio', ratio: { [JAE_ID]: 70, [SAM_ID]: 30 } }, source: 'user',
    });
  });

  it('CAT-3: offline, the choice waits and is sent when the connection returns; a refusal is dropped quietly', async () => {
    const { layer, controls, network } = couple();
    open = layer;
    await layer.ready;
    network.set(false);
    controls.online = false;
    rememberChoice('tesco', { categoryId: categoryId('Groceries') }, layer);
    rememberChoice('gone', { categoryId: '00000000-0000-4000-8000-00000000dead' }, layer);
    expect(layer.memory().map((m) => m.key).sort()).toEqual(['gone', 'tesco']);
    controls.online = true;
    network.set(true);
    await layer.idle();
    expect(controls.tables.categoryMemory.map((m) => m.key)).toEqual(['tesco']);
    expect(layer.problems.list()).toHaveLength(0);
  });

  it('CAT-4: exact amounts belong to one entry and are not remembered; nothing to learn writes nothing', async () => {
    const { layer, controls } = couple();
    open = layer;
    await layer.ready;
    rememberChoice('lamp', { split: { mode: 'exact', amounts: {} } }, layer);
    rememberChoice('lamp', {}, layer);
    rememberChoice('   ', { categoryId: categoryId('Other') }, layer);
    await layer.idle();
    expect(controls.tables.categoryMemory).toEqual([]);
  });
});
