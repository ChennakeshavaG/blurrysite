/**
 * picker.js — Blurry Site Element Picker
 *
 * Exposed as blsi.Picker (IIFE — no ES module syntax).
 *
 * Three picker modes:
 *  - DYNAMIC       — tap an element, we find its boundary and blur it
 *  - STICKY_PAGE   — sketch a box that scrolls with the page content
 *  - STICKY_SCREEN — sketch a box that stays in the same spot on the screen
 *
 * Activated/deactivated programmatically by content_script.js.
 * Depends on blsi.BlurEngine (loaded before this file via manifest.json).
 */

const Picker = (() => {
  'use strict';

  const CLS = blsi.CSS || {};
  const _IDS = blsi.IDS || {};
  const PM = blsi.PICKER_MODES || {
    DYNAMIC: 'dynamic',
    STICKY_PAGE: 'sticky-page',
    STICKY_SCREEN: 'sticky-screen',
  };
  const MIN_ZONE_SIZE = 10;

  /** True iff `mode` is either of the sticky variants. */
  function _isSticky(mode) {
    return mode === PM.STICKY_PAGE || mode === PM.STICKY_SCREEN;
  }

  // ─── Internal state ──────────────────────────────────────────────────────────

  let isActive = false;

  /** Current picker mode: 'dynamic' | 'sticky-page' | 'sticky-screen' */
  let currentMode = PM.STICKY_PAGE;

  /** Currently hovered DOM element while picker is active (dynamic mode). */
  let hoveredElement = null;

  /** Elements the picker has blurred in this session (dynamic mode). */
  const selectedElements = new Set();

  /** Active settings snapshot: { blurRadius, highlightColor, pickerMode, … } */
  let activeSettings = {
    blurRadius: blsi.DEFAULT_SETTINGS.BLUR_RADIUS,
    highlightColor: blsi.DEFAULT_SETTINGS.HIGHLIGHT_COLOR,
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

  // Short label shown on the mode chip.
  function _modeChipLabel(mode) {
    if (mode === PM.STICKY_PAGE) return 'Area on page';
    if (mode === PM.STICKY_SCREEN) return 'Area on screen';
    return 'Tap to blur';
  }

  // Long description shown in the chip's tooltip (hover).
  function _modeChipDescription(mode) {
    if (mode === PM.STICKY_PAGE) return 'Sketch a box over a region of the page. Scrolls with the content. Click to switch mode.';
    if (mode === PM.STICKY_SCREEN) return 'Sketch a box fixed to your screen. Stays put when you scroll — great for screen-sharing. Click to switch mode.';
    return 'Tap any element on the page to blur it. Click to switch mode.';
  }

  function _cycleMode(mode) {
    const order = [PM.DYNAMIC, PM.STICKY_PAGE, PM.STICKY_SCREEN];
    const idx = order.indexOf(mode);
    return order[(idx + 1) % order.length];
  }

  // Default corner when no stored position is available.
  const DEFAULT_PILL_POS = { top: 16, left: null, right: 16, bottom: null };
  const PILL_POS_KEY = 'picker_toolbar_pos';

  function buildToolbar() {
    if (toolbarEl) return;

    toolbarEl = document.createElement('div');
    toolbarEl.id = (_IDS.PICKER_TOOLBAR || 'bl-si-picker-toolbar');
    toolbarEl.className = (CLS.TOOLBAR || 'bl-si-toolbar');
    toolbarEl.setAttribute('data-bl-si-toolbar', 'true');

    // Bubble-phase stopPropagation: prevents toolbar events from reaching
    // page handlers, but lets events propagate DOWN through the toolbar's
    // children first so button click/change handlers fire normally.
    toolbarEl.addEventListener('mouseover', (e) => e.stopPropagation());
    toolbarEl.addEventListener('mouseout', (e) => e.stopPropagation());
    toolbarEl.addEventListener('click', (e) => e.stopPropagation());
    // NOTE: we intentionally do NOT stopPropagation on mousedown/mouseup —
    // the drag handler below needs to see them to start a drag.

    // ── Drag handle (the ONLY draggable surface on the pill) ───────────
    const dragHandle = document.createElement('div');
    dragHandle.className = 'bl-si-toolbar-drag';
    dragHandle.setAttribute('aria-label', 'Drag to move picker');
    dragHandle.title = 'Drag to move';
    dragHandle.textContent = '\u2630'; // ☰ trigram
    // Drag is wired at CAPTURE phase on the grip so it fires before any
    // bubble handlers on inner elements. The grip has no children, so this
    // is effectively "mousedown on the grip".
    _wireDrag(dragHandle);

    // ── Mode chip — click to cycle, hover for description ─────────────
    // Single button replaces the native <select> dropdown so the pill never
    // has to re-layout for a dropdown popup. Width is fixed in CSS so the
    // pill doesn't reflow when the chip's text changes across modes.
    modeSelectEl = document.createElement('button');
    modeSelectEl.type = 'button';
    modeSelectEl.className = 'bl-si-toolbar-chip';
    modeSelectEl.setAttribute('aria-label', 'Picker mode');
    modeSelectEl.textContent = _modeChipLabel(currentMode);
    modeSelectEl.title = _modeChipDescription(currentMode);
    modeSelectEl.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode(_cycleMode(currentMode));
    });
    modeSelectEl.addEventListener('mousedown', (e) => e.stopPropagation());

    // ── Action buttons ──────────────────────────────────────────────────
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'bl-si-toolbar-btn bl-si-toolbar-btn--clear';
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Remove all blur from this page';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllFromPicker();
    });
    clearBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bl-si-toolbar-btn bl-si-toolbar-btn--close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Exit picker mode';
    closeBtn.setAttribute('aria-label', 'Close picker');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deactivate();
    });
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    // Pill layout: [grip] [mode chip] [Clear] [×]  (no long label)
    toolbarEl.appendChild(dragHandle);
    toolbarEl.appendChild(modeSelectEl);
    toolbarEl.appendChild(clearBtn);
    toolbarEl.appendChild(closeBtn);

    // toolbarLabelEl is retained as null — legacy code paths that touched
    // it must check for null. The long "sketch a box on the page..." label
    // is gone; the chip tooltip carries the description now.
    toolbarLabelEl = null;

    document.body.appendChild(toolbarEl);

    // Restore saved position, or default to top-right corner.
    _restorePillPosition();
  }

  // ── Pill drag handling ─────────────────────────────────────────────────────
  // Fixed positioning with {top, left} in viewport coordinates. Drag is wired
  // at CAPTURE phase on the pill so it runs before any bubble-phase handlers
  // on children, but AFTER the picker's document-level capture handlers
  // (document > toolbarEl in the capture chain). The picker's onMouseDown
  // already bails on toolbar-contained targets, so sticky zone drawing
  // never starts when the user is trying to move the pill.

  let _dragCtx = null; // { offsetX, offsetY } — viewport-relative offset from pill origin

  function _wireDrag(handle) {
    // Capture phase so we run before any bubble-phase handlers on children.
    // The grip has no children, so in practice mousedown fires on the grip
    // itself and we unconditionally start the drag.
    handle.addEventListener('mousedown', _onDragStart, true);
  }

  /**
   * Apply a positional style with !important. The stylesheet uses
   * `top: 16px !important; right: 16px !important;` to anchor the pill's
   * initial position — plain inline-style writes (without !important) lose
   * to those rules and the pill refuses to move. setProperty with the
   * priority argument is the only way an inline write wins.
   */
  function _setPos(prop, value) {
    toolbarEl.style.setProperty(prop, value, 'important');
  }

  function _onDragStart(e) {
    if (!toolbarEl) return;
    if (e.button !== 0) return; // left click only

    // Stop propagation so the picker's sticky-zone-draw handler (registered
    // at capture phase on document, earlier in the chain) never sees this.
    e.preventDefault();
    e.stopPropagation();

    const rect = toolbarEl.getBoundingClientRect();
    _dragCtx = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    // Switch to {top,left} anchoring regardless of the current anchor side.
    // Freeze the pill's current viewport position before we start moving it.
    // MUST use setProperty(..., 'important') — the stylesheet has
    // !important rules that otherwise win the cascade.
    _setPos('left',   rect.left + 'px');
    _setPos('top',    rect.top + 'px');
    _setPos('right',  'auto');
    _setPos('bottom', 'auto');
    toolbarEl.classList.add('bl-si-toolbar--dragging');
    document.addEventListener('mousemove', _onDragMove, true);
    document.addEventListener('mouseup', _onDragEnd, true);
  }

  function _onDragMove(e) {
    if (!_dragCtx || !toolbarEl) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = toolbarEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = e.clientX - _dragCtx.offsetX;
    let top  = e.clientY - _dragCtx.offsetY;
    left = Math.max(4, Math.min(left, vw - rect.width - 4));
    top  = Math.max(4, Math.min(top,  vh - rect.height - 4));
    _setPos('left', left + 'px');
    _setPos('top',  top + 'px');
  }

  function _onDragEnd(e) {
    if (!_dragCtx || !toolbarEl) return;
    e.preventDefault();
    e.stopPropagation();
    document.removeEventListener('mousemove', _onDragMove, true);
    document.removeEventListener('mouseup', _onDragEnd, true);
    toolbarEl.classList.remove('bl-si-toolbar--dragging');
    _dragCtx = null;
    // Persist the current {top, left}.
    const rect = toolbarEl.getBoundingClientRect();
    const pos = { top: Math.round(rect.top), left: Math.round(rect.left), right: null, bottom: null };
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [PILL_POS_KEY]: pos });
      }
    } catch (_) {}
  }

  function _restorePillPosition() {
    if (!toolbarEl) return;
    const apply = (pos) => {
      if (!toolbarEl) return;
      // Must use setProperty('important') to beat the stylesheet's
      // `top: 16px !important; right: 16px !important;` rules.
      _setPos('top',    (pos.top != null)    ? pos.top + 'px'    : 'auto');
      _setPos('left',   (pos.left != null)   ? pos.left + 'px'   : 'auto');
      _setPos('right',  (pos.right != null)  ? pos.right + 'px'  : 'auto');
      _setPos('bottom', (pos.bottom != null) ? pos.bottom + 'px' : 'auto');
    };
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(PILL_POS_KEY, (result) => {
          const pos = result && result[PILL_POS_KEY];
          apply(pos && typeof pos === 'object' ? pos : DEFAULT_PILL_POS);
        });
        return;
      }
    } catch (_) {}
    apply(DEFAULT_PILL_POS);
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
        blsi.BlurEngine.removeBlur(el);
      }
    }
    selectedElements.clear();
  }

  // ─── Mode switching ──────────────────────────────────────────────────────────

  function setMode(mode) {
    if (mode !== PM.DYNAMIC && !_isSticky(mode)) return;
    if (mode === currentMode) return;

    // Cancel any in-progress sticky drag
    _cancelDraw();

    // Clean up dynamic mode state
    if (hoveredElement) {
      hoveredElement.classList.remove((CLS.HOVER_HIGHLIGHT || 'bl-si-hover-highlight'));
      hoveredElement = null;
    }

    // Clean up zone highlight
    _clearZoneHighlight();

    currentMode = mode;

    // Update the mode chip's label + tooltip to match the new mode.
    if (modeSelectEl) {
      modeSelectEl.textContent = _modeChipLabel(mode);
      modeSelectEl.title = _modeChipDescription(mode);
    }

    // Notify content_script for settings persistence.
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
    if (target.dataset && target.dataset.blSiZone !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (typeof activeCallbacks.onStickyUnblur === 'function') {
        activeCallbacks.onStickyUnblur(target.dataset.blSiZone);
      }
      _clearZoneHighlight();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const previewEl = document.createElement('div');
    previewEl.className = (CLS.ZONE_DRAWING || 'bl-si-zone-drawing');

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
        if (blsi.Shortcuts && blsi.Shortcuts.showToast) {
          blsi.Shortcuts.showToast('Area too small (min ' + MIN_ZONE_SIZE + 'px)');
        }
      }
      return;
    }

    const isScreen = currentMode === PM.STICKY_SCREEN;

    // Coordinate system depends on anchor:
    //   STICKY_PAGE   → document coords (add scroll offset), clamped to doc bounds.
    //   STICKY_SCREEN → viewport coords (no scroll offset), clamped to viewport bounds.
    let x, y, w, h, scrollW, scrollH;
    if (isScreen) {
      const vw = window.innerWidth || dx;
      const vh = window.innerHeight || dy;
      const left = Math.min(drawState.startX, e.clientX);
      const top  = Math.min(drawState.startY, e.clientY);
      x = Math.max(0, Math.min(left, vw - dx));
      y = Math.max(0, Math.min(top,  vh - dy));
      w = Math.min(dx, vw - x);
      h = Math.min(dy, vh - y);
      scrollW = vw;
      scrollH = vh;
    } else {
      const left = Math.min(drawState.startX, e.clientX) + window.scrollX;
      const top  = Math.min(drawState.startY, e.clientY) + window.scrollY;
      scrollW = document.documentElement.scrollWidth || window.innerWidth || dx;
      scrollH = document.documentElement.scrollHeight || window.innerHeight || dy;
      x = Math.max(0, Math.min(left, scrollW - dx));
      y = Math.max(0, Math.min(top,  scrollH - dy));
      w = Math.min(dx, scrollW - x);
      h = Math.min(dy, scrollH - y);
    }

    drawState = null;

    // Notify content_script to create and persist the zone.
    if (typeof activeCallbacks.onStickyBlur === 'function') {
      activeCallbacks.onStickyBlur({
        anchor: isScreen ? 'screen' : 'page',
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
    if (target.dataset && target.dataset.blSiZone !== undefined) {
      if (_highlightedZone === target) return;
      _clearZoneHighlight();
      _highlightedZone = target;
      target.classList.add((CLS.ZONE_HIGHLIGHT || 'bl-si-zone-highlight'));

      // Show name label
      const name = target.dataset.blSiZoneName || target.dataset.blSiZone;
      _showZoneLabel(target, name);
    } else if (_highlightedZone) {
      _clearZoneHighlight();
    }
  }

  function _showZoneLabel(zoneEl, text) {
    _hideZoneLabel();
    _zoneLabelEl = document.createElement('div');
    _zoneLabelEl.className = (CLS.ZONE_LABEL || 'bl-si-zone-label');
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
      _highlightedZone.classList.remove((CLS.ZONE_HIGHLIGHT || 'bl-si-zone-highlight'));
      _hideZoneLabel();
      _highlightedZone = null;
    }
  }

  // ─── Dynamic mode: event listeners (original hover+click behavior) ──────────

  function findClassedParent(el) {
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.className && typeof node.className === 'string') {
        const siteClasses = node.className.trim().split(/\s+/).filter(c => !c.startsWith('bl-si-'));
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
    if (_isSticky(currentMode)) {
      _onStickyMouseOver(e);
      return;
    }
    // Dynamic mode
    let target = resolveTarget(e.target);
    if (!target || target === toolbarEl || toolbarEl?.contains(target)) return;

    if (!blsi.BlurEngine.isBlurred(target)) {
      target = findClassedParent(target);
    }

    if (hoveredElement && hoveredElement !== target) {
      hoveredElement.classList.remove((CLS.HOVER_HIGHLIGHT || 'bl-si-hover-highlight'));
    }
    hoveredElement = target;
    hoveredElement.classList.add((CLS.HOVER_HIGHLIGHT || 'bl-si-hover-highlight'));
  }

  function onMouseOut(e) {
    if (_isSticky(currentMode)) {
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
      target.classList.remove((CLS.HOVER_HIGHLIGHT || 'bl-si-hover-highlight'));
    }
    if (hoveredElement === target) {
      hoveredElement = null;
    }
  }

  function onMouseDown(e) {
    if (_isSticky(currentMode)) {
      _onStickyMouseDown(e);
    }
  }

  function onMouseMove(e) {
    if (_isSticky(currentMode)) {
      _onStickyMouseMove(e);
    }
  }

  function onMouseUp(e) {
    if (_isSticky(currentMode)) {
      _onStickyMouseUp(e);
    }
  }

  function onClick(e) {
    if (_isSticky(currentMode)) {
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

    const alreadyBlurred = blsi.BlurEngine.isBlurred(target);
    if (!alreadyBlurred) {
      target = findClassedParent(target);
    }

    if (alreadyBlurred) {
      if (typeof activeCallbacks.onUnblur === 'function') {
        activeCallbacks.onUnblur(target);
      } else {
        blsi.BlurEngine.removeBlur(target);
      }
      selectedElements.delete(target);
      flashElementIndicator(target, 'Unblurred');
    } else {
      if (typeof activeCallbacks.onBlur === 'function') {
        activeCallbacks.onBlur(target);
      } else {
        blsi.BlurEngine.applyBlur(target, activeSettings.blurRadius);
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
    // Touch devices fall back to dynamic mode — sticky requires mouse sketch.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
      currentMode = PM.DYNAMIC;
    } else {
      const requested = settings && settings.pickerMode;
      if (requested === PM.DYNAMIC || requested === PM.STICKY_PAGE || requested === PM.STICKY_SCREEN) {
        currentMode = requested;
      } else if (requested === 'sticky') {
        // Legacy value persisted from pre-v2; treat as page-anchored.
        currentMode = PM.STICKY_PAGE;
      } else {
        currentMode = PM.STICKY_PAGE;
      }
    }

    document.documentElement.classList.add((CLS.PICKER_ACTIVE || 'bl-si-picker-active'));
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

    const highlighted = document.querySelectorAll('.bl-si-hover-highlight');
    for (const el of highlighted) {
      el.classList.remove((CLS.HOVER_HIGHLIGHT || 'bl-si-hover-highlight'));
    }
    hoveredElement = null;
    selectedElements.clear();

    document.documentElement.classList.remove((CLS.PICKER_ACTIVE || 'bl-si-picker-active'));
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

blsi.Picker = Picker;
