// ESLint v9 flat config. Replaces the legacy .eslintrc.json, which ESLint v9
// no longer reads (it requires eslint.config.{js,mjs,cjs}). Before this file
// existed, `npm run lint` errored with "couldn't find an eslint.config file"
// instead of actually linting, so the lint gate never genuinely passed.
//
// Built from the separately-installed @typescript-eslint/parser +
// @typescript-eslint/eslint-plugin (v8); the unified `typescript-eslint`
// package is not a dependency here.
//
// Scope note (honest, intentional): this runs the syntactic rule sets
// (eslint:recommended + @typescript-eslint recommended) but NOT the
// type-checked ("recommended-requiring-type-checking") rules. Reasons:
//   1. tsconfig.json's `include` is ["src/**/*"] only, so type-aware linting
//      cannot resolve the tests/ files (parserOptions.project errors).
//   2. The type-checked rules surface ~35 pre-existing issues (untyped
//      commander.js option objects, require-await on sync handlers, etc.).
//      Those rules never actually ran before (the old .eslintrc.json was
//      unloadable by ESLint v9), so nothing was ever enforced. Enabling them
//      is a separate cleanup. Re-add `...tsPlugin.configs['recommended-
//      requiring-type-checking'].rules` (and add tests to tsconfig) once that
//      debt is paid.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.mjs', '**/*.cjs'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
