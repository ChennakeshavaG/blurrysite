/**
 * fonts.js — Font face declarations for text-masking modes.
 *
 * DISC font (noppa/text-security v3.2.0, OFL-1.1):
 *   text-security-disc.woff2 — maps every Unicode codepoint to a filled disc (●).
 *   Fetched from https://github.com/noppa/text-security — see fonts/LICENSE-text-security.txt.
 *   Used as "bl-si-censored-disc" for blur-all `censored` mode.
 *
 * ASTERISK font (custom build via fontTools, OFL-1.1):
 *   asterisk.woff2 — maps every BMP codepoint to a 6-arm asterisk (*) via cmap format 4.
 *   Not in noppa/text-security upstream; generated independently with fontTools.
 *   Used as "bl-si-starred-asterisk" for PII `starred` mode.
 *
 * Font files live in fonts/ and are declared as web_accessible_resources so
 * content scripts can reference them via chrome.runtime.getURL().
 *
 * Two delivery paths so strict page CSP (font-src) cannot silently break us:
 *   1. @font-face URL strings (DISC_FONT_FACE / ASTERISK_FONT_FACE) injected
 *      into the same <style> block as the font-family rule. Cheap and
 *      synchronous, but blocked when page CSP forbids chrome-extension://
 *      or extension URL fetches in font-src.
 *   2. loadFonts() — fetches the woff2 binaries from the extension origin
 *      (privileged content-script context) and registers FontFace objects
 *      in document.fonts. Bypasses page CSP because the font payload never
 *      goes through @font-face URL resolution in the page. Async; safe to
 *      call early at content_script init.
 *
 * Exposed as blsi.Fonts (IIFE — no ES module syntax).
 */

const BlurrySiteFonts = (() => {
  "use strict";

  const DISC_FONT_FACE =
    `@font-face {` +
    ` font-family: "bl-si-censored-disc";` +
    ` src: url("${chrome.runtime.getURL('fonts/disc.woff2')}") format("woff2");` +
    ` font-display: block;` +
    `}`;

  const ASTERISK_FONT_FACE =
    `@font-face {` +
    ` font-family: "bl-si-starred-asterisk";` +
    ` src: url("${chrome.runtime.getURL('fonts/asterisk.woff2')}") format("woff2");` +
    ` font-display: block;` +
    `}`;

  const FONT_SOURCES = [
    { family: "bl-si-censored-disc",   path: "fonts/disc.woff2" },
    { family: "bl-si-starred-asterisk", path: "fonts/asterisk.woff2" },
  ];

  let _loadPromise = null;

  /**
   * Fetch font binaries from the extension origin and register them in
   * document.fonts. Idempotent — second call returns the cached promise.
   * Failures are swallowed so a fetch error never breaks downstream blur
   * logic; the @font-face URL path remains as fallback.
   */
  function loadFonts() {
    if (_loadPromise) return _loadPromise;
    if (typeof FontFace !== "function" || !document.fonts || typeof fetch !== "function") {
      _loadPromise = Promise.resolve();
      return _loadPromise;
    }
    _loadPromise = Promise.all(FONT_SOURCES.map(function (src) {
      try {
        var url = chrome.runtime.getURL(src.path);
        return fetch(url)
          .then(function (resp) { return resp.arrayBuffer(); })
          .then(function (buf) {
            var ff = new FontFace(src.family, buf, { display: "block" });
            return ff.load().then(function (loaded) {
              document.fonts.add(loaded);
            });
          })
          .catch(function () { /* CSP / fetch failure → @font-face fallback */ });
      } catch (_) {
        return Promise.resolve();
      }
    })).then(function () { /* swallow result — caller doesn't care */ });
    return _loadPromise;
  }

  return Object.freeze({ DISC_FONT_FACE, ASTERISK_FONT_FACE, loadFonts });
})();

blsi.Fonts = BlurrySiteFonts;
