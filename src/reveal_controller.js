/**
 * reveal_controller.js — Temporary reveal on click or hover
 *
 * Exposed as blsi.Reveal (IIFE — no ES module syntax).
 *
 * Owns all state for the reveal subsystem (click mode + hover mode, plus
 * ancestor-chain unblur and sticky zone overlay hit-testing). Depends on
 * blsi.BlurEngine for isBlurred() and getZoneOverlays(); otherwise stateless
 * relative to the rest of the extension.
 *
 * Wiring from content_script.js:
 *   blsi.Reveal.init({
 *     getMode:       () => settings.REVEAL_MODE,
 *     isPickerActive: () => isPickerActive,
 *   });
 */

const BlurrySiteReveal = (() => {
  'use strict';

  const Engine = blsi.BlurEngine;
  const RM = blsi.reveal_modes;

  // Tests cannot set e.isTrusted (jsdom non-configurable). Any test event that
  // should pass the trusted check must set this Symbol on the event object.
  const _TRUST = Symbol.for('blsi_event_trusted');

  // Derived from Engine.CATEGORY_SELECTORS — single source of truth.
  // Joins every alwaysBlur tag across all categories into one CSS selector.
  const ALWAYS_BLUR_SELECTOR = (function () {
    var cats = Engine.CATEGORY_SELECTORS;
    var tags = [];
    var keys = Object.keys(cats);
    for (var i = 0; i < keys.length; i++) {
      var ab = cats[keys[i]].alwaysBlur;
      for (var j = 0; j < ab.length; j++) tags.push(ab[j]);
    }
    return tags.join(',');
  }());

  // ── State ────────────────────────────────────────────────────────────────
  let _getMode = () => null;
  let _getPickerActive = () => false;
  let _installed = false;

  let revealedAncestors = [];
  let clickRevealedEl = null;
  let mouseoutTimer = null;
  let _hoverRevealedEl = null;
  const _revealedElements = new Set();

  // mousemove-based zone detection state
  let _rafPending = false;
  let _lastMouseX = -1;
  let _lastMouseY = -1;
  let _mouseMoveAttached = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  // Reveal walks need the broader "visually blurred" check so role-matched
  // parents (e.g. <button role="tab"> under the FORM category) are cleared
  // alongside tag-matched and data-attribute-stamped elements. Fall back to
  // Engine.isBlurred for older builds of blur_engine that don't expose the
  // helper yet.
  const _isVisuallyBlurred = (el) =>
    typeof Engine.isVisuallyBlurred === 'function'
      ? Engine.isVisuallyBlurred(el)
      : Engine.isBlurred(el);

  function clearRevealedAncestors() {
    for (let i = 0; i < revealedAncestors.length; i++) {
      delete revealedAncestors[i].dataset.blSiReveal;
    }
    revealedAncestors = [];
  }

  function revealAncestorChain(el) {
    clearRevealedAncestors();
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (_isVisuallyBlurred(node)) {
        node.dataset.blSiReveal = '1';
        revealedAncestors.push(node);
      }
      node = node.parentElement;
    }
    // Cross shadow DOM boundaries: a host element with data-bl-si-blur still
    // applies filter:blur() to its entire rendered subtree (including shadow
    // root contents) even when inner elements have data-bl-si-reveal stamped.
    // Walk up through each shadow host and its ancestors to clear outer blurs.
    var root = el.getRootNode();
    while (root instanceof ShadowRoot) {
      var host = root.host;
      if (_isVisuallyBlurred(host)) {
        host.dataset.blSiReveal = '1';
        revealedAncestors.push(host);
      }
      var hostParent = host.parentElement;
      while (hostParent && hostParent !== document.documentElement) {
        if (_isVisuallyBlurred(hostParent)) {
          hostParent.dataset.blSiReveal = '1';
          revealedAncestors.push(hostParent);
        }
        hostParent = hostParent.parentElement;
      }
      root = host.getRootNode();
    }
  }

  function findBlurredTarget(el, clientX, clientY) {
    // Walk UP — find the nearest blurred ancestor (or self).
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && _isVisuallyBlurred(node)) return node;
      node = node.parentElement;
    }
    // parentElement stops at shadow root boundaries: for an element whose
    // parent is a ShadowRoot (not an Element), parentElement returns null
    // before we ever reach the shadow host. Walk up the host chain, then
    // continue up light DOM from the outermost host if needed.
    // Handles: <rpl-badge data-bl-si-blur> → #shadow-root → <span> (cursor here)
    if (node === null && el instanceof Element) {
      var root = el.getRootNode();
      var lastHost = null;
      while (root instanceof ShadowRoot) {
        if (_isVisuallyBlurred(root.host)) return root.host;
        lastHost = root.host;
        root = root.host.getRootNode();
      }
      // Re-entered light DOM — keep walking up from the outermost host.
      if (lastHost) {
        var lightNode = lastHost.parentElement;
        while (lightNode && lightNode !== document.documentElement) {
          if (_isVisuallyBlurred(lightNode)) return lightNode;
          lightNode = lightNode.parentElement;
        }
      }
    }
    // Walk DOWN — fallback when hover target is a non-blurred wrapper.
    // querySelectorAll scoped to el's subtree keeps the candidate set small
    // (typically 5–50 elements; 300 is a safe upper bound on dense pages).
    // Iterating in reverse DOM order returns the innermost match first when
    // nested blurred elements overlap at the cursor position.
    if (el && el instanceof Element) {
      var hasSel = ALWAYS_BLUR_SELECTOR && Engine.isBlurAllActive();
      var sel = hasSel
        ? ALWAYS_BLUR_SELECTOR + ',[data-bl-si-blur],[data-bl-si-pick-blur],[data-bl-si-pii]'
        : '[data-bl-si-blur],[data-bl-si-pick-blur],[data-bl-si-pii]';
      var candidates = el.querySelectorAll(sel);
      var useCoords = clientX !== undefined && clientY !== undefined;
      for (var i = candidates.length - 1; i >= 0; i--) {
        var c = candidates[i];
        if (!_isVisuallyBlurred(c)) continue;
        if (useCoords) {
          var r = c.getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right &&
              clientY >= r.top  && clientY <= r.bottom) return c;
        } else {
          return c; // no coords — return innermost blurred descendant
        }
      }
    }
    return null;
  }

  function _isZoneOverlay(el) {
    return el && el.dataset && el.dataset.blSiZone !== undefined;
  }

  function _revealElement(el) {
    el.dataset.blSiReveal = '1';
    if (!_isZoneOverlay(el)) {
      // Stamp reveal on all blurred children — tag-matched (CSS rule) and
      // data-stamped (picker). querySelectorAll is browser-native and fast.
      var sel = (ALWAYS_BLUR_SELECTOR && Engine.isBlurAllActive())
        ? ALWAYS_BLUR_SELECTOR + ',[data-bl-si-blur],[data-bl-si-pick-blur],[data-bl-si-pii]'
        : '[data-bl-si-blur],[data-bl-si-pick-blur],[data-bl-si-pii]';
      var children = el.querySelectorAll(sel);
      for (var i = 0; i < children.length; i++) {
        if (_isVisuallyBlurred(children[i])) {
          children[i].dataset.blSiReveal = '1';
          _revealedElements.add(children[i]);
        }
      }
    }
    _revealedElements.add(el);
  }

  function _unrevealElement(el) {
    delete el.dataset.blSiReveal;
    if (!_isZoneOverlay(el)) {
      // Clean up by querying the reveal attr directly — no tag search needed
      var revealed = el.querySelectorAll('[data-bl-si-reveal]');
      for (var i = 0; i < revealed.length; i++) {
        delete revealed[i].dataset.blSiReveal;
        _revealedElements.delete(revealed[i]);
      }
    }
    _revealedElements.delete(el);
  }

  function _unrevealAll() {
    for (const el of _revealedElements) {
      delete el.dataset.blSiReveal;
    }
    _revealedElements.clear();
  }

  function dismissClickReveal() {
    if (clickRevealedEl) {
      _unrevealElement(clickRevealedEl);
      clickRevealedEl = null;
    }
    clearRevealedAncestors();
  }

  function _dismissHoverReveal() {
    if (_hoverRevealedEl) {
      _unrevealAll();
      clearRevealedAncestors();
      _hoverRevealedEl = null;
    }
  }

  // In click-reveal mode, pass-through clicks on `target="_blank"` links would
  // open a new tab — disruptive since the user just revealed content in-page.
  // Override: navigate in the same tab unless the user explicitly opted into a
  // new tab via a modifier key (Ctrl/Cmd/Shift) or a non-left-button click.
  function _redirectIfBlankLink(target, e) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    var node = target;
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
          clientY >= rect.top && clientY <= rect.bottom) {
        return z;
      }
    }
    return null;
  }

  // ── Zone mousemove detection ─────────────────────────────────────────────

  // Attached only when zones exist — detached when none. Zero cost on zone-free pages.
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

  // Thin handler — stores coordinates and schedules one rAF. Chrome 60+ already
  // frame-aligns mousemove events (once per frame), so the rAF gate mainly guards
  // older browsers and avoids queuing multiple frames when the layout is slow.
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

  // rAF callback — actual zone boundary detection. getBoundingClientRect() stays
  // on the cheap path (~0.1ms) because fixed-position zone overlays are not
  // invalidated by page content mutations.
  function _processZoneHover() {
    _rafPending = false;
    if (!_installed) return; // guard: destroy() may have been called before rAF fired
    const zones = Engine.getZoneOverlays();
    if (!zones.length) return;

    const zone = _findZoneAtPoint(_lastMouseX, _lastMouseY);

    if (zone) {
      if (mouseoutTimer) { clearTimeout(mouseoutTimer); mouseoutTimer = null; }
      if (_hoverRevealedEl === zone) return;
      _dismissHoverReveal();
      _revealElement(zone);
      _hoverRevealedEl = zone;
    } else if (_hoverRevealedEl && _isZoneOverlay(_hoverRevealedEl)) {
      // Cursor left zone area — start 50ms debounce (mirrors regular element behavior)
      if (!mouseoutTimer) {
        mouseoutTimer = setTimeout(() => {
          mouseoutTimer = null;
          _dismissHoverReveal();
        }, 50);
      }
    }
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function onRevealClick(e) {
    if (_getMode() !== RM.click) return;
    if (_getPickerActive()) return;

    // composedPath()[0] pierces shadow DOM retargeting — e.target is the shadow
    // host when the click originates inside a shadow root. composedPath()[0] gives
    // the actual element clicked (e.g. an SVG or blurred span inside shadow DOM).
    const target = (e.composedPath && e.composedPath()[0] instanceof Element)
      ? e.composedPath()[0]
      : e.target;
    if (!(target instanceof Element)) return;

    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (zone === clickRevealedEl) { _redirectIfBlankLink(target, e); return; } // already revealed — let click act
      dismissClickReveal();
      _revealElement(zone);
      clickRevealedEl = zone;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    const blurredEl = findBlurredTarget(target, e.clientX, e.clientY);

    // Click is inside the currently revealed area (the element itself or any
    // child) — pass through so links navigate, buttons fire, inputs focus.
    // Override _blank links to navigate in-tab (modifier keys still open a new
    // tab when the user explicitly intends it).
    if (clickRevealedEl && (blurredEl === clickRevealedEl ||
        (clickRevealedEl.contains && clickRevealedEl.contains(target)))) {
      _redirectIfBlankLink(target, e);
      return;
    }

    // Click outside any blurred element — dismiss reveal and pass through.
    if (!blurredEl) {
      dismissClickReveal();
      return;
    }

    // First click on a blurred element — intercept: reveal instead of act.
    // Listener runs at capture phase so preventDefault() is not yet too late
    // for links (<a href>) and buttons.
    dismissClickReveal();
    _revealElement(blurredEl);
    clickRevealedEl = blurredEl;
    revealAncestorChain(blurredEl);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && clickRevealedEl) {
      dismissClickReveal();
    }
  }

  function onRevealMouseOver(e) {
    if (_getMode() !== RM.hover) return;
    if (!e.isTrusted && !e[_TRUST]) return;
    _syncMouseMoveListener();
    // composedPath()[0] pierces shadow DOM retargeting — e.target is the shadow
    // host when the mouseover originates inside a shadow root. composedPath()[0]
    // gives the actual element under the cursor (e.g. svg or path inside shadow).
    // findBlurredTarget then walks up within the shadow tree via parentElement,
    // finds the blurred element, and _revealElement stamps it inside shadow DOM.
    // The shadow root's injected [data-bl-si-reveal] CSS rule clears the filter.
    const target = (e.composedPath && e.composedPath()[0] instanceof Element)
      ? e.composedPath()[0]
      : e.target;
    if (!(target instanceof Element)) return;

    // Zone detection moved to mousemove (_processZoneHover) — precise boundary
    // detection without the "distance to travel" lag from pointer-events:none gaps.

    const blurredRoot = findBlurredTarget(target, e.clientX, e.clientY);

    // Only act when we actually found a blurred element under the cursor.
    // When blurredRoot is null — cursor is over a non-blurred wrapper or gap
    // between elements — do NOT clear the mouseout timer and do NOT dismiss
    // immediately. The 50ms debounce in onRevealMouseOut handles the case where
    // the cursor genuinely leaves the reveal area. Clearing the timer here would
    // prevent that debounce from firing, causing hover reveal to stick
    // indefinitely when the cursor drifts into wrapper whitespace.
    if (!blurredRoot) return;

    // Cursor is confirmed over a blurred element — safe to cancel the pending
    // dismiss and transition to (or stay on) this element.
    if (mouseoutTimer) { clearTimeout(mouseoutTimer); mouseoutTimer = null; }

    if (_hoverRevealedEl && _hoverRevealedEl !== blurredRoot) {
      _dismissHoverReveal();
    }
    if (_hoverRevealedEl === blurredRoot) return;

    _revealElement(blurredRoot);
    _hoverRevealedEl = blurredRoot;
    revealAncestorChain(blurredRoot);
  }

  function onRevealMouseOut(e) {
    if (!e.isTrusted && !e[_TRUST]) return;
    if (!_hoverRevealedEl) return;
    _syncMouseMoveListener();
    // Zone dismiss is owned by _processZoneHover (mousemove). mouseout on a zone
    // overlay never fires because pointer-events:none makes them invisible to the
    // event system — the browser delivers mouseout only when the cursor leaves an
    // underlying website element, which may be well inside the zone boundary.
    if (_isZoneOverlay(_hoverRevealedEl)) return;
    if (mouseoutTimer) clearTimeout(mouseoutTimer);
    mouseoutTimer = setTimeout(() => {
      mouseoutTimer = null;
      _dismissHoverReveal();
    }, 50);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function init(opts) {
    if (_installed) return;
    if (opts && typeof opts.getMode === 'function') _getMode = opts.getMode;
    if (opts && typeof opts.isPickerActive === 'function') _getPickerActive = opts.isPickerActive;
    // Capture phase for mouse events — SPAs like WhatsApp Web stop propagation
    // at intermediate DOM levels for their own hover handling (timestamps, read
    // receipts, chat item highlighting). Bubble-phase listeners on `document`
    // never fire if any handler between the target and document calls
    // stopPropagation(). Capture fires top-down before any target/bubble
    // handler, so it always reaches us.
    document.addEventListener('mouseover', onRevealMouseOver, true);
    document.addEventListener('mouseout', onRevealMouseOut, true);
    // Capture phase — must run before the target's own handlers so that
    // preventDefault() is still effective for links and buttons. stopPropagation
    // is only called when actively intercepting a first-click on a blurred
    // element; clicks inside already-revealed areas pass through untouched.
    document.addEventListener('click', onRevealClick, true);
    document.addEventListener('keydown', onRevealKeydown);
    _installed = true;
  }

  function destroy() {
    if (!_installed) return;
    document.removeEventListener('mouseover', onRevealMouseOver, true);
    document.removeEventListener('mouseout', onRevealMouseOut, true);
    document.removeEventListener('click', onRevealClick, true);
    document.removeEventListener('keydown', onRevealKeydown);
    if (_mouseMoveAttached) {
      document.removeEventListener('mousemove', onRevealMouseMove, true);
      _mouseMoveAttached = false;
    }
    clearAll();
    _installed = false;
  }

  function clearAll() {
    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }
    _rafPending = false;
    _lastMouseX = -1;
    _lastMouseY = -1;
    _unrevealAll();
    clearRevealedAncestors();
    clickRevealedEl = null;
    _hoverRevealedEl = null;
  }

  return { init, destroy, clearAll };
})();

blsi.Reveal = BlurrySiteReveal;
