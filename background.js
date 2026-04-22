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
  });
}

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
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  log.flow('contextMenu', { menuItemId: info.menuItemId, tabId: tab.id });

  if (info.menuItemId === 'bl-si-blur-element') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.context_blur }).catch(() => {});
  } else if (info.menuItemId === 'bl-si-unblur-element') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.context_unblur }).catch(() => {});
  } else if (info.menuItemId === 'bl-si-blur-selection') {
    chrome.tabs.sendMessage(tab.id, { type: blsi.command.blur_selection }).catch(() => {});
  }
});

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
