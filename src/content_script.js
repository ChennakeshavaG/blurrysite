/**
 * blurrysite — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * the blsi.* namespace, loaded before this script via manifest.json.
 */

(() => {
  'use strict';

  const MSG = blsi;
  const UrlMatcher = blsi.UrlMatcher;
  const Reveal = blsi.Reveal;

  // ─── State ──────────────────────────────────────────────────────────────────

  /** @type {object} Global settings from storage (no URL rule overrides). */
  let globalSettings = MSG.buildDefaultSettings();

  /** @type {object} Resolved settings (global + URL rule overrides for current URL). */
  let settings = MSG.buildDefaultSettings();

  /** @type {Array} URL rules loaded from storage */
  let rules = [];

  /** Whether the element picker is currently active */
  let isPickerActive = false;

  /** Last element the user right-clicked — used by the context menu blur handler */
  let lastContextMenuTarget = null;

  /**
   * Single source of truth for picker-active state. Updates the local flag,
   * the shortcut handler's escape-key gate, AND the blur engine's observer
   * gate in one call. Any path that deactivates the picker MUST go through
   * this — callers that update only a subset leave the observer silent for
   * subsequent DOM mutations.
   */
  function setPickerActive(active) {
    isPickerActive = active;
    Shortcuts._setPickerActive(active);
    Engine._setPickerActiveForObserver(active);
  }

  /** Hostname used as the storage key for persisted blur items */
  const hostname = location.hostname;

  // ─── Module aliases (synchronous — loaded before this script by manifest) ──

  const Engine    = blsi.BlurEngine;
  const Store     = blsi.Storage;
  const Selector  = blsi.SelectorUtils;
  const Picker    = blsi.Picker;
  const Shortcuts = blsi.Shortcuts;

  // ── Logger alias ──────────────────────────────────────────────────────────
  const log = blsi.Logger.scope('content');

  /**
   * Reads the current blur state + items from storage and calls Engine.handleSite()
   * with the resolved settings. All _reconcile() call sites have been replaced
   * with this helper — storage is the single source of truth; handleSite is pure.
   */
  async function _reconcile() {
    const [isActive, items] = await Promise.all([
      Store.getBlurState(hostname),
      Store.getBlurItems(hostname),
    ]);
    await Engine.handleSite({ ...settings, BLUR_ALL_ACTIVE: isActive, BLUR_ITEMS: items });
  }

  // ─── Picker callbacks ─────────────────────────────────────────────────────────

  function _generateZoneId() {
    return 's_' + Math.random().toString(36).slice(2, 10);
  }

  const pickerCallbacks = {
    async onBlur(el) {
      const selector = Selector.getSelector(el);
      if (!selector) return;
      const name = Engine.allocateDynamicName();
      const item = { type: 'dynamic', name, selector };
      log.flow('picker.blur', { name, selector });
      await Store.saveBlurItem(hostname, item);
      await _reconcile();
    },

    async onUnblur(el) {
      const selector = Selector.getSelector(el);
      if (!selector) return;
      log.flow('picker.unblur', { selector });
      await Store.removeBlurItem(hostname, selector);
      await _reconcile();
    },

    async onStickyBlur(zoneRect) {
      const name = Engine.allocateStickyName();
      const id = _generateZoneId();
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

      log.flow('picker.stickyBlur', { name, id, rect: { x: zoneRect.x, y: zoneRect.y, w: zoneRect.width, h: zoneRect.height } });
      await Store.saveBlurItem(hostname, item);
      await _reconcile();
      Shortcuts.showToast(name);
    },

    async onStickyUnblur(zoneId) {
      log.flow('picker.stickyUnblur', { zoneId });
      await Store.removeBlurItem(hostname, zoneId);
      await _reconcile();
    },

    onModeChange(mode) {
      log.flow('picker.modeChange', { mode });
      // Save only the picker mode change to globalSettings (not resolved settings,
      // which would leak URL-rule overrides into global storage).
      globalSettings.PICKER_MODE = mode;
      Store.saveSettings(globalSettings);
    },

    onDeactivate() {
      log.flow('picker.deactivate');
      setPickerActive(false);
    },
  };

  // ─── Keyboard shortcut action map ────────────────────────────────────────────
  // Each entry is keyed by an action id from blsi.Actions. The shortcut handler
  // fires the function for the matching action, and this dispatch table re-enters
  // handleMessage so every trigger (JS shortcut, manifest command, popup relay)
  // converges on the same message-handling code path.

  const shortcutActionMap = {
    TOGGLE_BLUR_ALL() {
      handleMessage({ type: MSG.TOGGLE_BLUR_ALL }, null, () => {});
    },
    TOGGLE_PICKER() {
      handleMessage({ type: MSG.TOGGLE_PICKER }, null, () => {});
    },
    async CLEAR_ALL() {
      log.flow('trigger.clearAll', { source: 'shortcut', hostname });
      await Store.clearHost(hostname);
      await Store.saveBlurState(hostname, false);
      await _reconcile();
    },
    async SCREENSHOT() {
      try {
        const dataUrl = await blsi.Screenshot.captureViewport();
        blsi.Screenshot.download(dataUrl);
      } catch (_e) {
        log.error('Screenshot capture failed', _e);
      }
    },
    onExitPicker() {
      if (isPickerActive) {
        Picker.deactivate();
        isPickerActive = false;
      }
    },
  };

  // ─── Message handler ──────────────────────────────────────────────────────────

  // Dedup trigger messages between the JS shortcut matcher and chrome.commands.
  //
  // When the user presses a bound chord, two independent paths may fire:
  //   (A) JS matcher in shortcut_handler.js → fires synchronously → calls its
  //       callback which re-enters handleMessage.
  //   (B) chrome.commands in the manifest → browser dispatches to
  //       background.js → relays via chrome.tabs.sendMessage → handleMessage.
  //
  // Both paths enter handleMessage. We stamp globalThis.__blsiShortcutFire
  // [actionId] with performance.now() on the FIRST entry for a given type,
  // and dedup subsequent entries within a 500ms window.
  //
  // Path (A) enters first (synchronous), stamps, handles the action. Path (B)
  // arrives microseconds-to-milliseconds later, sees the fresh stamp, drops.
  //
  // The popup button and context-menu paths also enter handleMessage, stamp,
  // and handle — no competing second path, no dedup triggered.
  //
  // The mapping from messageType back to actionId comes from the action registry.
  const RELAY_DEDUP_MS = 500;
  const MESSAGE_TO_ACTION_ID = (() => {
    const out = {};
    if (blsi.Actions && blsi.Actions.list) {
      for (const a of blsi.Actions.list()) out[a.messageType] = a.id;
    }
    return out;
  })();

  function handleMessage(message, _sender, sendResponse) {
    const { type } = message;
    log.flow('msg.in', { type });

    // Fire-token dedup for trigger messages. Check-then-stamp: a fresh stamp
    // means a prior handleMessage call (same tick/ms) already handled this
    // action — drop this one as a duplicate relay.
    const actionId = MESSAGE_TO_ACTION_ID[type];
    if (actionId) {
      const fireTokens = globalThis.__blsiShortcutFire || (globalThis.__blsiShortcutFire = {});
      const nowTs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      const last = fireTokens[actionId];
      if (typeof last === 'number' && (nowTs - last) < RELAY_DEDUP_MS) {
        if (sendResponse) sendResponse({ ok: true, deduped: true });
        return false;
      }
      fireTokens[actionId] = nowTs;
    }

    if (settings.ENABLED === false && type !== MSG.GET_STATUS) {
      if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
      return false;
    }

    switch (type) {
      // ── Toggle blur-all mode ──────────────────────────────────────────────
      // Write storage, then reconcile DOM via _reconcile().
      case MSG.TOGGLE_BLUR_ALL: {
        const newState = !Engine.isPageBlurred;
        log.flow('trigger.toggleBlurAll', { nextState: newState, hostname });
        (async () => {
          await Store.saveBlurState(hostname, newState);
          await _reconcile();
          if (sendResponse) sendResponse({ isPageBlurred: newState });
        })();
        return true;
      }

      // ── Toggle element picker ─────────────────────────────────────────────
      case MSG.TOGGLE_PICKER: {
        log.flow('trigger.togglePicker', { nextState: !isPickerActive, mode: settings.PICKER_MODE });
        if (isPickerActive) {
          Picker.deactivate();
          setPickerActive(false);
        } else {
          Picker.activate({
            blurRadius: settings.BLUR_RADIUS,
            highlightColor: settings.HIGHLIGHT_COLOR,
            pickerMode: settings.PICKER_MODE,
          }, pickerCallbacks);
          setPickerActive(true);
        }
        if (sendResponse) sendResponse({ isPickerActive });
        break;
      }

      // ── Status query ──────────────────────────────────────────────────────
      case MSG.GET_STATUS: {
        const blurredCount = document.querySelectorAll('[data-bl-si-blur]').length;
        if (sendResponse) sendResponse({ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount });
        break;
      }

      // ── Clear all blur on this page (Alt+Shift+U keyboard relay) ──────────
      case MSG.CLEAR_ALL_BLUR: {
        log.flow('trigger.clearAll', { source: 'message', hostname });
        (async () => {
          await Store.clearHost(hostname);
          await Store.saveBlurState(hostname, false);
          await _reconcile();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      // ── Context menu: blur the right-clicked element ─────────────────────
      case MSG.CONTEXT_BLUR: {
        const target = lastContextMenuTarget;
        lastContextMenuTarget = null;
        if (!target) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_target' });
          return false;
        }
        const sel = Selector.getSelector(target);
        if (!sel) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_selector' });
          return false;
        }
        const name = Engine.allocateDynamicName();
        const item = { type: 'dynamic', name, selector: sel };
        log.flow('trigger.contextBlur', { name, selector: sel });
        (async () => {
          await Store.saveBlurItem(hostname, item);
          await _reconcile();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      // ── Context menu: unblur the right-clicked element ────────────────────
      case MSG.CONTEXT_UNBLUR: {
        const target = lastContextMenuTarget;
        lastContextMenuTarget = null;
        if (!target) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_target' });
          break;
        }
        // Walk up from target to nearest blurred ancestor.
        let unblurTarget = null;
        let node = target;
        while (node && node !== document.documentElement) {
          if (node instanceof Element && Engine.isBlurred(node)) { unblurTarget = node; break; }
          node = node.parentElement;
        }
        if (!unblurTarget) {
          if (sendResponse) sendResponse({ ok: false, reason: 'not_blurred' });
          return false;
        }
        const sel = Selector.getSelector(unblurTarget);
        if (!sel) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_selector' });
          return false;
        }
        log.flow('trigger.contextUnblur', { selector: sel });
        (async () => {
          await Store.removeBlurItem(hostname, sel);
          await _reconcile();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      case MSG.BLUR_SELECTION: {
        log.flow('trigger.blurSelection');
        const result = blsi.SelectionBlur.blurSelection();
        if (sendResponse) sendResponse({ ok: !!result });
        return false;
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
    document.documentElement.style.setProperty('--bl-si-redaction-color', settings.REDACTION_COLOR);
  }

  // ─── Idempotent state application ─────────────────────────────────────────────
  // Thin coordinator — applies resolved settings to CSS vars, shortcuts, picker,
  // reveal, then awaits _reconcile() to reconcile DOM. Idempotent. Async —
  // all callers must `await` so onChange events don't start overlapping reconciles.

  async function applyState(newSettings, prev) {
    const old = prev || settings;
    const changedKeys = [];
    for (const k of Object.keys(newSettings)) {
      if (JSON.stringify(old[k]) !== JSON.stringify(newSettings[k])) changedKeys.push(k);
    }
    if (changedKeys.length) log.flow('settings.apply', { changed: changedKeys });
    settings = newSettings;

    // CSS custom properties (cheap, idempotent)
    applySettingsToDom();

    // Shortcuts (init is already idempotent — destroy + re-create)
    if (settings.ENABLED) {
      Shortcuts.init(settings.SHORTCUTS, shortcutActionMap);
    } else {
      Shortcuts.destroy();
    }

    // Picker settings (if active)
    if (isPickerActive) {
      if (!settings.ENABLED) {
        Picker.deactivate();
        setPickerActive(false);
      } else {
        Picker.setSettings({
          blurRadius: settings.BLUR_RADIUS,
          highlightColor: settings.HIGHLIGHT_COLOR,
        });
      }
    }

    // Tab privacy (hide title + favicon)
    if (settings.TAB_PRIVACY && settings.ENABLED) {
      blsi.TabPrivacy.enable();
    } else {
      blsi.TabPrivacy.disable();
    }

    // Clear stale reveal state on mode change / disable
    if (old.REVEAL_MODE !== settings.REVEAL_MODE || !settings.ENABLED) {
      Reveal.clearAll();
    }

    // Delegate blur reconciliation to _reconcile() — reads storage, calls handleSite.
    await _reconcile();

    // Auto-blur (idle / tab switch)
    if ((settings.AUTO_BLUR_IDLE || settings.AUTO_BLUR_TAB_SWITCH) && settings.ENABLED) {
      blsi.AutoBlur.init({
        idleTimeout: settings.IDLE_TIMEOUT_SECONDS,
        tabSwitch: settings.AUTO_BLUR_TAB_SWITCH,
        idle: settings.AUTO_BLUR_IDLE,
        onIdle: async () => {
          await Store.saveBlurState(hostname, true);
          await _reconcile();
        },
        onActive: async () => {
          await Store.saveBlurState(hostname, false);
          await _reconcile();
        },
      });
    } else {
      blsi.AutoBlur.destroy();
    }

    // Blur timer
    if (settings.BLUR_TIMER_MINUTES > 0 && settings.ENABLED) {
      if (!blsi.BlurTimer.isActive()) {
        blsi.BlurTimer.start(settings.BLUR_TIMER_MINUTES, async () => {
          await Store.saveBlurState(hostname, false);
          await _reconcile();
        });
      }
    } else if (settings.BLUR_TIMER_MINUTES === 0) {
      blsi.BlurTimer.stop();
    }

    // PII auto-detection — scan after blur reconciliation so PII spans don't
    // conflict with the blur engine's text-check stamping.
    const anyDetect = settings.AUTO_DETECT && (
      settings.AUTO_DETECT.EMAIL ||
      (settings.AUTO_DETECT.NUMERIC && settings.AUTO_DETECT.NUMERIC !== 'off')
    );
    if (anyDetect && settings.ENABLED) {
      blsi.PiiDetector.scan(document.body, settings.AUTO_DETECT);
      blsi.PiiDetector.observeMutations(document.body);
    } else {
      blsi.PiiDetector.stopObserving();
      blsi.PiiDetector.clear(document.body);
    }
  }

  // ─── Initialisation ───────────────────────────────────────────────────────────

  async function init() {
    log.flow('init.start', { href: location.href, hostname });

    // 1. Populate storage cache (single read of all tracked keys).
    try {
      await Store.initCache();
    } catch (_e) { /* fall through with empty cache */ }

    // 2. Load settings and URL rules (now hits cache, no I/O).
    try {
      const [loaded, loadedRules] = await Promise.all([
        Store.getSettings(),
        Store.getRules(),
      ]);
      if (loadedRules) rules = loadedRules;
      if (loaded) globalSettings = loaded;
      // Resolve: URL rule overrides > global settings > defaults
      settings = UrlMatcher.resolveSettings(location.href, globalSettings, rules);
    } catch (_e) {
      // Storage read failed — use defaults.
    }

    // 2b. Initialize the content-script i18n helper with the user's chosen
    //     LANGUAGE. Picker toolbar reads from blsi.ContentI18n at build time,
    //     so this must complete before the picker is ever activated.
    if (blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      try { await blsi.ContentI18n.init(globalSettings.LANGUAGE); }
      catch (_e) { /* picker falls back to English literals */ }
    }

    // 3. Apply CSS custom properties from settings.
    applySettingsToDom();

    // 4. Register message listener from background / popup.
    chrome.runtime.onMessage.addListener(handleMessage);

    // 5. Register reveal handlers regardless of ENABLED — they early-return if
    //    the extension is disabled, but enabling later via storage change must
    //    not require re-registering.
    Reveal.init({
      getMode: () => settings.REVEAL_MODE,
      isPickerActive: () => isPickerActive,
    });

    // 6. Track the last right-clicked element for context menu blur/unblur.
    document.addEventListener('contextmenu', (e) => {
      lastContextMenuTarget = e.target instanceof Element ? e.target : null;
    }, true);

    // 7. If the extension is disabled, subscribe to changes (so re-enable works)
    //    but skip shortcuts + blur restore.
    if (settings.ENABLED === false) {
      Store.onChange(handleStorageChange);
      return;
    }

    // 8–9. Apply all stored settings — single authoritative call that covers
    //      blur restore, PII scan, AutoBlur, BlurTimer, shortcuts, and CSS vars.
    //      applyState(settings, null): old = prev ?? settings → changedKeys = []
    //      → logging skipped, every block runs unconditionally. _reconcile() is
    //      called inside, so no separate reconcile step is needed.
    Engine.resetCounters();
    await applyState(settings, null);

    // 10. Subscribe AFTER initial restore so we don't race with cross-tab events
    //     during the cold-start window.
    Store.onChange(handleStorageChange);

    log.flow('init.done', {
      enabled: settings.ENABLED,
      revealMode: settings.REVEAL_MODE,
      pickerMode: settings.PICKER_MODE,
      ruleCount: rules.length,
    });
  }

  // ─── Storage change subscriber ────────────────────────────────────────────────
  // Routes changes: settings/rules go through applyState for URL-rule resolution;
  // items/blur-all delegate directly to _reconcile() (reconciler handles diffing
  // internally). Async — always await the downstream call.

  async function handleStorageChange(key, newValue) {
    if (!Engine) return;
    switch (key) {
      case 'settings':
        await onSettingsChanged(newValue);
        break;
      case 'rules':
        await onRulesChanged(newValue);
        break;
      case 'blurred_items':
      case 'blur_all_hosts':
        await _reconcile();
        break;
    }
  }

  async function onSettingsChanged(newRawSettings) {
    log.flow('storage.settingsChanged');
    const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
    // Merge incoming raw settings over defaults, then validate. Replaces
    // globalSettings entirely so removed/renamed keys don't accumulate.
    const merged = MSG.deepMerge(MSG.DEFAULT_SETTINGS, newRawSettings || {});
    const nextGlobal = MSG.validateSettings(merged);
    const langChanged = nextGlobal.LANGUAGE !== globalSettings.LANGUAGE;
    globalSettings = nextGlobal;

    // Re-init the content-script i18n helper if LANGUAGE flipped, then
    // rebuild the picker toolbar in place if it's active so the new
    // locale shows up without the user having to close + reopen.
    if (langChanged && blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      try { await blsi.ContentI18n.init(globalSettings.LANGUAGE); }
      catch (_e) { /* keep stale strings, picker degrades to English literals */ }
      if (Picker && typeof Picker.rebuildToolbar === 'function' && Picker.isActive) {
        try { Picker.rebuildToolbar(); } catch (_e) {}
      }
    }

    const resolved = UrlMatcher.resolveSettings(location.href, globalSettings, rules);
    await applyState(resolved, prev);
  }

  async function onRulesChanged(newRules) {
    log.flow('storage.rulesChanged', { count: Array.isArray(newRules) ? newRules.length : 0 });
    const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
    rules = Array.isArray(newRules) ? newRules : [];
    const resolved = UrlMatcher.resolveSettings(location.href, globalSettings, rules);
    await applyState(resolved, prev);
  }

  // ─── SPA URL change detection ──────────────────────────────────────────────────
  // When the URL changes without a full navigation (SPA), re-resolve settings
  // from URL rules so per-site overrides take effect.

  let lastUrl = location.href;

  async function onUrlChange() {
    if (!Engine) return;
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    log.flow('spa.urlChange', { from: lastUrl, to: currentUrl });
    lastUrl = currentUrl;

    try {
      const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
      const resolved = UrlMatcher.resolveSettings(currentUrl, globalSettings, rules);
      await applyState(resolved, prev);
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

  // ─── DOM-ready guard ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
