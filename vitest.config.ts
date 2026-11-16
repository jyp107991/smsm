import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const define = { __APP_VERSION__: '"0.0.0-test"', __APP_COMMIT__: '"test"', __APP_DEMO__: 'false' };

export default defineConfig({
  define,
  plugins: [react()],
  test: {
    projects: [
      {
        define,
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        define,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/{ui,screens,data}/**/*.test.{ts,tsx}', 'src/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup-ui.ts'],
        },
      },
    ],
  },
});
