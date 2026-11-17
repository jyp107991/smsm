// Mutation testing for the money core (docs/ENGINEERING.md §4.3): the score must stay at or above 85%.
// Options checked against @stryker-mutator/core 10.1.1's stryker-schema.json and the vitest-runner's options.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts', related: true },
  mutate: ['src/core/money.ts', 'src/core/split.ts', 'src/core/balance.ts', 'src/core/recurring.ts'],
  coverageAnalysis: 'perTest',
  thresholds: { high: 90, low: 85, break: 85 },
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // Nothing in these is needed to run the core tests; copying them into the sandbox only slows Stryker down.
  ignorePatterns: ['/.claude', '/dist', '/dist-demo', '/test-results', '/playwright-report', '/coverage'],
};
