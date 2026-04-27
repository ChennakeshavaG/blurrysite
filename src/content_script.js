/**
 * blurrysite — content_script.js
 *
 * Main content script injected into every page. Coordinates all modules via
 * the blsi.* namespace, loaded before this script via manifest.json.
 */

(() => {
  'use strict';

  // ── Immutable page constants ───────────────────────────────────────────────

  /** Hostname used as the storage key for persisted blur items */
  const hostname = location.hostname;

  /** True when running in the top-level document, false inside any iframe */
  const IS_MAIN_FRAME = window === window.top;

  /** True when the page is running as an installed PWA (standalone display mode) */
  const IS_PWA = IS_MAIN_FRAME && window.matchMedia('(display-mode: standalone)').matches;

  // ── Module aliases (synchronous — loaded before this script by manifest) ──

  const Engine    = blsi.Engine;
  const Store     = blsi.Model;
  const Selector  = blsi.SelectorUtils;
  const Picker    = blsi.Picker;
  const Shortcuts = blsi.Shortcuts;
  const Reveal    = blsi.Reveal;
  const log       = blsi.Logger.scope('content');

  // ── Mutable state ─────────────────────────────────────────────────────────

  /** @type {object} Resolved settings for the current URL (snake_case keys). */
  let settings = blsi.build_default_model().global_default_settings;

  /** Whether the element picker is currently active */
  let isPickerActive = false;

  /** Last element the user right-clicked — used by the context menu blur handler */
  let lastContextMenuTarget = null;

  /** Shadow DOM host element for the in-page settings panel (PWA only) */
  let _pwaPanelHost = null;

  /** Debounce timer for SPA URL-change detection */
  let _urlChangeTimer = null;

  /**
   * Tracks whether this tab is currently rendering screen-share automate blur
   * (per the resolved state). Used to gate toast firing — only show on the
   * non-blurred → blurred transition, not on every NOTIFY ping.
   */
  let _ssCurrentlyBlurring = false;

  /**
   * Top-level page hostname — used exclusively for blur_all_hosts lookup so
   * cross-origin iframes follow the parent page's blur-all state rather than
   * their own. Seeded from document.referrer on initial load; updated via
   * postMessage from the main frame thereafter.
   */
  let _topHostname = IS_MAIN_FRAME
    ? location.hostname
    : (() => { try { return new URL(document.referrer).hostname; } catch (_) { return ''; } })();

  /** Last observed URL — SPA navigation change detection */
  let lastUrl = location.href;

  // Gates AutoBlur.init/destroy so unrelated storage echoes don't restart the idle timer.
  let _autoBlurCfgKey = null;

  // Idle toast fires once per focused visit; reset on tab-switch-and-back.
  let _idleToastShown = false;
  if (IS_MAIN_FRAME) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _idleToastShown = false;
    });
  }

  // ── State helpers ──────────────────────────────────────────────────────────

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

  function _to_seconds(value, unit) {
    if (unit === 'min') return value * 60;
    return value; // sec
  }

  // Builds an i18n toast string and appends "(site rule)" when the relevant
  // resolved field came from a site rule snapshot (per resolved._rule_overrides).
  function _toastMsg(toastKey, overrideKey) {
    const base = chrome.i18n.getMessage(toastKey) || toastKey;
    const ov = settings && settings._rule_overrides;
    if (overrideKey && ov && ov[overrideKey]) {
      const suffix = chrome.i18n.getMessage('toast_suffix_site_rule') || '(site rule)';
      return base + ' ' + suffix;
    }
    return base;
  }

  // ── Screen share helpers ───────────────────────────────────────────────────

  /**
   * Returns the 3 screen-share-blur stop actions for the automate toast.
   * Built at call time so i18n strings are resolved after init.
   *
   * Scope semantics (mirrored in popup notif card):
   *   - 'tab'           → suppress ALL automate triggers for this tab (broad).
   *   - 'site_session'  → suppress screen-share for this hostname (session).
   *   - 'feature'       → flip automate.settings.screen_share.enabled = false.
   */
  async function _ssBlurStopActions() {
    const myTabId = blsi.ScreenShare && blsi.ScreenShare.getTabId
      ? blsi.ScreenShare.getTabId()
      : null;
    return [
      {
        label: chrome.i18n.getMessage('automate_stop_per_tab'),
        onClick: async () => {
          await Store.suppress_screen_share('tab', { tab_id: myTabId, hostname });
          await _sync();
        },
      },
      {
        label: chrome.i18n.getMessage('automate_stop_site_session'),
        onClick: async () => {
          await Store.suppress_screen_share('site_session', { hostname, tab_id: myTabId });
          await _sync();
        },
      },
      {
        label: chrome.i18n.getMessage('automate_disable_feature'),
        variant: 'warn',
        onClick: async () => {
          await Store.suppress_screen_share('feature', { hostname, tab_id: myTabId });
          await _sync();
        },
      },
    ];
  }

  // ── Core sync ─────────────────────────────────────────────────────────────

  /**
   * Resolves settings and drives the engine. Accepts a pre-resolved snapshot
   * from applyState to avoid a redundant Store.resolve() call; re-resolves
   * from storage when called directly (picker callbacks, message handlers).
   */
  async function _sync(preResolved) {
    const tabId = blsi.ScreenShare && blsi.ScreenShare.getTabId
      ? blsi.ScreenShare.getTabId()
      : null;
    const resolved = preResolved || Store.resolve(_topHostname, location.href, tabId);
    settings = resolved;
    _ssCurrentlyBlurring = !!(resolved.automate_blur_triggers && resolved.automate_blur_triggers.screen_share);
    await Engine.handleSite(resolved);
  }

  // ── Picker callbacks ──────────────────────────────────────────────────────

  function _generateZoneId() {
    return 's_' + Math.random().toString(36).slice(2, 10);
  }

  const pickerCallbacks = {
    async onBlur(el) {
      const selectors = Selector.getSelectors(el);
      if (!selectors.length) return;
      const name = Engine.allocateElementName();
      const item = { type: 'dynamic', name, selectors };
      log.flow('picker.blur', { name, selectors });
      await Store.save_blur_item(hostname, item);
      await _sync();
    },

    async onUnblur(el) {
      const selectors = Selector.getSelectors(el);
      if (!selectors.length) return;
      log.flow('picker.unblur', { selectors });
      await Store.remove_blur_item(hostname, selectors[0]);
      await _sync();
    },

    async onStickyBlur(zoneRect) {
      const id = _generateZoneId();
      const scrollW = zoneRect.scrollWidth;
      const scrollH = zoneRect.scrollHeight;
      const anchor = zoneRect.anchor === 'screen' ? 'screen' : 'page';
      const name = Engine.allocateStickyName(anchor);
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

    async onModeChange(mode) {
      log.flow('picker.modeChange', { mode });
      await Store.patch_section('pick_and_blur', { settings: { picker_mode: mode } });
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
    'blur-selection'() {
      handleMessage({ type: blsi.command.blur_selection }, null, () => {});
    },
    onExitPicker() {
      if (isPickerActive) {
        Picker.deactivate(); // fires pickerCallbacks.onDeactivate → setPickerActive(false)
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
    // chrome.storage.onChanged and postMessage from the main frame. Stay
    // silent (no sendResponse) so an iframe can never racewin the response
    // when a caller forgets `frameId: 0` and broadcasts to all frames.
    if (!IS_MAIN_FRAME) return false;

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

    if (settings.enabled === false && type !== blsi.popup.get_status && type !== blsi.command.toggle_panel
        && type !== blsi.popup.highlight_item && type !== blsi.popup.clear_highlight) {
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
        const _tabId = blsi.ScreenShare && blsi.ScreenShare.getTabId ? blsi.ScreenShare.getTabId() : null;
        const resolved = Store.resolve(_topHostname, location.href, _tabId);
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
        if (sendResponse) sendResponse({ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount: Engine.blurredCount });
        break;
      }

      // ── Popup list hover highlight ──────────────────────────────────────
      case blsi.popup.highlight_item: {
        Engine.highlightItem(message);
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      case blsi.popup.clear_highlight: {
        Engine.clearItemHighlight();
        if (sendResponse) sendResponse({ ok: true });
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
        const sels = Selector.getSelectors(target);
        if (!sels.length) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_selector' });
          return false;
        }
        const name = Engine.allocateElementName();
        const item = { type: 'dynamic', name, selectors: sels };
        log.flow('trigger.contextBlur', { name, selectors: sels });
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
          return false;
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
        const unblurSels = Selector.getSelectors(unblurTarget);
        if (!unblurSels.length) {
          if (sendResponse) sendResponse({ ok: false, reason: 'no_selector' });
          return false;
        }
        log.flow('trigger.contextUnblur', { selectors: unblurSels });
        (async () => {
          await Store.remove_blur_item(hostname, unblurSels[0]);
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

      // ── PWA settings panel toggle ───────────────────────────────────────
      case blsi.command.toggle_panel: {
        if (_pwaPanelHost) {
          _pwaPanelHost.hidden = !_pwaPanelHost.hidden;
          log.flow('trigger.togglePanel', { hidden: _pwaPanelHost.hidden });
        }
        if (sendResponse) sendResponse({ ok: true });
        break;
      }

      // ── Screen share notify (background broadcast) ─────────────────────
      // Toast trigger only — actual blur state comes from Store.resolve()
      // which reads the session record. Storage onChanged also re-syncs in
      // tabs that miss this message; this handler ensures the toast fires
      // exactly once per non-blurred → blurred transition.
      case blsi.command.screen_share_notify: {
        log.flow('trigger.screenShareNotify');
        (async () => {
          const wasBlurring = _ssCurrentlyBlurring;
          await _sync();
          const nowBlurring = _ssCurrentlyBlurring;
          if (!wasBlurring && nowBlurring) {
            const actions = await _ssBlurStopActions();
            Shortcuts.showToast(_toastMsg('automate_toast_screen_share', 'automate_screen_share'), 15000, actions);
          } else if (!nowBlurring && settings && settings.automate_blur_skipped &&
                     settings.automate_blur_skip_reason && !wasBlurring) {
            Shortcuts.showToast(_toastMsg('automate_toast_skipped', 'automate_screen_share'), 2500);
          }
          if (sendResponse) sendResponse({ ok: true });
        })();
        return true;
      }

      default:
        break;
    }

    return false;
  }

  // Applies resolved settings to shortcuts, picker, reveal, autoBlur, PII, then
  // forwards the same snapshot to _sync() to update CSS vars + engine. Idempotent.
  // Callers must `await` — concurrent invocations corrupt engine's _activeItems Map.
  async function applyState(resolved, prev) {
    const old = prev || settings;
    const changedKeys = [];
    for (const k of Object.keys(resolved)) {
      if (JSON.stringify(old[k]) !== JSON.stringify(resolved[k])) changedKeys.push(k);
    }
    if (changedKeys.length) log.flow('settings.apply', { changed: changedKeys });

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
        if (old.picker_mode !== resolved.picker_mode) {
          Picker.setMode(resolved.picker_mode);
        }
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

    // Single resolve — pass the snapshot through so _sync() doesn't re-resolve.
    await _sync(resolved);

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

      const cfgKey = JSON.stringify({
        enabled: !!resolved.enabled,
        idle:    { enabled: !!idle.enabled, value: idle.value, unit: idle.unit },
        tab:     !!tab_switch.enabled,
      });
      if (cfgKey !== _autoBlurCfgKey) {
        _autoBlurCfgKey = cfgKey;
        if ((idle.enabled || tab_switch.enabled) && resolved.enabled) {
          blsi.AutoBlur.init({
            idleTimeout: _to_seconds(idle.value || 5, idle.unit || 'min'),
            tabSwitch: !!tab_switch.enabled,
            idle: !!idle.enabled,
            onIdle: async ({ reason } = {}) => {
              const trigger = reason || 'idle';
              await Store.save_automate_blur(hostname, trigger, true);
              await _sync();
              const toastKey = trigger === 'tab_switch'
                ? 'automate_toast_tab_switch'
                : 'automate_toast_idle';
              const ovKey = trigger === 'tab_switch' ? 'automate_tab_switch' : 'automate_idle';
              if (trigger === 'idle' && _idleToastShown) return;
              if (settings.automate_blur_only)    Shortcuts.showToast(_toastMsg(toastKey, ovKey), 2500);
              if (settings.automate_blur_skipped) Shortcuts.showToast(_toastMsg('automate_toast_skipped', ovKey), 2500);
              if (trigger === 'idle') _idleToastShown = true;
            },
            onActive: async () => {
              await Store.patch_automate_blur(hostname, { idle: false, tab_switch: false });
              await _sync();
            },
          });
        } else {
          blsi.AutoBlur.destroy();
          _idleToastShown = false;
        }
      }
    }

    // PII auto-detection — scan after blur reconciliation so PII spans don't
    // conflict with the blur engine's text-check stamping. PII detector owns
    // no observer; it subscribes to blur_engine's mutation dispatcher to
    // receive raw MutationRecord[] for every active root (document + shadow
    // roots), with characterData included so typed text in contenteditable
    // is detected without a reload.
    const anyDetect = resolved.pii_email || resolved.pii_numeric;
    if (anyDetect && resolved.enabled) {
      blsi.Engine.injectPiiRules(resolved.pii_mode, resolved.pii_redaction_color);
      blsi.PiiDetector.scan(document.body, { email: resolved.pii_email, numeric: resolved.pii_numeric });
      blsi.Engine.subscribeMutations('pii', blsi.PiiDetector.handleMutations);
    } else {
      blsi.Engine.unsubscribeMutations('pii');
      blsi.Engine.removePiiRules();
      // document.body can be momentarily null in early-disable paths during
      // teardown — guard so a throw here doesn't leak the unsubscribe state
      // (already done above) and leave stale [data-bl-si-pii] spans on screen.
      try { blsi.PiiDetector.clear(document.body); } catch (_) {}
    }
  }

  // ── PWA settings panel ────────────────────────────────────────────────────

  function _injectPwaPanel() {
    const host = document.createElement('div');
    host.id = 'bl-si-pwa-panel-host';
    host.hidden = true;
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = [
      ':host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483647;display:block}',
      ':host([hidden]){display:none!important}',
      '.w{position:relative;display:inline-block}',
      '.c{position:absolute;top:-10px;right:-10px;z-index:1;width:22px;height:22px;',
      'border-radius:50%;background:#1e1e2e;color:#fff;border:1.5px solid rgba(255,255,255,0.18);',
      'cursor:pointer;font-size:13px;line-height:1;padding:0;display:flex;',
      'align-items:center;justify-content:center;',
      'box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:system-ui,-apple-system,sans-serif}',
      '.c:hover{background:#2d2d44}',
      'iframe{width:320px;height:580px;border:none;border-radius:16px;display:block;',
      'box-shadow:0 8px 40px rgba(0,0,0,0.35),0 2px 12px rgba(0,0,0,0.15)}',
    ].join('');

    const wrap = document.createElement('div');
    wrap.className = 'w';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'c';
    closeBtn.setAttribute('aria-label',
      chrome.i18n.getMessage('aria_close_pwa_panel') || 'Close Blurry Site settings');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => { host.hidden = true; });

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('popup/popup.html');

    wrap.appendChild(closeBtn);
    wrap.appendChild(iframe);
    shadow.appendChild(style);
    shadow.appendChild(wrap);
    document.body.appendChild(host);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !host.hidden) { host.hidden = true; }
    }, true);

    return host;
  }

  async function _checkPwaHint() {
    const result = await chrome.storage.local.get('blsi_pwa_hint_shown');
    if (result && result.blsi_pwa_hint_shown) return;
    await chrome.storage.local.set({ blsi_pwa_hint_shown: true });
    const isMac = typeof navigator !== 'undefined' &&
      navigator.platform && navigator.platform.toLowerCase().includes('mac');
    const shortcut = isMac ? '⌥⇧O' : 'Alt+Shift+O';
    const msg = chrome.i18n.getMessage('toast_pwa_hint', shortcut)
      || ('PWA — right-click or press ' + shortcut + ' to open settings');
    Shortcuts.showToast(msg);
  }

  // ── iframe postMessage broadcast ──────────────────────────────────────────

  function _broadcastToFrames() {
    if (!window.frames.length) return;
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i].postMessage(
          { type: 'BLSI_SETTINGS_CHANGED', topHostname: location.hostname }, location.origin
        );
      } catch (_) {}
    }
  }

  // ── Storage change subscriber ──────────────────────────────────────────────
  // Any real (non-echo) change to the model = full re-resolve + applyState.

  async function handleStorageChange(newModel, _oldModel) {
    if (!Engine) return;

    const _tabId = blsi.ScreenShare && blsi.ScreenShare.getTabId ? blsi.ScreenShare.getTabId() : null;
    const resolved = Store.resolve(_topHostname, location.href, _tabId);
    const prev = { ...settings };

    // Detect language change for i18n re-init.
    if (IS_MAIN_FRAME && blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      const newLang = newModel && newModel.global_default_settings && newModel.global_default_settings.language;
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

  // ── SPA URL change detection ───────────────────────────────────────────────

  function onUrlChange() {
    clearTimeout(_urlChangeTimer);
    _urlChangeTimer = setTimeout(async () => {
      if (!Engine) return;
      const currentUrl = location.href;
      if (currentUrl === lastUrl) return;
      log.flow('spa.urlChange', { from: lastUrl, to: currentUrl });
      lastUrl = currentUrl;
      try {
        const prev = { ...settings };
        const _tabId = blsi.ScreenShare && blsi.ScreenShare.getTabId ? blsi.ScreenShare.getTabId() : null;
        const resolved = Store.resolve(_topHostname, currentUrl, _tabId);
        await applyState(resolved, prev);
      } catch (err) {
        console.warn('[BlurrySite] URL change handler error:', err.message, err.stack);
      }
    }, 150);
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

  // ── Initialisation ─────────────────────────────────────────────────────────

  async function init() {
    log.flow('init.start', { href: location.href, hostname });
    // Signal to perf tests (and any page listeners) that the content script is
    // beginning initialization. Anchors blur_ms timer in run-fixture.js.
    document.dispatchEvent(new CustomEvent('bl-si-init-start'));

    // 1. Populate storage cache (single read of all tracked keys).
    //    Concurrently resolve our own tab id via background WHO_AM_I so
    //    Store.resolve() can apply per-tab automate suppression and identify
    //    the sharing tab on initial load (mid-share catch-up).
    try {
      await Promise.all([
        Store.init_cache(),
        IS_MAIN_FRAME && blsi.ScreenShare && blsi.ScreenShare.whoAmI
          ? blsi.ScreenShare.whoAmI()
          : Promise.resolve(),
      ]);
    } catch (_e) { /* fall through with empty cache */ }

    // 2. Resolve settings for the current URL from cached model.
    const _initTabId = blsi.ScreenShare && blsi.ScreenShare.getTabId ? blsi.ScreenShare.getTabId() : null;
    const resolved = Store.resolve(_topHostname, location.href, _initTabId);
    settings = resolved;

    // 2b. Initialize the content-script i18n helper — main frame only because
    //     the picker toolbar (the only consumer) is main-frame only.
    if (IS_MAIN_FRAME && blsi.ContentI18n && typeof blsi.ContentI18n.init === 'function') {
      try { await blsi.ContentI18n.init(resolved.language); }
      catch (_e) { /* picker falls back to English literals */ }
    }

    // 3b. In PWA mode, inject the shadow DOM settings panel early so the
    //     message handler can toggle it as soon as it's registered.
    if (IS_PWA) {
      _pwaPanelHost = _injectPwaPanel();
    }

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

    // 9b. Catch-up toast for tabs opened mid-share. resolve() already factored
    //     the live session record during applyState; just fire the toast if
    //     this tab landed in screen-share-blur on initial load.
    if (IS_MAIN_FRAME && _ssCurrentlyBlurring && settings.automate_blur_only) {
      const _initActions = await _ssBlurStopActions();
      Shortcuts.showToast(chrome.i18n.getMessage('automate_toast_screen_share'), 15000, _initActions);
    }

    // 9c. Show one-time PWA hint after Shortcuts is initialized (applyState
    //     calls Shortcuts.init so showToast is available).
    if (IS_PWA) _checkPwaHint();

    // 10. Subscribe AFTER initial restore so we don't race with cross-tab events
    //     during the cold-start window.
    Store.on_change(handleStorageChange);

    // 11a. Iframes: listen for topHostname updates from the main frame.
    if (!IS_MAIN_FRAME) {
      window.addEventListener('message', async (event) => {
        if (event.source !== window.parent) return;
        if (!event.data || event.data.type !== 'BLSI_SETTINGS_CHANGED') return;
        _topHostname = event.data.topHostname || _topHostname;
        await _sync();
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

  // ── DOM-ready guard ────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
