/**
 * picker.js — PrivacyBlur Element Picker
 *
 * Exposed as pb.Picker (IIFE — no ES module syntax).
 *
 * Interactive element picker: the user hovers to highlight an element then
 * clicks to blur (or unblur) it. Activated/deactivated programmatically
 * by content_script.js.
 *
 * Depends on pb.BlurEngine (loaded before this file via manifest.json).
 */

const Picker = (() => {
  'use strict';

  const CLS = pb.CSS || {};
  const _IDS = pb.IDS || {};

  // ─── Internal state ──────────────────────────────────────────────────────────

  let isActive = false;

  /** Currently hovered DOM element while picker is active. */
  let hoveredElement = null;

  /** Elements the picker has blurred in this session. */
  const selectedElements = new Set();

  /** Active settings snapshot: { blurRadius, highlightColor, … } */
  let activeSettings = {
    blurRadius: pb.DEFAULT_SETTINGS.BLUR_RADIUS,
    highlightColor: pb.DEFAULT_SETTINGS.HIGHLIGHT_COLOR,
  };

  /** Callbacks provided by content_script: { onBlur, onUnblur, onDeactivate } */
  let activeCallbacks = {};

  // ─── Toolbar DOM references ───────────────────────────────────────────────────

  let toolbarEl = null;

  // ─── Toast notification ───────────────────────────────────────────────────────

  /** Briefly show a small indicator near a blurred element. */
  function flashElementIndicator(el, text) {
    const rect = el.getBoundingClientRect();
    const badge = document.createElement('div');
    badge.textContent = text;
    // Fixed positioning anchored to viewport — never mutates the target element's
    // layout properties, so fixed/sticky/absolute children are unaffected.
    Object.assign(badge.style, {
      position: 'fixed',
      top:  `${Math.max(4, rect.top  + 4)}px`,
      left: `${Math.max(4, rect.left + 4)}px`,
      background: 'rgba(0,0,0,0.75)',
      color: '#fff',
      fontSize: '11px',
      fontFamily: 'system-ui, sans-serif',
      padding: '2px 6px',
      borderRadius: '3px',
      zIndex: '2147483646',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 900);
  }

  // ─── Toolbar (fixed overlay) ──────────────────────────────────────────────────

  /**
   * Build and inject the fixed picker toolbar into the page.
   * Uses high z-index and inline styles to guarantee visibility above all
   * page stacking contexts.
   */
  function buildToolbar() {
    if (toolbarEl) return;

    toolbarEl = document.createElement('div');
    toolbarEl.id = (_IDS.PICKER_TOOLBAR || 'pb-picker-toolbar');
    toolbarEl.className = (CLS.TOOLBAR || 'pb-toolbar');
    toolbarEl.setAttribute('data-pb-toolbar', 'true');

    // Prevent picker events from propagating into the toolbar itself.
    toolbarEl.addEventListener('mouseover', (e) => e.stopPropagation(), true);
    toolbarEl.addEventListener('mouseout', (e) => e.stopPropagation(), true);
    toolbarEl.addEventListener('click', (e) => e.stopPropagation(), true);

    // ── Left: status text ──────────────────────────────────────────────────
    const label = document.createElement('span');
    label.className = (CLS.TOOLBAR_LABEL || 'pb-toolbar-label');
    label.textContent =
      'Picker Mode — hover an element and click to blur. Press Esc to exit.';

    // ── Right: action buttons ──────────────────────────────────────────────
    const btnGroup = document.createElement('div');
    btnGroup.className = 'pb-toolbar-btn-group';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'pb-toolbar-btn pb-toolbar-btn--clear';
    clearBtn.textContent = 'Clear all';
    clearBtn.title = 'Remove all blur from this page';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllFromPicker();
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'pb-toolbar-btn pb-toolbar-btn--close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Exit picker mode';
    closeBtn.setAttribute('aria-label', 'Close picker');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deactivate();
    });

    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(closeBtn);

    toolbarEl.appendChild(label);
    toolbarEl.appendChild(btnGroup);

    document.body.appendChild(toolbarEl);
  }

  function removeToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
    }
  }

  /** Remove blur from all elements this picker session blurred, then persist. */
  function clearAllFromPicker() {
    for (const el of selectedElements) {
      if (typeof activeCallbacks.onUnblur === 'function') {
        activeCallbacks.onUnblur(el);
      } else {
        pb.BlurEngine.removeBlur(el);
      }
    }
    selectedElements.clear();
  }

  // ─── Event listeners ──────────────────────────────────────────────────────────

  function onMouseOver(e) {
    const target = resolveTarget(e.target);
    if (!target || target === toolbarEl || toolbarEl?.contains(target)) return;

    if (hoveredElement && hoveredElement !== target) {
      hoveredElement.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    hoveredElement = target;
    hoveredElement.classList.add((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
  }

  function onMouseOut(e) {
    const target = resolveTarget(e.target);
    if (target) {
      target.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    if (hoveredElement === target) {
      hoveredElement = null;
    }
  }

  /**
   * Walk up from an element to find the nearest parent with a CSS class.
   * Elements with classes are stable across reloads (framework components).
   * Falls back to the element itself if no classed parent found.
   */
  function findClassedParent(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.className && typeof node.className === 'string') {
        // Filter out our own pb-* classes — only match site-defined classes
        const siteClasses = node.className.trim().split(/\s+/).filter(c => !c.startsWith('pb-'));
        if (siteClasses.length > 0) return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function onClick(e) {
    let target = resolveTarget(e.target);
    if (!target || target === toolbarEl || toolbarEl?.contains(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Walk up to nearest parent with a class for stable selector persistence
    target = findClassedParent(target);

    const alreadyBlurred = !!target.dataset.pbBlur;

    if (alreadyBlurred) {
      if (typeof activeCallbacks.onUnblur === 'function') {
        activeCallbacks.onUnblur(target);
      } else {
        pb.BlurEngine.removeBlur(target);
      }
      selectedElements.delete(target);
      flashElementIndicator(target, 'Unblurred');
    } else {
      if (typeof activeCallbacks.onBlur === 'function') {
        activeCallbacks.onBlur(target);
      } else {
        pb.BlurEngine.applyBlur(target, activeSettings.blurRadius);
      }
      selectedElements.add(target);
      flashElementIndicator(target, 'Blurred');
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    }
  }

  /**
   * Walk up from a raw event target to a sensible element to highlight.
   * Skip text nodes; also skip the toolbar.
   * @param {EventTarget} raw
   * @returns {Element|null}
   */
  function resolveTarget(raw) {
    if (!raw || !(raw instanceof Element)) return null;
    if (raw === document.documentElement || raw === document.body) return null;
    return raw;
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Activate the picker.
   * @param {object} settings  — { blurRadius, highlightColor, … }
   * @param {object} callbacks — { onBlur, onUnblur, onDeactivate }
   */
  function activate(settings, callbacks) {
    if (isActive) return;

    activeSettings = { ...activeSettings, ...settings };
    activeCallbacks = callbacks || {};
    isActive = true;

    // Add crosshair cursor cue to page root.
    document.documentElement.classList.add((CLS.PICKER_ACTIVE || 'pb-picker-active'));

    // Build and show toolbar.
    buildToolbar();

    // Attach capture-phase listeners so we intercept before page handlers.
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  /**
   * Deactivate the picker and clean up all side-effects.
   */
  function deactivate() {
    if (!isActive) return;

    isActive = false;

    // Remove event listeners.
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    // Remove highlight class from any lingering elements.
    const highlighted = document.querySelectorAll('.pb-hover-highlight');
    for (const el of highlighted) {
      el.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    hoveredElement = null;
    selectedElements.clear();

    // Remove visual cues.
    document.documentElement.classList.remove((CLS.PICKER_ACTIVE || 'pb-picker-active'));
    removeToolbar();

    // Notify content script.
    if (typeof activeCallbacks.onDeactivate === 'function') {
      activeCallbacks.onDeactivate();
    }

    activeCallbacks = {};
  }

  /**
   * Update settings while the picker is active (e.g. user changes blur radius
   * in the popup without closing picker).
   * @param {object} newSettings
   */
  function setSettings(newSettings) {
    activeSettings = { ...activeSettings, ...newSettings };
  }

  // ─── Exports ──────────────────────────────────────────────────────────────────

  return {
    get isActive() { return isActive; },
    activate,
    deactivate,
    setSettings,
  };

})();

pb.Picker = Picker;
