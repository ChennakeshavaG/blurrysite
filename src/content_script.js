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

'use strict';

(() => {
  // ─── State ──────────────────────────────────────────────────────────────────

  /** @type {object} Settings loaded from background / storage */
  let settings = {
    blurRadius: 8,
    highlightColor: '#f59e0b',
    transitionDuration: 200,
    revealOnHover: false,
    shortcuts: {
      chordKey1: 'k',
      chordKey2: 'v',
      chordModifier: 'ctrl',
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
  function startDomObserver() {
    if (domObserver) return;

    domObserver = new MutationObserver((mutations) => {
      // In picker mode we leave new elements alone — the user picks manually.
      if (isPickerActive) return;
      // In blur-all mode, extend blur to newly added content.
      if (isPageBlurred) {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              Engine.applyBlur(node, settings.blurRadius);
              node.querySelectorAll('*').forEach((child) => {
                Engine.applyBlur(child, settings.blurRadius);
              });
            }
          }
        }
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
  }

  // ─── Picker callbacks ─────────────────────────────────────────────────────────

  const pickerCallbacks = {
    /** Called by PrivacyBlurPicker when the user clicks to blur an element. */
    onBlur(el) {
      Engine.applyBlur(el, settings.blurRadius);
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.saveBlurredElement(hostname, selector).catch(() => {});
      }
    },

    /** Called by PrivacyBlurPicker when the user clicks to unblur an element. */
    onUnblur(el) {
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

  // ─── Shortcut settings helper ────────────────────────────────────────────────

  /**
   * Flatten the nested settings.shortcuts object into the flat shape that
   * PrivacyBlurShortcuts.init() expects.
   */
  function shortcutSettings() {
    const s = settings.shortcuts || {};
    return {
      chordKey:      s.chordKey1      || 'k',
      chordSecond:   s.chordKey2      || 'v',
      chordModifier: s.chordModifier  || 'ctrl',
    };
  }

  // ─── Keyboard shortcut action map ────────────────────────────────────────────

  const shortcutActionMap = {
    TOGGLE_BLUR_ALL() {
      handleMessage({ type: 'TOGGLE_BLUR_ALL' }, null, () => {});
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

    switch (type) {
      // ── Toggle blur-all mode ──────────────────────────────────────────────
      case 'TOGGLE_BLUR_ALL': {
        if (isPageBlurred) {
          Engine.unblurAll();
          isPageBlurred = false;
        } else {
          Engine.blurAllContent(settings.blurRadius);
          isPageBlurred = true;
        }
        if (sendResponse) sendResponse({ isPageBlurred });
        break;
      }

      // ── Toggle element picker ─────────────────────────────────────────────
      case 'TOGGLE_PICKER': {
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
      case 'CLEAR_ALL_BLUR': {
        Engine.unblurAll();
        isPageBlurred = false;
        Store.clearHost(hostname).catch(() => {});
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Re-apply persisted blur selectors ────────────────────────────────
      case 'RESTORE': {
        restoreBlurredElements().then(() => {
          if (sendResponse) sendResponse({ ok: true });
        });
        return true; // async response
      }

      // ── Status query ──────────────────────────────────────────────────────
      case 'GET_STATUS': {
        const blurredCount = document.querySelectorAll('.pb-blurred').length;
        if (sendResponse) sendResponse({ isPageBlurred, isPickerActive, blurredCount });
        break;
      }

      // ── Update settings ───────────────────────────────────────────────────
      case 'UPDATE_SETTINGS': {
        if (message.settings) {
          settings = { ...settings, ...message.settings };
          applySettingsToDom();
          Shortcuts.init(shortcutSettings(), shortcutActionMap);
          if (isPickerActive) {
            Picker.setSettings(settings);
          }
        }
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Context menu: blur the right-clicked element ─────────────────────
      case 'CONTEXT_BLUR': {
        const target = lastContextMenuTarget;
        if (target && target instanceof Element) {
          Engine.applyBlur(target, settings.blurRadius);
          const sel = Selector.getSelector(target);
          if (sel) {
            Store.saveBlurredElement(hostname, sel).catch(() => {});
          }
        }
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Context menu: unblur the right-clicked element ────────────────────
      case 'CONTEXT_UNBLUR': {
        const target = lastContextMenuTarget;
        if (target && target instanceof Element) {
          Engine.removeBlur(target);
          const sel = Selector.getSelector(target);
          if (sel) {
            Store.removeBlurredElement(hostname, sel).catch(() => {});
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
      settings.highlightColor || '#f59e0b'
    );
    document.documentElement.style.setProperty(
      '--pb-transition-duration',
      `${settings.transitionDuration || 200}ms`
    );
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
        settings = { ...settings, ...loaded };
      }
    } catch (_e) {
      // Background not ready — use defaults.
    }

    // 2. Apply CSS custom properties from settings.
    applySettingsToDom();

    // 3. Initialise keyboard shortcut handler.
    Shortcuts.init(shortcutSettings(), shortcutActionMap);

    // 4. Restore previously blurred elements for this hostname.
    await restoreBlurredElements();

    // 5. Register message listener from background / popup.
    chrome.runtime.onMessage.addListener(handleMessage);

    // 6. Track the last right-clicked element for context menu blur/unblur.
    document.addEventListener('contextmenu', (e) => {
      lastContextMenuTarget = e.target instanceof Element ? e.target : null;
    }, true);

    // 7. Start DOM observer for dynamic content.
    startDomObserver();
  }

  // ─── DOM-ready guard ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
