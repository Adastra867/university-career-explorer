import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['public/**', 'node_modules/**', 'coverage/**', 'artifacts/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'], languageOptions: { globals: globals.node, ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }] },
  },
  { files: ['tests/browser/*.js'], languageOptions: { globals: { ...globals.browser, appData: 'writable', goToStep: 'readonly', analyzeExperience: 'readonly', switchJDMode: 'readonly', matchJD: 'readonly', openCareerAssistant: 'readonly', closeCareerAssistant: 'readonly', sendChat: 'readonly', extractSkills: 'readonly' } } },
];
