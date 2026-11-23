/**
 * One phone: a persistent Chromium profile (its own IndexedDB, localStorage, Cache Storage and service
 * worker), so "close the app and open it again" is a real browser restart with the storage kept (OFF-1, OFF-5).
 * Every phone runs on a fixed clock (DAT-4): it starts at CLOCK_START and runs on from there, so timers,
 * the Undo window and Realtime behave normally while "today" is always the same date.
 */
import { chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
import { env } from './env';

/** Saturday 14 November 2026, 22:00 in London (GMT). In Tokyo it is already 07:00 on Sunday 15 November. */
export const CLOCK_START = new Date('2026-11-14T22:00:00Z');
/** "Today" on a phone in London at CLOCK_START, and in Tokyo. */
export const TODAY_LONDON = '2026-11-14';
export const TODAY_TOKYO = '2026-11-15';

export interface PhoneOptions {
  /** The person's display name, used by tests to read sentences ("Sam owes Jae £21.25"). */
  name: string;
  email: string;
  /** Profile folder; reusing it is what makes a restart keep the phone's storage. */
  dir: string;
  timezoneId?: string;
}

export class Phone {
  readonly name: string;
  readonly email: string;
  readonly timezoneId: string;
  private readonly dir: string;
  private ctx: BrowserContext | null = null;
  private pg: Page | null = null;
  private realStart = 0;
  private offline = false;
  /** Whether the open browser has airplane mode's network cut in place (see `setOffline`). */
  private cut = false;

  constructor(opts: PhoneOptions) {
    this.name = opts.name;
    this.email = opts.email;
    this.dir = opts.dir;
    this.timezoneId = opts.timezoneId ?? 'Europe/London';
  }

  get page(): Page {
    if (!this.pg) throw new Error(`${this.name}'s phone is not open`);
    return this.pg;
  }

  get context(): BrowserContext {
    if (!this.ctx) throw new Error(`${this.name}'s phone is not open`);
    return this.ctx;
  }

  get isOpen(): boolean {
    return this.ctx !== null;
  }

  /** Opens the app (first launch, or after a restart: same profile, same storage, clock carried on). */
  async open(path = '/'): Promise<Page> {
    if (this.realStart === 0) this.realStart = Date.now();
    const executablePath = process.env.PW_CHROMIUM_PATH;
    this.ctx = await chromium.launchPersistentContext(this.dir, {
      headless: true,
      baseURL: env.appUrl,
      viewport: { width: 390, height: 800 },
      locale: 'en-GB',
      timezoneId: this.timezoneId,
      offline: this.offline,
      serviceWorkers: 'allow',
      permissions: ['clipboard-read', 'clipboard-write'],
      ...(executablePath ? { executablePath } : {}),
    });
    this.cut = false;
    if (this.offline) await this.cutNetwork(true);
    // The clock keeps running across restarts as it would on a real phone.
    await this.ctx.clock.install({ time: new Date(CLOCK_START.getTime() + (Date.now() - this.realStart)) });
    this.pg = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    await this.pg.goto(path);
    if (!this.offline) {
      // The app shell must be cached before the network goes away (OFF-1).
      await this.pg.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
    }
    return this.pg;
  }

  /** Closes the browser completely, as when the app is swiped away or the phone restarts. */
  async close(): Promise<void> {
    if (!this.ctx) return;
    await this.ctx.close();
    this.ctx = null;
    this.pg = null;
  }

  async restart(path = '/'): Promise<Page> {
    await this.close();
    return this.open(path);
  }

  /**
   * Airplane mode on or off; applies to the open browser and to the next restart.
   *
   * `context.setOffline` gives the app what a phone gives it (navigator.onLine, the online and offline events)
   * and fails requests, but in Chromium it covers the page's current document only. A document being left
   * (`page.goto` while offline) loses the emulation as the next one arrives: it sees navigator.onLine turn
   * true, gets an `online` event, and a request it sends then reaches the server and is not reported to
   * Playwright at all. So the app, rightly, sent a write that was waiting, and the offline test saw it arrive
   * on the other phone (CI run 45272812175; reproduced in Chromium 153 and 159, with and without a service
   * worker). In airplane mode nothing leaves the phone, so while offline every request for another host (the
   * database, the AI and rate services) is also failed here as a phone fails it; the app's own files are
   * left to the service worker, as on a phone.
   */
  async setOffline(offline: boolean): Promise<void> {
    this.offline = offline;
    if (!this.ctx) return;
    // The cut is in place before the app hears it is offline, and gone before it hears it is back, so a
    // request is never let out while the app believes it is offline, nor failed by the cut once it is online.
    if (offline) {
      await this.cutNetwork(true);
      await this.ctx.setOffline(true);
    } else {
      await this.cutNetwork(false);
      await this.ctx.setOffline(false);
    }
    // The app learns about the network through the browser's own events, as on a phone.
  }

  private readonly offSite = (url: URL): boolean => url.origin !== new URL(env.appUrl).origin;

  private readonly disconnected = (route: Route): Promise<void> => route.abort('internetdisconnected');

  private async cutNetwork(on: boolean): Promise<void> {
    if (!this.ctx || on === this.cut) return;
    if (on) await this.ctx.route(this.offSite, this.disconnected);
    else await this.ctx.unroute(this.offSite, this.disconnected);
    this.cut = on;
  }

  /** The access token supabase-js keeps in localStorage (key `sb-<ref>-auth-token`). */
  async accessToken(): Promise<string> {
    const token = await this.page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && /^sb-.+-auth-token$/.test(key)) {
          const raw = localStorage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
          if (parsed?.access_token) return parsed.access_token;
        }
      }
      return null;
    });
    if (!token) throw new Error(`${this.name} has no stored session`);
    return token;
  }

  /**
   * Makes the stored sign-in look expired to this phone (as after days in airplane mode) without touching
   * the server: the refresh token stays valid, so it can refresh once the connection is back (OFF-6).
   */
  async expireStoredSession(): Promise<void> {
    const done = await this.page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && /^sb-.+-auth-token$/.test(key)) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const s = JSON.parse(raw) as { expires_at?: number; expires_in?: number };
          s.expires_at = Math.floor(Date.now() / 1000) - 3600;
          s.expires_in = -3600;
          localStorage.setItem(key, JSON.stringify(s));
          return true;
        }
      }
      return false;
    });
    if (!done) throw new Error(`${this.name} has no stored session to expire`);
  }

  /** Today's date as this phone sees it (DAT-2). */
  get today(): string {
    return this.timezoneId === 'Asia/Tokyo' ? TODAY_TOKYO : TODAY_LONDON;
  }
}
