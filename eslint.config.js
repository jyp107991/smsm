import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Money rule (DATA_MODEL §3): decimals exist only inside src/core/money.ts.
const moneySyntax = [
  { selector: "CallExpression[callee.name='parseFloat']", message: 'Money is integer pence: parse amounts with core/money.' },
  { selector: "CallExpression[callee.property.name='parseFloat']", message: 'Money is integer pence: parse amounts with core/money.' },
  { selector: "CallExpression[callee.property.name='toFixed']", message: 'Format money with core/money, not toFixed.' },
];
// The core never reads the clock (SPEC DAT-4): "now" is passed in.
const clockSyntax = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'core takes "today" as an argument.' },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'core takes "today" as an argument.' },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'core is deterministic.' },
];

export default tseslint.config(
  { ignores: ['.claude', 'dist', 'dist-demo', 'node_modules', 'coverage', 'reports', '.stryker-tmp', 'src/data/database.types.ts', 'supabase/functions'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': ['error', ...moneySyntax],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...moneySyntax, ...clockSyntax],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'react/*', '@supabase/*', 'motion', 'motion/*'], message: 'src/core is pure: no React, no network.' },
          { group: ['../data/*', '../ui/*', '../screens/*', '**/data/**', '**/ui/**', '**/screens/**'], message: 'src/core imports nothing from the other folders.' },
        ],
      }],
    },
  },
  { files: ['src/core/money.ts'], rules: { 'no-restricted-syntax': ['error', ...clockSyntax] } },
  {
    files: ['src/screens/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@supabase/*'], message: 'Screens use data hooks from src/data, not the client directly.' }],
      }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**', 'scripts/**', '*.config.{ts,js,mjs}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
);
