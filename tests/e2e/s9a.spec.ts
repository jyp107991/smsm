/**
 * S9a on the demo build (docs/slices/S9a.md "Tests → E2E"; docs/qa/S9-acceptance.md findings 1, 2 and 15): one walk at
 * 390×844 in each theme through the recap's month-end balance, quick add abroad and the settle-up refusal; each stop
 * has no horizontal overflow, nothing past the edge, and is axe clean (WCAG 2 A/AA). INS-2 PLC-6 SET-1. Written before
 * the build (ENGINEERING §5, tests first by someone else).
 *
 * The demo household has eighteen months of history, so the newest finished month has a recap and a statement; the
 * statement's "Balance at the end" is the core's month-end balance (core/statement), which the recap must now show.
 * The phone is put in Japan before the app opens (this phone's current country, localStorage "smsm-current-country"),
 * and the day's yen rate is stubbed (0.005265 pounds per yen: ¥2,000 = £10.53), so the walk never uses the network.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORT = { width: 390, height: 844 } as const;
const THEMES = ['light', 'dark'] as const;
const APOS = '[’\']';

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('main li, main p, main h1, main h2, main a, main button, main input, [role="dialog"] p, [role="dialog"] button, [role="dialog"] input'))) {
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

async function inJapan(page: Page): Promise<void> {
  await page.addInitScript(() => { localStorage.setItem('smsm-current-country', 'JP'); });
  await page.route(/api\.frankfurter\.dev\/v2\/rate\/JPY\/gbp/i, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ date: '2026-11-13', base: 'JPY', quote: 'GBP', rate: 0.005265 }) }));
  await page.route(/api\.bigdatacloud\.net/i, (route) => route.abort());
}

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });

/** The newest finished month, "YYYY-MM", by the browser's clock (the demo's today is the same day). */
async function lastMonth(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

test.describe('S9a walk', () => {
  for (const theme of THEMES) {
    test(`390×844, ${theme}: INS-2 the recap's month-end balance, PLC-6 quick add in Japan, SET-1 the settle-up refusal`, async ({ page }) => {
      await inJapan(page);
      await page.setViewportSize(VIEWPORT);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });

      // INS-2 (fix 1): the statement's balance at the end of last month is what the recap says "Between you".
      await page.goto('/');
      await expect(balance(page)).toBeVisible();
      const month = await lastMonth(page);
      await page.goto(`/statement/${month}`);
      const endLine = page.locator('main p').filter({ hasText: 'Balance at the end' });
      await expect(endLine).toBeVisible();
      const monthEnd = (await endLine.innerText()).replace('Balance at the end', '').replace(/\s+/g, ' ').trim();
      expect(monthEnd).toMatch(/^(All square|(Jae|Sam) owes (Jae|Sam) £[\d,]+\.\d\d)$/);
      await page.goto(`/recap/${month}`);
      const between = page.getByRole('region', { name: 'Between you' });
      await expect(between).toBeVisible();
      // Soft: the walk goes on, so one run reports each stop.
      await expect.soft(between).toContainText(monthEnd);
      await page.evaluate(async () => { await document.fonts.ready; });
      await check(page, `recap ${month}`);

      // PLC-6 (fix 2): in Japan, a bare amount in quick add is yen; Home shows the country chip.
      await page.goto('/');
      await expect(balance(page)).toBeVisible();
      await expect.soft(page.getByRole('main').getByRole('button', { name: /Japan/ }).first()).toBeVisible();
      const box = page.getByRole('textbox', { name: 'Quick add' });
      await box.fill('2000 ramen');
      await expect.soft(page.getByRole('main').getByRole('button', { name: /^¥2,000 · £10\.53 · / })).toBeVisible();
      await check(page, 'Home, quick add in Japan');
      await box.press('Enter');
      await expect.soft(page.getByRole('status', { name: 'Notifications' })).toContainText('£10.53');
      await expect(box).toHaveValue('');

      // SET-1 (fix 15): more than is owed is refused, with a one-tap "Use £…".
      await page.goto('/');
      await expect(balance(page)).toBeVisible();
      const sentence = await balance(page).locator('p.text-sentence').innerText();
      const owed = /£([\d,]+\.\d\d)/.exec(sentence)?.[1] ?? '';
      expect(owed, `the demo has a balance to settle (${sentence})`).not.toBe('');
      const debtor = /^(Jae|Sam) owes/.exec(sentence.trim())?.[1] ?? '';
      await balance(page).getByRole('button', { name: 'Settle up' }).click();
      const dialog = page.getByRole('dialog', { name: 'Settle up' });
      await expect(dialog).toBeVisible();
      const amount = dialog.getByRole('textbox', { name: 'Amount' });
      await expect(amount).toHaveValue(owed.replace(/,/g, ''));
      await amount.fill('999999');
      const record = dialog.getByRole('button', { name: new RegExp(`^Record ${debtor}${APOS}s payment$`) });
      await record.click();
      await expect(dialog.getByText(new RegExp(`That${APOS}s more than ${debtor} owes \\(£${owed.replace(/[.]/g, '\\.')}\\)`))).toBeVisible();
      await expect(dialog).toBeVisible();
      const use = dialog.getByRole('button', { name: `Use £${owed}` });
      await expect(use).toBeVisible();
      const box44 = await use.boundingBox();
      expect(box44?.height ?? 0, 'Use £… is a 44 px target').toBeGreaterThanOrEqual(44);
      await check(page, 'Settle up, more than is owed');
      await use.click();
      if (await dialog.isVisible()) {
        await expect(amount).toHaveValue(owed.replace(/,/g, ''));
        await record.click();
      }
      await expect(balance(page).getByText('All square', { exact: true })).toBeVisible();
    });
  }
});
