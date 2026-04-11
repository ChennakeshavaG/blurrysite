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
  const RM = blsi.REVEAL_MODES;

  // ── State ────────────────────────────────────────────────────────────────
  let _getMode = () => null;
  let _getPickerActive = () => false;
  let _installed = false;

  let revealedAncestors = [];
  let clickRevealedEl = null;
  let mouseoutTimer = null;
  let _hoverRevealedEl = null;
  const _revealedElements = new Set();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function clearRevealedAncestors() {
    for (let i = 0; i < revealedAncestors.length; i++) {
      revealedAncestors[i].style.removeProperty('filter');
    }
    revealedAncestors = [];
  }

  function revealAncestorChain(el) {
    clearRevealedAncestors();
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (Engine.isBlurred(node)) {
        node.style.setProperty('filter', 'none', 'important');
        revealedAncestors.push(node);
      }
      node = node.parentElement;
    }
  }

  function findBlurredTarget(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && Engine.isBlurred(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function _isZoneOverlay(el) {
    return el && el.dataset && el.dataset.blSiZone !== undefined;
  }

  function _revealElement(el) {
    if (_isZoneOverlay(el)) {
      el.style.setProperty('backdrop-filter', 'none', 'important');
      el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    } else {
      el.style.setProperty('filter', 'none', 'important');
      el.querySelectorAll('*').forEach(child => {
        if (Engine.isBlurred(child)) {
          child.style.setProperty('filter', 'none', 'important');
          _revealedElements.add(child);
        }
      });
    }
    _revealedElements.add(el);
  }

  function _unrevealElement(el) {
    if (_isZoneOverlay(el)) {
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
    } else {
      el.style.removeProperty('filter');
      el.style.removeProperty('transition');
      el.querySelectorAll('*').forEach(child => {
        if (_revealedElements.has(child)) {
          child.style.removeProperty('filter');
          _revealedElements.delete(child);
        }
      });
    }
    _revealedElements.delete(el);
  }

  function _unrevealAll() {
    const snapshot = Array.from(_revealedElements);
    for (const el of snapshot) {
      if (_isZoneOverlay(el)) {
        el.style.removeProperty('backdrop-filter');
        el.style.removeProperty('-webkit-backdrop-filter');
      } else {
        el.style.removeProperty('filter');
        el.style.removeProperty('transition');
      }
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

  // ── Event handlers ───────────────────────────────────────────────────────

  function onRevealClick(e) {
    if (_getMode() !== RM.CLICK) return;
    if (_getPickerActive()) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
        tag === 'button' || target.isContentEditable) return;

    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (zone === clickRevealedEl) return;
      dismissClickReveal();
      _revealElement(zone);
      clickRevealedEl = zone;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const blurredEl = findBlurredTarget(target);
    if (!blurredEl) return;

    if (blurredEl === clickRevealedEl) return;

    dismissClickReveal();
    _revealElement(blurredEl);
    clickRevealedEl = blurredEl;
    revealAncestorChain(blurredEl);
    e.preventDefault();
    e.stopPropagation();
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && clickRevealedEl) {
      dismissClickReveal();
    }
  }

  function onRevealMouseOver(e) {
    if (_getMode() !== RM.HOVER) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }

    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (_hoverRevealedEl === zone) return;
      _dismissHoverReveal();
      _revealElement(zone);
      _hoverRevealedEl = zone;
      return;
    }

    const blurredRoot = findBlurredTarget(target);
    if (_hoverRevealedEl && _hoverRevealedEl !== blurredRoot) {
      _dismissHoverReveal();
    }

    if (!blurredRoot) return;
    if (_hoverRevealedEl === blurredRoot) return;

    _dismissHoverReveal();
    _revealElement(blurredRoot);
    _hoverRevealedEl = blurredRoot;
    revealAncestorChain(blurredRoot);
  }

  function onRevealMouseOut(_e) {
    if (!_hoverRevealedEl) return;
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
    document.addEventListener('click', onRevealClick);
    document.addEventListener('keydown', onRevealKeydown);
    document.addEventListener('mouseover', onRevealMouseOver);
    document.addEventListener('mouseout', onRevealMouseOut);
    _installed = true;
  }

  function destroy() {
    if (!_installed) return;
    document.removeEventListener('click', onRevealClick);
    document.removeEventListener('keydown', onRevealKeydown);
    document.removeEventListener('mouseover', onRevealMouseOver);
    document.removeEventListener('mouseout', onRevealMouseOut);
    clearAll();
    _installed = false;
  }

  function clearAll() {
    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }
    _unrevealAll();
    clearRevealedAncestors();
    clickRevealedEl = null;
    _hoverRevealedEl = null;
  }

  return { init, destroy, clearAll };
})();

blsi.Reveal = BlurrySiteReveal;
