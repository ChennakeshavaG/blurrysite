/**
 * engine.js — Blurry Site core blur engine (facade + orchestrator).
 *
 * Hybrid CSS + data-attribute blur system. Sub-modules live under src/core/:
 *   - core/categories.js    — frozen tag/role data
 *   - core/css_manager.js   — three style-injection systems (blur-all, pick, PII)
 *   - core/marker_engine.js — element stamping + match queries
 *   - core/observer.js      — MutationObserver lifecycle + dispatcher
 *   - core/target_engine.js — zones, items, popup-hover highlight
 *   - core/engine_state.js  — shared private state across the above
 *
 * This file owns top-level lifecycle (handleSite, handleDocument,
 * handleIframe, teardown, unblurAll) and exposes the unified blsi.Engine
 * facade by re-exporting public methods from each core/* sub-module.
 *
 * Attribute-based stamping survives framework class-mutation churn (React /
 * Vue rerenders) better than class-based approaches.
 *
 * Exposed as blsi.Engine (IIFE — no ES module syntax).
 */

const Engine = (() => {
  "use strict";

  // ── Sub-module aliases ────────────────────────────────────────────────────
  // Each alias keeps call sites in the body short. The public return block
  // below re-exports the same names so external callers (picker, content_script,
  // reveal_controller, popup, tests) talk to a single blsi.Engine surface.

  const CATEGORY_SELECTORS = blsi.Categories.CATEGORY_SELECTORS;
  const DEFAULT_CATS       = blsi.Categories.DEFAULT_CATS;

  const Css = blsi.CssManager;
  const SVG_FILTER_ID    = Css.SVG_FILTER_ID;
  const ensureSvgFilter  = Css.ensureSvgFilter;
  const injectRules      = Css.injectRules;
  const removeRules      = Css.removeRules;
  const isBlurAllActive  = Css.isBlurAllActive;
  const injectPickBlurRules = Css.injectPickBlurRules;
  const removePickBlurRules = Css.removePickBlurRules;
  const injectPiiRules   = Css.injectPiiRules;
  const removePiiRules   = Css.removePiiRules;

  const Marker = blsi.MarkerEngine;
  const _State = blsi.EngineState;

  const _isExtensionUI       = Marker._isExtensionUI;
  const stampElements        = Marker.stampElements;
  const tryBlurTextCheck     = Marker.tryBlurTextCheck;
  const applyBlur            = Marker.applyBlur;
  const removeBlur           = Marker.removeBlur;
  const isBlurred            = Marker.isBlurred;
  const isVisuallyBlurred    = Marker.isVisuallyBlurred;
  const matchesActiveCategories = Marker.matchesActiveCategories;

  const Obs = blsi.Observer;
  const observeRoot           = Obs.observeRoot;
  const disconnectObserver    = Obs.disconnectObserver;
  const subscribeMutations    = Obs.subscribeMutations;
  const unsubscribeMutations  = Obs.unsubscribeMutations;

  const Targets = blsi.TargetEngine;
  const getZoneOverlays      = Targets.getZoneOverlays;
  const removeAllZoneOverlays = Targets.removeAllZoneOverlays;
  const _reconcileItems      = Targets.reconcileItems;
  const resetCounters        = Targets.resetCounters;
  const allocateElementName  = Targets.allocateElementName;
  const allocateStickyName   = Targets.allocateStickyName;
  const highlightItem        = Targets.highlightItem;
  const clearItemHighlight   = Targets.clearItemHighlight;

  // ── Orchestration ─────────────────────────────────────────────────────────

  // Mutex — prevents concurrent handleSite() calls from interleaving DOM mutations.
  let _handling = false;

  // Last fully-applied settings snapshot. handleSite short-circuits when the
  // incoming settings deep-equal this value. Cleared by teardown(document) so
  // the next handleSite re-runs unconditionally after a full reset.
  let localCache = null;

  function _deep_equal(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b || typeof a !== "object") return false;
    const a_arr = Array.isArray(a), b_arr = Array.isArray(b);
    if (a_arr !== b_arr) return false;
    if (a_arr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!_deep_equal(a[i], b[i])) return false;
      }
      return true;
    }
    const a_keys = Object.keys(a);
    if (a_keys.length !== Object.keys(b).length) return false;
    for (let k = 0; k < a_keys.length; k++) {
      const key = a_keys[k];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!_deep_equal(a[key], b[key])) return false;
    }
    return true;
  }

  function _setPickerActiveForObserver(v) {
    _State.setPickerActive(v);
  }

  function _applyCssVars(settings) {
    if (!document.documentElement) return;
    const s = document.documentElement.style;
    // Skip writes for missing fields — setProperty(name, undefined) serialises
    // as the literal string "undefined" and disables the var fallback in
    // content.css. Resolved settings always include defaults; this guards the
    // early-init / partial-settings path.
    if (settings.blur_radius != null) s.setProperty('--bl-si-radius', `${settings.blur_radius}px`);
    if (settings.highlight_color != null) s.setProperty('--bl-si-highlight-color', settings.highlight_color);
    if (settings.transition_duration != null) s.setProperty('--bl-si-transition-duration', `${settings.transition_duration}ms`);
    if (settings.redaction_color != null) s.setProperty('--bl-si-redaction-color', settings.redaction_color);
  }

  /**
   * Remove all blur state from `root` and recursively from any open shadow
   * roots found within it. One pass: clear stamps + find shadow hosts.
   *
   * PII-stamped elements (data-bl-si-pii) are intentionally skipped —
   * they own their own blur lifecycle and must stay blurred when blur-all
   * turns off (matches the original _disablePageWide behaviour).
   */
  function teardown(root) {
    if (root === document) {
      Obs.removeShadowAttachListener();
      localCache = null;
    }
    // Cancel any pending idle work for this root — prevents stampElements
    // re-stamping elements after teardown has cleared all attributes.
    Obs.clearStampQueueForRoot(root);
    // Drop any buffered mutations for this root — the observer is going away
    // and subscribers must not receive records for a torn-down root.
    Obs.clearPendingMutations(root);

    disconnectObserver(root);
    removeRules(root);
    removePickBlurRules(root);

    // ONE pass: clear stamps + collect shadow hosts for post-loop recursion.
    // Recursing inside forEach risks processing a child's shadow root before
    // the parent's stamps are cleared — collect-then-recurse avoids that.
    const shadowHosts = [];
    root.querySelectorAll('*').forEach(el => {
      if (el.dataset.blSiBlur && !el.dataset.blSiPii) {
        delete el.dataset.blSiBlur;
        _State.decrementBlurredCount();
      }
      if (el.dataset.blSiPickBlur) {
        delete el.dataset.blSiPickBlur;
      }
      if (el.shadowRoot) shadowHosts.push(el);
    });

    // Remove SVG filter if present in this root (stateless — no-op if absent).
    const svg = root.querySelector && root.querySelector('#' + SVG_FILTER_ID);
    if (svg && svg.parentNode) svg.parentNode.removeChild(svg);

    // Recurse into shadow roots after this root is fully cleaned up.
    shadowHosts.forEach(h => teardown(h.shadowRoot));
  }

  // Public alias — used by picker callbacks and tests.
  function unblurAll() {
    teardown(document);
    removeAllZoneOverlays();
  }

  /**
   * Apply or remove blur for one root — `document` (main page) or any open
   * shadow root. Single function for both because the active-path setup is
   * identical in both cases (injectRules + observeRoot + stamp queue +
   * scheduleStampIdle); only the document needs the shadow-attach listener
   * and the queue replace-vs-append distinction.
   *
   * Active path: CSS injection is synchronous; the querySelectorAll('*')
   * stamp pass is deferred to requestIdleCallback via _flushStampQueue.
   * EngineState.isPageBlurred is NOT set here — handleSite's responsibility.
   *
   * Document caller: handleSite (single call site).
   * Shadow-root callers: observer.js MO drain (new shadow roots) +
   *   shadow-attach listener + _flushStampQueue recursion + tests.
   */
  function handleDocument(settings, root) {
    const active = !!settings.engage;
    if (!active) {
      teardown(root);
      return;
    }

    const isMainDoc = (root === document);
    const cats = settings.blur_categories || DEFAULT_CATS;
    const mode = settings.blur_mode || null;
    const thorough = !!settings.thorough_blur;

    injectRules(root, cats, mode);   // synchronous — alwaysBlur tags blurred now
    observeRoot(root);               // synchronous — MO live before idle fires

    if (isMainDoc) {
      Obs.initShadowAttachListener();    // catch shadow roots attached after idle
      // Replace queue (not append). Pending idle, if any, uses this new queue.
      Obs.clearStampQueueForRoot(document);
    }

    Obs.pushStampQueueItem({ root, cats, thorough, mode });
    Obs.scheduleStampIdle();             // no-op if already pending
  }

  /**
   * Stamp or unstamp a cross-origin <iframe> element as a blur black-box.
   * Same-origin iframes are skipped — all_frames:true gives them their own
   * content_script that handles blur independently.
   *
   * Thin wrapper over MarkerEngine._stampIframeIfCrossOrigin so the
   * cross-origin probe + stamp logic has one source of truth (also used by
   * stampElements' iframe branch during the initial idle pass).
   */
  function handleIframe(settings, iframeEl) {
    Marker._stampIframeIfCrossOrigin(iframeEl, !!settings.engage);
  }

  /**
   * Single entry point — reconcile the entire page (document + all open shadow
   * roots) to the provided settings snapshot.
   *
   * Settings must include:
   *   BLUR_ALL_ACTIVE {boolean} — whether blur-all is on for this host
   *   BLUR_ITEMS      {Array}   — per-host blur items (dynamic + sticky)
   * Both are included by blsi.Model.resolve() before the caller passes them in.
   *
   * Storage reads live in content_script — handleSite is stateless/pure w.r.t.
   * storage. Every caller MUST await — concurrent calls are dropped (mutex).
   */
  async function handleSite(settings) {
    if (_handling) return;
    _handling = true;
    try {
      // Short-circuit when nothing changed since the last fully-applied call.
      // teardown(document) clears localCache so post-reset calls always run.
      if (_deep_equal(localCache, settings)) return;
      localCache = settings;

      // Store FIRST — MO callback reads currentSettings for new shadow hosts.
      _State.setCurrentSettings(settings);

      // CSS vars must be written before injectRules — frosted mode reads
      // --bl-si-radius from :root inside ensureSvgFilter. content.css has
      // per-var fallbacks so there is no flash of unstyled state before the
      // first handleSite call.
      _applyCssVars(settings);

      // ── Extension disabled — full teardown including items ──────────────────
      // Call teardown directly: resolve() forces engage=false when enabled=false,
      // but tests hand-craft settings and may not honour that invariant.
      if (settings.enabled === false) {
        teardown(document);
        _State.setIsPageBlurred(false);
        _reconcileItems([]);
        removeAllZoneOverlays(); // safety net for orphaned zones
        return;
      }

      // ── Automate overlay (separate reactive path) ──────────────────────────
      // The Overlay is owned by blsi.Automate.Manager, which subscribes to
      // session storage transitions independently of the engine. Engine no
      // longer reads automate_blur_active.

      const isActive = !!settings.engage;

      handleDocument(settings, document);  // sync — schedules idle for stamp work
      _State.setIsPageBlurred(isActive);

      // ── Item reconcile ──────────────────────────────────────────────────────
      // Runs in both active and inactive paths: picker blurs + sticky zones
      // persist when blur-all is off.
      const { added, removed } = _reconcileItems(settings.blur_items || []);

      // When blur-all is OFF, handleDocument tears down the observer.
      // Re-attach if any consumer still needs the document MO:
      //   - dynamic pick-blur items → caught by _tryPickBlurNode in the idle drain
      //   - registered subscribers (e.g. PII detector) → fed via the dispatcher
      // observeRoot is idempotent — no-op if blur-all already attached it.
      if (_State.getPickBlurDynamicActive() || Obs.hasSubscribers()) observeRoot(document);

      // idempotent: re-inject on every call so mode/color changes take effect without a DOM pass
      if (settings.pick_blur_enabled && (settings.blur_items || []).length > 0) {
        injectPickBlurRules(document, settings.pick_blur_type, settings.pick_blur_color);
      } else {
        removePickBlurRules(document);
      }

      if (blsi.Logger && blsi.Logger.enabled) {
        blsi.Logger.scope('engine').flow('handleSite', {
          active: isActive,
          added,
          removed,
          totalActive: Targets.activeItemsSize(),
        });
      }
    } finally {
      _handling = false;
    }
  }


  // ── Public API (blsi.Engine) ─────────────────────────────────────────────
  // Re-exports primitives from each core/* module, plus the orchestration
  // methods owned here. To add/remove a public method, edit this return block
  // AND update CLAUDE.md Module Globals table + docs/contracts/engine.md.

  return {
    // The block below (injectRules through tryBlurTextCheck) is exposed for
    // unit tests only — production callers must drive these via handleSite().
    // Everything below this block is real public API.
    injectRules,
    removeRules,
    injectPickBlurRules,
    removePickBlurRules,
    isBlurAllActive,
    stampElements,
    tryBlurTextCheck,

    // Individual element (picker / context menu)
    applyBlur,
    removeBlur,
    unblurAll,   // alias for teardown(document) + removeAllZoneOverlays
    teardown,

    // Popup hover highlight — highlights the page element corresponding to a blur item
    highlightItem,
    clearItemHighlight,

    // Queries
    isBlurred,
    isVisuallyBlurred,
    matchesActiveCategories,

    // Sticky zones — create/remove/removeAll are internal (called via handleSite item reconcile)
    getZoneOverlays,

    // PII mode CSS injection
    injectPiiRules,
    removePiiRules,

    // Utilities
    ensureSvgFilter,
    CATEGORY_SELECTORS,

    // Counter allocation for picker callbacks
    resetCounters,
    allocateElementName,
    allocateStickyName,

    // Single orchestration entry point.
    // Caller must fold BLUR_ALL_ACTIVE and BLUR_ITEMS into settings before calling.
    handleSite,

    // Per-root dispatch. Public for observer.js MO drain (new shadow roots) and
    // tests. Production page-wide callers go through handleSite.
    handleDocument,       // one root (document or shadow root); active path
                          //   queues stamp work, inactive path tears down
    handleIframe,         // cross-origin iframes only
    observeRoot,

    // Mutation dispatcher — subscribers receive raw MutationRecord[] per root.
    subscribeMutations,
    unsubscribeMutations,
    hasSubscribers: Obs.hasSubscribers,
    get isPageBlurred() {
      return _State.getIsPageBlurred();
    },
    get blurredCount() {
      return _State.getBlurredCount();
    },
    _setPickerActiveForObserver,
  };
})();

blsi.Engine = Engine;
