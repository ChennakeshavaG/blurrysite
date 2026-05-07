'use strict';

const js = require('@eslint/js');
const globals = require('globals');

const sharedRules = {
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
  }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-redeclare': ['error', { builtinGlobals: false }],
};

const extensionGlobals = {
  chrome: 'readonly',
  blsi: 'writable',
  importScripts: 'readonly',
};

const popupGlobals = {
  BlurrySitePopupState: 'writable',
  BlurrySitePopupUI: 'writable',
  BlurrySitePopupShared: 'writable',
  BlurrySitePopupRender: 'writable',
  BlurrySitePopupRenderGeneral: 'writable',
  BlurrySitePopupRenderHtb: 'writable',
  BlurrySitePopupRenderMyPage: 'writable',
  BlurrySitePopupRenderProtect: 'writable',
  BlurrySitePopupRenderShortcuts: 'writable',
  BlurrySitePopupRenderSiteRules: 'writable',
  BlurrySitePopupRenderTriggers: 'writable',
};

module.exports = [
  {
    ignores: ['node_modules/', 'dist/', 'docs/', '_locales/', 'tests/perf/'],
  },

  // src/ — browser extension content scripts (IIFEs)
  {
    ...js.configs.recommended,
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...extensionGlobals,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },

  // popup/ — extension popup (IIFEs, cross-file globals)
  {
    ...js.configs.recommended,
    files: ['popup/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...extensionGlobals,
        ...popupGlobals,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules, 'no-redeclare': 'off' },
  },

  // background.js — service worker
  {
    ...js.configs.recommended,
    files: ['background.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
        ...extensionGlobals,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },

  // tests/ — Jest (Node environment)
  {
    ...js.configs.recommended,
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...extensionGlobals,
        ...popupGlobals,
        _fireStorageChanged: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },

  // PII modules — regex escapes and Unicode whitespace are intentional
  {
    files: ['src/pii/**/*.js', 'tests/unit/pii/**/*.js'],
    rules: {
      'no-useless-escape': 'off',
      'no-irregular-whitespace': 'off',
    },
  },

  // build.js and scripts/ — Node
  {
    ...js.configs.recommended,
    files: ['build.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: { ...js.configs.recommended.rules, ...sharedRules },
  },
];
