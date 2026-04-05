/**
 * privacyblur — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * their window.PrivacyBlur* globals, which are loaded before this script via
 * the manifest.json content_scripts load order.
 */

(() => {
  'use strict';

  const MSG = window.PrivacyBlur;
  const CATEGORY_KEYS = Object.keys(window.PrivacyBlurEngine.CATEGORY_SELECTORS);
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

  // ─── Module aliases ──────────────────────────────────────────────────────────

  let Engine   = null;
  let Store    = null;
  let Selector = null;
  let Picker   = null;
  let Shortcuts = null;

  // ─── Restore blurred elements ────────────────────────────────────────────────

  async function restoreBlurredElements() {
    try {
      const selectors = await Store.getBlurredSelectors(hostname);
      if (!selectors || selectors.length === 0) return;

      for (const selector of selectors) {
        const el = Selector.restoreSelector(selector);
        if (el && canBlurMore()) {
          Engine.applyBlur(el, settings.BLUR_RADIUS, settings.BLUR_MODE);
          blurredElementCount++;
          observeElement(el);
          if (settings.REVEAL_MODE === RM.HOVER) {
            el.classList.add(CLS.REVEAL_ON_HOVER);
          }
        }
      }
    } catch (err) {
      // Storage unavailable or context invalidated — fail silently.
    }
  }

  // ── Performance: off-screen unblur via IntersectionObserver ─────────────────
  // When enabled, elements scrolled off-screen lose their blur (compositing
  // layer freed). When they scroll back, blur is re-applied. This keeps the
  // active compositing layer count bounded on infinite-scroll pages.

  let visibilityObserver = null;
  /** Set of elements currently unblurred because they're off-screen */
  const offscreenElements = new Set();

  function startVisibilityObserver() {
    if (visibilityObserver || !settings.PERFORMANCE.OFFSCREEN_UNBLUR) return;

    visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting) {
          // Back on screen — re-apply blur
          if (offscreenElements.has(el)) {
            offscreenElements.delete(el);
            el.classList.add(CLS.BLURRED);
            if (settings.BLUR_MODE === BM.FROSTED) el.classList.add(CLS.FROSTED);
            if (settings.REVEAL_MODE === RM.HOVER) el.classList.add(CLS.REVEAL_ON_HOVER);
          }
        } else {
          // Off screen — remove blur to free compositing layer
          if (el.classList.contains(CLS.BLURRED)) {
            offscreenElements.add(el);
            el.classList.remove(CLS.BLURRED, CLS.FROSTED, CLS.REVEAL_ON_HOVER);
          }
        }
      }
    }, {
      // rootMargin: observe slightly beyond viewport to pre-blur before visible
      rootMargin: '200px',
    });
  }

  function stopVisibilityObserver() {
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
    // Re-blur any elements that were temporarily unblurred
    for (const el of offscreenElements) {
      if (el.isConnected) {
        el.classList.add(CLS.BLURRED);
        if (settings.BLUR_MODE === BM.FROSTED) el.classList.add(CLS.FROSTED);
        if (settings.REVEAL_MODE === RM.HOVER) el.classList.add(CLS.REVEAL_ON_HOVER);
      }
    }
    offscreenElements.clear();
  }

  /** Track a blurred element with the visibility observer */
  function observeElement(el) {
    if (visibilityObserver && el instanceof Element) {
      visibilityObserver.observe(el);
    }
  }

  // ── Performance: element cap ──────────────────────────────────────────────
  // Tracks the total number of blurred elements. When MAX_BLURRED is reached,
  // new elements are not blurred. 0 = unlimited.

  let blurredElementCount = 0;

  function canBlurMore() {
    const max = settings.PERFORMANCE.MAX_BLURRED;
    return max === 0 || blurredElementCount < max;
  }

  // ── Batched MutationObserver ────────────────────────────────────────────────

  // CHUNK_SIZE read from settings (configurable, default 50)
  let pendingNodes = [];
  let processingScheduled = false;

  function processBlurChunk() {
    processingScheduled = false;
    // Capture state at entry — isPageBlurred may toggle mid-chunk via a
    // message handler running between rAF callbacks.
    const wasPageBlurred = isPageBlurred;
    if (!wasPageBlurred || pendingNodes.length === 0) {
      pendingNodes = [];
      return;
    }

    const chunkSize = settings.PERFORMANCE.CHUNK_SIZE || 50;
    const chunk = pendingNodes.splice(0, chunkSize);

    for (let i = 0; i < chunk.length; i++) {
      const node = chunk[i];
      if (!node.isConnected) continue;
      if (!canBlurMore()) break; // element cap reached

      if (Engine.shouldBlurElement(node, settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR)) {
        Engine.applyBlur(node, settings.BLUR_RADIUS, settings.BLUR_MODE);
        if (settings.REVEAL_MODE === RM.HOVER) node.classList.add(CLS.REVEAL_ON_HOVER);
        blurredElementCount++;
        observeElement(node);
      }
    }

    if (pendingNodes.length > 0) {
      processingScheduled = true;
      requestAnimationFrame(processBlurChunk);
    }
  }

  /** Combined CSS selector for observer descendant queries. Built from
   *  CATEGORY_SELECTORS to avoid querySelectorAll('*'). Rebuilt when
   *  categories change via buildObserverSelector(). */
  let observerSelector = '';

  function buildObserverSelector() {
    const cats = settings.BLUR_CATEGORIES;
    const tags = [];
    const CS = Engine.CATEGORY_SELECTORS;
    for (const key of CATEGORY_KEYS) {
      if (!cats[key]) continue;
      const cat = CS[key];
      for (let i = 0; i < cat.alwaysBlur.length; i++) tags.push(cat.alwaysBlur[i]);
      for (let i = 0; i < cat.textCheck.length; i++) tags.push(cat.textCheck[i]);
    }
    observerSelector = tags.join(',');
  }

  function startDomObserver() {
    if (domObserver) return; // Already running — use restartDomObserver() to rebuild
    buildObserverSelector();

    domObserver = new MutationObserver((mutations) => {
      if (isPickerActive) return;
      if (!isPageBlurred) return;

      for (const mutation of mutations) {
        // Handle new nodes added to the DOM
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Queue the node itself. For descendants, use the cached combined
            // selector instead of querySelectorAll('*') to avoid quadratic
            // complexity when large subtrees are inserted.
            pendingNodes.push(node);
            if (observerSelector) {
              const children = node.querySelectorAll(observerSelector);
              for (let i = 0; i < children.length; i++) {
                pendingNodes.push(children[i]);
              }
            }
          }
        }

        // Handle text content changes in existing elements (SPA re-renders)
        // When a SPA like YouTube updates text in place, the parent element
        // may already exist but now has new content that should be blurred.
        if (mutation.type === 'characterData') {
          const parent = mutation.target.parentElement;
          if (parent && parent.isConnected && !Engine.isBlurred(parent)) {
            pendingNodes.push(parent);
          }
        }

        // Handle attribute changes that may indicate re-rendered content
        // (e.g. SPA frameworks swapping aria-label, title, or data attributes)
        if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const el = mutation.target;
          if (el.isConnected && !Engine.isBlurred(el)) {
            pendingNodes.push(el);
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
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'alt', 'placeholder', 'value'],
    });
  }

  function stopDomObserver() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    pendingNodes = [];
    processingScheduled = false;
  }

  /** Stop and restart the observer with fresh selector and config. */
  function restartDomObserver() {
    stopDomObserver();
    startDomObserver();
  }

  // ─── Picker callbacks ─────────────────────────────────────────────────────────

  const pickerCallbacks = {
    onBlur(el) {
      if (!canBlurMore()) return;
      Engine.applyBlur(el, settings.BLUR_RADIUS, settings.BLUR_MODE);
      blurredElementCount++;
      observeElement(el);
      if (settings.REVEAL_MODE === RM.HOVER) {
        el.classList.add(CLS.REVEAL_ON_HOVER);
      }
      const selector = Selector.getSelector(el);
      if (selector) {
        Store.saveBlurredElement(hostname, selector).catch(() => {});
      }
    },

    onUnblur(el) {
      el.classList.remove(CLS.REVEAL_ON_HOVER);
      Engine.removeBlur(el);
      if (blurredElementCount > 0) blurredElementCount--;
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

  function findBlurredAncestor(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node instanceof Element && node.classList.contains(CLS.BLURRED)) return node;
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
      revealedAncestors[i].classList.remove(CLS.ANCESTOR_REVEAL);
    }
    revealedAncestors = [];
  }

  function revealAncestorChain(el) {
    clearRevealedAncestors();
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (node.classList.contains(CLS.BLURRED)) {
        node.classList.add(CLS.ANCESTOR_REVEAL);
        revealedAncestors.push(node);
      }
      node = node.parentElement;
    }
  }

  function dismissClickReveal() {
    if (clickRevealedEl) {
      clickRevealedEl.classList.remove(CLS.REVEALED);
      clickRevealedEl = null;
    }
    clearRevealedAncestors();
  }

  function onRevealClick(e) {
    if (settings.REVEAL_MODE !== RM.CLICK) return;
    if (isPickerActive) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const blurredEl = target.closest('.pb-blurred');
    if (!blurredEl) return;

    if (blurredEl === clickRevealedEl) {
      dismissClickReveal();
      return;
    }

    dismissClickReveal();
    blurredEl.classList.add(CLS.REVEALED);
    clickRevealedEl = blurredEl;
    revealAncestorChain(blurredEl);
  }

  function onRevealKeydown(e) {
    if (e.key === 'Escape' && clickRevealedEl) {
      dismissClickReveal();
    }
  }

  function onRevealMouseOver(e) {
    if (settings.REVEAL_MODE !== RM.HOVER) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    const revealTarget = target.closest('.pb-reveal-on-hover');
    if (!revealTarget) return;

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
          stopVisibilityObserver();
          Engine.unblurAll();
          blurredElementCount = 0;
          offscreenElements.clear();
          pendingNodes = [];
          isPageBlurred = false;
        } else {
          // Ensure observer is running to catch SPA re-renders
          buildObserverSelector();
          startDomObserver();
          Engine.blurAllContent(settings.BLUR_RADIUS, {
            categories: settings.BLUR_CATEGORIES,
            thoroughBlur: settings.THOROUGH_BLUR,
            blurMode: settings.BLUR_MODE,
          });
          // Track and observe all blurred elements
          blurredElementCount = 0;
          document.querySelectorAll('.pb-blurred').forEach((el) => {
            blurredElementCount++;
            if (settings.REVEAL_MODE === RM.HOVER) el.classList.add(CLS.REVEAL_ON_HOVER);
            observeElement(el);
          });
          isPageBlurred = true;
          if (settings.PERFORMANCE.OFFSCREEN_UNBLUR) startVisibilityObserver();
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
        document.querySelectorAll('.pb-reveal-on-hover').forEach((el) => {
          el.classList.remove(CLS.REVEAL_ON_HOVER);
        });
        dismissClickReveal();
        stopVisibilityObserver();
        Engine.unblurAll();
        blurredElementCount = 0;
        offscreenElements.clear();
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
        const blurredCount = document.querySelectorAll('.pb-blurred').length;
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
                  Engine.blurAllContent(settings.BLUR_RADIUS, { categories: settings.BLUR_CATEGORIES, thoroughBlur: settings.THOROUGH_BLUR, blurMode: settings.BLUR_MODE });
                  applyRevealClasses();
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
        if (target && target instanceof Element && canBlurMore()) {
          Engine.applyBlur(target, settings.BLUR_RADIUS, settings.BLUR_MODE);
          blurredElementCount++;
          observeElement(target);
          if (settings.REVEAL_MODE === RM.HOVER) {
            target.classList.add(CLS.REVEAL_ON_HOVER);
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
          unblurTarget.classList.remove(CLS.REVEAL_ON_HOVER);
          Engine.removeBlur(unblurTarget);
          if (blurredElementCount > 0) blurredElementCount--;
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
              el.classList.remove(CLS.REVEAL_ON_HOVER);
              Engine.removeBlur(el);
              if (blurredElementCount > 0) blurredElementCount--;
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

  /** Apply reveal-on-hover class to all blurred elements based on current reveal mode. */
  function applyRevealClasses() {
    const isHover = settings.REVEAL_MODE === RM.HOVER;
    document.querySelectorAll('.pb-blurred').forEach(el => {
      el.classList.toggle(CLS.REVEAL_ON_HOVER, isHover);
    });
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
      // Restart observer so it uses the new selector for descendant queries
      if (domObserver) restartDomObserver();
      else buildObserverSelector();
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

    // 5. DOM observer + visibility observer
    if (settings.ENABLED) {
      startDomObserver();
      if (settings.PERFORMANCE.OFFSCREEN_UNBLUR) {
        startVisibilityObserver();
      } else {
        stopVisibilityObserver();
      }
    } else {
      stopDomObserver();
      stopVisibilityObserver();
    }

    // 6. Re-blur when config changed while blur-all is active
    const thoroughChanged = old.THOROUGH_BLUR !== settings.THOROUGH_BLUR;
    const radiusChanged = old.BLUR_RADIUS !== settings.BLUR_RADIUS;
    const modeChanged = old.BLUR_MODE !== settings.BLUR_MODE;
    if (isPageBlurred && (catsChanged || thoroughChanged || radiusChanged || modeChanged)) {
      stopVisibilityObserver(); // disconnect before re-blur to avoid thrashing
      offscreenElements.clear();
      pendingNodes = []; // Clear stale queued nodes before re-blur
      blurredElementCount = 0;
      Engine.unblurAll();
      Engine.blurAllContent(settings.BLUR_RADIUS, {
        categories: settings.BLUR_CATEGORIES,
        thoroughBlur: settings.THOROUGH_BLUR,
        blurMode: settings.BLUR_MODE,
      });
      // Re-count and observe all newly blurred elements
      document.querySelectorAll('.pb-blurred').forEach(el => {
        blurredElementCount++;
        observeElement(el);
      });
      if (settings.PERFORMANCE.OFFSCREEN_UNBLUR) startVisibilityObserver();
    }

    // 7. Reveal mode management (always runs — covers both re-blur and mode-only changes)
    applyRevealClasses();
    if (settings.REVEAL_MODE !== RM.CLICK) dismissClickReveal();

    // 8. Disable cleanup
    if (!settings.ENABLED) dismissClickReveal();
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  async function init() {
    Engine    = window.PrivacyBlurEngine;
    Store     = window.PrivacyBlurStorage;
    Selector  = window.PrivacyBlurSelectorUtils;
    Picker    = window.PrivacyBlurPicker;
    Shortcuts = window.PrivacyBlurShortcuts;

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
        Engine.blurAllContent(settings.BLUR_RADIUS, {
          categories: settings.BLUR_CATEGORIES,
          thoroughBlur: settings.THOROUGH_BLUR,
          blurMode: settings.BLUR_MODE,
        });
        applyRevealClasses();
        isPageBlurred = true;
        // Count and observe all blurred elements
        blurredElementCount = 0;
        document.querySelectorAll('.pb-blurred').forEach(el => {
          blurredElementCount++;
          observeElement(el);
        });
        if (settings.PERFORMANCE.OFFSCREEN_UNBLUR) startVisibilityObserver();
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
    lastUrl = currentUrl;

    const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
    const resolved = resolveSettings(currentUrl, globalSettings, rules);
    applyState(resolved, prev);
  }

  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

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
