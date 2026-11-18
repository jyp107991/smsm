/**
 * S8 on the demo build (docs/slices/S8.md "Interfaces → Settings", "Tests → E2E"; DESIGN): Settings → "Notifications" at
 * 320×640 and 390×844 in both themes: no horizontal overflow, nothing past the edge, axe clean (WCAG 2 A/AA), 44 px
 * targets for the button and every switch. Then the built service worker: a real push delivered to it (Chromium's
 * DevTools protocol, ServiceWorker.deliverPushMessage, a trusted push event) shows the notification with the words,
 * the sender's head, the app's badge image, the tag and the path; a second push with the same tag replaces the first;
 * the notification's click opens its path in the open window. NOT-1 NOT-2 NOT-3. Written before the build.
 *
 * Notes for the builder: notifications are allowed for the page (Playwright permission), so the phone's state is "off"
 * (no subscription: the demo never subscribes with a push service). The push payload is the function's
 * ({ title, body, path, tag, icon, count }, tests/unit/push-function.test.ts). There is no trusted way to click a
 * notification from a test, so the click is a NotificationEvent dispatched inside the worker: the worker's focus()
 * is refused there, and the handler must still send the window to the path (tests/unit/push-sw.test.ts says the same).
 * The head icons are /icons/head-cat.png and /icons/head-dog.png (scripts/render-icons.ts, from the rig).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
const SWITCHES = ['Entries', 'Settle-ups', 'Comments', 'Bills posted today', 'Bills tomorrow', 'Recap and settle day', 'Balance reminder'] as const;

test.use({ permissions: ['notifications'] });

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const root = document.querySelector('main');
    if (!root) return ['no main'];
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll('li, p, h1, h2, a, button, input, label, [role="status"], [role="switch"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()} "${el.textContent.slice(0, 30)}" ${String(Math.round(r.left))}–${String(Math.round(r.right))}`);
    }
    return out;
  });
  expect(wide, where).toEqual([]);
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`);
  expect(summary).toEqual([]);
}

async function check(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflow(page, where);
  await expectNothingPastTheEdge(page, where);
  await expectAxeClean(page, where);
}

const switchNamed = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Notifications' }).getByRole('switch', { name, exact: true }).or(
    page.getByRole('region', { name: 'Notifications' }).getByRole('checkbox', { name, exact: true }),
  ).first();

function expect44(what: string, box: { width: number; height: number } | null): void {
  expect(box, what).not.toBeNull();
  expect(box?.height ?? 0, `${what} height`).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0, `${what} width`).toBeGreaterThanOrEqual(44);
}

async function settingsAtNotifications(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  const region = page.getByRole('region', { name: 'Notifications' });
  await region.scrollIntoViewIfNeeded();
  await expect(region).toBeVisible();
}

test.describe('S8 screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: NOT-1: Settings → Notifications fits, is axe clean and every target is 44 px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await settingsAtNotifications(page);
        const region = page.getByRole('region', { name: 'Notifications' });

        const allow = region.getByRole('button', { name: 'Allow notifications on this phone' });
        await expect(allow).toBeVisible();
        expect44('Allow notifications on this phone', await allow.boundingBox());
        for (const name of SWITCHES) {
          const sw = switchNamed(page, name);
          await expect(sw, name).toBeAttached();
          expect44(name, await sw.boundingBox());
        }
        await expect(region.getByText(/Approvals/)).toBeVisible();
        await check(page, 'Settings → Notifications');

        // NOT-1: the balance reminder and its amount.
        await switchNamed(page, 'Balance reminder').click({ force: true });
        const amount = region.getByRole('textbox', { name: 'Remind me above' });
        await expect(amount).toBeVisible();
        await expect(amount).toHaveAttribute('inputmode', 'decimal');
        const amountBox = await amount.boundingBox();
        expect(amountBox?.height ?? 0, 'Remind me above height').toBeGreaterThanOrEqual(44);
        await check(page, 'Settings → Notifications with the balance reminder on');
      });
    }
  }
});

test.describe('S8 service worker', () => {
  test('NOT-1 NOT-2 NOT-3: a real push shows the notification; the same tag replaces it; its click opens the path', async ({ page, request, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin;

    // The head icons and the app's badge exist as PNGs.
    for (const icon of ['/icons/head-cat.png', '/icons/head-dog.png']) {
      const res = await request.get(icon);
      expect(res.status(), icon).toBe(200);
      expect(res.headers()['content-type'] ?? '', icon).toContain('image/png');
    }

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Balance' })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const cdp = await page.context().newCDPSession(page);
    const registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: typeof registrations }) => { registrations.push(...e.registrations); });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => registrations.some((r) => !r.isDeleted && r.scopeURL === `${origin}/`)).toBe(true);
    const registrationId = registrations.filter((r) => !r.isDeleted && r.scopeURL === `${origin}/`).at(-1)?.registrationId ?? '';

    const payload = {
      title: 'smsm', body: 'Sam added Tesco £42.50 · Sam owes Jae £24.50', path: '/bills', tag: 'entry:e2e-1', icon: '/icons/head-dog.png', count: 2,
    };
    const notes = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
      .map((n) => ({ title: n.title, body: n.body, tag: n.tag, icon: n.icon, badge: (n as Notification & { badge?: string }).badge ?? '', data: n.data as unknown })));

    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) });
    await expect.poll(async () => (await notes()).filter((n) => n.tag === payload.tag).length).toBe(1);
    const [shown] = (await notes()).filter((n) => n.tag === payload.tag);
    expect(shown?.title).toBe('smsm');
    expect(shown?.body).toBe(payload.body);
    expect(shown?.icon ?? '').toMatch(/\/icons\/head-dog\.png$/);
    expect(shown?.badge ?? '').toMatch(/\/icons\/[\w-]+\.png$/);
    expect(shown?.data).toMatchObject({ path: '/bills' });
    const badge = new URL(shown?.badge ?? '/', origin).pathname;
    expect((await request.get(badge)).status(), badge).toBe(200);

    // NOT-1: a later change to the same thing replaces the notification rather than adding one.
    const changed = { ...payload, body: 'Sam changed Tesco to £45.20 · Sam owes Jae £26.10' };
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(changed) });
    await expect.poll(async () => (await notes()).find((n) => n.tag === payload.tag)?.body).toBe(changed.body);
    expect((await notes()).filter((n) => n.tag === payload.tag)).toHaveLength(1);

    // NOT-2: the click sends the open window to the path.
    const worker = page.context().serviceWorkers().find((w) => w.url().startsWith(origin)) ?? await page.context().waitForEvent('serviceworker');
    const dispatched = await worker.evaluate(async (tag) => {
      const sw = self as unknown as { registration: ServiceWorkerRegistration; dispatchEvent(e: Event): boolean };
      const [n] = await sw.registration.getNotifications({ tag });
      if (!n) return 'no notification';
      const Ctor = (self as unknown as { NotificationEvent: new (type: string, init: { notification: Notification }) => Event }).NotificationEvent;
      sw.dispatchEvent(new Ctor('notificationclick', { notification: n }));
      return 'dispatched';
    }, payload.tag);
    expect(dispatched).toBe('dispatched');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10_000 }).toBe('/bills');
    await expect(page.getByRole('heading', { level: 1, name: 'Bills' })).toBeVisible();
  });
});
