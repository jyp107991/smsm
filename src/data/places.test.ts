/**
 * S4b data layer (docs/slices/S4b.md "Interfaces → Data", "Decisions made here"): this phone's current country
 * and its "Use location" setting (PLC-3, PLC-2), finding where the phone is through injected services (PLC-2:
 * rounded to about 100 m, never more than 4 s, nothing when denied or offline, OFF-4), the day's rate cached per
 * currency and used offline (PLC-6, OFF-4, DAT-5), and entries carrying country, place, position and the original
 * amount (PLC-1, PLC-6). Written before the build (ENGINEERING §5, tests first by someone else); each test names
 * its SPEC ids and fails because the functions below don't exist yet.
 *
 * Interface these tests expect (exported from src/data/index.ts):
 *   useCurrentCountry(): string                 PLC-3: per phone, localStorage 'smsm-current-country'; default
 *   setCurrentCountry(code: string): void                 the household's home country ('GB').
 *   useLocationSetting(): boolean               PLC-2: per phone, off until turned on; never sent to the server.
 *   setUseLocation(on: boolean): void
 *   locate(layer?): Promise<{ lat, lng, country, place } | null>
 *     PLC-2: only with "Use location" on; geo.position() then geo.reverse(rounded lat, rounded lng); lat/lng rounded
 *     to 3 dp; place = city, else locality; null when it takes longer than 4 s, is denied, or the phone is offline.
 *   rateFor(currency, date?, layer?): Promise<{ rate: string; date: string; stale: boolean } | null>
 *     PLC-6 OFF-4: rates.rate(from, date?) (Frankfurter's { date, base, quote, rate }); the last rate per currency
 *     is kept in localStorage 'smsm-rates' and reused that day; offline or failing, the last known with stale: true;
 *     nothing known, null.
 *   Data layer options gain `geo` and `rates` (the fakes below; the app passes the browser + BigDataCloud and
 *   Frankfurter ones). ExpenseDraft gains country, place, lat, lng and original { amount, currency, rate }, stored
 *   as country, place, lat, lng, original_amount, original_currency, fx_rate. `amount` stays the caller's pence.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import { DataProvider } from './DataProvider';
import * as hooksModule from './hooks';
import * as dataIndex from './index';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import type { ExpenseDraft } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
interface Located { lat: number; lng: number; country: string; place: string | null }
interface Rate { rate: string; date: string; stale: boolean }
interface S4bData {
  useCurrentCountry(): string;
  setCurrentCountry(code: string): void;
  useLocationSetting(): boolean;
  setUseLocation(on: boolean): void;
  locate(layer?: DataLayer): Promise<Located | null>;
  rateFor(currency: string, date?: string, layer?: DataLayer): Promise<Rate | null>;
}
interface Original { amount: string; currency: string; rate: string }
type S4bDraft = ExpenseDraft & { country?: string; place?: string | null; lat?: number | null; lng?: number | null; original?: Original | null };
const data = { ...(hooksModule as object), ...(mutations as object), ...(dataIndex as object) } as unknown as S4bData & typeof hooksModule;
const m = mutations as unknown as typeof mutations & {
  addExpense(input: S4bDraft & { id?: string }, layer?: DataLayer): string;
  editExpense(id: string, patch: Partial<S4bDraft>, layer?: DataLayer): void;
};

// ───────── fake services (what the data layer options `geo` and `rates` take) ─────────
interface Position { lat: number; lng: number }
interface Reverse { countryCode: string; city: string; locality: string }
function fakeGeo(opts: { position?: () => Promise<Position>; reverse?: (lat: number, lng: number) => Promise<Reverse> } = {}) {
  const geo = {
    position: vi.fn(opts.position ?? (() => Promise.resolve({ lat: 35.011636, lng: 135.768029 }))),
    reverse: vi.fn(opts.reverse ?? (() => Promise.resolve({ countryCode: 'JP', city: 'Kyoto', locality: 'Shimogyo Ward' }))),
  };
  return geo;
}
interface FrankfurterRate { date: string; base: string; quote: string; rate: number }
function fakeRates(table: Record<string, number> = { JPY: 0.0047475, EUR: 0.8712 }, opts: { fail?: boolean } = {}) {
  return {
    rate: vi.fn((...args: [from: string, date?: string]): Promise<FrankfurterRate> => {
      const [from] = args;
      if (opts.fail) return Promise.reject(new Error('503'));
      const rate = table[from];
      return rate === undefined ? Promise.reject(new Error('404')) : Promise.resolve({ date: '2026-11-13', base: from, quote: 'GBP', rate });
    }),
  };
}
const never = <T,>() => new Promise<T>(() => { /* never answers */ });
const denied = () => Promise.reject(Object.assign(new Error('User denied Geolocation'), { code: 1 }));

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  vi.useRealTimers();
  for (const l of open.splice(0)) await l.dispose();
});

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple(opts);
  open.push(c.layer);
  return c;
}
const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const ramen = (over: Partial<S4bDraft> = {}): S4bDraft => ({
  description: 'Ramen', amount: pence(570), date: TODAY, categoryId: categoryId('Eating out'), payer: JAE_ID, split: even, ...over,
});
const YEN: Original = { amount: '1200', currency: 'JPY', rate: '0.0047475' };

