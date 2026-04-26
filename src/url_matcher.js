/**
 * url_matcher.js — URL pattern parsing + rule resolution
 *
 * Exposed as blsi.UrlMatcher (IIFE — no ES module syntax).
 *
 * Parse-then-match strategy: decompose both page URL and user pattern into
 * parts (scheme, hostname, port, path) and match each with domain-boundary
 * awareness. Prevents "notexample.com" matching a pattern for "example.com".
 *
 * User input heuristics:
 *   "example.com"          → hostname match (includes subdomains), any path
 *   "example.com/app*"     → hostname + path prefix with wildcard
 *   "*.example.com"        → subdomains only, any path
 *   "example.com:8080"     → hostname + specific port
 *   "https://example.com"  → scheme + hostname
 *
 * Hash (#fragment) is always excluded from matching.
 * Query string (?key=val) is excluded unless explicitly in the pattern.
 */

const BlurrySiteUrlMatcher = (() => {
  'use strict';

  const PT = blsi.pattern_types;

  /** Max pattern string length to prevent ReDoS and storage abuse. */
  const MAX_PATTERN_LENGTH = 500;

  /**
   * Parse a user-entered pattern into structured parts.
   * @returns {{ scheme: string|null, hostname: string, port: string|null, path: string|null, subdomainWildcard: boolean }}
   */
  function parsePattern(pattern) {
    let scheme = null;
    let rest = pattern;

    const schemeMatch = rest.match(/^(https?):\/\//i);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      rest = rest.slice(schemeMatch[0].length);
    } else if (rest.startsWith('*://')) {
      rest = rest.slice(4);
    }

    let subdomainWildcard = false;
    if (rest.startsWith('*.')) {
      subdomainWildcard = true;
      rest = rest.slice(2);
    }

    let hostPart, pathPart = null;
    const slashIdx = rest.indexOf('/');
    if (slashIdx >= 0) {
      hostPart = rest.slice(0, slashIdx);
      pathPart = rest.slice(slashIdx);
    } else {
      hostPart = rest;
    }

    let port = null;
    const colonIdx = hostPart.lastIndexOf(':');
    if (colonIdx >= 0) {
      const maybPort = hostPart.slice(colonIdx + 1);
      if (/^\d+$/.test(maybPort)) {
        port = maybPort;
        hostPart = hostPart.slice(0, colonIdx);
      }
    }

    return {
      scheme,
      hostname: hostPart.toLowerCase(),
      port,
      path: pathPart,
      subdomainWildcard,
    };
  }

  /**
   * Check if pageHostname matches a pattern hostname with domain-boundary awareness.
   * "example.com" matches "example.com" and "sub.example.com" (includes subdomains).
   * "*.example.com" matches "sub.example.com" but NOT "example.com".
   */
  function hostnameMatches(pageHost, patternHost, subdomainWildcard) {
    if (subdomainWildcard) {
      return pageHost.endsWith('.' + patternHost);
    }
    return pageHost === patternHost || pageHost.endsWith('.' + patternHost);
  }

  /**
   * Check if pagePath matches a pattern path with wildcard support.
   * "/*" or null → any path. "/app*" → starts with /app.
   */
  function pathMatches(pagePath, patternPath) {
    if (!patternPath || patternPath === '/' || patternPath === '/*') return true;

    if (patternPath.endsWith('*')) {
      const prefix = patternPath.slice(0, -1);
      return pagePath.startsWith(prefix);
    }

    return pagePath === patternPath || pagePath === patternPath + '/';
  }

  /**
   * Tests whether a URL matches a rule's pattern.
   * @param {string} url         - Full page URL (location.href)
   * @param {string} pattern     - User-entered pattern string
   * @param {string} patternType - 'wildcard' | 'regex'
   * @returns {boolean}
   */
  function matchesPattern(url, pattern, patternType) {
    if (!pattern || typeof pattern !== 'string') return false;
    if (pattern.length > MAX_PATTERN_LENGTH) return false;

    if (patternType === PT.regex) {
      try {
        if (/([+*?])\s*[)]\s*[+*?{]/.test(pattern) || /([+*?{])\s*\1/.test(pattern)) {
          return false;
        }
        const urlNoHash = url.replace(/#.*$/, '');
        return new RegExp(pattern, 'i').test(urlNoHash);
      } catch (_e) {
        return false;
      }
    }

    try {
      const parsed = new URL(url);
      const pat = parsePattern(pattern);

      if (pat.scheme && parsed.protocol !== pat.scheme + ':') return false;

      if (!hostnameMatches(parsed.hostname, pat.hostname, pat.subdomainWildcard)) return false;

      if (pat.port && parsed.port !== pat.port) return false;

      if (!pathMatches(parsed.pathname, pat.path)) return false;

      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Resolve settings for the current URL.
   * Priority: first matching URL rule > user global settings > DEFAULT_SETTINGS.
   * Rule settings are partial — deep-merged over the global settings.
   */
  function resolveSettings(url, globalSettings, urlRules) {
    const defaults = blsi.deep_merge(blsi.DEFAULT_MODEL.global_default_settings, blsi.DEFAULT_MODEL.blur_all.settings);
    let resolved = blsi.deep_merge(defaults, globalSettings);

    if (Array.isArray(urlRules)) {
      for (const rule of urlRules) {
        if (matchesPattern(url, rule.hostname_value, rule.hostname_type)) {
          resolved = blsi.deep_merge(resolved, rule.settings || {});
          break;
        }
      }
    }

    return resolved;
  }

  return {
    matchesPattern,
    resolveSettings,
    MAX_PATTERN_LENGTH,
  };
})();

blsi.UrlMatcher = BlurrySiteUrlMatcher;
