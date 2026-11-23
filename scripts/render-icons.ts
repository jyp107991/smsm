/**
 * Renders the hand-written SVG icons in public/icons/ to the PNGs the manifest needs, and (S8) the notification
 * icons: each animal's head from the rig itself (src/ui/rig/Animal.tsx, drawn on the paper colour, so a phone that
 * crops it to a circle still shows a whole head) and the monochrome badge Android tints for the status bar.
 * Usage: npx tsx scripts/render-icons.ts   (set PW_CHROMIUM_PATH to use a pre-installed Chromium)
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const jobs: { src: string; out: string; size: number; inset?: number }[] = [
  { src: 'icon.svg', out: 'app-c-192.png', size: 192 },
  { src: 'icon.svg', out: 'app-c-512.png', size: 512 },
  { src: 'icon.svg', out: 'app-c-maskable-512.png', size: 512 },
  { src: 'icon-monochrome.svg', out: 'app-c-monochrome-512.png', size: 512 },
  // S8: the notification's badge (Android uses only its shape).
  { src: 'icon-monochrome.svg', out: 'badge-96.png', size: 96 },
];

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const j of jobs) {
  const svg = readFileSync(`public/icons/${j.src}`, 'utf8');
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: `public/icons/${j.out}`, omitBackground: true });
  console.log(`wrote public/icons/${j.out}`);
}

// S8: the sender's head as the notification's icon (DESIGN §2.3, "Notifications"), from the rig, in the light theme.
const vite = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const rig = (await vite.ssrLoadModule('/src/ui/rig/Animal.tsx')) as { Animal: ComponentType<Record<string, unknown>> };
  const css = ['src/styles/tokens.css', 'src/ui/rig/rig.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const SIZE = 192;
  for (const kind of ['cat', 'dog'] as const) {
    const head = renderToStaticMarkup(createElement(rig.Animal, { kind, pose: 'head', mood: 'calm', size: Math.round(SIZE * 0.8), motion: false }));
    await page.setViewportSize({ width: SIZE, height: SIZE });
    await page.setContent(
      `<html><head><style>:root{color-scheme:light}${css}</style></head><body style="margin:0">` +
      `<div id="icon" style="width:${String(SIZE)}px;height:${String(SIZE)}px;display:flex;align-items:center;justify-content:center;background:var(--paper)">${head}</div>` +
      '</body></html>',
    );
    await page.locator('#icon').screenshot({ path: `public/icons/head-${kind}.png` });
    console.log(`wrote public/icons/head-${kind}.png`);
  }
} finally {
  await vite.close();
}
await browser.close();
