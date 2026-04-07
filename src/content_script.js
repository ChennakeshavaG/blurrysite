/**
 * blurrysite — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * the blsi.* namespace, loaded before this script via manifest.json.
 */

(() => {
  'use strict';

  const MSG = blsi;
  const CATEGORY_KEYS = Object.keys(blsi.BlurEngine.CATEGORY_SELECTORS);
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

  /** Guard: skip storage.onChanged repaint when we just wrote the data ourselves */
  let _ownStorageWrite = false;

  /** Hostname used as the storage key for persisted blur items */
  const hostname = location.hostname;

  /** Auto-naming counters for blur items (per session, seeded from storage on init) */
  let dynamicCounter = 0;
  let stickyCounter = 0;

  // ─── Module aliases (synchronous — loaded before this script by manifest) ──

  const Engine    = blsi.BlurEngine;
  const Store     = blsi.Storage;
  const Selector  = blsi.SelectorUtils;
  const Picker    = blsi.Picker;
  const Shortcuts = blsi.Shortcuts;

  // ─── Repaint: single source of truth ──────────────────────────────────────────
  // Reads ALL blur state from storage and re-renders the DOM to match.
  // Called after every storage write. Storage is the authority; DOM derives from it.

  async function repaint() {
    // Mark that we're doing a local repaint — suppress storage.onChanged echo
    _ownStorageWrite = true;
    setTimeout(() => { _ownStorageWrite = false; }, 100);

    try {
      // 1. Capture transient reveal state before clearing
      const revealSnapshot = Array.from(_revealedElements);
      const wasClickRevealed = clickRevealedEl;
      const wasHoverRevealed = _hoverRevealedEl;

      // 2. Read current blur state from storage
      const [items, blurAllActive] = await Promise.all([
        Store.getBlurItems(hostname),
        Store.getBlurState(hostname),
      ]);

      // 3. Clean slate — remove all blur artifacts from DOM
      dismissClickReveal();
      _unrevealAll();
      _hoverRevealedEl = null;
      clickRevealedEl = null;
      stopDomObserver();
      Engine.unblurAll();

      // 4. Seed counters from stored items
      dynamicCounter = 0;
      stickyCounter = 0;

      // 5. Restore dynamic items (selector-based)
      if (items && items.length > 0) {
        for (const item of items) {
          if (item.type === 'dynamic') {
            try {
              const el = Selector.restoreSelector(item.selector);
              if (el) Engine.applyBlur(el);
            } catch (_e) { /* invalid selector */ }
            const num = parseInt((item.name || '').replace('Dynamic ', ''), 10);
            if (!isNaN(num) && num > dynamicCounter) dynamicCounter = num;
          }
        }
      }

      // 6. Restore sticky items (coordinate-based)
      if (items && items.length > 0) {
        const curW = document.documentElement.scrollWidth || window.innerWidth;
        const curH = document.documentElement.scrollHeight || window.innerHeight;

        for (const item of items) {
          if (item.type !== 'sticky') continue;

          // Path-tolerance check
          if (item.path) {
            const stored = item.path.replace(/\/+$/, '') || '/';
            const current = location.pathname.replace(/\/+$/, '') || '/';
            if (stored !== current) continue;
          }

          const x = (typeof item.xPct === 'number') ? item.xPct * curW : item.x;
          const y = (typeof item.yPct === 'number') ? item.yPct * curH : item.y;
          const w = (typeof item.widthPct === 'number') ? item.widthPct * curW : item.width;
          const h = (typeof item.heightPct === 'number') ? item.heightPct * curH : item.height;

          Engine.createZoneOverlay({
            id: item.id, name: item.name,
            x: Math.round(x), y: Math.round(y),
            width: Math.round(w), height: Math.round(h),
          });

          const num = parseInt((item.name || '').replace('Sticky ', ''), 10);
          if (!isNaN(num) && num > stickyCounter) stickyCounter = num;
        }
      }

      // 7. If blur-all active, inject CSS rules + stamp text-check elements
      if (blurAllActive) {
        Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
        Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
        startDomObserver();
        isPageBlurred = true;
      } else {
        isPageBlurred = false;
      }

      // 8. Restore transient reveal state (inline style overrides survive repaint)
      for (const el of revealSnapshot) {
        if (!document.contains(el)) continue;
        _revealElement(el);
      }
      if (wasClickRevealed && document.contains(wasClickRevealed)) {
        clickRevealedEl = wasClickRevealed;
      }
      if (wasHoverRevealed && document.contains(wasHoverRevealed)) {
        _hoverRevealedEl = wasHoverRevealed;
      }

    } catch (err) {
      log.warn('repaint error:', err.message);
    }
  }

  // ── Logger alias ──────────────────────────────────────────────────────────
  const log = blsi.Logger;

  // ── MutationObserver: stamp data-bl-si-blur on new text-check elements ──────
  // Always-blur tags are handled by CSS rules (auto-apply, no JS needed).
  // Text-check tags need the hasMeaningfulTextContent gate, so MO watches
  // for new ones and stamps data-bl-si-blur. Uses data attribute instead of
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
          // Skip zone overlay elements — they are our own injected divs
          if (node.dataset && node.dataset.blSiZone !== undefined) continue;
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

  function _generateZoneId() {
    return 's_' + Math.random().toString(36).slice(2, 10);
  }

  const pickerCallbacks = {
    async onBlur(el) {
      const selector = Selector.getSelector(el);
      if (!selector) return;
      dynamicCounter++;
      const item = { type: 'dynamic', name: 'Dynamic ' + dynamicCounter, selector };
      await Store.saveBlurItem(hostname, item);
      await repaint();
    },

    async onUnblur(el) {
      const selector = Selector.getSelector(el);
      if (!selector) return;
      await Store.removeBlurItem(hostname, selector);
      await repaint();
    },

    async onStickyBlur(zoneRect) {
      stickyCounter++;
      const id = _generateZoneId();
      const name = 'Sticky ' + stickyCounter;
      const scrollW = zoneRect.scrollWidth;
      const scrollH = zoneRect.scrollHeight;

      const item = {
        type: 'sticky', name: name, id: id,
        x: zoneRect.x, y: zoneRect.y,
        width: zoneRect.width, height: zoneRect.height,
        xPct: scrollW ? zoneRect.x / scrollW : 0,
        yPct: scrollH ? zoneRect.y / scrollH : 0,
        widthPct: scrollW ? zoneRect.width / scrollW : 0,
        heightPct: scrollH ? zoneRect.height / scrollH : 0,
        scrollWidth: scrollW, scrollHeight: scrollH,
        path: location.pathname,
      };

      await Store.saveBlurItem(hostname, item);
      await repaint();
      Shortcuts.showToast(name);
    },

    async onStickyUnblur(zoneId) {
      await Store.removeBlurItem(hostname, zoneId);
      await repaint();
    },

    onModeChange(mode) {
      settings.PICKER_MODE = mode;
      Store.saveSettings(settings);
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

  /** Find the nearest blurred element (data-bl-si-blur or CSS-rule-blurred tag) */
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

  function _isZoneOverlay(el) {
    return el && el.dataset && el.dataset.blSiZone !== undefined;
  }

  /** Unified reveal — works for both regular blurred elements and zone overlays. */
  function _revealElement(el) {
    if (_isZoneOverlay(el)) {
      el.style.setProperty('backdrop-filter', 'none', 'important');
      el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    } else {
      el.style.setProperty('filter', 'none', 'important');
      // Reveal ALL blurred descendants (data-bl-si-blur + CSS tag rules)
      el.querySelectorAll('*').forEach(child => {
        if (Engine.isBlurred(child)) {
          child.style.setProperty('filter', 'none', 'important');
          _revealedElements.add(child);
        }
      });
    }
    _revealedElements.add(el);
  }

  /** Unified unreveal — restores CSS-applied blur for both types. */
  function _unrevealElement(el) {
    if (_isZoneOverlay(el)) {
      el.style.removeProperty('backdrop-filter');
      el.style.removeProperty('-webkit-backdrop-filter');
    } else {
      el.style.removeProperty('filter');
      el.style.removeProperty('transition');
      // Clean up descendants
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

  /** Find the zone overlay at the given viewport coordinates, if any. */
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

  function onRevealClick(e) {
    if (settings.REVEAL_MODE !== RM.CLICK) return;
    if (isPickerActive) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' ||
        tag === 'button' || target.isContentEditable) return;

    // Check zone overlays first (they have pointer-events: none, so check coords)
    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (zone === clickRevealedEl) {
        dismissClickReveal();
      } else {
        dismissClickReveal();
        _revealElement(zone);
        clickRevealedEl = zone;
      }
      return;
    }

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

    if (mouseoutTimer) {
      clearTimeout(mouseoutTimer);
      mouseoutTimer = null;
    }

    // Check zone overlays first (pointer-events: none, so use coords)
    const zone = _findZoneAtPoint(e.clientX, e.clientY);
    if (zone) {
      if (_hoverRevealedEl === zone) return;
      _dismissHoverReveal();
      _revealElement(zone);
      _hoverRevealedEl = zone;
      return;
    }

    // Mouse is NOT over any zone or has moved to a different element.
    // If something was revealed, dismiss immediately instead of waiting
    // for the 50ms mouseout timer (which gets reset on every element boundary).
    const blurredRoot = findBlurredTarget(target);
    if (_hoverRevealedEl && _hoverRevealedEl !== blurredRoot) {
      _dismissHoverReveal();
      // Fall through to reveal new target if it's blurred
    }

    if (!blurredRoot) return;

    if (_hoverRevealedEl === blurredRoot) return;

    _dismissHoverReveal();
    _revealElement(blurredRoot);
    _hoverRevealedEl = blurredRoot;
    revealAncestorChain(blurredRoot);
  }

  function _dismissHoverReveal() {
    if (_hoverRevealedEl) {
      _unrevealAll();
      clearRevealedAncestors();
      _hoverRevealedEl = null;
    }
  }

  function onRevealMouseOut(e) {
    if (!_hoverRevealedEl) return;
    if (mouseoutTimer) clearTimeout(mouseoutTimer);
    mouseoutTimer = setTimeout(() => {
      mouseoutTimer = null;
      _dismissHoverReveal();
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
        (async () => {
          await Store.saveBlurState(hostname, !isPageBlurred);
          await repaint();
          if (sendResponse) sendResponse({ isPageBlurred });
        })();
        return true; // async
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
            pickerMode: settings.PICKER_MODE,
          }, pickerCallbacks);
          isPickerActive = true;
          Shortcuts._setPickerActive(true);
        }
        if (sendResponse) sendResponse({ isPickerActive });
        break;
      }

      // ── Clear all blur on this page ───────────────────────────────────────
      case MSG.CLEAR_ALL_BLUR: {
        (async () => {
          await Store.clearHost(hostname);
          await Store.saveBlurState(hostname, false);
          await repaint();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true; // async
      }

      // ── Re-apply persisted blur items ──────────────────────────────────
      case MSG.RESTORE: {
        repaint().then(() => {
          if (sendResponse) sendResponse({ ok: true });
        });
        return true; // async
      }

      // ── Status query ──────────────────────────────────────────────────────
      case MSG.GET_STATUS: {
        const blurredCount = document.querySelectorAll('[data-bl-si-blur]').length;
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

            // Restore blur state when re-enabled
            if (!wasEnabled && settings.ENABLED) {
              await repaint();
            }

            if (sendResponse) sendResponse({ ok: true });
          })();
        }
        return true; // async handler
      }

      // ── Context menu: blur the right-clicked element ─────────────────────
      case MSG.CONTEXT_BLUR: {
        (async () => {
          const target = lastContextMenuTarget;
          lastContextMenuTarget = null;
          if (target) {
            const sel = Selector.getSelector(target);
            if (sel) {
              dynamicCounter++;
              const item = { type: 'dynamic', name: 'Dynamic ' + dynamicCounter, selector: sel };
              await Store.saveBlurItem(hostname, item);
              await repaint();
            }
          }
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true; // async
      }

      // ── Context menu: unblur the right-clicked element ────────────────────
      case MSG.CONTEXT_UNBLUR: {
        (async () => {
          const target = lastContextMenuTarget;
          lastContextMenuTarget = null;
          if (!target) {
            if (sendResponse) sendResponse({ ok: false, reason: 'no_target' });
            return;
          }
          const unblurTarget = findBlurredTarget(target);
          if (unblurTarget) {
            const sel = Selector.getSelector(unblurTarget);
            if (sel) {
              await Store.removeBlurItem(hostname, sel);
              await repaint();
            }
          }
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true; // async
      }

      // ── Unblur a specific item (from popup remove button) ────────────────
      case MSG.UNBLUR_ITEM: {
        // Item already removed from storage by popup — just repaint
        repaint().then(() => {
          if (sendResponse) sendResponse({ ok: true });
        });
        return true; // async
      }

      default:
        break;
    }

    return false;
  }

  // ─── Apply CSS custom properties ─────────────────────────────────────────────

  function applySettingsToDom() {
    document.documentElement.style.setProperty('--bl-si-radius', `${settings.BLUR_RADIUS}px`);
    document.documentElement.style.setProperty('--bl-si-highlight-color', settings.HIGHLIGHT_COLOR);
    document.documentElement.style.setProperty('--bl-si-transition-duration', `${settings.TRANSITION_DURATION}ms`);
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

    // 5. Re-render when blur-related config changes while blur-all is active
    const modeChanged = old.BLUR_MODE !== settings.BLUR_MODE;
    const thoroughChanged = old.THOROUGH_BLUR !== settings.THOROUGH_BLUR;
    if (isPageBlurred && (catsChanged || modeChanged || thoroughChanged)) {
      repaint();
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

    // 7. Repaint: restore all blur state from storage (items + blur-all + zones).
    await repaint();

    // 8. Register reveal handlers (both modes use event delegation on document).
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
      console.warn('[BlurrySite] URL change handler error:', err.message, err.stack);
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

    // Repaint when blur items or blur-all state change (cross-tab sync only)
    if ((changes.blurred_items || changes.blur_all_hosts) && !_ownStorageWrite) {
      repaint();
    }
  });

  // ─── DOM-ready guard ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
