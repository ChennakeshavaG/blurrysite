/**
 * core/target_engine.js — pick-blur targets: zones, items, highlight.
 *
 * Owns user-defined blur targets: dynamic items (selector-anchored), sticky
 * zones (page or screen anchored boxes), and the popup-hover highlight that
 * lights up the page element corresponding to a popup list row.
 *
 * Three concerns merged because they all manage user-named targets that
 * hang off `pick_and_blur.items` storage:
 *
 *   - Zone overlays  — `_zoneOverlays` Map; absolute / fixed positioned divs.
 *   - Item dispatch  — `_activeItems` Map; reconciled diff against storage on
 *                      every handleSite() call. `_pickBlurDynamicActive` is
 *                      flipped here so observer's MO gate stays in sync.
 *   - Highlight      — popup hover messages stamp `bl-si-hover-highlight` on
 *                      the matched element / zone overlay.
 *
 * Cross-module reads:
 *   - blsi.MarkerEngine._isExtensionUI  (gate dynamic / pick-blur stamps)
 *   - blsi.SelectorUtils.restoreSelector
 *   - blsi.EngineState.setPickBlurDynamicActive
 *
 * Exposed as blsi.TargetEngine (IIFE — no ES module syntax).
 */

const BlurrySiteTargetEngine = (() => {
  'use strict';

  const State = blsi.EngineState;

  // ── Sticky zone overlays ───────────────────────────────────────────────────

  /** Map of active zone overlays: zoneId → DOM element */
  const _zoneOverlays = new Map();

  /**
   * Create and inject a sticky zone overlay div into document.body.
   * @param {object} zoneData - { id, name, x, y, width, height, ... }
   * @returns {HTMLElement} The created overlay element
   */
  function createZoneOverlay(zoneData) {
    if (!zoneData || !zoneData.id) return null;

    if (!document.body) return null;

    // Remove existing overlay with same id (idempotent)
    if (_zoneOverlays.has(zoneData.id)) {
      removeZoneOverlay(zoneData.id);
    }

    const el = document.createElement("div");
    el.className = blsi.css.zone_overlay;
    el.dataset.blSiZone = zoneData.id;
    el.dataset.blSiZoneName = zoneData.name || "";

    // Anchor: 'page' (default, absolute positioning in document coordinates
    // — zone scrolls with content) vs 'screen' (position: fixed in viewport
    // coordinates — zone stays put during scroll, ideal for always-on
    // screen-share privacy overlays).
    const anchor = zoneData.anchor === "screen" ? "screen" : "page";
    el.dataset.blSiZoneAnchor = anchor;
    el.dataset.blSiPickBlur = '1';

    const position = anchor === "screen" ? "fixed" : "absolute";
    el.style.cssText =
      [
        "position: " + position,
        "left: " + zoneData.x + "px",
        "top: " + zoneData.y + "px",
        "width: " + zoneData.width + "px",
        "height: " + zoneData.height + "px",
      ].join("; ") + ";";

    document.body.appendChild(el);
    _zoneOverlays.set(zoneData.id, el);
    return el;
  }

  function removeZoneOverlay(zoneId) {
    const el = _zoneOverlays.get(zoneId);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
    _zoneOverlays.delete(zoneId);
  }

  function getZoneOverlays() {
    return Array.from(_zoneOverlays.values());
  }

  function removeAllZoneOverlays() {
    for (const [, el] of _zoneOverlays) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    _zoneOverlays.clear();
  }

  // ── Item reconcile state + counters ────────────────────────────────────────

  let _elementCounter = 0;
  let _pageAreaCounter = 0;
  let _screenAreaCounter = 0;

  // Tracks items currently applied to the DOM, keyed by item id
  // (dynamic → selector, sticky → id). Diffed against storage on every
  // handleSite() call to reconcile add/remove.
  const _activeItems = new Map();

  let _highlightedEl = null;

  function _itemId(item) {
    if (!item) return undefined;
    if (item.type === "dynamic") {
      const sels = blsi.item_selectors(item);
      return sels[0];
    }
    return item.id;
  }

  function _isExtensionUI(el) {
    return blsi.MarkerEngine._isExtensionUI(el);
  }

  function _applyDynamicItem(item) {
    const sels = blsi.item_selectors(item);
    const el = blsi.SelectorUtils.restoreSelector(sels);
    if (el && !_isExtensionUI(el)) {
      el.dataset.blSiPickBlur = '1';
    }
    const raw = item.name || '';
    const numStr = raw.startsWith('Element ') ? raw.slice(8) : raw.slice('Dynamic '.length);
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num > _elementCounter) _elementCounter = num;
  }

  function tryPickBlurNode(el) {
    if (!el || !(el instanceof Element)) return;
    if (el.dataset.blSiPickBlur) return;
    if (_isExtensionUI(el)) return;
    for (const item of _activeItems.values()) {
      if (item.type !== 'dynamic') continue;
      const sels = blsi.item_selectors(item);
      for (let s = 0; s < sels.length; s++) {
        try {
          if (el.matches(sels[s]) && document.querySelectorAll(sels[s]).length === 1) {
            el.dataset.blSiPickBlur = '1';
            return;
          }
        } catch (_) { /* invalid selector — ignore */ }
      }
    }
  }

  function _removeDynamicItem(item) {
    const sels = blsi.item_selectors(item);
    const el = blsi.SelectorUtils.restoreSelector(sels);
    if (el) delete el.dataset.blSiPickBlur;
  }

  function _applyStickyItem(item) {
    // Anchor determines coordinate system:
    //   'page'   — document coordinates, scrolls with content. Supports
    //              xPct/yPct re-projection on layout changes.
    //   'screen' — viewport coordinates, position: fixed. Raw x/y stable
    //              across pages.
    const anchor = item.anchor === "screen" ? "screen" : "page";

    let x, y, w, h;
    if (anchor === "page") {
      const curW = document.documentElement.scrollWidth || window.innerWidth;
      // Re-project X/width when viewport WIDTH has clearly changed (reflow).
      // Never re-project Y/height — page height varies during load (lazy images,
      // dynamic content) so curH at RESTORE time is unreliable; raw Y is exact.
      const wChanged = item.scrollWidth && Math.abs(curW - item.scrollWidth) > Math.max(10, item.scrollWidth * 0.01);
      x = (wChanged && typeof item.xPct === "number") ? item.xPct * curW : item.x;
      y = item.y;
      w = (wChanged && typeof item.widthPct === "number") ? item.widthPct * curW : item.width;
      h = item.height;
    } else {
      // Screen-anchored: raw pixel coordinates in the viewport. No re-projection.
      x = item.x;
      y = item.y;
      w = item.width;
      h = item.height;
    }

    createZoneOverlay({
      id: item.id,
      name: item.name,
      anchor: anchor,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
    });

    const raw = item.name || '';
    if (raw.startsWith('Area on screen ')) {
      const num = parseInt(raw.slice(15), 10);
      if (!isNaN(num) && num > _screenAreaCounter) _screenAreaCounter = num;
    } else if (raw.startsWith('Area on page ')) {
      const num = parseInt(raw.slice(13), 10);
      if (!isNaN(num) && num > _pageAreaCounter) _pageAreaCounter = num;
    } else {
      const num = parseInt(raw.replace('Sticky ', ''), 10);
      if (!isNaN(num) && num > _pageAreaCounter) _pageAreaCounter = num;
    }
  }

  function _removeStickyItem(item) {
    removeZoneOverlay(item.id);
  }

  function applyItem(item) {
    if (!item) return;
    if (item.type === "dynamic") _applyDynamicItem(item);
    else if (item.type === "sticky") _applyStickyItem(item);
  }

  function removeItem(item) {
    if (!item) return;
    if (item.type === "dynamic") _removeDynamicItem(item);
    else if (item.type === "sticky") _removeStickyItem(item);
  }

  /**
   * Diff `desired` items against `_activeItems` and apply/remove the delta.
   * Runs in both active and inactive paths — picker blurs and sticky zones
   * persist even when blur-all is off.
   */
  function reconcileItems(desired) {
    const desiredArray = Array.isArray(desired) ? desired : [];
    const desiredById = new Map(desiredArray.map((i) => [_itemId(i), i]));

    let added = 0, removed = 0;
    for (const [id, item] of Array.from(_activeItems)) {
      if (!desiredById.has(id)) {
        removeItem(item);
        _activeItems.delete(id);
        removed++;
      }
    }
    for (const [id, item] of desiredById) {
      const isNew = !_activeItems.has(id);
      applyItem(item);
      _activeItems.set(id, item);
      if (isNew) added++;
    }
    State.setPickBlurDynamicActive(desiredArray.some(i => i.type === 'dynamic'));
    return { added, removed };
  }

  function activeItemsSize() {
    return _activeItems.size;
  }

  function resetCounters() {
    _elementCounter = 0;
    _pageAreaCounter = 0;
    _screenAreaCounter = 0;
  }

  function allocateElementName() {
    _elementCounter++;
    return 'Element ' + _elementCounter;
  }

  function allocateStickyName(anchor) {
    if (anchor === 'screen') {
      _screenAreaCounter++;
      return 'Area on screen ' + _screenAreaCounter;
    }
    _pageAreaCounter++;
    return 'Area on page ' + _pageAreaCounter;
  }

  // ── Popup hover highlight ──────────────────────────────────────────────────

  function highlightItem(item) {
    if (_highlightedEl) {
      _highlightedEl.classList.remove("bl-si-hover-highlight");
      _highlightedEl = null;
    }
    var el = null;
    if (item && item.item_type === "dynamic") {
      var sels = blsi.item_selectors(item);
      el = blsi.SelectorUtils.restoreSelector(sels);
      // Fallback: SPA position shifts make structural selectors non-unique or stale.
      // Class combo (now always stored) lets us find the right element among hits.
      if (!el) {
        outer: for (var i = 0; i < sels.length; i++) {
          try {
            var hits = document.querySelectorAll(sels[i]);
            for (var j = 0; j < hits.length; j++) {
              if (hits[j].dataset && hits[j].dataset.blSiPickBlur) { el = hits[j]; break outer; }
            }
          } catch (_e2) { /* invalid selector — try next */ }
        }
      }
    } else if (item && item.item_type === "sticky") {
      el = _zoneOverlays.get(item.id) || null;
    }
    if (!el) return;
    el.classList.add("bl-si-hover-highlight");
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    _highlightedEl = el;
  }

  function clearItemHighlight() {
    if (_highlightedEl) {
      _highlightedEl.classList.remove("bl-si-hover-highlight");
      _highlightedEl = null;
    }
  }

  return {
    // Zone overlay query.
    getZoneOverlays,
    removeAllZoneOverlays,

    // Item reconcile (called by orchestrator handleSite).
    reconcileItems,
    activeItemsSize,

    // Picker callbacks — counter allocation for new item naming.
    resetCounters,
    allocateElementName,
    allocateStickyName,

    // Popup hover highlight.
    highlightItem,
    clearItemHighlight,

    // Observer hook — late-loading dynamic pick-blur stamping.
    tryPickBlurNode,
  };
})();

blsi.TargetEngine = BlurrySiteTargetEngine;
