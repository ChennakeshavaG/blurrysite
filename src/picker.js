/**
 * picker.js — PrivacyBlur Element Picker
 *
 * Exposed as pb.Picker (IIFE — no ES module syntax).
 *
 * Two-mode picker:
 *  - Sticky mode: user drags to draw a rectangle → creates a zone overlay
 *  - Dynamic mode: user hovers and clicks an element → blurs/unblurs it
 *
 * Activated/deactivated programmatically by content_script.js.
 * Depends on pb.BlurEngine (loaded before this file via manifest.json).
 */

const Picker = (() => {
  'use strict';

  const CLS = pb.CSS || {};
  const _IDS = pb.IDS || {};
  const PM = pb.PICKER_MODES || { STICKY: 'sticky', DYNAMIC: 'dynamic' };
  const MIN_ZONE_SIZE = 10;

  // ─── Internal state ──────────────────────────────────────────────────────────

  let isActive = false;

  /** Current picker mode: 'sticky' | 'dynamic' */
  let currentMode = PM.STICKY;

  /** Currently hovered DOM element while picker is active (dynamic mode). */
  let hoveredElement = null;

  /** Elements the picker has blurred in this session (dynamic mode). */
  const selectedElements = new Set();

  /** Active settings snapshot: { blurRadius, highlightColor, pickerMode, … } */
  let activeSettings = {
    blurRadius: pb.DEFAULT_SETTINGS.BLUR_RADIUS,
    highlightColor: pb.DEFAULT_SETTINGS.HIGHLIGHT_COLOR,
  };

  /** Callbacks provided by content_script: { onBlur, onUnblur, onStickyBlur, onStickyUnblur, onDeactivate, onModeChange } */
  let activeCallbacks = {};

  // ─── Sticky drawing state ──────────────────────────────────────────────────

  /** Drawing state during sticky drag: { startX, startY, previewEl } or null */
  let drawState = null;

  // ─── Zone hover label state ──────────────────────────────────────────────────

  /** Currently highlighted zone overlay in picker mode */
  let _highlightedZone = null;

  /** Zone label element currently shown */
  let _zoneLabelEl = null;

  // ─── Toolbar DOM references ───────────────────────────────────────────────────

  let toolbarEl = null;
  let toolbarLabelEl = null;
  let modeSelectEl = null;

  // ─── Toast notification ───────────────────────────────────────────────────────

  function flashElementIndicator(el, text) {
    const rect = el.getBoundingClientRect();
    const badge = document.createElement('div');
    badge.textContent = text;
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

  function _modeLabel() {
    return currentMode === PM.STICKY
      ? 'Click and drag to blur an area. Press Esc to exit.'
      : 'Hover an element and click to blur. Press Esc to exit.';
  }

  function buildToolbar() {
    if (toolbarEl) return;

    toolbarEl = document.createElement('div');
    toolbarEl.id = (_IDS.PICKER_TOOLBAR || 'pb-picker-toolbar');
    toolbarEl.className = (CLS.TOOLBAR || 'pb-toolbar');
    toolbarEl.setAttribute('data-pb-toolbar', 'true');

    // Bubble-phase stopPropagation: prevents toolbar events from reaching
    // page handlers, but lets events propagate DOWN through the toolbar's
    // children first so button click/change handlers fire normally.
    toolbarEl.addEventListener('mouseover', (e) => e.stopPropagation());
    toolbarEl.addEventListener('mouseout', (e) => e.stopPropagation());
    toolbarEl.addEventListener('click', (e) => e.stopPropagation());
    toolbarEl.addEventListener('mousedown', (e) => e.stopPropagation());
    toolbarEl.addEventListener('mouseup', (e) => e.stopPropagation());

    // ── Left: mode selector + status text ──────────────────────────────────
    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex !important; align-items:center !important; gap:8px !important; flex:1 !important;';

    modeSelectEl = document.createElement('select');
    modeSelectEl.className = 'pb-toolbar-btn';
    modeSelectEl.style.cssText = 'cursor:pointer !important; padding:3px 6px !important; background:rgba(255,255,255,0.08) !important; color:#e5e7eb !important; border:1px solid rgba(255,255,255,0.12) !important; border-radius:4px !important; font-size:12px !important; font-family:system-ui,sans-serif !important;';

    const optSticky = document.createElement('option');
    optSticky.value = PM.STICKY;
    optSticky.textContent = 'Sticky';
    optSticky.title = 'Draw a box to blur a fixed area on the page. Stays in place even if the page content changes.';

    const optDynamic = document.createElement('option');
    optDynamic.value = PM.DYNAMIC;
    optDynamic.textContent = 'Dynamic';
    optDynamic.title = 'Click an element to blur it. Follows the element, but may not survive page reloads.';

    modeSelectEl.appendChild(optSticky);
    modeSelectEl.appendChild(optDynamic);
    modeSelectEl.value = currentMode;

    modeSelectEl.addEventListener('change', (e) => {
      e.stopPropagation();
      setMode(modeSelectEl.value);
    });

    toolbarLabelEl = document.createElement('span');
    toolbarLabelEl.className = (CLS.TOOLBAR_LABEL || 'pb-toolbar-label');
    toolbarLabelEl.textContent = _modeLabel();

    leftGroup.appendChild(modeSelectEl);
    leftGroup.appendChild(toolbarLabelEl);

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
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Exit picker mode';
    closeBtn.setAttribute('aria-label', 'Close picker');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deactivate();
    });

    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(closeBtn);

    toolbarEl.appendChild(leftGroup);
    toolbarEl.appendChild(btnGroup);

    document.body.appendChild(toolbarEl);
  }

  function removeToolbar() {
    if (toolbarEl) {
      toolbarEl.remove();
      toolbarEl = null;
      toolbarLabelEl = null;
      modeSelectEl = null;
    }
  }

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

  // ─── Mode switching ──────────────────────────────────────────────────────────

  function setMode(mode) {
    if (mode !== PM.STICKY && mode !== PM.DYNAMIC) return;
    if (mode === currentMode) return;

    // Cancel any in-progress sticky drag
    _cancelDraw();

    // Clean up dynamic mode state
    if (hoveredElement) {
      hoveredElement.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
      hoveredElement = null;
    }

    // Clean up zone highlight
    _clearZoneHighlight();

    currentMode = mode;

    // Update toolbar UI
    if (toolbarLabelEl) toolbarLabelEl.textContent = _modeLabel();
    if (modeSelectEl) modeSelectEl.value = mode;

    // Notify content_script for settings persistence
    if (typeof activeCallbacks.onModeChange === 'function') {
      activeCallbacks.onModeChange(mode);
    }
  }

  // ─── Sticky mode: drawing handlers ──────────────────────────────────────────

  function _onStickyMouseDown(e) {
    if (e.button !== 0) return; // left click only
    const target = e.target;
    if (target === toolbarEl || (toolbarEl && toolbarEl.contains(target))) return;

    // Check if clicking an existing zone overlay → remove it
    if (target.dataset && target.dataset.pbZone !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (typeof activeCallbacks.onStickyUnblur === 'function') {
        activeCallbacks.onStickyUnblur(target.dataset.pbZone);
      }
      _clearZoneHighlight();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const previewEl = document.createElement('div');
    previewEl.className = (CLS.ZONE_DRAWING || 'pb-zone-drawing');

    drawState = {
      startX: e.clientX,
      startY: e.clientY,
      previewEl: previewEl,
    };

    // Position preview at mouse start
    previewEl.style.left = e.clientX + 'px';
    previewEl.style.top = e.clientY + 'px';
    previewEl.style.width = '0px';
    previewEl.style.height = '0px';

    document.body.appendChild(previewEl);
  }

  function _onStickyMouseMove(e) {
    if (!drawState) return;

    const dx = e.clientX - drawState.startX;
    const dy = e.clientY - drawState.startY;

    // Support dragging in any direction
    const left = Math.min(drawState.startX, e.clientX);
    const top = Math.min(drawState.startY, e.clientY);

    drawState.previewEl.style.left = left + 'px';
    drawState.previewEl.style.top = top + 'px';
    drawState.previewEl.style.width = Math.abs(dx) + 'px';
    drawState.previewEl.style.height = Math.abs(dy) + 'px';
  }

  function _onStickyMouseUp(e) {
    if (!drawState) return;

    const dx = Math.abs(e.clientX - drawState.startX);
    const dy = Math.abs(e.clientY - drawState.startY);

    // Remove drawing preview
    if (drawState.previewEl && drawState.previewEl.parentNode) {
      drawState.previewEl.remove();
    }

    // Enforce minimum size
    if (dx < MIN_ZONE_SIZE || dy < MIN_ZONE_SIZE) {
      drawState = null;
      if (dx > 2 || dy > 2) {
        // User tried to draw but too small — show feedback
        if (pb.Shortcuts && pb.Shortcuts.showToast) {
          pb.Shortcuts.showToast('Area too small (min ' + MIN_ZONE_SIZE + 'px)');
        }
      }
      return;
    }

    // Convert viewport coords to document coords
    const left = Math.min(drawState.startX, e.clientX) + window.scrollX;
    const top = Math.min(drawState.startY, e.clientY) + window.scrollY;

    // Clamp to document bounds (fallback to viewport if doc not sized)
    const scrollW = document.documentElement.scrollWidth || window.innerWidth || dx;
    const scrollH = document.documentElement.scrollHeight || window.innerHeight || dy;
    const x = Math.max(0, Math.min(left, scrollW - dx));
    const y = Math.max(0, Math.min(top, scrollH - dy));
    const w = Math.min(dx, scrollW - x);
    const h = Math.min(dy, scrollH - y);

    drawState = null;

    // Notify content_script to create and persist the zone
    if (typeof activeCallbacks.onStickyBlur === 'function') {
      activeCallbacks.onStickyBlur({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
        scrollWidth: scrollW,
        scrollHeight: scrollH,
      });
    }
  }

  function _cancelDraw() {
    if (drawState) {
      if (drawState.previewEl && drawState.previewEl.parentNode) {
        drawState.previewEl.remove();
      }
      drawState = null;
    }
  }

  // ─── Sticky mode: zone hover labels ──────────────────────────────────────────

  function _onStickyMouseOver(e) {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;
    if (target === toolbarEl || (toolbarEl && toolbarEl.contains(target))) return;

    // Check if hovering over a zone overlay
    if (target.dataset && target.dataset.pbZone !== undefined) {
      if (_highlightedZone === target) return;
      _clearZoneHighlight();
      _highlightedZone = target;
      target.classList.add((CLS.ZONE_HIGHLIGHT || 'pb-zone-highlight'));

      // Show name label
      const name = target.dataset.pbZoneName || target.dataset.pbZone;
      _showZoneLabel(target, name);
    } else if (_highlightedZone) {
      _clearZoneHighlight();
    }
  }

  function _showZoneLabel(zoneEl, text) {
    _hideZoneLabel();
    _zoneLabelEl = document.createElement('div');
    _zoneLabelEl.className = (CLS.ZONE_LABEL || 'pb-zone-label');
    _zoneLabelEl.textContent = text;
    zoneEl.appendChild(_zoneLabelEl);
  }

  function _hideZoneLabel() {
    if (_zoneLabelEl && _zoneLabelEl.parentNode) {
      _zoneLabelEl.remove();
    }
    _zoneLabelEl = null;
  }

  function _clearZoneHighlight() {
    if (_highlightedZone) {
      _highlightedZone.classList.remove((CLS.ZONE_HIGHLIGHT || 'pb-zone-highlight'));
      _hideZoneLabel();
      _highlightedZone = null;
    }
  }

  // ─── Dynamic mode: event listeners (original hover+click behavior) ──────────

  function findClassedParent(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.className && typeof node.className === 'string') {
        const siteClasses = node.className.trim().split(/\s+/).filter(c => !c.startsWith('pb-'));
        if (siteClasses.length > 0) return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function resolveTarget(raw) {
    if (!raw || !(raw instanceof Element)) return null;
    if (raw === document.documentElement || raw === document.body) return null;
    return raw;
  }

  // ─── Unified event handlers (dispatch by mode) ────────────────────────────────

  function onMouseOver(e) {
    if (currentMode === PM.STICKY) {
      _onStickyMouseOver(e);
      return;
    }
    // Dynamic mode
    let target = resolveTarget(e.target);
    if (!target || target === toolbarEl || toolbarEl?.contains(target)) return;

    if (!pb.BlurEngine.isBlurred(target)) {
      target = findClassedParent(target);
    }

    if (hoveredElement && hoveredElement !== target) {
      hoveredElement.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    hoveredElement = target;
    hoveredElement.classList.add((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
  }

  function onMouseOut(e) {
    if (currentMode === PM.STICKY) {
      // Clear zone highlight when leaving a zone
      if (_highlightedZone) {
        const related = e.relatedTarget;
        if (!related || !_highlightedZone.contains(related)) {
          _clearZoneHighlight();
        }
      }
      return;
    }
    // Dynamic mode
    const target = resolveTarget(e.target);
    if (target) {
      target.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    if (hoveredElement === target) {
      hoveredElement = null;
    }
  }

  function onMouseDown(e) {
    if (currentMode === PM.STICKY) {
      _onStickyMouseDown(e);
    }
  }

  function onMouseMove(e) {
    if (currentMode === PM.STICKY) {
      _onStickyMouseMove(e);
    }
  }

  function onMouseUp(e) {
    if (currentMode === PM.STICKY) {
      _onStickyMouseUp(e);
    }
  }

  function onClick(e) {
    if (currentMode === PM.STICKY) {
      // Sticky mode uses mousedown/mouseup, so consume click to prevent page handlers
      let target = e.target;
      if (target === toolbarEl || (toolbarEl && toolbarEl.contains(target))) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // Dynamic mode
    let target = resolveTarget(e.target);
    if (!target || target === toolbarEl || toolbarEl?.contains(target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const alreadyBlurred = pb.BlurEngine.isBlurred(target);
    if (!alreadyBlurred) {
      target = findClassedParent(target);
    }

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
      if (drawState) {
        _cancelDraw();
      } else {
        deactivate();
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  function activate(settings, callbacks) {
    if (isActive) return;

    activeSettings = { ...activeSettings, ...settings };
    activeCallbacks = callbacks || {};
    isActive = true;

    // Set mode from settings (persisted across sessions), default to sticky.
    // Touch devices fall back to dynamic mode — sticky requires mouse drag.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
      currentMode = PM.DYNAMIC;
    } else {
      currentMode = (settings && settings.pickerMode === PM.DYNAMIC) ? PM.DYNAMIC : PM.STICKY;
    }

    document.documentElement.classList.add((CLS.PICKER_ACTIVE || 'pb-picker-active'));
    buildToolbar();

    // Capture-phase listeners for all modes
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function deactivate() {
    if (!isActive) return;

    isActive = false;
    _cancelDraw();
    _clearZoneHighlight();

    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);

    const highlighted = document.querySelectorAll('.pb-hover-highlight');
    for (const el of highlighted) {
      el.classList.remove((CLS.HOVER_HIGHLIGHT || 'pb-hover-highlight'));
    }
    hoveredElement = null;
    selectedElements.clear();

    document.documentElement.classList.remove((CLS.PICKER_ACTIVE || 'pb-picker-active'));
    removeToolbar();

    if (typeof activeCallbacks.onDeactivate === 'function') {
      activeCallbacks.onDeactivate();
    }

    activeCallbacks = {};
  }

  function setSettings(newSettings) {
    activeSettings = { ...activeSettings, ...newSettings };
  }

  return {
    get isActive() { return isActive; },
    activate,
    deactivate,
    setSettings,
    setMode,
  };

})();

pb.Picker = Picker;
