/**
 * privacyblur — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * their window.PrivacyBlur* globals, which are loaded before this script via
 * the manifest.json content_scripts load order:
 *
 *   selector_utils.js  → window.PrivacyBlurSelectorUtils
 *   storage_manager.js → window.PrivacyBlurStorage
 *   blur_engine.js     → window.PrivacyBlurEngine
 *   shortcut_handler.js→ window.PrivacyBlurShortcuts
 *   picker.js          → window.PrivacyBlurPicker
 */

(() => {
  'use strict';

  const MSG = window.PrivacyBlur;
  const D   = window.PrivacyBlur.DEFAULTS;
  const CATEGORY_KEYS = Object.keys(window.PrivacyBlurEngine.CATEGORY_SELECTORS);

  // ─── State ──────────────────────────────────────────────────────────────────

  /** @type {object} Settings loaded from background / storage */
  let settings = {
    blurRadius: D.BLUR_RADIUS,
    highlightColor: D.HIGHLIGHT_COLOR,
    transitionDuration: D.TRANSITION_DURATION,
    revealOnHover: D.REVEAL_ON_HOVER,
    enabled: D.ENABLED,
    shortcuts: {
      chordKey1: D.CHORD_KEY1,
      chordKey2: D.CHORD_KEY2,
      chordCode1: D.CHORD_CODE1,
      chordCode2: D.CHORD_CODE2,
      chordModifier: D.CHORD_MODIFIER,
    },
    revealMode: D.REVEAL_MODE,
    thoroughBlur: D.THOROUGH_BLUR,
    blurCategories: {
      text:      D.BLUR_CATEGORIES.text,
      media:     D.BLUR_CATEGORIES.media,
      form:      D.BLUR_CATEGORIES.form,
      table:     D.BLUR_CATEGORIES.table,
      structure: D.BLUR_CATEGORIES.structure,
    },
  };

  /** Whether the "blur all page content" mode is active */
  let isPageBlurred = false;

  /** Whether the element picker is currently active */
  let isPickerActive = false;

  /** Last element the user right-clicked — used by the context menu blur handler */
  let lastContextMenuTarget = null;

  /** MutationObserver watching for dynamically added nodes */
  let domObserver = null;

  /** Hostname used as the storage key for persisted selectors */
  const hostname = location.hostname;

  // ─── Module aliases ──────────────────────────────────────────────────────────

  // Convenience aliases so the rest of the code reads cleanly.
  // These are set after DOMContentLoaded to guarantee globals are present.
  let Engine   = null; // window.PrivacyBlurEngine
  let Store    = null; // window.PrivacyBlurStorage
  let Selector = null; // window.PrivacyBlurSelectorUtils
  let Picker   = null; // window.PrivacyBlurPicker
  let Shortcuts = null; // window.PrivacyBlurShortcuts

  // ─── Restore blurred elements ────────────────────────────────────────────────

  /**
   * Load persisted selectors for the current hostname from Storage and
   * re-apply blur to every matched element.
   */
  async function restoreBlurredElements() {
    try {
      const selectors = await Store.getBlurredSelectors(hostname);
      if (!selectors || selectors.length === 0) return;

      for (const selector of selectors) {
        const el = Selector.restoreSelector(selector);
        if (el) {
          Engine.applyBlur(el, settings.blurRadius);
          if (settings.revealMode === 'hover') {
            el.classList.add('pb-reveal-on-hover');
          }
        }
      }
    } catch (err) {
      // Storage unavailable or context invalidated — fail silently.
    }
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  /**
   * Start watching the DOM for newly added nodes.
   * When "blur all" mode is active, automatically blur every new element.
   */
  // ── Batched MutationObserver ────────────────────────────────────────────────
  // SPA navigation can replace the entire DOM tree in one operation, producing
  // thousands of added nodes. Processing them synchronously inside the observer
  // callback causes layout thrashing (getComputedStyle interleaved with DOM
  // writes) and blocks the main thread for seconds, crashing the tab or browser.
  //
  // Solution: collect added nodes in a queue, then process in chunks via
  // requestAnimationFrame. Each chunk processes up to CHUNK_SIZE elements,
  // then yields back to the main thread so the browser can paint and respond
  // to input. Content may appear unblurred for 1-2 frames during heavy SPA
  // transitions — acceptable tradeoff vs. a frozen browser.

  const CHUNK_SIZE = 50;
  let pendingNodes = [];
  let processingScheduled = false;

  function processBlurChunk() {
    processingScheduled = false;
    if (!isPageBlurred || pendingNodes.length === 0) {
      pendingNodes = [];
      return;
    }

    // Take one chunk from the front of the queue.
    const chunk = pendingNodes.splice(0, CHUNK_SIZE);

    for (let i = 0; i < chunk.length; i++) {
      const node = chunk[i];
      // Node may have been removed between queuing and processing (SPA teardown).
      if (!node.isConnected) continue;

      if (Engine.matchesActiveCategories(node, settings.blurCategories)) {
        Engine.applyBlur(node, settings.blurRadius);
        if (settings.revealMode === 'hover') node.classList.add('pb-reveal-on-hover');
      }
    }

    // Schedule next chunk if there are remaining nodes.
    if (pendingNodes.length > 0) {
      processingScheduled = true;
      requestAnimationFrame(processBlurChunk);
    }
  }

  function startDomObserver() {
    if (domObserver) return;

    domObserver = new MutationObserver((mutations) => {
      if (isPickerActive) return;
      if (!isPageBlurred) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Queue the node itself and all its descendants. querySelectorAll
          // returns a static list so it's safe to run before the deferred
          // processing — the elements won't shift under us.
          pendingNodes.push(node);
          const children = node.querySelectorAll('*');
          for (let i = 0; i < children.length; i++) {
            pendingNodes.push(children[i]);
          }
        }
      }

      if (!processingScheduled && pendingNodes.length > 0) {
        processingScheduled = true;
        requestAnimationFrame(processBlurChunk);
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopDomObserver() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    // Clear pending blur queue to prevent stale nodes from being processed
    // after blur-all is toggled off, and release node references.
    pendingNodes = [];
    processingScheduled = false;
  }

  // ─── Picker callbacks ─────────────────────────────────────────────────────────

  const pickerCallbacks = {
    /** Called by PrivacyBlurPicker when the user clicks to blur an element. */
    onBlur(el) {
      Engine.applyBlur(el, settings.blurRadius);
      if (settings.revealMode === 'hover') {
        el.classList.add('pb-reveal-on-hover');
      }
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.saveBlurredElement(hostname, selector).catch(() => {});
      }
    },

    /** Called by PrivacyBlurPicker when the user clicks to unblur an element. */
    onUnblur(el) {
      el.classList.remove('pb-reveal-on-hover');
      Engine.removeBlur(el);
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.removeBlurredElement(hostname, selector).catch(() => {});
      }
    },

    /** Called when the picker deactivates itself (e.g. Escape key). */
    onDeactivate() {
      isPickerActive = false;
      Shortcuts._setPickerActive(false);
    },
  };

  // ─── Settings merge helper ────────────────────────────────────────────────────

  /**
   * Merge incoming settings into current settings, preserving nested shortcuts.
   * A shallow spread would replace the entire shortcuts sub-object if the
   * incoming object has a partial shortcuts key.
   */
  function mergeSettings(incoming) {
    const merged = { ...settings, ...incoming };
    merged.shortcuts = { ...settings.shortcuts, ...(incoming.shortcuts || {}) };
    merged.blurCategories = { ...settings.blurCategories, ...(incoming.blurCategories || {}) };
    return merged;
  }

  // ─── Shortcut settings helper ────────────────────────────────────────────────

  /**
   * Flatten the nested settings.shortcuts object into the flat shape that
   * PrivacyBlurShortcuts.init() expects.
   */
  function shortcutSettings() {
    const s = settings.shortcuts || {};
    return {
      chordKey:      s.chordKey1,
      chordSecond:   s.chordKey2,
      chordCode1:    s.chordCode1,
      chordCode2:    s.chordCode2,
      chordModifier: s.chordModifier,
    };
  }

  // ─── DOM helpers ─────────────────────────────────────────────────────────────

  /**
   * Walk up from `el` to find the nearest ancestor (or self) with `.pb-blurred`.
   * Returns null if none found.
   */
  function findBlurredAncestor(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && node.classList.contains('pb-blurred')) return node;
      node = node.parentElement;
    }
    return null;
  }

  // ─── Reveal management (click + hover modes) ──────────────────────────────────
  // CSS filter on a parent blurs the entire rendered output, including children.
  // To make a revealed element readable, we must also remove filter from every
  // blurred ancestor. Both click and hover modes share the ancestor chain logic.
  //
  // Click mode (default): click a blurred element to peek, click again or
  //   Escape to re-blur. Explicit intent — no hover conflicts, touch-friendly,
  //   WCAG compliant (dismissible via Escape).
  // Hover mode (optional): CSS :hover removes filter. JS manages ancestor chain
  //   via event delegation with debounced mouseout (150ms) to reduce dropdown
  //   timing conflicts.

  /** Tracks elements currently marked with pb-ancestor-reveal for cleanup. */
  let revealedAncestors = [];

  /** The element currently click-revealed (only one at a time). */
  let clickRevealedEl = null;

  /** Timer for debounced mouseout in hover mode. */
  let mouseoutTimer = null;

  /** Clear all pb-ancestor-reveal classes and reset the tracking array. */
  function clearRevealedAncestors() {
    for (let i = 0; i < revealedAncestors.length; i++) {
      revealedAncestors[i].classList.remove('pb-ancestor-reveal');
    }
    revealedAncestors = [];
  }

  /** Walk up from an element and add pb-ancestor-reveal to blurred ancestors. */
  function revealAncestorChain(el) {
    clearRevealedAncestors();
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (node.classList.contains('pb-blurred')) {
        node.classList.add('pb-ancestor-reveal');
        revealedAncestors.push(node);
      }
      node = node.parentElement;
    }
  }

  /** Dismiss click-reveal: remove pb-revealed and ancestor chain. */
  function dismissClickReveal() {
    if (clickRevealedEl) {
      clickRevealedEl.classList.remove('pb-revealed');
      clickRevealedEl = null;
    }
    clearRevealedAncestors();
  }

  // ── Click-to-reveal handler (event delegation) ─────────────────────────────

  function onRevealClick(e) {
    if (settings.revealMode !== 'click') return;
    if (isPickerActive) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    // Find the nearest blurred element at or above the click target.
    const blurredEl = target.closest('.pb-blurred');
    if (!blurredEl) return;

    // If clicking the already-revealed element, dismiss it.
    if (blurredEl === clickRevealedEl) {
      dismissClickReveal();
      return;
    }

    // Dismiss any previous reveal, then reveal the clicked element.
    dismissClickReveal();
    blurredEl.classList.add('pb-revealed');
    clickRevealedEl = blurredEl;
    revealAncestorChain(blurredEl);
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && clickRevealedEl) {
      dismissClickReveal();
    }
  }

  // ── Hover-to-reveal handlers (event delegation) ────────────────────────────

  function onRevealMouseOver(e) {
    if (settings.revealMode !== 'hover') return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    const revealTarget = target.closest('.pb-reveal-on-hover');
    if (!revealTarget) return;

    // Cancel any pending mouseout debounce — mouse is back on a reveal element.
    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }

    revealAncestorChain(revealTarget);
  }

  function onRevealMouseOut(e) {
    if (revealedAncestors.length === 0) return;
    const related = e.relatedTarget;
    if (related && related instanceof Element && related.closest('.pb-reveal-on-hover')) {
      return;
    }
    // Debounce: wait 150ms before re-blurring ancestors. This gives the user
    // time to move the mouse into dropdown menus or tooltips that appear on
    // hover without the ancestors flashing blurred between events.
    if (mouseoutTimer) clearTimeout(mouseoutTimer);
    mouseoutTimer = setTimeout(() => {
      mouseoutTimer = null;
      clearRevealedAncestors();
    }, 150);
  }

  // ─── Keyboard shortcut action map ────────────────────────────────────────────

  const shortcutActionMap = {
    TOGGLE_BLUR_ALL() {
      handleMessage({ type: MSG.TOGGLE_BLUR_ALL }, null, () => {});
    },
    onExitPicker() {
      if (isPickerActive) {
        Picker.deactivate();
        isPickerActive = false;
      }
    },
  };

  // ─── Message handler ──────────────────────────────────────────────────────────

  /**
   * Centralized handler for messages sent from background.js or the popup.
   */
  function handleMessage(message, _sender, sendResponse) {
    const { type } = message;

    // Allow settings, status, and restore messages through even when disabled.
    // Block blur/picker/context actions when the extension is disabled.
    const alwaysAllowed = [MSG.UPDATE_SETTINGS, MSG.GET_STATUS, MSG.RESTORE];
    if (settings.enabled === false && !alwaysAllowed.includes(type)) {
      if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
      return false;
    }

    switch (type) {
      // ── Toggle blur-all mode ──────────────────────────────────────────────
      case MSG.TOGGLE_BLUR_ALL: {
        if (isPageBlurred) {
          dismissClickReveal();
          Engine.unblurAll();
          isPageBlurred = false;
        } else {
          Engine.blurAllContent(settings.blurRadius, { categories: settings.blurCategories, thoroughBlur: settings.thoroughBlur });
          if (settings.revealMode === 'hover') {
            document.querySelectorAll('.pb-blurred').forEach((el) => {
              el.classList.add('pb-reveal-on-hover');
            });
          }
          isPageBlurred = true;
        }
        if (sendResponse) sendResponse({ isPageBlurred });
        break;
      }

      // ── Toggle element picker ─────────────────────────────────────────────
      case MSG.TOGGLE_PICKER: {
        if (isPickerActive) {
          Picker.deactivate();
          isPickerActive = false;
          Shortcuts._setPickerActive(false);
        } else {
          Picker.activate(settings, pickerCallbacks);
          isPickerActive = true;
          Shortcuts._setPickerActive(true);
        }
        if (sendResponse) sendResponse({ isPickerActive });
        break;
      }

      // ── Clear all blur on this page ───────────────────────────────────────
      case MSG.CLEAR_ALL_BLUR: {
        document.querySelectorAll('.pb-reveal-on-hover').forEach((el) => {
          el.classList.remove('pb-reveal-on-hover');
        });
        Engine.unblurAll();
        isPageBlurred = false;
        Store.clearHost(hostname).catch(() => {});
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Re-apply persisted blur selectors ────────────────────────────────
      case MSG.RESTORE: {
        restoreBlurredElements().then(() => {
          if (sendResponse) sendResponse({ ok: true });
        });
        return true; // async response
      }

      // ── Status query ──────────────────────────────────────────────────────
      case MSG.GET_STATUS: {
        const blurredCount = document.querySelectorAll('.pb-blurred').length;
        if (sendResponse) sendResponse({ isPageBlurred, isPickerActive, blurredCount });
        break;
      }

      // ── Update settings ───────────────────────────────────────────────────
      case MSG.UPDATE_SETTINGS: {
        if (message.settings) {
          const oldCategories = settings.blurCategories;
          settings = mergeSettings(message.settings);
          applySettingsToDom();

          // Invalidate cached selectors when category toggles change so the
          // next blurAllContent call rebuilds with the new configuration.
          if (message.settings.blurCategories) {
            const changed = CATEGORY_KEYS.some(k => oldCategories[k] !== settings.blurCategories[k]);
            if (changed) Engine.invalidateSelectorCache();
          }

          if (settings.enabled === false) {
            // Tear down active features when disabled
            Shortcuts.destroy();
            if (isPickerActive) {
              Picker.deactivate();
              isPickerActive = false;
            }
            stopDomObserver();
          } else {
            Shortcuts.init(shortcutSettings(), shortcutActionMap);
            if (isPickerActive) {
              Picker.setSettings(settings);
            }
            startDomObserver();
          }
        }
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Context menu: blur the right-clicked element ─────────────────────
      case MSG.CONTEXT_BLUR: {
        const target = lastContextMenuTarget;
        if (target && target instanceof Element) {
          Engine.applyBlur(target, settings.blurRadius);
          if (settings.revealMode === 'hover') {
            target.classList.add('pb-reveal-on-hover');
          }
          const sel = Selector.getSelector(target);
          if (sel) {
            Store.saveBlurredElement(hostname, sel).catch(() => {});
          }
        }
        lastContextMenuTarget = null;
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Context menu: unblur the right-clicked element ────────────────────
      case MSG.CONTEXT_UNBLUR: {
        const target = lastContextMenuTarget;
        const unblurTarget = findBlurredAncestor(target);
        if (unblurTarget) {
          unblurTarget.classList.remove('pb-reveal-on-hover');
          Engine.removeBlur(unblurTarget);
          const sel = Selector.getSelector(unblurTarget);
          if (sel) {
            Store.removeBlurredElement(hostname, sel).catch(() => {});
          }
        }
        lastContextMenuTarget = null;
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Unblur a specific selector (from popup remove button) ────────────
      case MSG.UNBLUR_SELECTOR: {
        if (message.selector) {
          const el = document.querySelector(message.selector);
          if (el) {
            el.classList.remove('pb-reveal-on-hover');
            Engine.removeBlur(el);
          }
        }
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      default:
        break;
    }

    return false;
  }

  // ─── Apply CSS custom properties ─────────────────────────────────────────────

  function applySettingsToDom() {
    document.documentElement.style.setProperty(
      '--pb-radius',
      `${settings.blurRadius}px`
    );
    document.documentElement.style.setProperty(
      '--pb-highlight-color',
      settings.highlightColor || D.HIGHLIGHT_COLOR
    );
    document.documentElement.style.setProperty(
      '--pb-transition-duration',
      `${settings.transitionDuration || D.TRANSITION_DURATION}ms`
    );

    // Update reveal classes based on revealMode.
    // Hover mode: add pb-reveal-on-hover to all blurred elements.
    // Click/none mode: remove pb-reveal-on-hover (hover CSS rule inactive).
    // Also dismiss any active click reveal when mode changes.
    const isHoverMode = settings.revealMode === 'hover';
    document.querySelectorAll('.pb-blurred').forEach((el) => {
      el.classList.toggle('pb-reveal-on-hover', isHoverMode);
    });
    if (settings.revealMode !== 'click') {
      dismissClickReveal();
    }
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  async function init() {
    // Bind module aliases now that all scripts are loaded.
    Engine    = window.PrivacyBlurEngine;
    Store     = window.PrivacyBlurStorage;
    Selector  = window.PrivacyBlurSelectorUtils;
    Picker    = window.PrivacyBlurPicker;
    Shortcuts = window.PrivacyBlurShortcuts;

    // 1. Load settings from storage.
    try {
      const loaded = await Store.getSettings();
      if (loaded) {
        settings = mergeSettings(loaded);
      }
    } catch (_e) {
      // Background not ready — use defaults.
    }

    // 2. Apply CSS custom properties from settings.
    applySettingsToDom();

    // 3. Register message listener from background / popup (must be early so
    //    UPDATE_SETTINGS and RESTORE messages are never missed).
    chrome.runtime.onMessage.addListener(handleMessage);

    // 4. Track the last right-clicked element for context menu blur/unblur.
    document.addEventListener('contextmenu', (e) => {
      lastContextMenuTarget = e.target instanceof Element ? e.target : null;
    }, true);

    // 5. If the extension is disabled, stop here — don't init shortcuts,
    //    don't restore blur, don't start the DOM observer or hover listeners.
    if (settings.enabled === false) return;

    // 6. Initialise keyboard shortcut handler.
    Shortcuts.init(shortcutSettings(), shortcutActionMap);

    // 7. Restore previously blurred elements for this hostname.
    await restoreBlurredElements();

    // 8. Start DOM observer for dynamic content.
    startDomObserver();

    // 9. Register reveal handlers (both modes use event delegation on document).
    document.addEventListener('click', onRevealClick);
    document.addEventListener('keydown', onRevealKeydown);
    document.addEventListener('mouseover', onRevealMouseOver);
    document.addEventListener('mouseout', onRevealMouseOut);
  }

  // ─── Storage change listener ──────────────────────────────────────────────────
  // Catches setting changes even when popup's tabMessage doesn't reach us
  // (e.g. popup opened programmatically, or tab focus race).

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const newSettings = changes.settings.newValue;
    if (!newSettings) return;

    const oldCategories = settings.blurCategories;
    settings = mergeSettings(newSettings);
    applySettingsToDom();

    // Invalidate cached selectors if categories changed via cross-tab update.
    if (newSettings.blurCategories) {
      const changed = CATEGORY_KEYS.some(k => oldCategories[k] !== settings.blurCategories[k]);
      if (changed) Engine.invalidateSelectorCache();
    }

    if (settings.enabled === false) {
      Shortcuts.destroy();
      if (isPickerActive) {
        Picker.deactivate();
        isPickerActive = false;
      }
      stopDomObserver();
    } else {
      Shortcuts.init(shortcutSettings(), shortcutActionMap);
      startDomObserver();
    }
  });

  // ─── DOM-ready guard ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
