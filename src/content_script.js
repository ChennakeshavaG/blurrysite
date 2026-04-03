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
          if (settings.revealOnHover) {
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
      if (settings.revealOnHover) {
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

    // Allow settings, status, and restore messages through even when disabled.
    // Block blur/picker/context actions when the extension is disabled.
    const alwaysAllowed = ['UPDATE_SETTINGS', 'GET_STATUS', 'RESTORE'];
    if (settings.enabled === false && !alwaysAllowed.includes(type)) {
      if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
      return false;
    }

    switch (type) {
      // ── Toggle blur-all mode ──────────────────────────────────────────────
      case 'TOGGLE_BLUR_ALL': {
        if (isPageBlurred) {
          Engine.unblurAll();
          isPageBlurred = false;
        } else {
          Engine.blurAllContent(settings.blurRadius);
          if (settings.revealOnHover) {
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
      case 'CONTEXT_BLUR': {
        const target = lastContextMenuTarget;
        if (target && target instanceof Element) {
          Engine.applyBlur(target, settings.blurRadius);
          if (settings.revealOnHover) {
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
      case 'CONTEXT_UNBLUR': {
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
      case 'UNBLUR_SELECTOR': {
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
      settings.highlightColor || '#f59e0b'
    );
    document.documentElement.style.setProperty(
      '--pb-transition-duration',
      `${settings.transitionDuration || 200}ms`
    );

    // Toggle reveal-on-hover class on all currently blurred elements
    document.querySelectorAll('.pb-blurred').forEach((el) => {
      el.classList.toggle('pb-reveal-on-hover', !!settings.revealOnHover);
    });
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

    // 3. Register message listener from background / popup (must be early so
    //    UPDATE_SETTINGS and RESTORE messages are never missed).
    chrome.runtime.onMessage.addListener(handleMessage);

    // 4. Track the last right-clicked element for context menu blur/unblur.
    document.addEventListener('contextmenu', (e) => {
      lastContextMenuTarget = e.target instanceof Element ? e.target : null;
    }, true);

    // 5. If the extension is disabled, stop here — don't init shortcuts,
    //    don't restore blur, don't start the DOM observer.
    if (settings.enabled === false) return;

    // 6. Initialise keyboard shortcut handler.
    Shortcuts.init(shortcutSettings(), shortcutActionMap);

    // 7. Restore previously blurred elements for this hostname.
    await restoreBlurredElements();

    // 8. Start DOM observer for dynamic content.
    startDomObserver();
  }

  // ─── Storage change listener ──────────────────────────────────────────────────
  // Catches setting changes even when popup's tabMessage doesn't reach us
  // (e.g. popup opened programmatically, or tab focus race).

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const newSettings = changes.settings.newValue;
    if (!newSettings) return;

    settings = { ...settings, ...newSettings };
    applySettingsToDom();

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
