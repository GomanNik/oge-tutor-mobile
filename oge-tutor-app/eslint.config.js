/*
 * OGE Tutor App — ESLint flat configuration.
 * The project is plain JavaScript/JSX, so this config focuses on production-safe syntax and common error rules.
 */
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.mjs', 'tests/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
        React: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^React$|^jsx$' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/data\\/initialData|services\\/storage|services\\/importers|app\\/actions/]",
          message: 'Legacy frontend-only modules must not be imported into runtime code.',
        },
      ],
    },
  },
];