// ─────────────────────────────── PLC-3: current country, per phone ───────────────────────────────

describe('current country (PLC-3): this phone’s own', () => {
  it('PLC-3 PLC-1: with nothing chosen it is the household’s home country, GB', async () => {
    const c = household();
    await c.layer.ready;
    const view = renderHook(() => data.useCurrentCountry(), { wrapper: wrapperFor(c.layer) });
    await waitFor(() => { expect(view.result.current).toBe('GB'); });
    view.unmount();
  });

  it('PLC-3: setCurrentCountry is kept in localStorage "smsm-current-country" and the hook follows it', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const view = renderHook(() => data.useCurrentCountry(), { wrapper: wrapperFor(c.layer) });
    act(() => { data.setCurrentCountry('JP'); });
    await waitFor(() => { expect(view.result.current).toBe('JP'); });
    expect(localStorage.getItem('smsm-current-country')).toContain('JP');
    act(() => { data.setCurrentCountry('GB'); });
    await waitFor(() => { expect(view.result.current).toBe('GB'); });
    view.unmount();
  });

  it('PLC-3: it survives restarting the app and is never sent to the server (the partner’s phone keeps its own)', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    act(() => { data.setCurrentCountry('JP'); });
    await settle(c.layer);
    expect(c.controls.calls.some((call) => JSON.stringify(call.arg ?? null).includes('"JP"'))).toBe(false);
    const again = household();
    await again.layer.ready;
    const view = renderHook(() => data.useCurrentCountry(), { wrapper: wrapperFor(again.layer) });
    await waitFor(() => { expect(view.result.current).toBe('JP'); });
    view.unmount();
  });
});

// ─────────────────────────────── PLC-2: the Use location setting ───────────────────────────────

describe('Use location (PLC-2): off until asked, per phone', () => {
  it('PLC-2: off by default; setUseLocation(true) turns it on, and it survives a restart', async () => {
    const c = household();
    await c.layer.ready;
    const view = renderHook(() => data.useLocationSetting(), { wrapper: wrapperFor(c.layer) });
    expect(view.result.current).toBe(false);
    act(() => { data.setUseLocation(true); });
    await waitFor(() => { expect(view.result.current).toBe(true); });
    view.unmount();
    const again = renderHook(() => data.useLocationSetting(), { wrapper: wrapperFor(c.layer) });
    expect(again.result.current).toBe(true);
    act(() => { data.setUseLocation(false); });
    await waitFor(() => { expect(again.result.current).toBe(false); });
    again.unmount();
  });

  it('PLC-2: the setting is this phone’s; nothing reaches the household’s data', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const before = c.controls.calls.length;
    act(() => { data.setUseLocation(true); });
    await settle(c.layer);
    expect(c.controls.calls.slice(before).filter((call) => !/^(select|get|list|fetch)/i.test(call.name))).toEqual([]);
  });
});

// ─────────────────────────────── PLC-2 OFF-4: locate() ───────────────────────────────

