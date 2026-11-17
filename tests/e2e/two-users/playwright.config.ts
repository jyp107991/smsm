/**
 * The two-user suite: the production build of the app against the Supabase local stack (not the demo build
 * that tests/e2e uses). Run with `npx playwright test -c tests/e2e/two-users/playwright.config.ts` after
 * `npx supabase start` and exporting the stack's variables (docs/slices/S2-ci.md).
 * Each scenario launches its own persistent Chromium profiles (see phone.ts), so `use` here only matters
 * for the request fixture.
 */
import { defineConfig } from '@playwright/test';

const port = Number(process.env.TWO_USERS_PORT ?? 4174);
const appUrl = process.env.TWO_USERS_APP_URL ?? `http://localhost:${String(port)}`;
process.env.TWO_USERS_APP_URL = appUrl;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../../playwright-report/two-users' }]] : 'list',
  outputDir: '../../../test-results/two-users',
  use: { baseURL: appUrl, trace: 'retain-on-failure' },
  webServer: {
    // The real build: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY point at the local stack.
    command: `npm run build && npx vite preview --port ${String(port)} --strictPort`,
    cwd: '../../..',
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
