import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const build = { version: pkg.version, commit: commitSha(), builtAt: new Date().toISOString() };

/** Writes /version.json so the smoke test (and a stale app) can compare versions with the server. */
function versionFile(): Plugin {
  return {
    name: 'smsm-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) + '\n' });
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_DEMO__: JSON.stringify(mode === 'demo'),
  },
  plugins: [
    react(),
    tailwindcss(),
    versionFile(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/favicon.svg'],
      manifest: {
        id: '/',
        name: 'smsm',
        short_name: 'smsm',
        description: 'A home ledger for two',
        lang: 'en-GB',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#DCDFCD',
        theme_color: '#DCDFCD',
        icons: [
          { src: '/icons/app-c-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/app-c-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/app-c-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/app-c-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
        ],
        // S6b (ADD-8, NOT-3): long-press the app's icon; each opens its sheet once (src/screens/shell/FromOutside.tsx).
        shortcuts: [
          { name: 'Add expense', short_name: 'Add', url: '/?do=add', icons: [{ src: '/icons/app-c-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Scan receipt', short_name: 'Scan', url: '/?do=scan', icons: [{ src: '/icons/app-c-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Settle up', short_name: 'Settle', url: '/?do=settle', icons: [{ src: '/icons/app-c-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // S6b (ADD-8, SPEC 5.3): smsm in Android's share sheet. The service worker keeps what was shared
        // (public/share-target.js) and opens /?do=shared.
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'photo', accept: ['image/*'] }] },
        },
      },
      workbox: {
        // A new version takes over as soon as it is installed, even with an old window open (owner, 17 Nov:
        // a phone stayed on an old build because the old worker waited for every window to close). The app
        // checks for it on launch and restarts with a progress bar (src/ui/LaunchUpdate.tsx).
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/version\.json$/, /^\/api\//],
        // S6b (ADD-8): POST /share (the share sheet) is answered by this, ahead of everything else.
        // S8 (NOT-1, NOT-2): push shows a notification; a tap opens its path.
        importScripts: ['/share-target.js', '/push.js'],
        // Latin font files are precached; the Korean slices (hundreds of small files, DESIGN §3.2) are not:
        // each is cached the first time a name or note needs it, and works offline from then on.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', '**/*-latin-*.woff2'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts-korean', expiration: { maxEntries: 300 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { sourcemap: true, target: 'es2023' },
}));
