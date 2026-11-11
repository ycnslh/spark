const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['**/node_modules/**', 'data/**', 'coverage/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map((name) => [name, 'off'])),
        ...globals.browser,
      },
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...Object.fromEntries(Object.keys(globals.browser).map((name) => [name, 'off'])),
        ...globals.serviceworker,
      },
    },
  },
];
