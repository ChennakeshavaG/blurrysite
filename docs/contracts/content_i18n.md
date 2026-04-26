# content_i18n Contract

## Overview

Runtime i18n loader for content scripts. Loads `_locales/<lang>/messages.json` via `fetch` + `chrome.runtime.getURL()` so content scripts can honor the user's LANGUAGE storage setting at runtime. `chrome.i18n.getMessage()` reads only the OS locale and cannot be overridden — this helper exists to bridge that gap. English is loaded once as a fallback and cached across re-inits.

## Module State

| Variable | Description |
|---|---|
| `_strings` | `Object<string, {message: string}>` — primary locale strings (empty if language is `'en'`) |
| `_fallback` | `Object<string, {message: string}>` — English fallback, loaded once and cached |
| `_lang` | `string` — last successfully initialized language code (default: `'en'`) |
| `_warnedKeys` | `Set<string>` — keys already warned about in current init; reset on each `init()` call |

## Public API

### init(requestedLang?)

**What**: Loads English fallback (once, cached) and the requested language as primary strings.  
**Params**: `requestedLang` (string, optional) — `'auto'` | `'en'` | `'hi_IN'` | `'ta_IN'` | undefined (treated as `'auto'`)  
**Returns**: `Promise<void>`  
**Side effects**:
- On first call: fetches `_locales/en/messages.json` into `_fallback`
- Resolves `'auto'` via `_resolveAuto()` against `blsi.supported_languages`
- Fetches primary locale JSON into `_strings` (empty object if language is `'en'`)
- Resets `_warnedKeys`  
**Handles**:
- Unsupported language code → treated as `'auto'`
- Same language already loaded with strings present → no-op (returns immediately)
- Fetch failure → returns `{}` (silently falls back to English)

### t(key, fallback?)

**What**: Synchronous string lookup — primary locale → English fallback → `fallback` arg → key itself.  
**Params**: `key` (string) — message key (camelCase per Chrome messages.json convention); `fallback` (string, optional) — literal to return if no translation found  
**Returns**: `string` — translated string, fallback string, or the key itself  
**Side effects**: Warns via `blsi.Logger.warn` (or `console.warn`) once per missing key per `init()` call  
**Handles**: Missing key in both primary and fallback → warns once (guarded by `_warnedKeys`) and returns `fallback || key`.

### get currentLang

**What**: Returns the language code of the last successful `init()` call.  
**Returns**: `string` — e.g. `'en'`, `'hi_IN'`, `'ta_IN'`

## Internal Functions

### _loadJSON(lang)

**What**: Fetches and parses `_locales/<lang>/messages.json` via `chrome.runtime.getURL`.  
**Params**: `lang` (string)  
**Returns**: `Promise<Object>` — parsed JSON or `{}` on any error  
**Handles**: Network failure, non-OK response, JSON parse error — all return `{}`.

### _resolveAuto(supported)

**What**: Resolves `'auto'` to a supported locale code by reading the browser UI language.  
**Params**: `supported` (string[]) — supported language codes from `blsi.supported_languages`  
**Returns**: `string` — resolved locale code (falls back to `'en'`)  
**Resolution order**: BCP47 → underscore conversion (`hi-IN` → `hi_IN`); tries full locale (`hi_IN`), then base lang (`hi`), then prefix match (`hi_` prefix in supported list); falls back to `'en'`.

## Invariants

- English fallback (`_fallback`) is loaded at most once per session, regardless of how many times `init()` is called.
- `_strings` is always `{}` when the language is `'en'` — `t()` falls through to `_fallback` directly.
- `_warnedKeys` is reset on every `init()` call so missing keys surface fresh for new locales.
- Missing keys never throw — they always return `fallback || key`.
- **Differs from popup i18n**: popup uses `chrome.i18n.getMessage()` (OS locale only); `ContentI18n` loads JSON at runtime to honor the user's LANGUAGE storage setting.
