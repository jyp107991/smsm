/**
 * The S0 gallery (DESIGN §7), served by the demo build. S0's own checks: renders at 390×800 and
 * 320×568 without horizontal overflow, in both themes, axe clean, and reduced motion stops all motion.
 * BAL-3: the plank at five balances.
 *
 * What the page must provide: each section is a <section> labelled by its heading (so it is a region
 * with that name): "The mark", "Letters", "Colours", "The plank", "The cat and the dog", "On the page".
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 390, height: 800 },
  { width: 320, height: 568 },
] as const;
const THEMES = ['light', 'dark'] as const;
const SECTIONS = ['The mark', 'Letters', 'Colours', 'The plank', 'The cat and the dog', 'On the page'];

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function openGallery(page: Page, theme: (typeof THEMES)[number] = 'light'): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/gallery');
  await expect(page.getByRole('heading', { name: 'The mark', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'The cat and the dog', exact: true }).locator('svg[role="img"]').first()).toBeVisible();
  await settle(page);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectAxeClean(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${String(v.nodes.length)} node(s), e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`,
  );
  expect(summary).toEqual([]);
}

async function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
}

test.describe('gallery', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: every section, no horizontal overflow, axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openGallery(page, theme);
        for (const name of SECTIONS) {
          await expect(page.getByRole('heading', { name, exact: true }).first(), `heading "${name}"`).toBeVisible();
          await expect(page.getByRole('region', { name, exact: true }), `region "${name}"`).toHaveCount(1);
        }
        await expectNoHorizontalOverflow(page);
        await expectAxeClean(page);
      });
    }
  }

  test('BAL-3: the plank at five balances: level, both ways, never past 8°', async ({ page }) => {
    await openGallery(page);
    const tilted = page.getByRole('region', { name: 'The plank', exact: true }).locator('[data-tilt]');
    await expect(tilted).toHaveCount(5);
    const tilts = (await tilted.evaluateAll((els) => els.map((el) => el.getAttribute('data-tilt')))).map(Number);
    for (const t of tilts) {
      expect(Number.isFinite(t)).toBe(true);
      expect(Math.abs(t)).toBeLessThanOrEqual(8);
    }
    expect(tilts).toContain(0);
    expect(tilts.some((t) => t > 0)).toBe(true);
    expect(tilts.some((t) => t < 0)).toBe(true);
    expect(new Set(tilts).size).toBe(5);
  });

  test('both animals in every mood × pose (2 × 8 × 4 = 64)', async ({ page }) => {
    await openGallery(page);
    const animals = page.getByRole('region', { name: 'The cat and the dog', exact: true }).locator('svg[role="img"]');
    await expect(animals).toHaveCount(64);
    const names = await animals.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent));
    expect(names.filter((n) => /cat/i.test(n)).length).toBe(32);
    expect(names.filter((n) => /dog/i.test(n)).length).toBe(32);
  });

  test('with motion allowed, the animals move', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openGallery(page);
    await expect.poll(() => runningAnimations(page)).toBeGreaterThan(0);
  });

  test('reduced motion stops all motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGallery(page);
    await page.waitForLoadState('load');
    // Give anything that would start on mount (springs, view transitions, CSS keyframes) time to start.
    await page.waitForTimeout(500);
    expect(await runningAnimations(page)).toBe(0);
    await page.waitForTimeout(1000);
    expect(await runningAnimations(page)).toBe(0);
  });
});

test.describe('the shell at /', () => {
  for (const theme of THEMES) {
    test(`${theme}: axe clean, no horizontal overflow at 390 and 320`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'smsm' })).toBeVisible();
      await settle(page);
      await expectAxeClean(page);
      await expectNoHorizontalOverflow(page);
      await page.setViewportSize({ width: 320, height: 568 });
      await expectNoHorizontalOverflow(page);
      await expectAxeClean(page);
    });
  }
});
