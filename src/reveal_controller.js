/**
 * reveal_controller.js — Temporary reveal of blurred elements via the
 * `data-bl-si-reveal` attribute. Modes: hover, click, none.
 *
 * Three DOM walks (all shadow-DOM aware via `_ancestorOrHost`):
 *   - findBlurredNear        find the nearest blurred element at the cursor
 *   - revealBlurredAncestors stamp every blurred ancestor (outer filter
 *                            would otherwise keep blurring the reveal)
 *   - _revealElement         stamp el + its blurred descendants
 *
 * Cleanup mirrors:
 *   - _unrevealElement / _unrevealAll  (target + descendants)
 *   - clearAncestorReveals             (ancestor chain)
 *
 * Wiring from content_script.js:
 *   blsi.Reveal.init({
 *     getMode:       () => settings.reveal_mode,
 *     isPickerActive: () => isPickerActive,
 *   });
 *
 * Exposed as blsi.Reveal (IIFE — no ES module syntax).
 */

const BlurrySiteReveal = (() => {
  'use strict';

  const Engine = blsi.Engine;
  const RM = blsi.reveal_modes;

  // Tests cannot set e.isTrusted (jsdom non-configurable). Test events that
  // should pass the trust check set this Symbol instead.
  const _TRUST = Symbol.for('blsi_event_trusted');

  // Joined alwaysBlur tags + role attribute selectors from every category —
  // derived from Engine.CATEGORY_SELECTORS so this stays the single source
  // of truth. Roles MUST be included: descendant scans (find / stamp) need
  // to match role-blurred elements (e.g. <div role="button"> under FORM)
  // the same way blur-all CSS rules do — otherwise reveal misses them when
  // they sit beneath a hovered wrapper.
  const ALWAYS_BLUR_SELECTOR = (function () {
    const cats = Engine.CATEGORY_SELECTORS;
    const parts = [];
    for (const key of Object.keys(cats)) {
      for (const t of cats[key].alwaysBlur) parts.push(t);
      if (cats[key].roles) {
        for (const r of cats[key].roles) parts.push('[role="' + r + '"]');
      }
    }
    return parts.join(',');
  }());

  // ── State ────────────────────────────────────────────────────────────────

  let _getMode = () => null;
  let _getPickerActive = () => false;
  let _installed = false;

  let _revealedAncestors = [];          // Element[] stamped by revealBlurredAncestors
  let _clickRevealedEl = null;          // currently click-revealed element
  let _hoverRevealedEl = null;          // currently hover-revealed element
  const _revealedElements = new Set();  // every element with data-bl-si-reveal
  let _hoverExitTimer = null;           // 50ms debounce before hover dismiss

  // mousemove → rAF zone-hover detection state
  let _rafPending = false;
  let _lastMouseX = -1;
  let _lastMouseY = -1;
  let _mouseMoveAttached = false;

  // ── Predicates / selectors ───────────────────────────────────────────────

  // Reveal walks need the broader "visually blurred" check so role-matched
  // parents (e.g. <button role="tab"> under FORM) are cleared alongside
  // tag-matched and data-attribute-stamped elements.
  const _isVisuallyBlurred = (el) => Engine.isVisuallyBlurred(el);

  const _isZoneOverlay = (el) => !!(el && el.dataset && el.dataset.blSiZone !== undefined);

  // Single source of truth for "find any blurred element". Includes the
  // tag-rule selector when blur-all is active; always includes the three
  // data-attribute stamps.
  function _allBlurredSelector() {
    const stamps = '[data-bl-si-blur],[data-bl-si-pick-blur],[data-bl-si-pii]';
    return (ALWAYS_BLUR_SELECTOR && Engine.isBlurAllActive())
      ? ALWAYS_BLUR_SELECTOR + ',' + stamps
      : stamps;
  }

  // ── Shadow-aware walk primitive ──────────────────────────────────────────

  // Walk-one-step upward. parentElement first; when null (shadow root edge)
  // hops to the shadow host. Returns null past document root.
  function _ancestorOrHost(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return (root instanceof ShadowRoot) ? root.host : null;
  }

  // Walks up from `start` (inclusive) using _ancestorOrHost; returns the
  // first blurred element, or null. Used by both findBlurredNear (cursor →
  // nearest blurred) and revealBlurredAncestors (skip the loop when nothing
  // blurred remains above).
  function _findBlurredAncestor(start) {
    let node = start;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && _isVisuallyBlurred(node)) return node;
      node = _ancestorOrHost(node);
    }
    return null;
  }

  // Collect every shadow root in `node`'s composed subtree. querySelectorAll
  // does not pierce shadow boundaries — descendant walks for stamping /
  // unstamping / hit-testing must iterate each shadow root explicitly.
  // Recurses into nested shadow roots. Bounded by subtree size — `node` is
  // a hover target, not the document root.
  function _collectShadowRootsIn(node) {
    const out = [];
    if (node instanceof Element && node.shadowRoot) out.push(node.shadowRoot);
    if (node.querySelectorAll) {
      const descendants = node.querySelectorAll('*');
      for (let i = 0; i < descendants.length; i++) {
        if (descendants[i].shadowRoot) out.push(descendants[i].shadowRoot);
      }
    }
    // Recurse into discovered roots for nested shadows.
    for (let i = 0, len = out.length; i < len; i++) {
      const nested = _collectShadowRootsIn(out[i]);
      for (let j = 0; j < nested.length; j++) out.push(nested[j]);
    }
    return out;
  }

  // Stamp data-bl-si-reveal on every blurred element matched by `sel` inside
  // `root` (Element or ShadowRoot). qSAll-bounded to the given root only —
  // does NOT pierce shadow boundaries; the caller walks roots.
  function _stampBlurredIn(root, sel) {
    const matches = root.querySelectorAll(sel);
    for (let i = 0; i < matches.length; i++) {
      if (_isVisuallyBlurred(matches[i])) {
        matches[i].dataset.blSiReveal = '1';
        _revealedElements.add(matches[i]);
      }
    }
  }

  // Mirror of _stampBlurredIn for cleanup. Removes data-bl-si-reveal from
  // every stamped element inside `root`.
  function _unstampRevealsIn(root) {
    const stamped = root.querySelectorAll('[data-bl-si-reveal]');
    for (let i = 0; i < stamped.length; i++) {
      delete stamped[i].dataset.blSiReveal;
      _revealedElements.delete(stamped[i]);
    }
  }

  // ── Walk 1: find nearest blurred element at cursor ───────────────────────

  function findBlurredNear(el, clientX, clientY) {
    // UP — covers light DOM and shadow boundaries in one walk.
    const upHit = _findBlurredAncestor(el);
    if (upHit) return upHit;
    // DOWN — fallback when cursor is over a non-blurred wrapper.
    const downHit = _findBlurredDescendantAt(el, clientX, clientY);
    if (downHit) return downHit;
    // STACK PIERCE — fallback for sibling overlays at the same coords
    // (YouTube yt-touch-feedback-shape, MUI ripples, similar absolute-
    // positioned decoratives that sit on top of a blurred sibling). The
    // mouseover target is the overlay; tree walks miss the blurred sibling.
    if (clientX !== undefined && clientY !== undefined) {
      const stackHit = _findBlurredAtPoint(clientX, clientY);
      if (stackHit) return stackHit;
    }
    return null;
  }

  function _findBlurredAtPoint(clientX, clientY) {
    const hits = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < hits.length; i++) {
      if (_isVisuallyBlurred(hits[i])) return hits[i];
    }
    // elementsFromPoint excludes `display: contents` elements (no layout
    // box). Walk DOWN from each hit and Range-test every blurred descendant —
    // catches phantom elements like YT's ytAttributedStringHost spans.
    for (let i = 0; i < hits.length; i++) {
      const inner = _findBlurredDescendantAt(hits[i], clientX, clientY);
      if (inner) return inner;
    }
    return null;
  }

  function _findBlurredDescendantAt(el, clientX, clientY) {
    if (!(el instanceof Element)) return null;
    const sel = _allBlurredSelector();
    const useCoords = clientX !== undefined && clientY !== undefined;
    // Search light DOM + every shadow root in `el`'s composed subtree.
    // Reverse DOM order within each root — innermost match wins on overlap.
    const roots = [el].concat(_collectShadowRootsIn(el));
    for (let r = roots.length - 1; r >= 0; r--) {
      const candidates = roots[r].querySelectorAll(sel);
      for (let i = candidates.length - 1; i >= 0; i--) {
        const c = candidates[i];
        if (!_isVisuallyBlurred(c)) continue;
        if (!useCoords) return c;
        const rect = _hitRectOf(c);
        if (rect &&
            clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top  && clientY <= rect.bottom) return c;
      }
    }
    return null;
  }

  // Returns the visual hit-test rect for `el`. Falls back to a Range over the
  // element's text content when the element itself has no layout box —
  // happens for `display: contents` elements (e.g. YouTube's
  // `ytAttributedStringHost` class), whose own getBoundingClientRect is 0×0
  // even though their text renders in the parent's flow.
  function _hitRectOf(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width !== 0 || rect.height !== 0) return rect;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return (r.width !== 0 || r.height !== 0) ? r : null;
    } catch (_) {
      return null;
    }
  }

  // ── Walk 2: stamp every blurred ancestor of `el` ─────────────────────────

  // A shadow host with data-bl-si-blur applies filter:blur() to its entire
  // composed subtree. Inner reveal won't show through unless every blurred
  // ancestor (including across shadow boundaries) also has the reveal stamp.
  function revealBlurredAncestors(el) {
    clearAncestorReveals();
    let node = _ancestorOrHost(el);
    while (node && node !== document.documentElement) {
      if (_isVisuallyBlurred(node)) {
        node.dataset.blSiReveal = '1';
        _revealedAncestors.push(node);
      }
      node = _ancestorOrHost(node);
    }
  }

  function clearAncestorReveals() {
    for (let i = 0; i < _revealedAncestors.length; i++) {
      delete _revealedAncestors[i].dataset.blSiReveal;
    }
    _revealedAncestors = [];
  }

  // ── Walk 3: stamp `el` + every blurred descendant ────────────────────────

  function _revealElement(el) {
    el.dataset.blSiReveal = '1';
    _revealedElements.add(el);
    if (_isZoneOverlay(el)) return;       // zone overlays have no blurred children
    const sel = _allBlurredSelector();
    _stampBlurredIn(el, sel);
    // Pierce shadow boundaries — each shadow root has its own filter rules
    // (CSS injected per root) so descendants need their own reveal stamps.
    const shadows = _collectShadowRootsIn(el);
    for (let i = 0; i < shadows.length; i++) _stampBlurredIn(shadows[i], sel);
  }

  function _unrevealElement(el) {
    delete el.dataset.blSiReveal;
    _revealedElements.delete(el);
    if (_isZoneOverlay(el)) return;
    _unstampRevealsIn(el);
    const shadows = _collectShadowRootsIn(el);
    for (let i = 0; i < shadows.length; i++) _unstampRevealsIn(shadows[i]);
  }

  function _unrevealAll() {
    for (const el of _revealedElements) {
      delete el.dataset.blSiReveal;
    }
    _revealedElements.clear();
  }

  // ── Dismiss helpers ──────────────────────────────────────────────────────

  function _dismissClick() {
    if (_clickRevealedEl) {
      _unrevealElement(_clickRevealedEl);
      _clickRevealedEl = null;
    }
    clearAncestorReveals();
  }

  function _dismissHover() {
    if (!_hoverRevealedEl) return;
    _unrevealAll();
    clearAncestorReveals();
    _hoverRevealedEl = null;
  }

  // In click-reveal mode, pass-through clicks on `target="_blank"` links would
  // open a new tab — disruptive since the user just revealed content in-page.
  // Override: navigate in the same tab unless the user explicitly opted into a
  // new tab via a modifier key (Ctrl/Cmd/Shift) or a non-left-button click.
  function _redirectIfBlankLink(target, e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    let node = target;
    while (node && node !== document.documentElement) {
      if (node instanceof HTMLAnchorElement && node.href &&
          (node.target === '_blank' || node.target === '_new')) {
        e.preventDefault();
        window.location.assign(node.href);
        return;
      }
      node = node.parentElement;
    }
  }

  function _findZoneAtPoint(clientX, clientY) {
    const zones = Engine.getZoneOverlays();
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      const rect = z.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top  && clientY <= rect.bottom) {
        return z;
      }
    }
    return null;
  }

  // ── Zone mousemove detection ─────────────────────────────────────────────

  // Attached only when zones exist — detached when none. Zero cost on
  // zone-free pages.
  function _syncMouseMoveListener() {
    const hasZones = Engine.getZoneOverlays().length > 0;
    if (hasZones && !_mouseMoveAttached) {
      document.addEventListener('mousemove', onRevealMouseMove, true);
      _mouseMoveAttached = true;
    } else if (!hasZones && _mouseMoveAttached) {
      document.removeEventListener('mousemove', onRevealMouseMove, true);
      _mouseMoveAttached = false;
    }
  }

  // Thin handler — stores coordinates and schedules one rAF. Chrome 60+
  // already frame-aligns mousemove; the rAF gate guards older browsers and
  // avoids queuing multiple frames when layout is slow.
  function onRevealMouseMove(e) {
    if (_getMode() !== RM.hover) return;
    if (!e.isTrusted && !e[_TRUST]) return;
    if (_getPickerActive()) return;
    _lastMouseX = e.clientX;
    _lastMouseY = e.clientY;
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(_processZoneHover);
  }

  // rAF callback — actual zone boundary detection. getBoundingClientRect()
  // stays cheap (~0.1ms) because fixed-position zone overlays are not
  // invalidated by page mutations.
  function _processZoneHover() {
    _rafPending = false;
    if (!_installed) return;             // destroy() may have fired before rAF
    const zones = Engine.getZoneOverlays();
    if (!zones.length) return;

    const zone = _findZoneAtPoint(_lastMouseX, _lastMouseY);

    if (zone) {
      if (_hoverExitTimer) { clearTimeout(_hoverExitTimer); _hoverExitTimer = null; }
      if (_hoverRevealedEl === zone) return;
      _dismissHover();
      _revealElement(zone);
      _hoverRevealedEl = zone;
    } else if (_hoverRevealedEl && _isZoneOverlay(_hoverRevealedEl)) {
      // Cursor left zone — start 50ms debounce (mirrors regular element behavior).
      if (!_hoverExitTimer) {
        _hoverExitTimer = setTimeout(() => {
          _hoverExitTimer = null;
          _dismissHover();
        }, 50);
      }
    }
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function onRevealClick(e) {
    if (_getMode() !== RM.click) return;
    if (_getPickerActive()) return;

    // composedPath()[0] pierces shadow DOM retargeting — e.target is the
    // shadow host when the click originates inside a shadow root.
    const target = (e.composedPath && e.composedPath()[0] instanceof Element)
      ? e.composedPath()[0]
      : e.target;
    if (!(target instanceof Element)) return;

    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (zone === _clickRevealedEl) { _redirectIfBlankLink(target, e); return; }
      _dismissClick();
      _revealElement(zone);
      _clickRevealedEl = zone;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    const blurredEl = findBlurredNear(target, e.clientX, e.clientY);

    // Click inside the currently-revealed area — pass through so links navigate,
    // buttons fire, inputs focus. Override _blank links to navigate in-tab
    // (modifier keys still allow new-tab when explicitly intended).
    if (_clickRevealedEl && (blurredEl === _clickRevealedEl ||
        (_clickRevealedEl.contains && _clickRevealedEl.contains(target)))) {
      _redirectIfBlankLink(target, e);
      return;
    }

    if (!blurredEl) {
      _dismissClick();
      return;
    }

    // First click on a blurred element — intercept: reveal instead of act.
    // Capture phase keeps preventDefault() effective for links/buttons.
    _dismissClick();
    _revealElement(blurredEl);
    _clickRevealedEl = blurredEl;
    revealBlurredAncestors(blurredEl);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && _clickRevealedEl) _dismissClick();
  }

  function onRevealMouseOver(e) {
    if (_getMode() !== RM.hover) return;
    if (!e.isTrusted && !e[_TRUST]) return;
    _syncMouseMoveListener();

    const target = (e.composedPath && e.composedPath()[0] instanceof Element)
      ? e.composedPath()[0]
      : e.target;
    if (!(target instanceof Element)) return;

    // Zone hover is owned by _processZoneHover (mousemove). This handler
    // covers regular blurred elements only.
    const blurredRoot = findBlurredNear(target, e.clientX, e.clientY);

    // When blurredRoot is null the cursor is over a non-blurred wrapper or
    // gap — do NOT clear the exit timer. The 50ms debounce in onRevealMouseOut
    // handles genuine cursor exits; clearing it here would let hover reveal
    // stick when the cursor drifts into wrapper whitespace.
    if (!blurredRoot) return;

    // Confirmed over a blurred element — cancel pending dismiss.
    if (_hoverExitTimer) { clearTimeout(_hoverExitTimer); _hoverExitTimer = null; }

    if (_hoverRevealedEl && _hoverRevealedEl !== blurredRoot) _dismissHover();
    if (_hoverRevealedEl === blurredRoot) return;

    _revealElement(blurredRoot);
    _hoverRevealedEl = blurredRoot;
    revealBlurredAncestors(blurredRoot);
  }

  function onRevealMouseOut(e) {
    if (!e.isTrusted && !e[_TRUST]) return;
    if (!_hoverRevealedEl) return;
    _syncMouseMoveListener();
    // Zone dismiss is owned by _processZoneHover — mouseout never fires
    // reliably at zone boundaries (pointer-events: none).
    if (_isZoneOverlay(_hoverRevealedEl)) return;
    if (_hoverExitTimer) clearTimeout(_hoverExitTimer);
    _hoverExitTimer = setTimeout(() => {
      _hoverExitTimer = null;
      _dismissHover();
    }, 50);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function init(opts) {
    if (_installed) return;
    if (opts && typeof opts.getMode === 'function') _getMode = opts.getMode;
    if (opts && typeof opts.isPickerActive === 'function') _getPickerActive = opts.isPickerActive;
    // Capture phase — SPAs (e.g. WhatsApp Web) stop propagation at intermediate
    // levels for their own hover/click handling. Bubble-phase listeners on
    // `document` would never fire. Capture also keeps preventDefault()
    // effective for click intercepts on links/buttons.
    document.addEventListener('mouseover', onRevealMouseOver, true);
    document.addEventListener('mouseout',  onRevealMouseOut,  true);
    document.addEventListener('click',     onRevealClick,     true);
    document.addEventListener('keydown',   onRevealKeydown);
    _installed = true;
  }

  function destroy() {
    if (!_installed) return;
    document.removeEventListener('mouseover', onRevealMouseOver, true);
    document.removeEventListener('mouseout',  onRevealMouseOut,  true);
    document.removeEventListener('click',     onRevealClick,     true);
    document.removeEventListener('keydown',   onRevealKeydown);
    if (_mouseMoveAttached) {
      document.removeEventListener('mousemove', onRevealMouseMove, true);
      _mouseMoveAttached = false;
    }
    clearAll();
    _installed = false;
  }

  function clearAll() {
    if (_hoverExitTimer) {
      clearTimeout(_hoverExitTimer);
      _hoverExitTimer = null;
    }
    _rafPending = false;
    _lastMouseX = -1;
    _lastMouseY = -1;
    _unrevealAll();
    clearAncestorReveals();
    _clickRevealedEl = null;
    _hoverRevealedEl = null;
  }

  return { init, destroy, clearAll };
})();

blsi.Reveal = BlurrySiteReveal;
