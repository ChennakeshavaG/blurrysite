# tests/ — Testing Guide for Claude Agents

See `../CLAUDE.md` for project-level rules. This file covers test-specific patterns.

## Quick Reference

```bash
npm run test:unit        # run all 5 unit test files (104 tests)
npm test                 # + coverage report (threshold: 70% lines + functions)
```

---

## Test File Pattern (all 5 unit files follow this)

```js
const fs   = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/xxx.js');

function loadXxx() {
  if (global.PrivacyBlurXxx) return;          // load only once per suite
  const src = fs.existsSync(MODULE_PATH)
    ? fs.readFileSync(MODULE_PATH, 'utf8')
    : buildStubSource();
  (0, eval)(src);                              // ← eval, NOT vm.runInThisContext
}

function buildStubSource() {
  return `(function() { 'use strict'; ... window.PrivacyBlurXxx = { ... }; })();`;
}
```

### Why `(0, eval)` and not `vm.runInThisContext`

`vm.runInThisContext` runs code in Node.js's V8 context where `window` is not defined.
`(0, eval)(src)` runs code in the current context — Jest's jsdom where `window === global`.
Both are established by `tests/setup.js` with `global.window = global`.

### The stub is the contract spec

The `buildStubSource()` inline stub in each test file defines the exact API contract that the real source file must satisfy. When the real file exists, tests run against it. When it does not exist, tests run against the stub. Either way, tests must pass.

---

## setup.js — What Is Mocked and Why

| Mock | Reason |
|---|---|
| `global.window = global` | IIFEs assign `window.PrivacyBlur*`; without this alias jsdom context loses the globals |
| `global.chrome = { runtime, storage, tabs, commands, contextMenus, action }` | All `jest.fn()` — lets unit tests assert message calls without a real browser |
| `HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeCtx)` | jsdom returns `null` from `getContext()`; `ctx.clearRect()` throws if not mocked |
| `global.requestAnimationFrame = jest.fn()` returning handle, **no callback execution** | Video blur loops call RAF recursively; auto-executing causes OOM |
| `global.cancelAnimationFrame = jest.fn()` | Tests assert RAF is cancelled on video `removeBlur` |
| `beforeEach(() => jest.clearAllMocks())` | Resets call counts between every test |

**Do not change the RAF stub to execute callbacks.** This was the cause of a heap OOM in development.

---

## Common Test Patterns

### Testing async chrome.runtime.sendMessage calls

```js
// Success response
chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
  if (cb) cb({ selectors: ['#foo'] });
});

// Error via lastError
chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
  Object.defineProperty(chrome.runtime, 'lastError', {
    value: { message: 'Extension context invalidated' },
    configurable: true,
  });
  if (cb) cb(undefined);
  Object.defineProperty(chrome.runtime, 'lastError', {
    value: null,
    configurable: true,
  });
});
```

### Testing keyboard events

Fire events directly on `document` — capture-phase listeners on document still fire for events dispatched at document (at-target rule):

```js
function fireKey(key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey:  modifiers.ctrl  || false,
    altKey:   modifiers.alt   || false,
    shiftKey: modifiers.shift || false,
    metaKey:  modifiers.meta  || false,
  });
  document.dispatchEvent(event);
  return event;
}
```

### Resetting picker state between tests

```js
beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  jest.clearAllMocks();
  try { PrivacyBlurPicker.deactivate(); } catch (_) {}
});
afterEach(() => {
  try { PrivacyBlurPicker.deactivate(); } catch (_) {}
});
```

### Resetting shortcut handler state between tests

```js
afterEach(() => {
  PrivacyBlurShortcuts.destroy();
});
```

---

## Coverage Requirements

Enforced in `jest.config.js`:

```js
coverageThreshold: {
  global: { lines: 70, functions: 70 }
}
```

Only `src/**/*.js` files count toward coverage. `background.js`, `popup/`, `tests/` are excluded.

If you add a new file to `src/`, add a corresponding `tests/unit/xxx.test.js`. The file will fail the threshold if left untested.

---

## e2e Tests (tests/e2e/blur.spec.js)

Uses Puppeteer to launch real Chromium with the extension loaded. Requires Chrome to be installed.

```bash
npm run test:e2e

# Skip in CI (no Chrome available):
SKIP_E2E=1 npm test
```

E2e tests do not run in the `unit` Jest project — they are in a separate `e2e` project with `testEnvironment: 'node'`.
