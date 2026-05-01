# url_matcher Contract

## Overview

`blsi.UrlMatcher` is a pure utility module for URL pattern matching and per-site settings resolution. It implements a parse-then-match strategy that decomposes both the page URL and the user-entered pattern into structured parts (scheme, hostname, port, path) to prevent substring collisions — `notexample.com` never matches a rule for `example.com`. It has no DOM access, no storage access, and no side effects — safe to call synchronously from any context including background, content script, and popup.

## Public API

### matchesPattern(url, pattern, patternType)

**What**: Tests whether a full page URL matches a user-entered pattern string, using either wildcard (structured parse-then-match) or regex matching depending on `patternType`.

**Params**:
- `url` (string) — The full page URL, typically `location.href`. Must be parseable by `new URL()`.
- `pattern` (string) — The user-entered pattern string. Examples: `"example.com"`, `"*.example.com/app*"`, `"https://example.com:8080/path"`, `"/foo.*bar/"` (regex).
- `patternType` (string) — Matching strategy. `blsi.pattern_types.regex` activates regex mode. Any other value (including `undefined`, `null`, or `'wildcard'`) activates structured wildcard mode.

**Returns**: `boolean` — `true` if the URL matches the pattern; `false` for any mismatch, invalid input, over-length pattern, or parse/regex error.

**Side effects**: None.

**Handles**:
- `pattern` is falsy, not a string, or `typeof pattern !== 'string'` → returns `false`.
- `pattern.length > MAX_PATTERN_LENGTH` (500) → returns `false` immediately, before any parse or regex construction (prevents ReDoS and storage abuse).
- **Regex mode** (`patternType === blsi.pattern_types.regex`):
  - Pre-flight heuristic rejects nested/doubled quantifiers (`(a+)+`, `a**`, `a++`, etc.) matched by `/([+*?])\s*[)]\s*[+*?{]/.test(pattern)` and `/([+*?{])\s*\1/.test(pattern)` — returns `false` without constructing the RegExp.
  - Hash is stripped from the URL before testing: `url.replace(/#.*$/, '')`.
  - `new RegExp(pattern, 'i')` is constructed; if it throws `SyntaxError`, returns `false`.
  - Query string is included in the test subject (not stripped) — regex patterns can match query parameters.
- **Wildcard mode** (all other `patternType` values):
  - Wraps `new URL(url)` in a try/catch; malformed or non-HTTP URLs return `false`.
  - Hash is excluded automatically via `URL` parsing (`.hash` is never compared).
  - Query string is excluded from the URL side — `parsed.pathname` is compared, not the full `href` minus hash. Patterns that must match query params should use regex mode.
  - Scheme check: if the pattern begins with `https://` or `http://`, `parsed.protocol` must equal `scheme + ':'`. A `*://` prefix causes the scheme to be stripped but not checked. No scheme prefix = scheme is not checked.
  - Hostname matching (domain-boundary-aware):
    - `*.example.com` → matches `sub.example.com` but NOT bare `example.com` (via `endsWith('.' + patternHost)`).
    - `example.com` (no `*.`) → matches the hostname itself AND any subdomain (`sub.example.com`) via exact equality OR `endsWith('.' + patternHost)`.
    - Hostnames are lowercased during parse; comparison is always lowercase.
  - Port check: if pattern includes `:8080`, `parsed.port` must equal exactly. No port in pattern = port is not checked.
  - Path matching:
    - `null`, `'/'`, or `'/*'` in pattern → matches any path.
    - Pattern path ending in `*` → prefix match (`pagePath.startsWith(prefix)`).
    - Otherwise → exact match or exact match with trailing slash appended (`pagePath === patternPath || pagePath === patternPath + '/'`).

---

### isRestrictedUrl(url)

**What**: Tests whether a URL is a Chrome-restricted page where extensions cannot inject content scripts. The browser enforces this list at the platform level — `host_permissions: ["<all_urls>"]` does NOT bypass it. Used by both the popup (to swap in a "page restricted" empty state) and `background.js` (to skip restricted tabs during install-time programmatic re-injection).

**Params**:
- `url` (string | undefined | null) — A full URL string, typically `tab.url` from `chrome.tabs.query`.

**Returns**: `boolean` — `true` if the URL is restricted (extension cannot run); `false` if injection is permitted.

**Side effects**: None.

