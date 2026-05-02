/**
 * pii/pii_state.js — Shared private state for PII sub-modules.
 *
 * Holds the running match count, the active types snapshot, the canonical
 * PII attribute name, the compiled-regex cache (Phase 2), and the scan-cost
 * stats counter (Phase 2). Other PII sub-modules read/write through this
 * module instead of duplicating state.
 *
 * Exposed as blsi.PiiState (IIFE — no ES module syntax).
 */

const BlurrySitePiiState = (() => {
  "use strict";

  // Canonical attribute placed on PII wrapping spans.
  // CSS rule [data-bl-si-pii]:not([data-bl-si-reveal]) in content.css
  // drives blur — independent of blur-all.
  const PII_ATTR = "data-bl-si-pii";

  let _matchCount = 0;
  let _activeTypes = null;
  // Per-scan country signal cache (Phase 4 — PERF.md M6). Seeded once at
  // the top of facade.scan() via `setCountry(blsi.PiiCountry.detect())`.
  // Stage 2 detector validators read it via getCountry().
  let _country = null;

  // ── Regex cache (Phase 2 — PERF.md M3) ────────────────────────────────────
  // Replaces the previous `new RegExp(re.source, re.flags)` per-call pattern.
  // Callers pass a /g RegExp prototype; cache returns a single compiled
  // instance per (source, flags) tuple with lastIndex reset.
  const _REGEX_CACHE = new Map();

  function getCachedRegex(prototype) {
    const key = prototype.source + "::" + prototype.flags;
    let re = _REGEX_CACHE.get(key);
    if (!re) {
      re = new RegExp(prototype.source, prototype.flags);
      _REGEX_CACHE.set(key, re);
    }
    re.lastIndex = 0;
    return re;
  }

  function _resetRegexCache() {
    _REGEX_CACHE.clear();
  }

  // ── Scan stats (Phase 2) ──────────────────────────────────────────────────
  // Production-cheap counters surfaced via blsi.PiiDetector.getStats().
  // Increment helpers no-op when Logger.enabled is false to keep the hot
  // path zero-overhead in non-debug builds.
  const _stats = {
    node_count: 0,
    digit_node_count: 0,
    stage3_candidates: 0,
    stage4_suppressed: 0,
    total_emit: 0,
  };

  function _statsOn() {
    return !!(blsi.Logger && blsi.Logger.enabled);
  }

  function recordNode(hasDigit) {
    if (!_statsOn()) return;
    _stats.node_count++;
    if (hasDigit) _stats.digit_node_count++;
  }

  function recordCandidate() {
    if (!_statsOn()) return;
    _stats.stage3_candidates++;
  }

  function recordSuppress() {
    if (!_statsOn()) return;
    _stats.stage4_suppressed++;
  }

  function recordEmit() {
    if (!_statsOn()) return;
    _stats.total_emit++;
  }

  function getStats() {
    // Always return a copy so callers can't mutate counters.
    return Object.assign({}, _stats);
  }

  function resetStats() {
    for (const k of Object.keys(_stats)) _stats[k] = 0;
  }

  function getMatchCount() {
    return _matchCount;
  }

  function incrementMatchCount() {
    _matchCount++;
  }

  function resetMatchCount() {
    _matchCount = 0;
  }

  function getActiveTypes() {
    return _activeTypes;
  }

  function setActiveTypes(types) {
    _activeTypes = types;
  }

  function clearActiveTypes() {
    _activeTypes = null;
  }

  // ── Country signal cache (Phase 4 — PERF.md M6) ──────────────────────────
  // Single ISO 3166 alpha-2 code (or null) seeded by the facade at the top of
  // each scan. Stage 2 detector validators read it via `getCountry()`.

  function getCountry() {
    return _country;
  }

  function setCountry(code) {
    if (typeof code === "string" && /^[A-Z]{2}$/.test(code)) {
      _country = code;
    } else {
      _country = null;
    }
  }

  function clearCountry() {
    _country = null;
  }

  return Object.freeze({
    PII_ATTR,
    getMatchCount,
    incrementMatchCount,
    resetMatchCount,
    getActiveTypes,
    setActiveTypes,
    clearActiveTypes,
    getCountry,
    setCountry,
    clearCountry,
    getCachedRegex,
    _resetRegexCache,
    recordNode,
    recordCandidate,
    recordSuppress,
    recordEmit,
    getStats,
    resetStats,
  });
})();

blsi.PiiState = BlurrySitePiiState;
