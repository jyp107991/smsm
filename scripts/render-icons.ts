/**
 * Renders the hand-written SVG icons in public/icons/ to the PNGs the manifest needs.
 * Usage: npx tsx scripts/render-icons.ts   (set PW_CHROMIUM_PATH to use a pre-installed Chromium)
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const jobs: { src: string; out: string; size: number; inset?: number }[] = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon.svg', out: 'icon-maskable-512.png', size: 512 },
  { src: 'icon-monochrome.svg', out: 'icon-monochrome-512.png', size: 512 },
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
await browser.close();
