import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(globalIgnores(['dist/', 'coverage/', 'src/generated/']), {
  files: ['**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: globals.node,
  },
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
});
