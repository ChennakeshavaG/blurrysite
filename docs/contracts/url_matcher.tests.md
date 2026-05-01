# url_matcher Test Contract

## Overview

Unit tests for `src/url_matcher.js`. The module exposes `blsi.UrlMatcher` with three public members: `matchesPattern(url, pattern, type)`, `resolveSettings(url, globals, rules)`, and the constant `MAX_PATTERN_LENGTH`.

The file uses a load-guard pattern: it calls `require(MODULE_PATH)` when the file exists (enabling Istanbul coverage) and falls back to an inline `buildStubSource()` eval when it does not. The stub satisfies the same public API contract.

---

## Setup & Teardown

- `loadUrlMatcher()` is called once at module scope (load-guard: skips if `blsi.UrlMatcher` already assigned).
- Destructured bindings `{ matchesPattern, resolveSettings, MAX_PATTERN_LENGTH }` are captured at load time.
- No `beforeEach` / `afterEach` hooks in this file.
- `jest.clearAllMocks()` runs globally between tests via `tests/setup.js`.

---

## Test Groups

### UrlMatcher.matchesPattern — wildcard mode

- `bare hostname matches exact` — `'https://example.com/page'` matches pattern `'example.com'`.
- `bare hostname matches subdomain` — `'https://sub.example.com/'` matches pattern `'example.com'`.
- `bare hostname does NOT match domain-boundary attack (notexample.com)` — `'notexample.com'` does not match `'example.com'`; the suffix check must respect domain boundaries.
- `*.example.com matches subdomains only, not root` — `'https://sub.example.com/'` matches; `'https://example.com/'` does not.
- `scheme restriction enforced` — `'http://example.com/'` does not match `'https://example.com'`; same URL with `https` does.
- `port restriction enforced` — `'example.com:8080'` matches only when port in URL equals `:8080`; `:9000` does not match.
- `default port normalized by URL — :443 on https` — `'https://example.com/'` (no explicit port) matches `'example.com'`.
- `path prefix wildcard matches` — `'example.com/app*'` matches `/app/home`; does not match `/other`.
- `exact path matches with trailing slash tolerance` — both `'/app'` and `'/app/'` match pattern `'example.com/app'`.
- `empty or invalid patterns return false` — `''`, `null`, `undefined` all return `false`.
- `pattern exceeding MAX_PATTERN_LENGTH returns false` — string of `MAX_PATTERN_LENGTH + 1` characters returns `false`.

### UrlMatcher.matchesPattern — regex mode

- `valid regex matches url without hash` — `'^https://example\\.com/x$'` matches the URL after stripping the fragment `#frag`.
- `case insensitive` — `'EXAMPLE.com'` in URL is matched by lowercase pattern `'example\\.com'`.
- `rejects nested quantifiers (ReDoS)` — `'(a+)+'` and `'a**'` both return `false` (ReDoS guard).
- `invalid regex returns false, no throw` — `'[unclosed'` is an invalid regex; function returns `false` without throwing.

### UrlMatcher.resolveSettings

- `no rules → returns merged defaults over globals` — with empty rules array, `blur_radius` from `globals` is present and `blur_categories` is defined (defaults filled in).
- `first-match-wins among rules` — two rules both matching the URL; only the first rule's `blur_radius: 30` is used, not the second's `blur_radius: 99`.
- `non-matching rule falls through to globals` — rule for `'other.com'` is skipped; `globals.blur_radius: 10` is returned.
- `rule settings deep-merged (partial override preserves other keys)` — rule overrides `blur_radius: 50`; `reveal_mode: 'hover'` from globals is preserved.
- `null/undefined rules array tolerated` — calling `resolveSettings` with `null` or `undefined` as the rules argument does not throw.

### UrlMatcher.isRestrictedUrl

- `chrome:// pages are restricted` — `chrome://newtab`, `chrome://extensions`, `chrome://settings/cookies` all return `true`.
- `chrome-extension:// pages are restricted` — extension UI URLs return `true`.
- `Chrome Web Store hosts are restricted` — both `chromewebstore.google.com` (any path) and `chrome.google.com/webstore*` legacy URL return `true`.
- `chrome.google.com outside /webstore is NOT restricted` — `chrome.google.com/about` and `chrome.google.com/` return `false`.
- `about: / view-source: / devtools: / moz-extension: / edge: / chrome-search: are restricted` — full set of platform-blocked schemes return `true`.
- `regular https / http URLs are NOT restricted` — `example.com`, `news.ycombinator.com` return `false`.
- `empty / null / undefined / non-string URLs are restricted` — all falsy + non-string inputs return `true` (covers PDF viewer, devtools tabs, mid-navigation tabs).
- `malformed URLs are restricted` — un-parseable strings return `true`.
- `hostname comparison is case-insensitive` — `ChromeWebStore.Google.Com` resolves to the lowercase host before comparison.

---

## Edge Cases Covered

- Domain-boundary attack: `'notexample.com'` must not match pattern `'example.com'` (hostname suffix must be preceded by `.` or be the full hostname).
- URL with hash fragment in regex mode: fragment is stripped before matching.
- ReDoS guard: nested quantifiers (`(a+)+`, `a**`) are rejected before regex execution.
- Invalid regex syntax: caught without throw; returns `false`.
- `MAX_PATTERN_LENGTH` early-exit guard: oversized patterns rejected before any URL parsing.
- Default port normalization: browser's `URL` constructor normalises `:443` away for `https`, so no special handling needed.
- Trailing slash tolerance in wildcard path matching.
- `null`/`undefined` passed as rules to `resolveSettings` (graceful no-op).

---

## Coverage Gaps

The test file itself annotates the following missing coverage (preserved here verbatim):

- **Wildcard mode:**
  - No test for a completely malformed URL string (triggers `try/catch` path in implementation).
  - No test verifying query strings (`?key=val`) are ignored in wildcard hostname/path matching.
  - No test for case sensitivity of the wildcard hostname suffix check (`*.EXAMPLE.COM` vs `*.example.com`).
  - No test for hash fragment in wildcard mode (regex mode strips `#frag` — wildcard mode untested).
  - `MAX_PATTERN_LENGTH` enforcement tested for wildcard only; not tested for regex mode.

- **Regex mode:**
  - ReDoS guard tested against only 2 patterns; weak confidence for edge cases like `(a|aa)+`, `(a+)*`, `x{1,30}{1,30}`.
  - No test for hash fragment stripping when the fragment is part of the pattern itself.

- **resolveSettings:**
  - No test for a rule missing the `patternType` / `hostname_type` field (should default to wildcard or skip).
  - No test for a rule whose `settings` object is `null` or `undefined`.
  - No test for `globals` being `null` (should fall back to defaults only).
  - No test that a rule with the correct hostname but `blur_all: false` interacts correctly with `resolveSettings`.
