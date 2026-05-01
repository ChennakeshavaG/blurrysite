/**
 * pii/pii_country.js — Page-level country signal.
 *
 * Stub for Phase 0. Captures hostname TLD + <html lang> + meta tags +
 * currency-symbol density into a single ISO 3166 alpha-2 string (or null)
 * once per scan. Lands in Phase 4 alongside the Stage 2 context-gated
 * detectors that consume the signal.
 *
 * Exposed as blsi.PiiCountry (IIFE — no ES module syntax).
 */

const BlurrySitePiiCountry = (() => {
  "use strict";

  return Object.freeze({});
})();

blsi.PiiCountry = BlurrySitePiiCountry;
