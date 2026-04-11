/**
 * tests/unit/url_matcher.test.js
 *
 * Unit tests for src/url_matcher.js
 * Module exposes blsi.UrlMatcher with: matchesPattern, resolveSettings.
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
      return blsi.deepMerge(blsi.DEFAULT_SETTINGS, globals || {});
    }
    blsi.UrlMatcher = { matchesPattern: matchesPattern, resolveSettings: resolveSettings, MAX_PATTERN_LENGTH: 500 };
  })();
  `;
}

loadUrlMatcher();

const { matchesPattern, resolveSettings, MAX_PATTERN_LENGTH } = blsi.UrlMatcher;

describe('UrlMatcher.matchesPattern — wildcard mode', () => {
  test('bare hostname matches exact', () => {
    expect(matchesPattern('https://example.com/page', 'example.com', 'wildcard')).toBe(true);
  });

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

  test('empty or invalid patterns return false', () => {
    expect(matchesPattern('https://example.com/', '', 'wildcard')).toBe(false);
    expect(matchesPattern('https://example.com/', null, 'wildcard')).toBe(false);
    expect(matchesPattern('https://example.com/', undefined, 'wildcard')).toBe(false);
  });

  test('pattern exceeding MAX_PATTERN_LENGTH returns false', () => {
    const huge = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
    expect(matchesPattern('https://example.com/', huge, 'wildcard')).toBe(false);
  });
});

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
});

describe('UrlMatcher.resolveSettings', () => {
  test('no rules → returns merged defaults over globals', () => {
    const globals = { BLUR_RADIUS: 20 };
    const resolved = resolveSettings('https://example.com/', globals, []);
    expect(resolved.BLUR_RADIUS).toBe(20);
    expect(resolved.BLUR_CATEGORIES).toBeDefined();
  });

  test('first-match-wins among rules', () => {
    const globals = { BLUR_RADIUS: 10 };
    const rules = [
      { pattern: 'example.com', patternType: 'wildcard', settings: { BLUR_RADIUS: 30 } },
      { pattern: 'example.com', patternType: 'wildcard', settings: { BLUR_RADIUS: 99 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.BLUR_RADIUS).toBe(30);
  });

  test('non-matching rule falls through to globals', () => {
    const globals = { BLUR_RADIUS: 10 };
    const rules = [
      { pattern: 'other.com', patternType: 'wildcard', settings: { BLUR_RADIUS: 99 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.BLUR_RADIUS).toBe(10);
  });

  test('rule settings deep-merged (partial override preserves other keys)', () => {
    const globals = { BLUR_RADIUS: 10, HIGHLIGHT_COLOR: '#fff' };
    const rules = [
      { pattern: 'example.com', patternType: 'wildcard', settings: { BLUR_RADIUS: 50 } },
    ];
    const resolved = resolveSettings('https://example.com/', globals, rules);
    expect(resolved.BLUR_RADIUS).toBe(50);
    expect(resolved.HIGHLIGHT_COLOR).toBe('#fff');
  });

  test('null/undefined rules array tolerated', () => {
    const globals = { BLUR_RADIUS: 10 };
    expect(() => resolveSettings('https://example.com/', globals, null)).not.toThrow();
    expect(() => resolveSettings('https://example.com/', globals, undefined)).not.toThrow();
  });
});
