# tests/ — Testing Guide for Claude Agents

See `../CLAUDE.md` for project-level rules. This file covers test-specific patterns.

## Quick Reference

```bash
npm run test:unit        # run all 6 unit test files (215 tests)
npm test                 # + coverage report (~91% line coverage on src/)
```

---

## Test File Pattern (all 5 unit files follow this)

```js
const fs   = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/xxx.js');

function loadXxx() {
  if (global.PrivacyBlurXxx) return;          // load only once per suite
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);                      // require() enables Istanbul coverage
  } else {
    (0, eval)(buildStubSource());              // fallback stub for contract testing
  }
}

function buildStubSource() {
  return `(function() { 'use strict'; ... window.PrivacyBlurXxx = { ... }; })();`;
}
```

### Why `require()` and not `eval()`

Source files are loaded via `require()` so Jest's Istanbul transform instruments them for coverage. The earlier `(0, eval)(fs.readFileSync(...))` pattern bypassed the require chain, causing 0% coverage. The `buildStubSource()` fallback still uses `eval()` since stubs are inline strings.

### The stub is the contract spec

The `buildStubSource()` inline stub in each test file defines the exact API contract that the real source file must satisfy. When the real file exists, tests run against it. When it does not exist, tests run against the stub. Either way, tests must pass.

---

## setup.js — What Is Mocked and Why

| Mock | Reason |
|---|---|
| `global.window = global` | IIFEs assign `window.PrivacyBlur*`; without this alias jsdom context loses the globals |
| `require('../src/constants.js')` | Loads message types + DEFAULTS before any source module |
| `global.chrome = { runtime, storage, tabs, commands, contextMenus, action }` | All `jest.fn()` — lets unit tests assert message calls without a real browser |
| `HTMLCanvasElement.prototype.getContext = jest.fn(() => fakeCtx)` | jsdom returns `null` from `getContext()`; `ctx.clearRect()` throws if not mocked |
| `global.requestAnimationFrame = jest.fn()` returning handle, **no callback execution** | Video blur loops call RAF recursively; auto-executing causes OOM |
| `global.cancelAnimationFrame = jest.fn()` | Tests assert RAF is cancelled on video `removeBlur` |
| `KeyboardEvent.prototype.getModifierState = function() { return false; }` | jsdom may not implement it; shortcut handler uses it for AltGr detection |
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
    code:        modifiers.code        || '',
    bubbles:     true,
    cancelable:  true,
    ctrlKey:     modifiers.ctrl        || false,
    altKey:      modifiers.alt         || false,
    shiftKey:    modifiers.shift       || false,
    metaKey:     modifiers.meta        || false,
    repeat:      modifiers.repeat      || false,
    isComposing: modifiers.isComposing || false,
  });
  document.dispatchEvent(event);
  return event;
}
```

### Testing AltGr (getModifierState)

```js
const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
event.getModifierState = jest.fn((mod) => mod === 'AltGraph');
document.dispatchEvent(event);
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

## Coverage

Configured in `jest.config.js`:

```js
collectCoverageFrom: ['src/**/*.js', '!src/content_script.js']
```

`content_script.js` is excluded because it's an orchestrator tested via e2e, not unit tests. All other `src/` files are instrumented via `require()`.

If you add a new file to `src/`, add a corresponding `tests/unit/xxx.test.js`.

---

## Documentation

**Every test must be documented in `docs/TEST_VALIDATION.md`** with:
- Test name (exact string from `test('...')`)
- What it asserts
- Step-by-step manual replication instructions for verifying in a real browser

When adding, modifying, or removing tests, update `docs/TEST_VALIDATION.md` in the same commit.

---

## e2e Tests (tests/e2e/)

Uses Puppeteer to launch real Chromium with the extension loaded. Requires Chrome to be installed.

```bash
npm run test:e2e

# Skip in CI (no Chrome available):
SKIP_E2E=1 npm test
```

E2e tests do not run in the `unit` Jest project — they are in a separate `e2e` project with `testEnvironment: 'node'`.
