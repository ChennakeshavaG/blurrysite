/**
 * automate/overlay.js — Viewport-covering blur overlay primitive.
 *
 * Single full-viewport <div> mounted on document.body. When automate state
 * requires blur, show() mounts/updates the div; hide() removes it. No DOM
 * traversal, no per-element stamping, no <style> injection competing with
 * the page's cascade — just one element on top of everything.
 *
 * The overlay is the render path for AUTOMATE-driven blur only. Manual
 * blur-all, pick-blur, and PII detection continue to use the existing
 * stamp+CSS engine; those intents are granular and the overlay would be
 * too coarse for them.
 *
 * Modes:
 *   - 'solid'    opaque color (privacy-strongest; nothing leaks through)
 *   - 'frosted'  backdrop-filter:blur over a translucent tint
 *   - 'color'    solid color with configurable opacity
 *
 * Loaded in CONTENT context only (per-tab). Not used in background.
 *
 * Contract: docs/contracts/automate/overlay.md
 *
 * Exposed as blsi.Automate.Overlay (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  const ROOT_ID    = 'bl-si-automate-overlay';
  const Z_INDEX    = '2147483646';   // one below the picker toolbar (2147483647)

  let _el           = null;
  let _initialized  = false;
  let _last_options = null;

  function _create() {
    if (_el || !document.body) return;
    _el = document.createElement('div');
    _el.id = ROOT_ID;
    _el.setAttribute('aria-hidden', 'true');
    _el.setAttribute('data-bl-si-extension-ui', '1');  // exclude from blur engines
    _apply_base_styles(_el);
    document.body.appendChild(_el);
  }

  function _apply_base_styles(el) {
    // Inline styles to avoid CSS injection — keeps this primitive self-contained
    // and immune to page CSS that might disable our z-index or pointer-events.
    const s = el.style;
    s.setProperty('all',           'initial', 'important');
    s.setProperty('position',      'fixed',   'important');
    s.setProperty('top',           '0',       'important');
    s.setProperty('right',         '0',       'important');
    s.setProperty('bottom',        '0',       'important');
    s.setProperty('left',          '0',       'important');
    s.setProperty('width',         '100vw',   'important');
    s.setProperty('height',        '100vh',   'important');
    s.setProperty('z-index',       Z_INDEX,   'important');
    s.setProperty('pointer-events','auto',    'important');
    s.setProperty('display',       'block',   'important');
    s.setProperty('user-select',   'none',    'important');
    // Default appearance — overridden by _apply_mode if a mode is provided.
    s.setProperty('background',    '#000',    'important');
  }

  function _apply_mode(opts) {
    if (!_el) return;
    const s = _el.style;
    const mode = (opts && opts.mode) || 'solid';
    const color = (opts && opts.color) || '#000000';
    const opacity = (opts && typeof opts.opacity === 'number')
      ? Math.max(0, Math.min(1, opts.opacity))
      : 1;
    const blur_radius = (opts && typeof opts.blur_radius === 'number') ? opts.blur_radius : 16;

    if (mode === 'frosted') {
      // Cap the tint at 0.6 so the backdrop blur remains visible underneath.
      s.setProperty('background',              _rgba(color, Math.min(0.6, opacity)), 'important');
      s.setProperty('backdrop-filter',         'blur(' + blur_radius + 'px)',         'important');
      s.setProperty('-webkit-backdrop-filter', 'blur(' + blur_radius + 'px)',         'important');
    } else if (mode === 'color') {
      s.setProperty('background',         _rgba(color, opacity), 'important');
      s.removeProperty('backdrop-filter');
      s.removeProperty('-webkit-backdrop-filter');
    } else {
      // 'solid' default
      s.setProperty('background',         _rgba(color, opacity), 'important');
      s.removeProperty('backdrop-filter');
      s.removeProperty('-webkit-backdrop-filter');
    }
  }

  function _rgba(hex, alpha) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 'rgba(0,0,0,' + alpha + ')';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() { _initialized = true; }   // idempotent; nothing to register yet

  function show(opts) {
    if (!_initialized) init();
    _last_options = opts || {};
    _create();
    if (_el) _apply_mode(_last_options);
  }

  function update(opts) {
    if (!_el) { show(opts); return; }
    _last_options = Object.assign({}, _last_options, opts);
    _apply_mode(_last_options);
  }

  function hide() {
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
  }

  function isVisible() { return !!_el && !!_el.parentNode; }

  function destroy() {
    hide();
    _initialized = false;
    _last_options = null;
  }

  const Overlay = Object.freeze({ init, show, update, hide, isVisible, destroy });

  if (typeof globalThis !== 'undefined') {
    globalThis.blsi = globalThis.blsi || {};
    globalThis.blsi.Automate = globalThis.blsi.Automate || {};
    globalThis.blsi.Automate.Overlay = Overlay;
  }
})();