**Handles**:
- Falsy / non-string / malformed URL → returns `true` (treated as restricted; covers PDF viewer, devtools tabs, mid-navigation tabs with no committed URL).
- Restricted schemes (any path): `chrome:`, `chrome-extension:`, `edge:`, `about:`, `moz-extension:`, `view-source:`, `devtools:`, `chrome-search:`.
- Restricted hosts: `chromewebstore.google.com` (any path), `chrome.google.com` when path starts with `/webstore` (legacy Chrome Web Store URL).
- Hostname comparison is lowercased; protocol comparison uses the raw `parsed.protocol` value (always lowercase per the URL spec).
- Pure function — no DOM, no storage, no `chrome.*` access. Safe to call from background, popup, and content-script contexts.

---

### resolveSettings(url, globalSettings, urlRules)

**What**: Computes the effective settings for a given page URL by deep-merging the extension defaults, the user's global settings, and the first matching URL rule's partial settings override.

**Params**:
- `url` (string) — The full page URL (`location.href`).
- `globalSettings` (object) — The user's current global settings (from `blsi_model`). Treated as a partial object — missing keys fall through to built-in defaults.
- `urlRules` (Array | any) — Array of site rule entries. Each rule is expected to have `hostname_value` (string), `hostname_type` (string, value from `blsi.pattern_types`), and `settings` (partial settings object). A non-array value (including `null`, `undefined`) is tolerated and treated as no rules present.

**Returns**: `object` — A fully merged settings object. Merge priority from lowest to highest:
1. `blsi.DEFAULT_MODEL.global_default_settings` deep-merged with `blsi.DEFAULT_MODEL.blur_all.settings` (built-in floor).
2. `globalSettings` argument (user's global preference overrides).
3. The first matching rule's `settings` (per-site partial overrides).

**Side effects**: None. Reads `blsi.DEFAULT_MODEL` and calls `blsi.deep_merge` (both pure). Does not write to storage.

**Handles**:
- `urlRules` is not an array → skips the rule loop entirely; returns global + default merge.
- Empty `urlRules` array → no rule tested; returns global + default merge.
- Rule with no `settings` key → `rule.settings || {}` coalesces to empty object; the deep-merge is a no-op for that field.
- Multiple matching rules → only the **first** matching rule is applied; subsequent matches are ignored (explicit `break` after first match).
- A rule whose `hostname_value` is malformed, over-length, or whose `matchesPattern` returns `false` → that rule is silently skipped and iteration continues.
- `globalSettings` is `{}` or partially populated → only the provided keys override defaults; remaining defaults are preserved.

---

## Constants / Data

### MAX_PATTERN_LENGTH

`number` — Value: `500`. The maximum number of characters allowed in a pattern string. `matchesPattern` returns `false` immediately for any pattern exceeding this length. Exposed on the public return object so UI validation layers and storage guards can use the same threshold without a separate hardcoded constant.

---

## Internal Helpers (not exported)

Private to the IIFE. Documented here for maintainers; do not call from outside the module.

### parsePattern(pattern)

Decomposes a user-entered wildcard pattern string into `{ scheme, hostname, port, path, subdomainWildcard }`.

- Strips `https://`, `http://` (sets `scheme`), or `*://` (clears scheme).
- Strips `*.` prefix (sets `subdomainWildcard: true`).
- Splits at the first `/` to separate `hostPart` from `pathPart`.
- Extracts port from `host:port` if the suffix after the last `:` is all digits.
- Lowercases `hostname`. Returns a plain object — no validation, never throws.

### hostnameMatches(pageHost, patternHost, subdomainWildcard)

Applies domain-boundary-aware hostname comparison. When `subdomainWildcard` is `true`, uses `pageHost.endsWith('.' + patternHost)` (subdomain-only). Otherwise allows exact equality or `endsWith('.' + patternHost)` (includes all subdomains).

### pathMatches(pagePath, patternPath)

Applies path comparison. `null`, `'/'`, or `'/*'` pattern path → any page path matches. Pattern ending in `*` → `pagePath.startsWith(prefix)`. Otherwise exact match or exact match with trailing slash.

---

## Invariants

- `matchesPattern` is a pure function — no mutations, no I/O; all internal errors are caught and translated to `false`.
- `resolveSettings` is a pure function — returns a new object every call; never mutates its arguments.
- Hostname matching is always case-insensitive (hostnames lowercased in `parsePattern`; `URL` parsing normalizes page hostnames).
- Regex mode applies the `'i'` flag, making regex matches case-insensitive too.
- Hash (`#fragment`) is excluded on both paths: wildcard mode via `URL` parsing (`.hash` never compared); regex mode via `url.replace(/#.*$/, '')` before test.
- The module has no mutable module-level state — safe to call concurrently from content script, popup, and background without locking.
- `resolveSettings` always returns a valid settings object even when `globalSettings` is empty and no rules match — the built-in default model provides the floor.
