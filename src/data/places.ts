/**
 * S4b (PLC-1…PLC-4, PLC-6, OFF-4): where this phone is, and the day's exchange rate. Both outside services are
 * called from the phone only (src/data is the one I/O layer) and are injectable, so tests pass fakes:
 * - place names: BigDataCloud's free client reverse geocoding, with the device's own current position only;
 * - rates: Frankfurter's daily reference rates, kept per currency so the last one is used offline.
 * Per-phone settings (current country, use location) live in localStorage; nothing here goes to the server.
 */
import { roundPosition } from '../core/fx';

export interface Position { lat: number; lng: number }
export interface Located { lat: number; lng: number; country: string | null; place: string | null }

export interface GeoService {
  /** The device's current position; rejects when it isn't allowed or unavailable (never asks unless `prompt`). */
  position(opts?: { prompt: boolean; timeoutMs: number }): Promise<Position>;
  /** BigDataCloud's answer for a position (needs a connection). */
  reverse(lat: number, lng: number): Promise<{ countryCode?: string | null; city?: string | null; locality?: string | null }>;
}

export interface RatesService {
  /** Frankfurter's answer: pounds per unit of `from` on the day (or the given day). */
  rate(from: string, date?: string): Promise<{ date: string; base?: string; quote?: string; rate: number }>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { resolve(null); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/** The browser's geolocation + BigDataCloud. Never asks for permission unless `prompt` is true. */
export function browserGeo(): GeoService {
  return {
    async position(opts) {
      const prompt = opts?.prompt === true;
      const timeoutMs = opts?.timeoutMs ?? 4000;
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) throw new Error('no geolocation');
      if (!prompt) {
        const state = await navigator.permissions.query({ name: 'geolocation' });
        if (state.state !== 'granted') throw new Error('location not allowed yet');
      }
      return new Promise<Position>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (p) => { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
          reject,
          { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: timeoutMs },
        );
      });
    },
    async reverse(lat, lng) {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${String(lat)}&longitude=${String(lng)}&localityLanguage=en`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`place names: ${String(res.status)}`);
      return (await res.json()) as { countryCode?: string; city?: string; locality?: string };
    },
  };
}

/** Frankfurter's reference rates (keyless). */
export function frankfurterRates(): RatesService {
  return {
    async rate(from, date) {
      const url = `https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/gbp${date ? `?date=${date}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`rates: ${String(res.status)}`);
      return (await res.json()) as { date: string; base: string; quote: string; rate: number };
    },
  };
}

// ───────── per phone ─────────

const COUNTRY_KEY = 'smsm-current-country';
const LOCATION_KEY = 'smsm-use-location';
const RATES_KEY = 'smsm-rates';
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* no storage: the setting lasts until the app closes */ }
  for (const l of listeners) l();
}

export function subscribePlaces(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === COUNTRY_KEY || e.key === LOCATION_KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

/** PLC-3: this phone's current country, or null for "home" (the household's home country). */
export function storedCountry(): string | null {
  const v = read(COUNTRY_KEY);
  return v && /^[A-Z]{2}$/.test(v) ? v : null;
}
export function setStoredCountry(code: string | null): void {
  write(COUNTRY_KEY, code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null);
}

export function storedUseLocation(): boolean {
  return read(LOCATION_KEY) === 'on';
}
export function setStoredUseLocation(on: boolean): void {
  write(LOCATION_KEY, on ? 'on' : null);
}

/**
 * PLC-2: where the phone is now: its position rounded to about 100 m before anything leaves the phone, with the
 * country and town, within `timeoutMs` (4 s) in all; null when it can't tell in time, isn't allowed, or offline.
 */
export async function locateWith(geo: GeoService, opts: { prompt?: boolean; timeoutMs?: number; online: boolean }): Promise<Located | null> {
  if (!opts.online) return null;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const started = Date.now();
  const pos = await withTimeout(geo.position({ prompt: opts.prompt === true, timeoutMs }), timeoutMs);
  if (!pos) return null;
  const lat = roundPosition(pos.lat);
  const lng = roundPosition(pos.lng);
  const left = timeoutMs - (Date.now() - started);
  const named = left > 0 ? await withTimeout(geo.reverse(lat, lng), left) : null;
  if (!named) return null;
  const country = typeof named.countryCode === 'string' && /^[A-Z]{2}$/.test(named.countryCode) ? named.countryCode : null;
  const city = typeof named.city === 'string' && named.city.trim() !== '' ? named.city.trim()
    : typeof named.locality === 'string' && named.locality.trim() !== '' ? named.locality.trim() : null;
  return { lat, lng, country, place: city };
}

interface KeptRate { rate: string; date: string; fetchedOn?: string }

function keptRates(): Record<string, KeptRate> {
  try {
    const parsed: unknown = JSON.parse(read(RATES_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, KeptRate> : {};
  } catch {
    return {};
  }
}

/**
 * PLC-6, OFF-4: the rate for a currency (pounds per unit, as exact text). The day's rate is fetched once per
 * currency per day and kept; offline, or if the service fails, the last one kept is used (`stale`).
 */
export async function rateWith(rates: RatesService, currency: string, opts: { online: boolean; today: string; date?: string }): Promise<{ rate: string; date: string; stale: boolean } | null> {
  const kept = keptRates()[currency] ?? null;
  if (opts.online && !opts.date && kept && kept.fetchedOn === opts.today) return { rate: kept.rate, date: kept.date, stale: false };
  if (opts.online) {
    const fresh = await withTimeout(rates.rate(currency, opts.date), 6000);
    if (fresh && typeof fresh.rate === 'number' && fresh.rate > 0) {
      const rate = String(fresh.rate);
      if (!opts.date) write(RATES_KEY, JSON.stringify({ ...keptRates(), [currency]: { rate, date: fresh.date, fetchedOn: opts.today } }));
      return { rate, date: fresh.date, stale: false };
    }
  }
  return kept ? { rate: kept.rate, date: kept.date, stale: true } : null;
}
