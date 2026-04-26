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

  return Object.freeze({ DISC_FONT_FACE, ASTERISK_FONT_FACE });
})();

blsi.Fonts = BlurrySiteFonts;
