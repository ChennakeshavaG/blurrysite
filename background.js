'use strict';

importScripts(
  'src/constants.js',
  'src/logger.js',
  'src/action_registry.js'
);

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

// ── Context menu setup ─────────────────────────────────────────────────────
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'bl-si-blur-element',
      title:    chrome.i18n.getMessage('ctxBlurElement') || 'Blur this element',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id:       'bl-si-unblur-element',
      title:    chrome.i18n.getMessage('ctxUnblurElement') || 'Unblur this element',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id:       'bl-si-blur-selection',
      title:    chrome.i18n.getMessage('ctxBlurSelection') || 'Blur selected text',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id:       'bl-si-settings-sep',
      type:     'separator',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id:       'bl-si-settings-panel',
      title:    'Open Settings Panel',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id:       'bl-si-settings-tab',
      title:    'Open Settings in Tab',
      contexts: ['all'],
    });
  });
}

// ── Screen-share session record (background-owned) ────────────────────────
// Single source of truth for live-share state. Content scripts read via
// chrome.storage.session.onChanged + storage_model session caches.
const SCREEN_SHARE_SESSION_KEY = 'blsi_screen_share';
const SUPPRESSED_TABS_SESSION_KEY = 'blsi_automate_suppressed_tabs';

function _emptyScreenShareState() {
  return { active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [] };
}

async function _setScreenShareActive(sharing_tab_id) {
  // Each new share starts with cleared suppression maps so stale per-site or
  // per-tab suppress entries from a prior share never silently carry over.
  const next = {
    active: true,
    sharing_tab_id: typeof sharing_tab_id === 'number' ? sharing_tab_id : null,
    started_at: Date.now(),
    suppressed_sites: [],
  };
  await chrome.storage.session.set({
    [SCREEN_SHARE_SESSION_KEY]: next,
    [SUPPRESSED_TABS_SESSION_KEY]: [],
  });
}

async function _setScreenShareInactive() {
  await chrome.storage.session.set({ [SCREEN_SHARE_SESSION_KEY]: _emptyScreenShareState() });
}

function _broadcastScreenShareNotify(excludeTabId) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue;
      if (excludeTabId !== undefined && tab.id === excludeTabId) continue;
      chrome.tabs.sendMessage(tab.id, { type: blsi.command.screen_share_notify }).catch(() => {});
    }
  });
}

// Clear stale screen-share session record on every SW start. _sharePorts is
// always empty on restart (in-memory Map). If a share is actually in progress,
// screen_share.js will reconnect the port and the onConnect handler restores
// active state. Suppressed-tabs list also resets — tab ids from a prior
// session may have been reused by Chrome by now.
chrome.storage.session.set({
  [SCREEN_SHARE_SESSION_KEY]: _emptyScreenShareState(),
  [SUPPRESSED_TABS_SESSION_KEY]: [],
});

chrome.runtime.onInstalled.addListener((details) => {
  log.flow('onInstalled', { reason: details && details.reason });
  createContextMenus();
  // Clean up stale storage keys from pre-refactor versions
  chrome.storage.local.remove(['blurred_selectors', 'settings', 'rules', 'blurred_items', 'blur_all_hosts']);
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
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
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
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
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

// ── Screen share port tracking ─────────────────────────────────────────────
// content script (screen_share.js) opens 'blsi-screen-share' when sharing starts
// and disconnects when sharing ends (or the tab crashes, closes, or navigates).
// Port lifetime = share lifetime — no heartbeat or polling needed.
const _sharePorts = new Map(); // tabId → port; in-memory, empty on SW restart

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'blsi-screen-share') return;
  const tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (!tabId) return;

  _sharePorts.set(tabId, port);
  log.flow('screenShare.portOpen', { tabId });
  // Reconcile session record — covers SW restart mid-share where the top-level
  // clear ran first and the reconnecting port restores live-share state.
  _setScreenShareActive(tabId);

  port.onDisconnect.addListener(async () => {
    _sharePorts.delete(tabId);
    log.flow('screenShare.portClose', { tabId });
    await _setScreenShareInactive();
    // Storage onChanged handles re-resolve in every tab. Send NOTIFY so the
    // toast can clear in-flight if any tab is showing one.
    _broadcastScreenShareNotify();
  });
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

  // ── Screen share relay ────────────────────────────────────────────────
  // Background owns blsi_screen_share session record. On state change, content
  // tabs auto-react via chrome.storage.session.onChanged in storage_model.
  // SCREEN_SHARE_NOTIFY is a UI ping (toast trigger on transition into blur).
  // Tabs opened mid-share read the session record on init via storage_model.
  if (message && message.type === blsi.command.screen_share_started) {
    const senderTabId = sender.tab && sender.tab.id;
    (async () => {
      await _setScreenShareActive(senderTabId);
      _broadcastScreenShareNotify(senderTabId);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message && message.type === blsi.command.screen_share_ended) {
    (async () => {
      await _setScreenShareInactive();
      _broadcastScreenShareNotify();
      sendResponse({ ok: true });
    })();
    return true;
  }

  // ── WHO_AM_I — content scripts query their own tab id ─────────────────
  if (message && message.type === blsi.command.who_am_i) {
    const tabId = sender && sender.tab && sender.tab.id;
    sendResponse({ tab_id: typeof tabId === 'number' ? tabId : null });
    return false;
  }
});

// ── Tab close cleanup — drop tab id from suppressed list ──────────────────
// Without this, Chrome's tab-id reuse could let a stale entry silence a
// brand-new tab that gets the same id. Storage onChanged → content tabs
// re-resolve automatically.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const r = await chrome.storage.session.get(SUPPRESSED_TABS_SESSION_KEY);
    const list = Array.isArray(r[SUPPRESSED_TABS_SESSION_KEY]) ? r[SUPPRESSED_TABS_SESSION_KEY] : [];
    if (list.indexOf(tabId) < 0) return;
    const next = list.filter((t) => t !== tabId);
    await chrome.storage.session.set({ [SUPPRESSED_TABS_SESSION_KEY]: next });
  } catch (_) { /* ignore */ }
});
