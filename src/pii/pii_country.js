/**
 * pii/pii_country.js — Page-level country signal.
 *
 * Computes an ISO 3166 alpha-2 string (or `null`) from four sources, in
 * priority order:
 *   1. <meta name="geo.country">, <meta name="content-language">, <meta property="og:locale">
 *   2. <html lang="en-US"> (region subtag required — bare "en" → null)
 *   3. Hostname ccTLD (.uk, .de, .in, …)
 *   4. Single-country currency density (£=GB, ₹=IN, ₩=KR, ₽=RU) in first
 *      1000 chars of body text. Multi-country symbols ($, €, ¥) are
 *      intentionally excluded — they hurt precision more than they help.
 *
 * `detect()` is cached lazily — called once per scan, never re-runs unless
 * `_resetCache()` is invoked (used by tests + by SPA URL-change paths). This
 * is the M6 mitigation from `docs/research/pii/numeric/PERF.md`.
 *
 * `detectFromInputs(inputs)` is the pure side that takes pre-extracted
 * inputs — testable without a DOM. `detect()` reads `location` + `document`
 * and forwards to `detectFromInputs`.
 *
 * Stage 2 validators in `blsi.PiiDetectors` consume the cached value via
 * `blsi.PiiState.getCountry()` (seeded by the facade scan() at the top of
 * each scan).
 *
 * Exposed as blsi.PiiCountry (IIFE — no ES module syntax).
 */

const BlurrySitePiiCountry = (() => {
  "use strict";

  // ── ccTLD → ISO 3166 alpha-2 ─────────────────────────────────────────────
  // Conservative allow-list. Excludes ccTLDs commonly used as gTLDs (.io, .me,
  // .tv, .co) where the TLD does NOT reliably signal country. Add entries as
  // detector country requirements expand.
  const _TLD_TO_COUNTRY = Object.freeze({
    uk: "GB", gb: "GB", us: "US", in: "IN", de: "DE", fr: "FR", jp: "JP",
    cn: "CN", kr: "KR", au: "AU", ca: "CA", br: "BR", mx: "MX", ru: "RU",
    es: "ES", it: "IT", nl: "NL", se: "SE", ch: "CH", at: "AT", be: "BE",
    pl: "PL", sg: "SG", ae: "AE", sa: "SA", za: "ZA", tr: "TR", no: "NO",
    dk: "DK", fi: "FI", ie: "IE", nz: "NZ", ar: "AR", cl: "CL", pe: "PE",
    hk: "HK", tw: "TW", th: "TH", vn: "VN", ph: "PH", my: "MY", il: "IL",
    eg: "EG", id: "ID",
  });

  // Currency symbols → ISO country (single-country symbols only).
  const _CURRENCY_HINT = Object.freeze({
    "£": "GB",
    "₹": "IN",
    "₩": "KR",
    "₽": "RU",
  });

  // Cache state — `_isCached === false` means "not yet computed", regardless
  // of whether `_cache` is `null` (= computed but no signal) or a string.
  let _cache = null;
  let _isCached = false;

  function _hostnameTld(hostname) {
    if (typeof hostname !== "string" || !hostname) return null;
    const parts = hostname.toLowerCase().split(".");
    if (parts.length < 2) return null;
    return _TLD_TO_COUNTRY[parts[parts.length - 1]] || null;
  }

  function _langCountry(lang) {
    if (typeof lang !== "string" || !lang) return null;
    // Match `en-US`, `en_GB`, `ja-Latn-JP` etc. Region subtag REQUIRED — bare
    // `en`/`fr`/`de` carry too little signal (en is used worldwide, fr in
    // FR/CA/CH/BE/…, de in DE/AT/CH).
    const m = lang.match(/^[a-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})\b/);
    if (!m) return null;
    return m[1].toUpperCase();
  }

  function _metaCountry(metas) {
    if (!metas || !metas.length) return null;
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i];
      if (!meta || !meta.getAttribute) continue;
      const name = (meta.getAttribute("name") || "").toLowerCase();
      const property = (meta.getAttribute("property") || "").toLowerCase();
      const httpEquiv = (meta.getAttribute("http-equiv") || "").toLowerCase();
      const content = meta.getAttribute("content") || "";
      if (!content) continue;
      if (name === "geo.country" || name === "country") {
        const c = content.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(c)) return c;
      }
      if (
        name === "content-language" ||
        httpEquiv === "content-language" ||
        property === "og:locale"
      ) {
        const c = _langCountry(content);
        if (c) return c;
      }
    }
    return null;
  }

  function _currencyDensity(sample) {
    if (typeof sample !== "string" || !sample) return null;
    let best = null;
    let bestCount = 2; // require ≥3 occurrences to count as a signal.
    const symbols = Object.keys(_CURRENCY_HINT);
    for (let s = 0; s < symbols.length; s++) {
      const sym = symbols[s];
      let count = 0;
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === sym) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = _CURRENCY_HINT[sym];
      }
    }
    return best;
  }

  /**
   * Pure inputs-to-country function. No DOM access; safe in any context.
   * @param {{ hostname?: string, lang?: string, metas?: NodeList|Array, sample?: string }} inputs
   * @returns {string|null} ISO 3166 alpha-2 or null.
   */
  function detectFromInputs(inputs) {
    if (!inputs) return null;
    return (
      _metaCountry(inputs.metas) ||
      _langCountry(inputs.lang) ||
      _hostnameTld(inputs.hostname) ||
      _currencyDensity(inputs.sample) ||
      null
    );
  }

  /**
   * Read live document + cache result. Subsequent calls return cached value
   * until `_resetCache()` is invoked.
   * @returns {string|null}
   */
  function detect() {
    if (_isCached) return _cache;
    let result = null;
    try {
      const hostname =
        (typeof location !== "undefined" && location.hostname) || "";
      const lang =
        (typeof document !== "undefined" &&
          document.documentElement &&
          document.documentElement.lang) ||
        "";
      const metas =
        typeof document !== "undefined" && document.querySelectorAll
          ? document.querySelectorAll("meta")
          : null;
      const body =
        typeof document !== "undefined" && document.body
          ? document.body
          : null;
      const sample = body ? (body.textContent || "").slice(0, 1000) : "";
      result = detectFromInputs({ hostname, lang, metas, sample });
    } catch (_) {
      result = null;
    }
    _cache = result;
    _isCached = true;
    return _cache;
  }

  function _resetCache() {
    _cache = null;
    _isCached = false;
  }

  return Object.freeze({
    detect,
    detectFromInputs,
    _resetCache,
  });
})();

blsi.PiiCountry = BlurrySitePiiCountry;