describe('locate() (PLC-2, PLC-1, OFF-4): where this phone is, through the injected services', () => {
  it('PLC-2 PLC-1: with location on: country and town, the position rounded to 3 dp before it leaves the phone', async () => {
    const geo = fakeGeo();
    const c = household({ geo });
    await c.layer.ready;
    data.setUseLocation(true);
    await expect(data.locate(c.layer)).resolves.toEqual({ lat: 35.012, lng: 135.768, country: 'JP', place: 'Kyoto' });
    expect(geo.reverse).toHaveBeenCalledTimes(1);
    const [lat, lng] = geo.reverse.mock.calls[0] ?? [];
    expect(lat).toBeCloseTo(35.012, 10);
    expect(lng).toBeCloseTo(135.768, 10);
  });

  it('PLC-2: no city: the locality names the place', async () => {
    const geo = fakeGeo({ reverse: () => Promise.resolve({ countryCode: 'FR', city: '', locality: 'Saint-Malo' }) });
    const c = household({ geo });
    await c.layer.ready;
    data.setUseLocation(true);
    await expect(data.locate(c.layer)).resolves.toMatchObject({ country: 'FR', place: 'Saint-Malo' });
  });

  it('PLC-2: with location off it never asks the phone (null, position not requested)', async () => {
    const geo = fakeGeo();
    const c = household({ geo });
    await c.layer.ready;
    await expect(data.locate(c.layer)).resolves.toBeNull();
    expect(geo.position).not.toHaveBeenCalled();
    expect(geo.reverse).not.toHaveBeenCalled();
  });

  it('PLC-2 ADD-1: slower than 4 s (the position never comes) → null, so saving is never held up', async () => {
    const geo = fakeGeo({ position: () => never<Position>() });
    const c = household({ geo });
    await c.layer.ready;
    data.setUseLocation(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const found = data.locate(c.layer);
    await vi.advanceTimersByTimeAsync(4001);
    await expect(found).resolves.toBeNull();
  });

  it('PLC-2 OFF-4: the place name not back within 4 s → null', async () => {
    const geo = fakeGeo({ reverse: () => never<Reverse>() });
    const c = household({ geo });
    await c.layer.ready;
    data.setUseLocation(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const found = data.locate(c.layer);
    await vi.advanceTimersByTimeAsync(4001);
    await expect(found).resolves.toBeNull();
  });

  it('PLC-2: an answer inside 4 s is used', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const geo = fakeGeo({ position: () => new Promise<Position>((resolve) => { setTimeout(() => { resolve({ lat: 51.50072, lng: -0.12763 }); }, 3000); }) });
    const c = household({ geo });
    vi.useRealTimers();
    await c.layer.ready;
    data.setUseLocation(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const found = data.locate(c.layer);
    await vi.advanceTimersByTimeAsync(3100);
    await expect(found).resolves.toMatchObject({ lat: 51.501, lng: -0.128, country: 'JP', place: 'Kyoto' });
  });

  it('PLC-2: permission denied → null (the app works fully without it)', async () => {
    const geo = fakeGeo({ position: denied });
    const c = household({ geo });
    await c.layer.ready;
    data.setUseLocation(true);
    await expect(data.locate(c.layer)).resolves.toBeNull();
    expect(geo.reverse).not.toHaveBeenCalled();
  });

  it('OFF-4: offline → null; place names wait for a connection (the current country is used instead)', async () => {
    const geo = fakeGeo();
    const c = household({ geo });
    await c.layer.ready;
    await settle(c.layer);
    data.setUseLocation(true);
    c.network.set(false);
    await expect(data.locate(c.layer)).resolves.toBeNull();
    expect(geo.reverse).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── PLC-6 OFF-4 DAT-5: rateFor() ───────────────────────────────

describe('rateFor() (PLC-6, OFF-4, DAT-5): the day’s rate, cached per currency, the last one offline', () => {
  it('PLC-6: online: the reference rate as exact decimal text, not stale', async () => {
    const rates = fakeRates();
    const c = household({ rates });
    await c.layer.ready;
    await expect(data.rateFor('JPY', undefined, c.layer)).resolves.toEqual({ rate: '0.0047475', date: '2026-11-13', stale: false });
    expect(rates.rate).toHaveBeenCalledTimes(1);
    expect(rates.rate.mock.calls[0]?.[0]).toBe('JPY');
  });

  it('PLC-6: cached per currency in localStorage "smsm-rates": the same currency again that day is not fetched again', async () => {
    const rates = fakeRates();
    const c = household({ rates });
    await c.layer.ready;
    await data.rateFor('JPY', undefined, c.layer);
    await expect(data.rateFor('JPY', undefined, c.layer)).resolves.toMatchObject({ rate: '0.0047475', stale: false });
    expect(rates.rate).toHaveBeenCalledTimes(1);
    await expect(data.rateFor('EUR', undefined, c.layer)).resolves.toMatchObject({ rate: '0.8712', stale: false });
    expect(rates.rate).toHaveBeenCalledTimes(2);
    const kept = localStorage.getItem('smsm-rates') ?? '';
    expect(kept).toContain('JPY');
    expect(kept).toContain('EUR');
  });

  it('PLC-6: a past day asks for that day’s rate', async () => {
    const rates = fakeRates();
    const c = household({ rates });
    await c.layer.ready;
    await data.rateFor('JPY', '2026-11-02', c.layer);
    expect(rates.rate).toHaveBeenCalledWith('JPY', '2026-11-02');
  });

  it('OFF-4: offline: the last known rate, marked stale, without asking the service', async () => {
    const rates = fakeRates();
    const c = household({ rates });
    await c.layer.ready;
    await settle(c.layer);
    await data.rateFor('JPY', undefined, c.layer);
    c.network.set(false);
    rates.rate.mockClear();
    await expect(data.rateFor('JPY', undefined, c.layer)).resolves.toEqual({ rate: '0.0047475', date: '2026-11-13', stale: true });
    expect(rates.rate).not.toHaveBeenCalled();
  });

  it('OFF-4: the last rate survives restarting the app (a new phone session, offline)', async () => {
    const first = household({ rates: fakeRates() });
    await first.layer.ready;
    await data.rateFor('JPY', undefined, first.layer);
    const rates = fakeRates();
    const second = household({ rates, online: false });
    await second.layer.ready;
    await expect(data.rateFor('JPY', undefined, second.layer)).resolves.toMatchObject({ rate: '0.0047475', stale: true });
    expect(rates.rate).not.toHaveBeenCalled();
  });

  it('OFF-4: offline with nothing known → null (the Rate box is typed by hand)', async () => {
    const rates = fakeRates();
    const c = household({ rates, online: false });
    await c.layer.ready;
    await expect(data.rateFor('JPY', undefined, c.layer)).resolves.toBeNull();
  });

  it('DAT-5: the service failing falls back to the last known, stale; nothing known → null', async () => {
    const good = household({ rates: fakeRates() });
    await good.layer.ready;
    await data.rateFor('JPY', undefined, good.layer);
    const failing = fakeRates(undefined, { fail: true });
    const c = household({ rates: failing });
    await c.layer.ready;
    // A day not asked for before, so the service is asked; it is down: the last known JPY rate, stale.
    await expect(data.rateFor('JPY', '2026-11-02', c.layer)).resolves.toMatchObject({ rate: '0.0047475', stale: true });
    await expect(data.rateFor('KRW', undefined, c.layer)).resolves.toBeNull();
  });
});

// ─────────────────────────────── PLC-1 PLC-6: entries carry country, place and the original ───────────────────────────────

describe('entries with a place and another currency (PLC-1, PLC-2, PLC-6)', () => {
  it('PLC-1 PLC-6 OFF-2: addExpense stores country, place, position and the original amount; the pounds are the caller’s', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = m.addExpense(ramen({ country: 'JP', place: 'Kyoto', lat: 35.012, lng: 135.768, original: YEN }), c.layer);
    c.network.set(true);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.id === id);
    expect(row).toMatchObject({ amount_pence: 570, country: 'JP', place: 'Kyoto', original_currency: 'JPY' });
    expect(Number(row?.lat)).toBeCloseTo(35.012, 10);
    expect(Number(row?.lng)).toBeCloseTo(135.768, 10);
    expect(String(row?.original_amount)).toBe('1200');
    expect(String(row?.fx_rate)).toBe('0.0047475');
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 285, [SAM_ID]: -285 });
  });

  it('PLC-1: a position is never stored finer than 3 decimal places', async () => {
    const c = household();
    await c.layer.ready;
    const id = m.addExpense(ramen({ country: 'JP', place: 'Kyoto', lat: 35.011636, lng: -0.127631 }), c.layer);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.id === id);
    expect(Number(row?.lat)).toBeCloseTo(35.012, 10);
    expect(Number(row?.lng)).toBeCloseTo(-0.128, 10);
  });

  it('PLC-1: with no country given an entry is at home (GB), with no place, position or original', async () => {
    const c = household();
    await c.layer.ready;
    const id = m.addExpense(ramen(), c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({
      country: 'GB', place: null, lat: null, lng: null, original_amount: null, original_currency: null, fx_rate: null,
    });
  });

  it('PLC-2: a typed place stores no position', async () => {
    const c = household();
    await c.layer.ready;
    const id = m.addExpense(ramen({ country: 'JP', place: 'Nara', lat: null, lng: null }), c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ country: 'JP', place: 'Nara', lat: null, lng: null });
  });

  it('PLC-6: editing the pounds amount clears the original (it no longer describes the entry)', async () => {
    const abroad = storedExpense({
      description: 'Ramen', amount_pence: 570, paid: { [JAE_ID]: 570 }, shares: { [JAE_ID]: 285, [SAM_ID]: 285 },
      country: 'JP', place: 'Kyoto', lat: 35.012, lng: 135.768, original_amount: 1200, original_currency: 'JPY', fx_rate: 0.0047475,
    });
    const c = household({ expenses: [abroad] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(abroad.id, { amount: pence(600) }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]).toMatchObject({
      amount_pence: 600, original_amount: null, original_currency: null, fx_rate: null, country: 'JP', place: 'Kyoto',
    });
  });

  it('PLC-6 PLC-3: editing anything else keeps the original, the country and the place, whatever this phone’s country', async () => {
    const abroad = storedExpense({
      description: 'Ramen', amount_pence: 570, paid: { [JAE_ID]: 570 }, shares: { [JAE_ID]: 285, [SAM_ID]: 285 },
      country: 'JP', place: 'Kyoto', lat: 35.012, lng: 135.768, original_amount: 1200, original_currency: 'JPY', fx_rate: 0.0047475,
    });
    localStorage.setItem('smsm-current-country', 'FR');
    const c = household({ expenses: [abroad] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(abroad.id, { description: 'Tonkotsu ramen' }, c.layer);
    await settle(c.layer);
    const row = c.controls.tables.expenses[0];
    expect(row).toMatchObject({ description: 'Tonkotsu ramen', amount_pence: 570, country: 'JP', place: 'Kyoto', original_currency: 'JPY' });
    expect(String(row?.original_amount)).toBe('1200');
    expect(String(row?.fx_rate)).toBe('0.0047475');
  });

  it('PLC-6: the amount re-entered in yen with a new rate stores the new original', async () => {
    const abroad = storedExpense({
      description: 'Ramen', amount_pence: 570, paid: { [JAE_ID]: 570 }, shares: { [JAE_ID]: 285, [SAM_ID]: 285 },
      country: 'JP', original_amount: 1200, original_currency: 'JPY', fx_rate: 0.0047475,
    });
    const c = household({ expenses: [abroad] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(abroad.id, { amount: pence(712), original: { amount: '1500', currency: 'JPY', rate: '0.0047475' } }, c.layer);
    await settle(c.layer);
    const row = c.controls.tables.expenses[0];
    expect(row?.amount_pence).toBe(712);
    expect(String(row?.original_amount)).toBe('1500');
  });

  it('PLC-1: editing the place or removing it', async () => {
    const abroad = storedExpense({ country: 'JP', place: 'Kyoto', lat: 35.012, lng: 135.768 });
    const c = household({ expenses: [abroad] });
    await c.layer.ready;
    await settle(c.layer);
    m.editExpense(abroad.id, { place: null, lat: null, lng: null }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses[0]).toMatchObject({ country: 'JP', place: null, lat: null, lng: null });
  });
});
