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

// Clear stale screen-share session flag on every SW start. _sharePorts is always
// empty on restart (in-memory Map). If a share is actually in progress, screen_share.js
// will reconnect the port and re-set the flag. Without this, a flag left true after a
// mid-share SW restart would cause every new tab to apply automate blur indefinitely.
chrome.storage.session.set({ blsi_screen_share_active: false });

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
  // Re-set the flag here too: if the SW restarted mid-share, the top-level
  // clear ran first; the reconnecting port restores the live-share state.
  chrome.storage.session.set({ blsi_screen_share_active: true });

  port.onDisconnect.addListener(() => {
    _sharePorts.delete(tabId);
    log.flow('screenShare.portClose', { tabId });
    // Clear the session flag so tabs opened after the share ends don't
    // incorrectly apply automate blur on init.
    chrome.storage.session.set({ blsi_screen_share_active: false });
    // Fan-out UNBLUR to all tabs — same as SCREEN_SHARE_ENDED path.
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: blsi.command.screen_share_unblur }).catch(() => {});
        }
      }
    });
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

  // ── Screen share relay — fan out to other tabs ─────────────────────────
  // Stateless: no module-level Set (service worker can sleep between events).
  // On STARTED: persist active flag to session storage (survives SW sleep/restart),
  //   then blur all tabs except the one sharing.
  // On ENDED: clear session flag, unblur every tab.
  // Tabs opened mid-share miss the fan-out but read blsi_screen_share_active on
  // init and apply automate blur themselves.
  if (message && message.type === blsi.command.screen_share_started) {
    const senderTabId = sender.tab && sender.tab.id;
    chrome.storage.session.set({ blsi_screen_share_active: true });
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.id !== senderTabId) {
          chrome.tabs.sendMessage(tab.id, { type: blsi.command.screen_share_blur }).catch(() => {});
        }
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message && message.type === blsi.command.screen_share_ended) {
    chrome.storage.session.set({ blsi_screen_share_active: false });
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: blsi.command.screen_share_unblur }).catch(() => {});
        }
      }
    });
    sendResponse({ ok: true });
    return true;
  }
});
