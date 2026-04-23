/**
 * blurrysite — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * the blsi.* namespace, loaded before this script via manifest.json.
 */

(() => {
  'use strict';

  const Reveal = blsi.Reveal;

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {object} Resolved settings for the current URL (snake_case keys). */
  let settings = blsi.build_default_model().settings;

  /** Whether the element picker is currently active */
  let isPickerActive = false;

  /** Last element the user right-clicked — used by the context menu blur handler */
  let lastContextMenuTarget = null;

  /**
   * Single source of truth for picker-active state. Updates the local flag,
   * the shortcut handler's escape-key gate, AND the blur engine's observer
   * gate in one call. Any path that deactivates the picker MUST go through
   * this — callers that update only a subset leave the observer silent for
   * subsequent DOM mutations. No-op in iframes (picker is main-frame only).
   */
  function setPickerActive(active) {
    if (!IS_MAIN_FRAME) return;
    isPickerActive = active;
    Shortcuts._setPickerActive(active);
    Engine._setPickerActiveForObserver(active);
  }

  /** Hostname used as the storage key for persisted blur items */
  const hostname = location.hostname;

  /** True when running in the top-level document, false inside any iframe */
  const IS_MAIN_FRAME = window === window.top;

  /**
   * Top-level page hostname — used exclusively for blur_all_hosts lookup so
   * cross-origin iframes follow the parent page's blur-all state rather than
   * their own. Seeded from document.referrer on initial load; updated via
   * postMessage from the main frame thereafter.
   */
  let _topHostname = IS_MAIN_FRAME
    ? location.hostname
    : (() => { try { return new URL(document.referrer).hostname; } catch (_) { return ''; } })();

  // ── Module aliases (synchronous — loaded before this script by manifest) ──

  const Engine    = blsi.BlurEngine;
  const Store     = blsi.Model;
  const Selector  = blsi.SelectorUtils;
  const Picker    = blsi.Picker;
  const Shortcuts = blsi.Shortcuts;

  // ── Logger alias ──────────────────────────────────────────────────────────
  const log = blsi.Logger.scope('content');

  // ── Unit conversion helper ────────────────────────────────────────────────
  function _to_seconds(value, unit) {
    if (unit === 'hr') return value * 3600;
    if (unit === 'min') return value * 60;
    return value; // sec
  }

  /**
   * Reads the resolved settings from Model.resolve() and calls
   * Engine.handleSite() with the resolved snapshot. Model is the single
   * source of truth; handleSite is pure.
   */
  async function _sync() {
    const resolved = Store.resolve(_topHostname, location.href);
    await Engine.handleSite(resolved);
  }

  // ── Picker callbacks ──────────────────────────────────────────────────────

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
      await Store.save_blur_item(hostname, item);
      await _sync();
    },

    async onUnblur(el) {
      const selector = Selector.getSelector(el);
      if (!selector) return;
      log.flow('picker.unblur', { selector });
      await Store.remove_blur_item(hostname, selector);
      await _sync();
    },

    async onStickyBlur(zoneRect) {
      const name = Engine.allocateStickyName();
      const id = _generateZoneId();
      const scrollW = zoneRect.scrollWidth;
      const scrollH = zoneRect.scrollHeight;

      const anchor = zoneRect.anchor === 'screen' ? 'screen' : 'page';
      const item = {
        type: 'sticky', name: name, id: id,
        anchor: anchor,
        x: zoneRect.x, y: zoneRect.y,
        width: zoneRect.width, height: zoneRect.height,
        xPct: scrollW ? zoneRect.x / scrollW : 0,
        yPct: scrollH ? zoneRect.y / scrollH : 0,
        widthPct: scrollW ? zoneRect.width / scrollW : 0,
        heightPct: scrollH ? zoneRect.height / scrollH : 0,
        scrollWidth: scrollW, scrollHeight: scrollH,
        path: anchor === 'page' ? location.pathname : undefined,
      };

      log.flow('picker.stickyBlur', { name, id, anchor, rect: { x: zoneRect.x, y: zoneRect.y, w: zoneRect.width, h: zoneRect.height }, scrollW, scrollH });
      await Store.save_blur_item(hostname, item);
      await _sync();
      Shortcuts.showToast(name);
    },

    async onStickyUnblur(zoneId) {
      log.flow('picker.stickyUnblur', { zoneId });
      await Store.remove_blur_item(hostname, zoneId);
      await _sync();
    },

    onModeChange(mode) {
      log.flow('picker.modeChange', { mode });
      // Save only the picker mode change into the pick_and_blur feature section.
      Store.patch_section('pick_and_blur', { settings: { picker_mode: mode } });
    },

    onDeactivate() {
      log.flow('picker.deactivate');
      setPickerActive(false);
    },
  };

  // ── Keyboard shortcut action map ──────────────────────────────────────────
  // Each entry is keyed by an action id from blsi.Actions (kebab-case).
  // The shortcut handler fires the function for the matching action, and this
  // dispatch table re-enters handleMessage so every trigger (JS shortcut,
  // manifest command, popup relay) converges on the same message-handling path.

  const shortcutActionMap = {
    'toggle-blur-all'() {
      handleMessage({ type: blsi.command.toggle_blur_all }, null, () => {});
    },
    'toggle-picker'() {
      handleMessage({ type: blsi.command.toggle_picker }, null, () => {});
    },
    async 'clear-all'() {
      log.flow('trigger.clearAll', { source: 'shortcut', hostname });
      await Store.clear_host(hostname);
      await Store.save_blur_state(hostname, false);
      await _sync();
    },
    async screenshot() {
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

  // ── Message handler ────────────────────────────────────────────────────────

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

    // Iframes don't handle chrome.runtime messages — they receive state via
    // chrome.storage.onChanged and postMessage from the main frame.
    if (!IS_MAIN_FRAME) {
      if (sendResponse) sendResponse({ ok: false, reason: 'iframe' });
      return false;
    }

    // Fire-token dedup for trigger messages.
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

    if (settings.enabled === false && type !== blsi.popup.get_status) {
      if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
      return false;
    }

    switch (type) {
      // ── Toggle blur-all mode ────────────────────────────────────────────
      case blsi.command.toggle_blur_all: {
        const newState = !Engine.isPageBlurred;
        log.flow('trigger.toggleBlurAll', { nextState: newState, hostname });
        (async () => {
          await Store.save_blur_state(hostname, newState);
          await _sync();
          if (sendResponse) sendResponse({ isPageBlurred: newState });
        })();
        return true;
      }

      // ── Toggle element picker ───────────────────────────────────────────
      case blsi.command.toggle_picker: {
        const resolved = Store.resolve(hostname, location.href);
        const pickerMode = message.picker_mode || resolved.picker_mode;
        log.flow('trigger.togglePicker', { nextState: !isPickerActive, mode: pickerMode });
        if (isPickerActive) {
          Picker.deactivate();
          setPickerActive(false);
        } else {
          Picker.activate({
            blurRadius: resolved.blur_radius,
            highlightColor: resolved.highlight_color,
            pickerMode: pickerMode,
          }, pickerCallbacks);
          setPickerActive(true);
        }
        if (sendResponse) sendResponse({ isPickerActive });
        break;
      }

      // ── Status query ────────────────────────────────────────────────────
      case blsi.popup.get_status: {
        const blurredCount = document.querySelectorAll('[data-bl-si-blur]').length;
        if (sendResponse) sendResponse({ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount });
        break;
      }

      // ── Clear all blur on this page (keyboard relay) ────────────────────
      case blsi.command.clear_all_blur: {
        log.flow('trigger.clearAll', { source: 'message', hostname });
        (async () => {
          await Store.clear_host(hostname);
          await Store.save_blur_state(hostname, false);
          await _sync();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      // ── Context menu: blur the right-clicked element ────────────────────
      case blsi.command.context_blur: {
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
          await Store.save_blur_item(hostname, item);
          await _sync();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      // ── Context menu: unblur the right-clicked element ──────────────────
      case blsi.command.context_unblur: {
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
          await Store.remove_blur_item(hostname, sel);
          await _sync();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      case blsi.command.blur_selection: {
        log.flow('trigger.blurSelection');
        const result = blsi.SelectionBlur.blurSelection();
        if (sendResponse) sendResponse({ ok: !!result });
        return false;
      }

      // ── Screen share blur (from background fan-out) ─────────────────────
      case blsi.command.screen_share_blur: {
        const am_s = (Store.get().automate || {}).settings || {};
        if ((am_s.screen_share || {}).enabled) {
          log.flow('trigger.screenShareBlur');
          (async () => {
            await Store.save_automate_blur(hostname, 'screen_share', true);
            await _sync();
            if (sendResponse) sendResponse({ ok: true });
          })();
          return true;
        }
        if (sendResponse) sendResponse({ ok: false, reason: 'disabled' });
        break;
      }

      case blsi.command.screen_share_unblur: {
        log.flow('trigger.screenShareUnblur');
        (async () => {
          await Store.save_automate_blur(hostname, 'screen_share', false);
          await _sync();
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      default:
        break;
    }

    return false;
  }

  // ── Apply CSS custom properties ───────────────────────────────────────────

  function applySettingsToDom(resolved) {
    document.documentElement.style.setProperty('--bl-si-radius', `${resolved.blur_radius}px`);
    document.documentElement.style.setProperty('--bl-si-highlight-color', resolved.highlight_color);
    document.documentElement.style.setProperty('--bl-si-transition-duration', `${resolved.transition_duration}ms`);
    document.documentElement.style.setProperty('--bl-si-redaction-color', resolved.redaction_color);
  }

  // ── Idempotent state application ───────────────────────────────────────────
  // Thin coordinator — applies resolved settings to CSS vars, shortcuts, picker,
  // reveal, then awaits _sync() to push storage state to DOM. Idempotent.
  // Async — all callers must `await` so onChange events don't overlap.

  async function applyState(resolved, prev) {
    const old = prev || settings;
    const changedKeys = [];
    for (const k of Object.keys(resolved)) {
      if (JSON.stringify(old[k]) !== JSON.stringify(resolved[k])) changedKeys.push(k);
    }
    if (changedKeys.length) log.flow('settings.apply', { changed: changedKeys });
    settings = resolved;

    // CSS custom properties (cheap, idempotent)
    applySettingsToDom(resolved);

    // Shortcuts — main frame only (iframes don't capture keyboard)
    if (IS_MAIN_FRAME) {
      if (resolved.enabled) {
        Shortcuts.init(resolved.shortcuts, shortcutActionMap);
      } else {
        Shortcuts.destroy();
      }
    }

    // Picker settings (if active)
    if (isPickerActive) {
      if (!resolved.enabled) {
        Picker.deactivate();
        setPickerActive(false);
      } else {
        Picker.setSettings({
          blurRadius: resolved.blur_radius,
          highlightColor: resolved.highlight_color,
        });
      }
    }

    // Tab privacy — main frame only (tab title is a tab-level concern)
    if (IS_MAIN_FRAME) {
      if (resolved.tab_privacy && resolved.enabled) {
        blsi.TabPrivacy.enable();
      } else {
        blsi.TabPrivacy.disable();
      }
    }

    // Clear stale reveal state on mode change / disable
    if (old.reveal_mode !== resolved.reveal_mode || !resolved.enabled) {
      Reveal.clearAll();
    }

    // Delegate blur reconciliation to _sync() — reads resolved model, calls handleSite.
    await _sync();

    // Auto-blur — main frame only (tab-level concerns)
    if (IS_MAIN_FRAME) {
      const screen_share = resolved.automate_screen_share || {};
      const idle = resolved.automate_idle || {};
      const tab_switch = resolved.automate_tab_switch || {};

      // Screen share detection — inject getDisplayMedia wrapper if enabled.
      if (screen_share.enabled && resolved.enabled) {
        blsi.ScreenShare.init();
      } else {
        blsi.ScreenShare.destroy();
      }

      if ((idle.enabled || tab_switch.enabled) && resolved.enabled) {
        blsi.AutoBlur.init({
          idleTimeout: _to_seconds(idle.value || 5, idle.unit || 'min'),
          tabSwitch: !!tab_switch.enabled,
          idle: !!idle.enabled,
          onIdle: async ({ reason } = {}) => {
            await Store.save_automate_blur(hostname, reason || 'idle', true);
            await _sync();
          },
          onActive: async () => {
            await Store.patch_automate_blur(hostname, { idle: false, tab_switch: false });
            await _sync();
          },
        });
      } else {
        blsi.AutoBlur.destroy();
      }
    }

    // PII auto-detection — scan after blur reconciliation so PII spans don't
    // conflict with the blur engine's text-check stamping.
    const anyDetect = resolved.pii_email || resolved.pii_numeric;
    if (anyDetect && resolved.enabled) {
      blsi.BlurEngine.injectPiiRules(resolved.pii_mode, resolved.pii_redaction_color);
      blsi.PiiDetector.scan(document.body, { email: resolved.pii_email, numeric: resolved.pii_numeric });
      blsi.PiiDetector.observeMutations(document.body);
    } else {
      blsi.BlurEngine.removePiiRules();
      blsi.PiiDetector.stopObserving();
      blsi.PiiDetector.clear(document.body);
    }
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  async function init() {
    log.flow('init.start', { href: location.href, hostname });
    // Signal to perf tests (and any page listeners) that the content script is
    // beginning initialization. Anchors blur_ms timer in run-fixture.js.
    document.dispatchEvent(new CustomEvent('bl-si-init-start'));

    // 1. Populate storage cache (single read of all tracked keys).
    try {
      await Store.init_cache();
    } catch (_e) { /* fall through with empty cache */ }

    // 2. Resolve settings for the current URL from cached model.
    const resolved = Store.resolve(_topHostname, location.href);
    settings = resolved;

    // 2b. Initialize the content-script i18n helper — main frame only because
    //     the picker toolbar (the only consumer) is main-frame only.
    if (IS_MAIN_FRAME && blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      try { await blsi.ContentI18n.init(resolved.language); }
      catch (_e) { /* picker falls back to English literals */ }
    }

    // 3. Apply CSS custom properties from resolved settings.
    applySettingsToDom(resolved);

    // 4. Register message listener from background / popup.
    chrome.runtime.onMessage.addListener(handleMessage);

    // 5. Register reveal handlers regardless of enabled — they early-return if
    //    the extension is disabled, but enabling later via storage change must
    //    not require re-registering.
    Reveal.init({
      getMode: () => settings.reveal_mode,
      isPickerActive: () => isPickerActive,
    });

    // 6. Track the last right-clicked element for context menu blur/unblur.
    //    Main frame only — context menu actions are always dispatched to the main frame.
    if (IS_MAIN_FRAME) {
      document.addEventListener('contextmenu', (e) => {
        lastContextMenuTarget = e.target instanceof Element ? e.target : null;
      }, true);
    }

    // 7. If the extension is disabled, subscribe to changes (so re-enable works)
    //    but skip shortcuts + blur restore.
    if (resolved.enabled === false) {
      Store.on_change(handleStorageChange);
      document.dispatchEvent(new CustomEvent('bl-si-ready'));
      return;
    }

    // 8–9. Apply all stored settings — single authoritative call that covers
    //      blur restore, PII scan, AutoBlur, shortcuts, and CSS vars.
    Engine.resetCounters();
    await applyState(resolved, null);

    // 10. Subscribe AFTER initial restore so we don't race with cross-tab events
    //     during the cold-start window.
    Store.on_change(handleStorageChange);

    // 11a. Iframes: listen for topHostname updates from the main frame.
    if (!IS_MAIN_FRAME) {
      window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        if (!event.data || event.data.type !== 'BLSI_SETTINGS_CHANGED') return;
        _topHostname = event.data.topHostname || _topHostname;
        _sync();
      });
    }

    // 11b. Main frame: broadcast topHostname to all child iframes.
    if (IS_MAIN_FRAME) {
      _broadcastToFrames();
    }

    log.flow('init.done', {
      enabled: resolved.enabled,
      revealMode: resolved.reveal_mode,
      pickerMode: resolved.picker_mode,
    });
    // Signal to perf tests that initialization is fully complete (blur applied,
    // shortcuts registered, storage subscription active).
    document.dispatchEvent(new CustomEvent('bl-si-ready'));
  }

  // ── iframe postMessage broadcast ──────────────────────────────────────────

  function _broadcastToFrames() {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i].postMessage(
          { type: 'BLSI_SETTINGS_CHANGED', topHostname: location.hostname }, '*'
        );
      } catch (_) {}
    }
  }

  // ── Storage change subscriber ──────────────────────────────────────────────
  // Any real (non-echo) change to the model = full re-resolve + applyState.
  // The model already contains the truth; we just re-read it.

  async function handleStorageChange(newModel, _oldModel) {
    if (!Engine) return;

    const resolved = Store.resolve(_topHostname, location.href);
    const prev = { ...settings };

    // Detect language change for i18n re-init.
    if (IS_MAIN_FRAME && blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      const newLang = newModel && newModel.settings && newModel.settings.language;
      if (newLang && newLang !== settings.language) {
        try { await blsi.ContentI18n.init(newLang); }
        catch (_e) { /* keep stale strings */ }
        if (Picker && typeof Picker.rebuildToolbar === 'function' && Picker.isActive) {
          try { Picker.rebuildToolbar(); } catch (_e) {}
        }
      }
    }

    await applyState(resolved, prev);

    // Notify child iframes so they re-sync with the updated storage state.
    if (IS_MAIN_FRAME) _broadcastToFrames();
  }

  // ── SPA URL change detection ────────────────────────────────────────────────

  let lastUrl = location.href;

  async function onUrlChange() {
    if (!Engine) return;
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;
    log.flow('spa.urlChange', { from: lastUrl, to: currentUrl });
    lastUrl = currentUrl;

    try {
      const prev = { ...settings };
      const resolved = Store.resolve(hostname, currentUrl);
      await applyState(resolved, prev);
    } catch (err) {
      console.warn('[BlurrySite] URL change handler error:', err.message, err.stack);
    }
  }

  // SPA URL change detection — main frame only.
  if (IS_MAIN_FRAME) {
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

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
  }

  // ── DOM-ready guard ────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
