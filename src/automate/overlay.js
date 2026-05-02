/**
 * automate/overlay.js — Viewport-covering frosted blur overlay.
 *
 * Single full-viewport <div> mounted on document.body. When automate state
 * (idle / tab-switch / screen-share) requires blur, show() mounts the div;
 * hide() removes it. No DOM traversal, no per-element stamping, no <style>
 * injection competing with the page's cascade — just one element on top of
 * everything.
 *
 * The overlay is the render path for AUTOMATE-driven blur only. Manual
 * blur-all, pick-blur, and PII detection use the existing stamp+CSS engine.
 *
 * One mode, fixed: deep frosted glass. Automate intent is "hide this page
 * now, privacy-strongest" — the user's blur_mode / blur_radius / color
 * preferences are deliberately NOT consulted here. The overlay is not a
 * styled blur surface; it is a privacy curtain.
 *
 * Loaded in CONTENT context only (per-tab). Not used in background.
 *
 * Contract: docs/contracts/automate/overlay.md
 *
 * Exposed as blsi.Automate.Overlay (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  const ROOT_ID     = 'bl-si-automate-overlay';
  const Z_INDEX     = '2147483646';   // one below the picker toolbar (2147483647)
  const BLUR_RADIUS = '40px';         // deep — heavy obscuration, page motion still hints through
  const TINT        = 'rgba(0, 0, 0, 0.45)'; // moderate dark tint atop the backdrop blur

  let _el          = null;
  let _initialized = false;

  function _create() {
    if (_el || !document.body) return;
    _el = document.createElement('div');
    _el.id = ROOT_ID;
    _el.setAttribute('aria-hidden', 'true');
    _el.setAttribute('data-bl-si-extension-ui', '1');  // exclude from blur engines
    _apply_styles(_el);
    document.body.appendChild(_el);
  }

  function _apply_styles(el) {
    // Inline styles with !important — keeps the overlay self-contained and
    // immune to page CSS that might disable z-index, pointer-events, or the
    // backdrop-filter. setProperty bypasses style-src CSP (CSP applies to
    // <style> tags + style attributes parsed from markup, not DOM-API mutations).
    const s = el.style;
    s.setProperty('all',                     'initial',     'important');
    s.setProperty('position',                'fixed',       'important');
    s.setProperty('top',                     '0',           'important');
    s.setProperty('right',                   '0',           'important');
    s.setProperty('bottom',                  '0',           'important');
    s.setProperty('left',                    '0',           'important');
    s.setProperty('width',                   '100vw',       'important');
    s.setProperty('height',                  '100vh',       'important');
    s.setProperty('z-index',                 Z_INDEX,       'important');
    s.setProperty('pointer-events',          'auto',        'important');
    s.setProperty('display',                 'block',       'important');
    s.setProperty('user-select',             'none',        'important');
    s.setProperty('background',              TINT,                          'important');
    s.setProperty('backdrop-filter',         'blur(' + BLUR_RADIUS + ')',   'important');
    s.setProperty('-webkit-backdrop-filter', 'blur(' + BLUR_RADIUS + ')',   'important');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() { _initialized = true; }   // idempotent; nothing to register yet

  function show() {
    if (!_initialized) init();
    _create();
  }

  function hide() {
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
  }

  function isVisible() { return !!_el && !!_el.parentNode; }

  function destroy() {
    hide();
    _initialized = false;
  }

  const Overlay = Object.freeze({ init, show, hide, isVisible, destroy });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Overlay = Overlay;
  }
})();
