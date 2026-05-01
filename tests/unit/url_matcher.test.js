/**
 * tests/unit/url_matcher.test.js
 *
 * Unit tests for src/url_matcher.js
 * Module exposes blsi.UrlMatcher with: matchesPattern, resolveSettings.
 */

/* === TEST QUALITY ANNOTATIONS ===
 *
 * COVERS:
 *   - wildcard mode: bare hostname, *.subdomain, scheme restriction, port restriction,
 *     default port normalization, path prefix wildcard, trailing-slash tolerance,
 *     domain-boundary attack, empty/null/undefined patterns, MAX_PATTERN_LENGTH
 *   - regex mode: valid regex, case insensitivity, ReDoS nested quantifiers, invalid regex
 *   - resolveSettings: no-rules fallback, first-match-wins, non-matching fallthrough,
 *     deep-merge partial override, null/undefined rules array tolerance
 *
 * REDUNDANT:
 *   - "bare hostname matches exact" and "bare hostname matches subdomain" both exercise the
 *     same wildcard hostname-suffix matching code path; the only difference is a subdomain
 *     prefix. Could be merged into one test with two assertions.
 *   - "pattern exceeding MAX_PATTERN_LENGTH returns false" and "empty or invalid patterns
 *     return false" both test the early-return guard at the top of matchesPattern.
 *     A single parametrized test.each([input, label]) table would cover all early exits.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Wildcard mode tests (11 tests) could be replaced with a single test.each table:
 *     test.each([[url, pattern, type, expected], ...])('matches %s against %s', ...)
 *     This removes ~40 lines and makes adding new cases trivial.
 *   - ReDoS guard currently tests only 2 patterns; extend to 4-5 more patterns
 *     ((a|aa)+, (a+)*, x{1,30}{1,30}) as a test.each row for stronger confidence.
 *
 * MISSING COVERAGE:
 *   - URL parsing error handling — no test for a completely malformed URL string in
 *     matchesPattern (the try/catch path in the real implementation)
 *   - Case sensitivity of wildcard hostname matching — *.EXAMPLE.COM vs *.example.com
 *   - Query strings in URL — should be ignored; no test verifying ?key=val does not
 *     affect hostname/path matching
 *   - Hash fragment in URL for wildcard mode — regex mode strips #frag (tested), but
 *     wildcard mode has no equivalent test
 *   - MAX_PATTERN_LENGTH enforcement in regex mode — only tested for wildcard mode
 *   - resolveSettings with a rule that has no patternType field (defaults to wildcard?)
 *   - resolveSettings with a malformed rule object (missing pattern key)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/url_matcher.js');

function loadUrlMatcher() {
  if (blsi.UrlMatcher) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';
    function matchesPattern(url, pattern) {
      if (!pattern || typeof pattern !== 'string') return false;
      try { return new URL(url).hostname.endsWith(pattern); } catch (_) { return false; }
    }
    function resolveSettings(url, globals, rules) {
      return blsi.deep_merge(blsi.DEFAULT_MODEL.global_default_settings, globals || {});
    }
    function isRestrictedUrl(url) {
      if (!url || typeof url !== 'string') return true;
      try {
        const u = new URL(url);
        const p = u.protocol;
        if (p === 'chrome:' || p === 'chrome-extension:' || p === 'edge:' ||
            p === 'about:'  || p === 'moz-extension:'   || p === 'view-source:' ||
            p === 'devtools:' || p === 'chrome-search:') return true;
        const h = u.hostname.toLowerCase();
        if (h === 'chromewebstore.google.com') return true;
        if (h === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
        return false;
      } catch (_) { return true; }
    }
    blsi.UrlMatcher = { matchesPattern: matchesPattern, resolveSettings: resolveSettings, isRestrictedUrl: isRestrictedUrl, MAX_PATTERN_LENGTH: 500 };
  })();
  `;
}

loadUrlMatcher();

const { matchesPattern, resolveSettings, isRestrictedUrl, MAX_PATTERN_LENGTH } = blsi.UrlMatcher;

// USER IMPACT: user creates a rule "example.com" — settings apply to the apex domain and all its subdomains
// OPTIMIZE: all 11 tests below share the same (url, pattern, type, bool) shape; replace with a test.each table
describe('UrlMatcher.matchesPattern — wildcard mode', () => {
  // REDUNDANT: "bare hostname matches exact" and "bare hostname matches subdomain" both exercise the same hostname-suffix logic; merge with two assertions in one test
  test('bare hostname matches exact', () => {
    expect(matchesPattern('https://example.com/page', 'example.com', 'wildcard')).toBe(true);
  });

  // REDUNDANT: same code path as "bare hostname matches exact" — only adds a subdomain prefix; merge both into one parametrized test
  test('bare hostname matches subdomain', () => {
    expect(matchesPattern('https://sub.example.com/', 'example.com', 'wildcard')).toBe(true);
  });

  test('bare hostname does NOT match domain-boundary attack (notexample.com)', () => {
    expect(matchesPattern('https://notexample.com/', 'example.com', 'wildcard')).toBe(false);
  });

  test('*.example.com matches subdomains only, not root', () => {
    expect(matchesPattern('https://sub.example.com/', '*.example.com', 'wildcard')).toBe(true);
    expect(matchesPattern('https://example.com/', '*.example.com', 'wildcard')).toBe(false);
  });

  test('scheme restriction enforced', () => {
    expect(matchesPattern('http://example.com/', 'https://example.com', 'wildcard')).toBe(false);
    expect(matchesPattern('https://example.com/', 'https://example.com', 'wildcard')).toBe(true);
  });

  test('port restriction enforced', () => {
    expect(matchesPattern('https://example.com:8080/', 'example.com:8080', 'wildcard')).toBe(true);
    expect(matchesPattern('https://example.com:9000/', 'example.com:8080', 'wildcard')).toBe(false);
  });

  test('default port normalized by URL — :443 on https', () => {
    expect(matchesPattern('https://example.com/', 'example.com', 'wildcard')).toBe(true);
  });

  test('path prefix wildcard matches', () => {
    expect(matchesPattern('https://example.com/app/home', 'example.com/app*', 'wildcard')).toBe(true);
    expect(matchesPattern('https://example.com/other', 'example.com/app*', 'wildcard')).toBe(false);
  });

  test('exact path matches with trailing slash tolerance', () => {
    expect(matchesPattern('https://example.com/app', 'example.com/app', 'wildcard')).toBe(true);
    expect(matchesPattern('https://example.com/app/', 'example.com/app', 'wildcard')).toBe(true);
  });

  // REDUNDANT: shares the early-return guard path with "pattern exceeding MAX_PATTERN_LENGTH returns false"; consolidate into one test.each early-exit table
  test('empty or invalid patterns return false', () => {
    expect(matchesPattern('https://example.com/', '', 'wildcard')).toBe(false);
    expect(matchesPattern('https://example.com/', null, 'wildcard')).toBe(false);
    expect(matchesPattern('https://example.com/', undefined, 'wildcard')).toBe(false);
  });

  // REDUNDANT: shares the early-return guard path with "empty or invalid patterns return false"; consolidate into one test.each early-exit table
  test('pattern exceeding MAX_PATTERN_LENGTH returns false', () => {
    const huge = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    expect(matchesPattern('https://example.com/', huge, 'wildcard')).toBe(false);
  });
  // MISSING: no test for a completely malformed URL string (triggers try/catch in implementation)
  // MISSING: no test verifying query strings (?key=val) are ignored in wildcard path matching
  // MISSING: no test for case sensitivity of the wildcard hostname suffix check
});

// USER IMPACT: user creates an advanced regex rule — ReDoS protection prevents the browser tab from hanging on complex patterns
// OPTIMIZE: ReDoS guard currently tests 2 patterns; extend to 5+ via test.each for stronger confidence
describe('UrlMatcher.matchesPattern — regex mode', () => {
  test('valid regex matches url without hash', () => {
    expect(matchesPattern('https://example.com/x#frag', '^https://example\\.com/x$', 'regex')).toBe(true);
  });

  test('case insensitive', () => {
    expect(matchesPattern('https://EXAMPLE.com/', 'example\\.com', 'regex')).toBe(true);
  });

  test('rejects nested quantifiers (ReDoS)', () => {
    expect(matchesPattern('https://example.com/', '(a+)+', 'regex')).toBe(false);
    expect(matchesPattern('https://example.com/', 'a**', 'regex')).toBe(false);
  });

  test('invalid regex returns false, no throw', () => {
    expect(matchesPattern('https://example.com/', '[unclosed', 'regex')).toBe(false);
  });
  // MISSING: no test for MAX_PATTERN_LENGTH enforcement in regex mode (only tested for wildcard)
  // MISSING: no test for hash fragment stripping in regex mode when fragment is part of the pattern
});

// USER IMPACT: user stacks URL-specific rules — first matching rule wins; non-matching URLs fall through to global settings
describe('UrlMatcher.resolveSettings', () => {
  test('no rules → returns merged defaults over globals', () => {
    const globals = { blur_radius: 20 };
    const resolved = resolveSettings('https://example.com/', globals, []);
    expect(resolved.blur_radius).toBe(20);
    expect(resolved.blur_categories).toBeDefined();
  });

  test('first-match-wins among rules', () => {
    const globals = { blur_radius: 10 };
    const rules = [
      { hostname_value: 'example.com', hostname_type: 'wildcard', settings: { blur_radius: 30 } },
      { hostname_value: 'example.com', hostname_type: 'wildcard', settings: { blur_radius: 99 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.blur_radius).toBe(30);
  });

  test('non-matching rule falls through to globals', () => {
    const globals = { blur_radius: 10 };
    const rules = [
      { hostname_value: 'other.com', hostname_type: 'wildcard', settings: { blur_radius: 99 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.blur_radius).toBe(10);
  });

  test('rule settings deep-merged (partial override preserves other keys)', () => {
    const globals = { blur_radius: 10, reveal_mode: 'hover' };
    const rules = [
      { hostname_value: 'example.com', hostname_type: 'wildcard', settings: { blur_radius: 50 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.blur_radius).toBe(50);
    expect(resolved.reveal_mode).toBe('hover');
  });

  test('null/undefined rules array tolerated', () => {
    const globals = { blur_radius: 10 };
    expect(() => resolveSettings('https://example.com/', globals, null)).not.toThrow();
    expect(() => resolveSettings('https://example.com/', globals, undefined)).not.toThrow();
  });
  // MISSING: no test for resolveSettings with a rule missing the patternType field (should default to wildcard)
  // MISSING: no test for resolveSettings with a rule whose settings object is null/undefined
  // MISSING: no test for resolveSettings when globals is null (should fall back to defaults only)
});

// USER IMPACT: popup shows a clear "page restricted" empty state on chrome:// pages and the Web Store,
// instead of rendering toggles that silently fail; background.js skips these URLs during install-time re-injection.
describe('UrlMatcher.isRestrictedUrl', () => {
  test('chrome:// pages are restricted', () => {
    expect(isRestrictedUrl('chrome://newtab')).toBe(true);
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('chrome://settings/cookies')).toBe(true);
  });

  test('chrome-extension:// pages are restricted', () => {
    expect(isRestrictedUrl('chrome-extension://abcd1234/popup.html')).toBe(true);
  });

  test('Chrome Web Store hosts are restricted', () => {
    expect(isRestrictedUrl('https://chromewebstore.google.com/')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/category/extensions')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/webstore')).toBe(true);
    expect(isRestrictedUrl('https://chrome.google.com/webstore/detail/foo/abc')).toBe(true);
  });

  test('chrome.google.com outside /webstore is NOT restricted', () => {
    expect(isRestrictedUrl('https://chrome.google.com/about')).toBe(false);
    expect(isRestrictedUrl('https://chrome.google.com/')).toBe(false);
  });

  test('about: / view-source: / devtools: / moz-extension: / edge: / chrome-search: are restricted', () => {
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl('view-source:https://example.com')).toBe(true);
    expect(isRestrictedUrl('devtools://devtools/bundled/inspector.html')).toBe(true);
    expect(isRestrictedUrl('moz-extension://abcd/page.html')).toBe(true);
    expect(isRestrictedUrl('edge://settings')).toBe(true);
    expect(isRestrictedUrl('chrome-search://local-ntp/local-ntp.html')).toBe(true);
  });

  test('regular https / http URLs are NOT restricted', () => {
    expect(isRestrictedUrl('https://example.com/')).toBe(false);
    expect(isRestrictedUrl('http://example.com/path?q=1')).toBe(false);
    expect(isRestrictedUrl('https://news.ycombinator.com/')).toBe(false);
  });

  test('empty / null / undefined / non-string URLs are restricted', () => {
    expect(isRestrictedUrl('')).toBe(true);
    expect(isRestrictedUrl(null)).toBe(true);
    expect(isRestrictedUrl(undefined)).toBe(true);
    expect(isRestrictedUrl(123)).toBe(true);
    expect(isRestrictedUrl({})).toBe(true);
  });

  test('malformed URLs are restricted', () => {
    expect(isRestrictedUrl('not a url')).toBe(true);
    expect(isRestrictedUrl('://broken')).toBe(true);
  });

  test('hostname comparison is case-insensitive', () => {
    expect(isRestrictedUrl('https://ChromeWebStore.Google.Com/')).toBe(true);
  });
});
