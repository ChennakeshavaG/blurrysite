'use strict';

// Chrome MV3: runs as service worker — importScripts available.
// Firefox MV3: runs as event page — scripts already loaded by manifest "scripts" array.
if (typeof importScripts === 'function') {
  importScripts(
    'src/constants.js',
    'src/logger.js',
    'src/action_registry.js',
    'src/url_matcher.js',
    'src/automate/state.js',
    'src/automate/idle.js',
    'src/automate/screen_share_bg.js'
  );
}

const log = blsi.Logger.scope('bg');

/**
 * background.js — Blurry Site MV3 Service Worker
 *
 * Responsibilities:
 *  - Relay keyboard command events to the active tab's content script
 *  - Manage the right-click context menu entries
 *  - Screenshot capture relay (captureVisibleTab requires background privileges)
 *
 * Storage I/O is handled by storage_model.js in content_script and popup
 * contexts directly — no storage reads/writes here.
 */

// Allow content scripts to read/write chrome.storage.session (MV3 default is background-only).
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(e => log.warn('setAccessLevel', e && e.message));

// ── Context menu setup ─────────────────────────────────────────────────────
var _menuCreating = false;
function createContextMenus() {
  if (_menuCreating) return;
  _menuCreating = true;
  var _lastErrorCb = () => { if (chrome.runtime.lastError) log.warn('contextMenus.create', chrome.runtime.lastError.message); };
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      log.warn('contextMenus.removeAll', chrome.runtime.lastError.message);
      _menuCreating = false;
      return;
    }
    chrome.contextMenus.create({
      id:       'bl-si-blur-element',
      title:    chrome.i18n.getMessage('ctxBlurElement') || 'Blur this element',
      contexts: ['all'],
    }, _lastErrorCb);
    chrome.contextMenus.create({
      id:       'bl-si-unblur-element',
      title:    chrome.i18n.getMessage('ctxUnblurElement') || 'Unblur this element',
      contexts: ['all'],
    }, _lastErrorCb);
    chrome.contextMenus.create({
      id:       'bl-si-blur-selection',
      title:    chrome.i18n.getMessage('ctxBlurSelection') || 'Blur selected text',
      contexts: ['selection'],
    }, _lastErrorCb);
    chrome.contextMenus.create({
      id:       'bl-si-settings-sep',
      type:     'separator',
      contexts: ['all'],
    }, _lastErrorCb);
    chrome.contextMenus.create({
      id:       'bl-si-settings-panel',
      title:    chrome.i18n.getMessage('ctx_open_settings_panel') || 'Open Settings Panel',
      contexts: ['all'],
    }, _lastErrorCb);
    chrome.contextMenus.create({
      id:       'bl-si-settings-tab',
      title:    chrome.i18n.getMessage('ctx_open_settings_tab') || 'Open Settings in Tab',
      contexts: ['all'],
    }, () => {
      if (chrome.runtime.lastError) log.warn('contextMenus.create', chrome.runtime.lastError.message);
      _menuCreating = false;
    });
  });
}

// ── Automate session state ────────────────────────────────────────────────
const State = blsi.Automate.State;

// Register the OS-level idle observer at SW load. Idempotent — re-runs on
// every SW wake re-registers the chrome.idle listener and re-seeds the cached
// phase via chrome.idle.queryState. Threshold pulled from blsi_model on init
// and hot-updated via the storage onChanged listener inside the module.
if (blsi && blsi.Automate && blsi.Automate.Idle) {
  blsi.Automate.Idle.init();
}

// Register the background-side screen-share handler. Clears stale session
// record, wires port + message listeners. Idempotent on SW wake.
if (blsi && blsi.Automate && blsi.Automate.ScreenShareBg) {
  blsi.Automate.ScreenShareBg.init();
}

// ── Install-time content script re-injection ───────────────────────────────
// Static manifest content_scripts only fire on next navigation. Already-open
// tabs at install/update time get nothing — users would have to reload every
// tab. Re-inject programmatically into existing tabs so the extension activates
// immediately. Skipped on chrome_update / shared_module_update because content
// scripts survive Chrome browser updates intact.
//
// File list MUST stay in lockstep with manifest.json content_scripts. The
// manifest is the source of truth; this list mirrors it for re-injection only.
const _MAIN_WORLD_FILES = ['src/main_world_bridge.js'];
const _ISOLATED_WORLD_FILES = [
  'src/constants.js',
  'src/content_i18n.js',
  'src/logger.js',
  'src/action_registry.js',
  'src/shortcut_label.js',
  'src/url_matcher.js',
  'src/selector_utils.js',
  'src/storage_model.js',
  'src/tab_privacy.js',
  'src/pii/pii_state.js',
  'src/pii/pii_checksums.js',
  'src/pii/pii_pre_filter.js',
  'src/pii/pii_country.js',
  'src/pii/pii_suppressors.js',
  'src/pii/pii_detectors.js',
  'src/pii/pii.js',
  'src/fonts.js',
  'src/core/engine_state.js',
  'src/core/categories.js',
  'src/core/css_manager.js',
  'src/core/marker_engine.js',
  'src/core/observer.js',
  'src/core/target_engine.js',
  'src/engine.js',
  'src/automate/state.js',
  'src/automate/screen_share.js',
  'src/automate/overlay.js',
  'src/automate/visibility.js',
  'src/automate/manager.js',
  'src/reveal_controller.js',
  'src/shortcut_handler.js',
  'src/selection_blur.js',
  'src/screenshot.js',
  'src/picker.js',
  'src/content_script.js',
];
const _CONTENT_CSS_FILES = ['styles/content.css'];

