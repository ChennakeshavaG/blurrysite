# content_i18n Test Contract

## Overview

Tests for `src/content_i18n.js` (`blsi.ContentI18n`). Verifies module exposure on `blsi`, `init()` for explicit locales (`en`, `hi_IN`, `ta_IN`), automatic locale resolution via `chrome.i18n.getUILanguage()` (not `navigator.language`), the fallback chain for missing translation keys, the `t(key, fallback)` explicit fallback argument, unknown-key passthrough to the key string itself, missing-key warn-once deduplication, and graceful recovery from fetch failures.

The module is structurally parallel to `popup_i18n.js`; the primary distinction is that `content_i18n` reads the browser UI locale from `chrome.i18n.getUILanguage()` rather than `navigator.language`.

## Setup & Teardown

- **`beforeAll`**: installs `chrome.runtime.getURL` mock returning a `chrome-extension://test/<path>` URL; installs `chrome.i18n.getUILanguage` mock returning `'en'` by default; loads the module once via `require(MODULE_PATH)` if the file exists (enables Istanbul coverage).
- **`beforeEach`**: saves `global.fetch`; spies on `console.warn` with `.mockImplementation(() => {})` to silence missing-key warnings in tests that do not exercise the warn path.
- **`afterEach`**: restores `global.fetch` and the `console.warn` spy.
- **`mockFetch(map)`** local helper: replaces `global.fetch` with a `jest.fn()` that matches request URL substrings against map keys and returns `{ ok: true, json: async () => body }` for matches; returns `{ ok: false }` for unmatched URLs.
- Locale message format: `{ key: { message: "..." } }` (Chrome extensions messages.json shape).

## Test Groups

### blsi.ContentI18n

- `module is exposed on blsi` — `blsi.ContentI18n` is defined and exposes `init` and `t` as functions.
- `init('en') only fetches the English file` — after `init('en')`, `t('pickerClearBtn')` returns `'Clear'` (the English value) and `currentLang` is `'en'`.
- `init('hi_IN') loads Hindi as primary, falls back to English for missing keys` — after `init('hi_IN')`, `t('pickerClearBtn')` returns the Hindi value `'साफ़'`; `t('onlyEn')` (key absent from Hindi locale) returns the English fallback `'EN only'`; `currentLang` is `'hi_IN'`.
- `init('ta_IN') loads Tamil` — after `init('ta_IN')`, `t('pickerClearBtn')` returns the Tamil value `'அழி'`.
- `init('auto') with hi-IN UI language resolves to hi_IN` — when `chrome.i18n.getUILanguage()` returns `'hi-IN'`, `init('auto')` resolves to Hindi; `t('pickerClearBtn')` returns `'साफ़'`.
- `init('auto') with bare 'ta' UI language resolves to ta_IN` — when `chrome.i18n.getUILanguage()` returns `'ta'` (no region tag), `init('auto')` resolves to the first supported `ta_*` variant; `t('pickerClearBtn')` returns `'அழி'`.
- `init('auto') with unsupported UI language clamps to English` — when `chrome.i18n.getUILanguage()` returns `'fr-FR'`, `init('auto')` falls back to English; `currentLang` is `'en'`.
- `t(key, fallback) returns fallback when neither cache has the key` — `t('totally_unknown', 'My Fallback')` returns `'My Fallback'` when the key is absent from both locale and fallback caches.
- `t(key) with no fallback returns the key itself` — `t('totally_unknown')` returns the key string `'totally_unknown'` when no fallback argument is supplied.
- `missing key logs once per key per init` — calling `t('ghost_key', 'English fallback')` three times triggers exactly one `console.warn` call; the warning message includes the substring `'missing key: ghost_key'`.
- `failed fetch leaves t() returning the fallback literal` — when `global.fetch` throws a network error, `init('hi_IN')` completes without throwing; subsequent `t('newKey', 'English fallback')` returns `'English fallback'`.

## Edge Cases Covered

- Bare language tag without region (`'ta'`) is matched against supported locales by prefix to resolve `'ta_IN'`.
- Unsupported UI language (`'fr-FR'`) clamps to English rather than crashing or producing `undefined`.
- Fetch failure (thrown error) is caught; module degrades gracefully, returning supplied fallback strings.
- Missing-key warnings are deduplicated per key per `init()` call to prevent console spam.

## Coverage Gaps

- No test for `currentLang` getter before any `init()` call — should default to `'en'`.
- No test for `init()` with an unsupported explicit language string (e.g. `'xyz_XY'`) — expected to fall back to English but unverified.
- No test for `t(key, fallback)` where `fallback` is `null`, `undefined`, or an empty string.
- No test for `_resolveAuto()` with a bare language code that has no supported variant (e.g. `'fr'` with no `fr_*` in `SUPPORTED_LANGUAGES`).
- All auto-resolution tests use `chrome.i18n.getUILanguage()`; no test confirms the module does NOT read `navigator.language`.
