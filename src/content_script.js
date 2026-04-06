/**
 * privacyblur — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * the pb.* namespace, loaded before this script via manifest.json.
 */

(() => {
  'use strict';

  const MSG = pb;
  const CATEGORY_KEYS = Object.keys(pb.BlurEngine.CATEGORY_SELECTORS);
  const RM = MSG.REVEAL_MODES;
  const BM = MSG.BLUR_MODES;
  const PT = MSG.PATTERN_TYPES;
  const CLS = MSG.CSS;

  // ─── State ──────────────────────────────────────────────────────────────────

  /** @type {object} Global settings from storage (no URL rule overrides). */
  let globalSettings = MSG.buildDefaultSettings();

  /** @type {object} Resolved settings (global + URL rule overrides for current URL). */
  let settings = MSG.buildDefaultSettings();

  /** @type {Array} URL rules loaded from storage */
  let rules = [];

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

  // ─── Module aliases (synchronous — loaded before this script by manifest) ──

  const Engine    = pb.BlurEngine;
  const Store     = pb.Storage;
  const Selector  = pb.SelectorUtils;
  const Picker    = pb.Picker;
  const Shortcuts = pb.Shortcuts;

  // ─── Restore blurred elements ────────────────────────────────────────────────

  async function restoreBlurredElements() {
    try {
      const selectors = await Store.getBlurredSelectors(hostname);
      if (!selectors || selectors.length === 0) return;

      for (const selector of selectors) {
        const el = Selector.restoreSelector(selector);
        if (el) {
          Engine.applyBlur(el);
        }
      }
    } catch (err) {
      // Storage unavailable or context invalidated — fail silently.
    }
  }

  // ── Logger alias ──────────────────────────────────────────────────────────
  const log = pb.Logger;

  // ── MutationObserver: stamp data-pb-blur on new text-check elements ──────
  // Always-blur tags are handled by CSS rules (auto-apply, no JS needed).
  // Text-check tags need the hasMeaningfulTextContent gate, so MO watches
  // for new ones and stamps data-pb-blur. Uses data attribute instead of
  // classList to avoid triggering site framework re-render loops.

  function startDomObserver() {
    if (domObserver) return;

    domObserver = new MutationObserver((mutations) => {
      if (isPickerActive) return;
      if (!isPageBlurred) return;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          // Stamp the node itself if it's a text-check element with text
          Engine.tryBlurTextCheck(node, settings.THOROUGH_BLUR);
          // Also check descendants
          const children = node.querySelectorAll('*');
          for (let i = 0; i < children.length; i++) {
            Engine.tryBlurTextCheck(children[i], settings.THOROUGH_BLUR);
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
    onBlur(el) {
      Engine.applyBlur(el);
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.saveBlurredElement(hostname, selector).catch(() => {});
      }
    },

    onUnblur(el) {
      Engine.removeBlur(el);
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.removeBlurredElement(hostname, selector).catch(() => {});
      }
    },

    onDeactivate() {
      isPickerActive = false;
      Shortcuts._setPickerActive(false);
    },
  };

  // ─── Settings helpers ────────────────────────────────────────────────────────


  // ─── URL rule pattern matching ──────────────────────────────────────────────

  /** Max pattern string length to prevent ReDoS and storage abuse. */
  const MAX_PATTERN_LENGTH = 500;

  // ─── URL pattern matching (parse-then-match) ──────────────────────────────
  // Decomposes both the page URL and the user's pattern into parts
  // (hostname, path, protocol, port) and matches each with domain-boundary
  // awareness. Prevents "notexample.com" matching a pattern for "example.com".
  //
  // User input heuristics:
  //   "example.com"          → hostname match (includes subdomains), any path
  //   "example.com/app*"     → hostname + path prefix with wildcard
  //   "*.example.com"        → subdomains only, any path
  //   "example.com:8080"     → hostname + specific port
  //   "https://example.com"  → scheme + hostname
  //   Full URL with path     → each component matched separately
  //
  // Hash (#fragment) is always excluded from matching.
  // Query string (?key=val) is excluded unless explicitly in the pattern.

  /**
   * Parse a user-entered pattern into structured parts.
   * @returns {{ scheme: string|null, hostname: string, port: string|null, path: string|null, subdomainWildcard: boolean }}
   */
  function parsePattern(pattern) {
    let scheme = null;
    let rest = pattern;

    // Extract scheme if present
    const schemeMatch = rest.match(/^(https?):\/\//i);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      rest = rest.slice(schemeMatch[0].length);
    } else if (rest.startsWith('*://')) {
      rest = rest.slice(4); // explicit any-scheme
    }

    // Check for subdomain wildcard: *.example.com
    let subdomainWildcard = false;
    if (rest.startsWith('*.')) {
      subdomainWildcard = true;
      rest = rest.slice(2);
    }

    // Split hostname from path at the first /
    let hostPart, pathPart = null;
    const slashIdx = rest.indexOf('/');
    if (slashIdx >= 0) {
      hostPart = rest.slice(0, slashIdx);
      pathPart = rest.slice(slashIdx); // includes leading /
    } else {
      hostPart = rest;
    }

    // Extract port from hostname
    let port = null;
    const colonIdx = hostPart.lastIndexOf(':');
    if (colonIdx >= 0) {
      const maybPort = hostPart.slice(colonIdx + 1);
      if (/^\d+$/.test(maybPort)) {
        port = maybPort;
        hostPart = hostPart.slice(0, colonIdx);
      }
    }

    return {
      scheme,
      hostname: hostPart.toLowerCase(),
      port,
      path: pathPart,
      subdomainWildcard,
    };
  }

  /**
   * Check if pageHostname matches a pattern hostname with domain-boundary awareness.
   * "example.com" matches "example.com" and "sub.example.com" (includes subdomains).
   * Subdomain wildcard "*.example.com" matches "sub.example.com" but NOT "example.com".
   */
  function hostnameMatches(pageHost, patternHost, subdomainWildcard) {
    if (subdomainWildcard) {
      // *.example.com → must be a subdomain, not the root
      return pageHost.endsWith('.' + patternHost);
    }
    // example.com → matches exact OR any subdomain
    return pageHost === patternHost || pageHost.endsWith('.' + patternHost);
  }

  /**
   * Check if pagePath matches a pattern path with wildcard support.
   * "/*" or null → any path. "/app*" → starts with /app.
   */
  function pathMatches(pagePath, patternPath) {
    if (!patternPath || patternPath === '/' || patternPath === '/*') return true;

    // Remove trailing * for prefix matching
    if (patternPath.endsWith('*')) {
      const prefix = patternPath.slice(0, -1);
      return pagePath.startsWith(prefix);
    }

    // Exact path match (with or without trailing slash tolerance)
    return pagePath === patternPath || pagePath === patternPath + '/';
  }

  /**
   * Tests whether a URL matches a rule's pattern.
   * @param {string} url         - Full page URL (location.href)
   * @param {string} pattern     - User-entered pattern string
   * @param {string} patternType - 'wildcard' | 'regex'
   * @returns {boolean}
   */
  function matchesPattern(url, pattern, patternType) {
    if (!pattern || typeof pattern !== 'string') return false;
    if (pattern.length > MAX_PATTERN_LENGTH) return false;

    // Regex mode: match against URL without hash.
    // Reject patterns with nested quantifiers to prevent ReDoS.
    if (patternType === PT.REGEX) {
      try {
        if (/([+*?])\s*[)]\s*[+*?{]/.test(pattern) || /([+*?{])\s*\1/.test(pattern)) {
          return false; // nested quantifiers — catastrophic backtracking risk
        }
        const urlNoHash = url.replace(/#.*$/, '');
        return new RegExp(pattern, 'i').test(urlNoHash);
      } catch (_e) {
        return false;
      }
    }

    // Wildcard mode: parse-then-match
    try {
      const parsed = new URL(url);
      const pat = parsePattern(pattern);

      // Scheme check (only if user specified a protocol)
      if (pat.scheme && parsed.protocol !== pat.scheme + ':') return false;

      // Hostname check with domain boundary awareness
      if (!hostnameMatches(parsed.hostname, pat.hostname, pat.subdomainWildcard)) return false;

      // Port check (only if user specified a port)
      // new URL() normalizes default ports to "" so https://x.com:443 == https://x.com
      if (pat.port && parsed.port !== pat.port) return false;

      // Path check
      if (!pathMatches(parsed.pathname, pat.path)) return false;

      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Resolve settings for the current URL.
   * Priority: first matching URL rule > user global settings > DEFAULT_SETTINGS.
   * Rule settings are partial — deep-merged over the global settings.
   */
  function resolveSettings(url, globalSettings, urlRules) {
    let resolved = MSG.deepMerge(MSG.DEFAULT_SETTINGS, globalSettings);

    for (const rule of urlRules) {
      if (matchesPattern(url, rule.pattern, rule.patternType)) {
        resolved = MSG.deepMerge(resolved, rule.settings || {});
        break; // first match wins
      }
    }

    return resolved;
  }


  // ─── DOM helpers ─────────────────────────────────────────────────────────────

  /** Find the nearest blurred ancestor */
  function findBlurredAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && Engine.isBlurred(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  // ─── Reveal management (click + hover modes) ──────────────────────────────────

  let revealedAncestors = [];
  let clickRevealedEl = null;
  let mouseoutTimer = null;

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

  /** Find the nearest blurred element (data-pb-blur or CSS-rule-blurred tag) */
  function findBlurredTarget(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && Engine.isBlurred(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /** Set of elements currently revealed via inline style */
  const _revealedElements = new Set();

  function _revealElement(el) {
    el.style.setProperty('transition', 'filter 100ms ease', 'important');
    el.style.setProperty('filter', 'none', 'important');
    _revealedElements.add(el);
    // Reveal ALL blurred descendants — they may be blurred by:
    // 1. data-pb-blur attribute ([data-pb-blur] CSS rule)
    // 2. CSS tag rules (span, p, img, etc. from injected <style>)
    // Both need inline style override to unblur.
    el.querySelectorAll('*').forEach(child => {
      if (Engine.isBlurred(child)) {
        child.style.setProperty('filter', 'none', 'important');
        _revealedElements.add(child);
      }
    });
  }

  function _unrevealElement(el) {
    el.style.removeProperty('filter');
    setTimeout(() => el.style.removeProperty('transition'), 120);
    _revealedElements.delete(el);
    // Clean up descendants added by _revealElement
    el.querySelectorAll('*').forEach(child => {
      if (_revealedElements.has(child)) {
        child.style.removeProperty('filter');
        _revealedElements.delete(child);
      }
    });
  }

  function _unrevealAll() {
    for (const el of _revealedElements) {
      el.style.removeProperty('filter');
      el.style.removeProperty('transition');
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

  function onRevealClick(e) {
    if (settings.REVEAL_MODE !== RM.CLICK) return;
    if (isPickerActive) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
        tag === 'button' || target.isContentEditable) return;

    const blurredEl = findBlurredTarget(target);
    if (!blurredEl) return;

    if (blurredEl === clickRevealedEl) {
      dismissClickReveal();
      return;
    }

    dismissClickReveal();
    _revealElement(blurredEl);
    clickRevealedEl = blurredEl;
    revealAncestorChain(blurredEl);
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && clickRevealedEl) {
      dismissClickReveal();
    }
  }

  /** The single element currently revealed by hover */
  let _hoverRevealedEl = null;

  function onRevealMouseOver(e) {
    if (settings.REVEAL_MODE !== RM.HOVER) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    // Prefer target itself if blurred, else walk up to nearest blurred element.
    // This keeps reveal scoped tightly to what the user actually hovered.
    const blurredRoot = findBlurredTarget(target);
    if (!blurredRoot) return;

    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }

    // Already revealing this root — skip
    if (_hoverRevealedEl === blurredRoot) return;

    // Unreveal previous
    if (_hoverRevealedEl) {
      _unrevealAll();
      clearRevealedAncestors();
    }

    _revealElement(blurredRoot);
    _hoverRevealedEl = blurredRoot;
    revealAncestorChain(blurredRoot);
  }

  function onRevealMouseOut(e) {
    if (!_hoverRevealedEl) return;
    if (mouseoutTimer) clearTimeout(mouseoutTimer);
    mouseoutTimer = setTimeout(() => {
      mouseoutTimer = null;
      if (_hoverRevealedEl) {
        _unrevealElement(_hoverRevealedEl);
        _hoverRevealedEl = null;
      }
      clearRevealedAncestors();
    }, 50);
  }

  // ─── Keyboard shortcut action map ────────────────────────────────────────────

  const shortcutActionMap = {
    TOGGLE_BLUR_ALL() {
      handleMessage({ type: MSG.TOGGLE_BLUR_ALL }, null, () => {});
    },
    TOGGLE_PICKER() {
      handleMessage({ type: MSG.TOGGLE_PICKER }, null, () => {});
    },
    CLEAR_ALL() {
      handleMessage({ type: MSG.CLEAR_ALL_BLUR }, null, () => {});
    },
    onExitPicker() {
      if (isPickerActive) {
        Picker.deactivate();
        isPickerActive = false;
      }
    },
  };

  // ─── Message handler ──────────────────────────────────────────────────────────

  // Debounce guard for toggle commands. Manifest commands (Alt+Shift+B) and JS
  // shortcut handler both fire TOGGLE_BLUR_ALL for the same keypress — the JS
  // handler fires synchronously, then background relays the manifest command
  // asynchronously. Without dedup, the toggle fires twice (ON then OFF = no-op).
  const lastToggleTime = {};
  const TOGGLE_DEDUP_MS = 300;

  function handleMessage(message, _sender, sendResponse) {
    const { type } = message;
    log.log('handleMessage:', type);

    // Dedup toggle commands that fire from both manifest and JS handler
    if (type === MSG.TOGGLE_BLUR_ALL || type === MSG.TOGGLE_PICKER || type === MSG.CLEAR_ALL_BLUR) {
      const now = Date.now();
      if (lastToggleTime[type] && now - lastToggleTime[type] < TOGGLE_DEDUP_MS) {
        if (sendResponse) sendResponse({ ok: true, deduped: true });
        return false;
      }
      lastToggleTime[type] = now;
    }

    const alwaysAllowed = [MSG.UPDATE_SETTINGS, MSG.GET_STATUS, MSG.RESTORE];
    if (settings.ENABLED === false && !alwaysAllowed.includes(type)) {
      if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
      return false;
    }

    switch (type) {
      // ── Toggle blur-all mode ──────────────────────────────────────────────
      case MSG.TOGGLE_BLUR_ALL: {
        if (isPageBlurred) {
          dismissClickReveal();
          stopDomObserver();
          Engine.unblurAll();
          isPageBlurred = false;
        } else {
          Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
          Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
          startDomObserver();
          isPageBlurred = true;
        }
        // Persist blur-all state for this hostname so it survives page reload
        Store.saveBlurState(hostname, isPageBlurred).catch(() => {});
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
          Picker.activate({
            blurRadius: settings.BLUR_RADIUS,
            highlightColor: settings.HIGHLIGHT_COLOR,
          }, pickerCallbacks);
          isPickerActive = true;
          Shortcuts._setPickerActive(true);
        }
        if (sendResponse) sendResponse({ isPickerActive });
        break;
      }

      // ── Clear all blur on this page ───────────────────────────────────────
      case MSG.CLEAR_ALL_BLUR: {
        dismissClickReveal();
        stopDomObserver();
        Engine.unblurAll();
        isPageBlurred = false;
        Store.clearHost(hostname).catch(() => {});
        Store.saveBlurState(hostname, false).catch(() => {});
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
        const blurredCount = document.querySelectorAll('[data-pb-blur]').length;
        if (sendResponse) sendResponse({ isPageBlurred, isPickerActive, blurredCount });
        break;
      }

      // ── Update settings ───────────────────────────────────────────────────
      case MSG.UPDATE_SETTINGS: {
        if (message.settings) {
          (async () => {
            const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
            const wasEnabled = settings.ENABLED;
            globalSettings = MSG.deepMerge(globalSettings, message.settings);
            // Reload rules — popup may have saved new rules before this message
            try { const r = await Store.getRules(); if (r) rules = r; } catch (_e) {}
            const resolved = resolveSettings(location.href, globalSettings, rules);
            applyState(resolved, prev);

            // Restore blur-all when re-enabled
            if (!wasEnabled && settings.ENABLED) {
              try {
                const wasBlurAll = await Store.getBlurState(hostname);
                if (wasBlurAll && !isPageBlurred) {
                  isPageBlurred = true;
                  Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
                  Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
                  startDomObserver();
                }
              } catch (_e) {}
            }

            if (sendResponse) sendResponse({ ok: true });
          })();
        }
        return true; // async handler
      }

      // ── Context menu: blur the right-clicked element ─────────────────────
      case MSG.CONTEXT_BLUR: {
        const target = lastContextMenuTarget;
        if (target) {
          Engine.applyBlur(target);
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
        if (!target) {
          lastContextMenuTarget = null;
          if (sendResponse) sendResponse({ ok: false, reason: 'no_target' });
          break;
        }
        const unblurTarget = findBlurredTarget(target);
        if (unblurTarget) {
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
          try {
            const el = document.querySelector(message.selector);
            if (el) {
              Engine.removeBlur(el);
            }
          } catch (_e) { /* invalid selector — skip */ }
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
    document.documentElement.style.setProperty('--pb-radius', `${settings.BLUR_RADIUS}px`);
    document.documentElement.style.setProperty('--pb-highlight-color', settings.HIGHLIGHT_COLOR);
    document.documentElement.style.setProperty('--pb-transition-duration', `${settings.TRANSITION_DURATION}ms`);
  }

  // ─── Idempotent state application ─────────────────────────────────────────────
  // Single function that configures every component from resolved settings.
  // All propagation paths (UPDATE_SETTINGS, storage.onChanged, SPA navigation,
  // init) collapse to: resolveSettings() → applyState().
  // Calling applyState twice with the same data produces the same result.

  function applyState(newSettings, prev) {
    const old = prev || settings;
    settings = newSettings;

    // 1. CSS custom properties (cheap, idempotent)
    applySettingsToDom();

    // 2. Category / selector cache
    const catsChanged = CATEGORY_KEYS.some(k => old.BLUR_CATEGORIES[k] !== settings.BLUR_CATEGORIES[k]);
    if (catsChanged) {
      Engine.invalidateSelectorCache();
    }

    // 3. Shortcuts (init is already idempotent — destroy + re-create)
    if (settings.ENABLED) {
      Shortcuts.init(settings.SHORTCUTS, shortcutActionMap);
    } else {
      Shortcuts.destroy();
    }

    // 4. Picker settings (if active)
    if (isPickerActive) {
      if (!settings.ENABLED) {
        Picker.deactivate();
        isPickerActive = false;
        Shortcuts._setPickerActive(false);
      } else {
        Picker.setSettings({
          blurRadius: settings.BLUR_RADIUS,
          highlightColor: settings.HIGHLIGHT_COLOR,
        });
      }
    }

    // 5. Re-inject blur rules when config changed while blur-all is active
    const modeChanged = old.BLUR_MODE !== settings.BLUR_MODE;
    const thoroughChanged = old.THOROUGH_BLUR !== settings.THOROUGH_BLUR;
    if (isPageBlurred && (catsChanged || modeChanged || thoroughChanged)) {
      Engine.unblurAll();
      Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
      Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
      stopDomObserver();
      startDomObserver();
    }

    // 6. Clear stale reveal state on mode change
    if (old.REVEAL_MODE !== settings.REVEAL_MODE) {
      clearRevealedAncestors();
      _unrevealAll();
      _hoverRevealedEl = null;
      clickRevealedEl = null;
    }

    // 7. DOM observer
    if (settings.ENABLED && isPageBlurred) {
      startDomObserver();
    } else if (!settings.ENABLED) {
      stopDomObserver();
    }

    // 7. Disable cleanup
    if (!settings.ENABLED) {
      dismissClickReveal();
      Engine.unblurAll();
      isPageBlurred = false;
    }
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  async function init() {
    log.log('init() starting');

    // 1. Load settings and URL rules from storage.
    try {
      const [loaded, loadedRules] = await Promise.all([
        Store.getSettings(),
        Store.getRules(),
      ]);
      if (loadedRules) rules = loadedRules;
      if (loaded) globalSettings = loaded;
      // Resolve: URL rule overrides > global settings > defaults
      settings = resolveSettings(location.href, globalSettings, rules);
    } catch (_e) {
      // Background not ready — use defaults.
    }

    // 2. Apply CSS custom properties from settings.
    applySettingsToDom();

    // 3. Register message listener from background / popup.
    chrome.runtime.onMessage.addListener(handleMessage);

    // 4. Track the last right-clicked element for context menu blur/unblur.
    document.addEventListener('contextmenu', (e) => {
      lastContextMenuTarget = e.target instanceof Element ? e.target : null;
    }, true);

    // 5. If the extension is disabled, stop here.
    if (settings.ENABLED === false) return;

    // 6. Initialise keyboard shortcut handler.
    Shortcuts.init(settings.SHORTCUTS, shortcutActionMap);

    // 7. Restore previously blurred elements for this hostname.
    await restoreBlurredElements();

    // 8. Restore blur-all state for this hostname.
    try {
      const wasBlurAll = await Store.getBlurState(hostname);
      if (wasBlurAll && !isPageBlurred) {
        Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
        Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
        isPageBlurred = true;
      }
    } catch (_e) {
      // Storage unavailable — skip restore
    }

    // 9. Start DOM observer for dynamic content.
    startDomObserver();

    // 9. Register reveal handlers (both modes use event delegation on document).
    document.addEventListener('click', onRevealClick);
    document.addEventListener('keydown', onRevealKeydown);
    document.addEventListener('mouseover', onRevealMouseOver);
    document.addEventListener('mouseout', onRevealMouseOut);
  }

  // ─── SPA URL change detection ──────────────────────────────────────────────────
  // When the URL changes without a full navigation (SPA), re-resolve settings
  // from URL rules so per-site overrides take effect.

  let lastUrl = location.href;

  function onUrlChange() {
    if (!Engine) return;
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    log.log('URL change:', lastUrl, '→', currentUrl);
    lastUrl = currentUrl;

    try {
      const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
      const resolved = resolveSettings(currentUrl, globalSettings, rules);
      applyState(resolved, prev);
    } catch (err) {
      console.warn('[PrivacyBlur] URL change handler error:', err.message, err.stack);
    }
  }

  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

  // Wrap history.pushState/replaceState for SPA frameworks (YouTube, React Router, etc.)
  // that navigate without firing popstate.
  // Wrap history methods for SPA detection. Use try-catch so a bug in our
  // handler never breaks the page's own navigation.
  const _origPushState = history.pushState;
  const _origReplaceState = history.replaceState;
  history.pushState = function() {
    const result = _origPushState.apply(this, arguments);
    try { onUrlChange(); } catch (_) {}
    return result;
  };
  history.replaceState = function() {
    const result = _origReplaceState.apply(this, arguments);
    try { onUrlChange(); } catch (_) {}
    return result;
  };

  // ─── Storage change listener (cross-tab sync) ──────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Engine) return;

    let needsResolve = false;
    const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };

    if (changes.rules) {
      rules = changes.rules.newValue || [];
      needsResolve = true;
    }

    if (changes.settings && changes.settings.newValue) {
      globalSettings = MSG.deepMerge(globalSettings, changes.settings.newValue);
      needsResolve = true;
    }

    if (needsResolve) {
      const resolved = resolveSettings(location.href, globalSettings, rules);
      applyState(resolved, prev);
    }
  });

  // ─── DOM-ready guard ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