async function _reinjectAllTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (err) {
    log.warn('reinject: tabs.query failed', err && err.message);
    return;
  }

  let attempted = 0;
  let succeeded = 0;
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (blsi.UrlMatcher.isRestrictedUrl(tab.url)) continue;
    attempted++;

    // CSS first, then isolated-world JS in declared order, then MAIN-world bridge.
    // MAIN bridge runs late on already-open tabs (post-document_start) — any
    // getDisplayMedia / attachShadow already executed will not be hooked.
    // Acceptable tradeoff for install-time recovery; resolves on next nav.
    const tabId = tab.id;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: _CONTENT_CSS_FILES,
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: _ISOLATED_WORLD_FILES,
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: _MAIN_WORLD_FILES,
        world: 'MAIN',
      });
      succeeded++;
    } catch (err) {
      // Silent skip — tab may have closed, navigated to a restricted URL after
      // our filter, or be in a state where injection is blocked.
      log.warn('reinject failed', { tabId, url: tab.url, err: err && err.message });
    }
  }

  log.flow('reinject summary', { attempted, succeeded, skipped: tabs.length - attempted });
}

chrome.runtime.onInstalled.addListener((details) => {
  const reason = details && details.reason;
  log.flow('onInstalled', { reason });
  createContextMenus();
  // Clean up stale storage keys from pre-refactor versions
  chrome.storage.local.remove(['blurred_selectors', 'settings', 'rules', 'blurred_items', 'blur_all_hosts'], () => {
    if (chrome.runtime.lastError) log.warn('storage.remove stale keys', chrome.runtime.lastError.message);
  });
  if (reason === 'install' || reason === 'update') {
    _reinjectAllTabs();
  }
});

chrome.runtime.onStartup.addListener(() => {
  log.flow('onStartup');
  createContextMenus();
});

// ── Context menu click handler ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  log.flow('contextMenu', { menuItemId: info.menuItemId, tabId: tab.id });

  if (info.menuItemId === 'bl-si-blur-element') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.context_blur }).catch(() => {});
  } else if (info.menuItemId === 'bl-si-unblur-element') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.context_unblur }).catch(() => {});
  } else if (info.menuItemId === 'bl-si-blur-selection') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.blur_selection }).catch(() => {});
  } else if (info.menuItemId === 'bl-si-settings-panel') {
    await _openSettingsOrPanel(tab);
  } else if (info.menuItemId === 'bl-si-settings-tab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') }, () => {
      if (chrome.runtime.lastError) log.warn('tabs.create', chrome.runtime.lastError.message);
    });
  }
});

// ── Settings panel helper ──────────────────────────────────────────────────
// In a PWA app window: toggle the in-page shadow DOM settings panel.
// In a normal browser window: open popup.html as a tab (popup is accessible via icon).
async function _openSettingsOrPanel(tab) {
  try {
    const win = await chrome.windows.get(tab.windowId);
    if (win.type === 'app') {
      chrome.tabs.sendMessage(tab.id, { type: blsi.command.toggle_panel }).catch(() => {});
      return;
    }
  } catch (_) { /* fall through to tab */ }
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') }, () => {
    if (chrome.runtime.lastError) log.warn('tabs.create', chrome.runtime.lastError.message);
  });
}

// ── Commands API relay — forward keyboard commands to the active tab ────────
// Map chrome.commands names → action messageType, derived from the registry.
// Adding a new action with a chromeCommand field automatically wires the relay.
const COMMAND_TO_MESSAGE = (() => {
  const out = {};
  for (const action of blsi.Actions.list()) {
    if (action.chromeCommand) out[action.chromeCommand] = action.messageType;
  }
  return out;
})();

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'open-settings') {
    log.flow('command.openSettings', { tabId: tab.id });
    await _openSettingsOrPanel(tab);
    return;
  }

  const type = COMMAND_TO_MESSAGE[command];
  if (!type) return;
  log.flow('command.relay', { command, type, tabId: tab.id });
  chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

// ── Screenshot capture relay ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === blsi.command.capture_viewport) {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true; // async sendResponse
  }
});

// ── Tab close cleanup — drop tab id from suppressed list ──────────────────
// Without this, Chrome's tab-id reuse could let a stale entry silence a
// brand-new tab that gets the same id. Storage onChanged → content tabs
// re-resolve automatically.
chrome.tabs.onRemoved.addListener((tabId) => {
  State.remove_suppressed_tab(tabId);
  State.clear_tab_switch(tabId);
  State.set_screen_share_inactive(tabId);
});
