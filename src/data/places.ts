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
  /** The device's current position, or null (denied, unavailable, no permission yet when `prompt` is false). */
  position(opts: { prompt: boolean; timeoutMs: number }): Promise<Position | null>;
  /** Country code and town for a position (needs a connection), or null. */
  name(p: Position): Promise<{ country: string | null; place: string | null } | null>;
}

export interface RatesService {
  /** Pounds per unit of `currency` (the day's reference rate, or the given day's), or null. */
  rate(currency: string, date?: string): Promise<{ rate: string; date: string } | null>;
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
    async position({ prompt, timeoutMs }) {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null;
      if (!prompt) {
        try {
          const state = await navigator.permissions.query({ name: 'geolocation' });
          if (state.state !== 'granted') return null;
        } catch {
          return null;
        }
      }
      return withTimeout(new Promise<Position>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (p) => { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
          reject,
          { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: timeoutMs },
        );
      }), timeoutMs);
    },
    async name(p) {
      const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${String(p.lat)}&longitude=${String(p.lng)}&localityLanguage=en`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const j = (await res.json()) as { countryCode?: unknown; city?: unknown; locality?: unknown };
      const country = typeof j.countryCode === 'string' && /^[A-Z]{2}$/.test(j.countryCode) ? j.countryCode : null;
      const city = typeof j.city === 'string' && j.city.trim() !== '' ? j.city.trim() : typeof j.locality === 'string' && j.locality.trim() !== '' ? j.locality.trim() : null;
      return { country, place: city };
    },
  };
}

/** Frankfurter's reference rates (keyless). */
export function frankfurterRates(): RatesService {
  return {
    async rate(currency, date) {
      if (!/^[A-Z]{3}$/.test(currency)) return null;
      const url = `https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/gbp${date ? `?date=${date}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const j = (await res.json()) as { rate?: unknown; date?: unknown };
      if (typeof j.rate !== 'number' || !(j.rate > 0)) return null;
      return { rate: String(j.rate), date: typeof j.date === 'string' ? j.date : '' };
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

/** PLC-2: where the phone is now (rounded to about 100 m), within `timeoutMs`; null if it can't tell in time. */
export async function locateWith(geo: GeoService, opts: { prompt?: boolean; timeoutMs?: number; online: boolean }): Promise<Located | null> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const started = Date.now();
  const pos = await withTimeout(geo.position({ prompt: opts.prompt === true, timeoutMs }), timeoutMs);
  if (!pos) return null;
  const rounded = { lat: roundPosition(pos.lat), lng: roundPosition(pos.lng) };
  if (!opts.online) return { ...rounded, country: null, place: null };
  const left = Math.max(0, timeoutMs - (Date.now() - started));
  // The device's own position goes to the namer (never the rounded or a stored one; BigDataCloud's terms).
  const named = left > 0 ? await withTimeout(geo.name(pos), left) : null;
  return { ...rounded, country: named?.country ?? null, place: named?.place ?? null };
}

interface KeptRate { rate: string; date: string }

function keptRates(): Record<string, KeptRate> {
  try {
    const parsed: unknown = JSON.parse(read(RATES_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, KeptRate> : {};
  } catch {
    return {};
  }
}

/** PLC-6, OFF-4: the day's rate for a currency (pounds per unit); offline or failing, the last one kept (`stale`). */
export async function rateWith(rates: RatesService, currency: string, opts: { online: boolean; date?: string }): Promise<{ rate: string; date: string; stale: boolean } | null> {
  const kept = keptRates()[currency] ?? null;
  if (opts.online) {
    const fresh = await withTimeout(rates.rate(currency, opts.date), 6000);
    if (fresh) {
      if (!opts.date) write(RATES_KEY, JSON.stringify({ ...keptRates(), [currency]: fresh }));
      return { ...fresh, stale: false };
    }
  }
  return kept ? { ...kept, stale: true } : null;
}
