"use strict";

importScripts("src/constants.js", "src/logger.js");

const MSG = self.blsi;
const log = blsi.Logger.scope('bg');

/**
 * background.js — Blurry Site MV3 Service Worker
 *
 * Responsibilities:
 *  - Relay keyboard command events to the active tab's content script
 *  - Manage the right-click context menu entries
 *  - Re-apply persisted blur state whenever a tab finishes loading
 *  - Seed default settings on install
 *
 * Storage I/O is handled directly by callers via storage_manager.js
 * (both content script and popup use chrome.storage.local directly).
 */

// ---------------------------------------------------------------------------
// Context menu setup — created once on service-worker install/startup
// ---------------------------------------------------------------------------
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "bl-si-blur-element",
      title: "Blur this element",
      contexts: ["all"],
    });

    chrome.contextMenus.create({
      id: "bl-si-unblur-element",
      title: "Unblur this element",
      contexts: ["all"],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  log.flow('onInstalled', { reason: details && details.reason });
  createContextMenus();

  // Clean up stale storage key from pre-refactor versions
  chrome.storage.local.remove("blurred_selectors");

  // Seed default settings to storage if not present. This ensures the popup
  // shows correct toggle states on first load (instead of all-unchecked).
  chrome.storage.local.get("settings", (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: MSG.buildDefaultSettings() });
    } else {
      // Validate existing settings — repair any broken/missing values
      const validated = MSG.validateSettings(result.settings);
      chrome.storage.local.set({ settings: validated });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  log.flow('onStartup');
  createContextMenus();
});

// ---------------------------------------------------------------------------
// Context menu click handler
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  log.flow('contextMenu', { menuItemId: info.menuItemId, tabId: tab.id });

  if (info.menuItemId === "bl-si-blur-element") {
    chrome.tabs.sendMessage(tab.id, { type: MSG.CONTEXT_BLUR }).catch(() => {});
  } else if (info.menuItemId === "bl-si-unblur-element") {
    chrome.tabs
      .sendMessage(tab.id, { type: MSG.CONTEXT_UNBLUR })
      .catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Commands API relay — forward keyboard commands to the active tab
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const messageMap = {
    "toggle-blur-all": { type: MSG.TOGGLE_BLUR_ALL },
    "toggle-picker": { type: MSG.TOGGLE_PICKER },
    "clear-all-blur": { type: MSG.CLEAR_ALL_BLUR },
  };

  const message = messageMap[command];
  if (message) {
    log.flow('command.relay', { command, type: message.type, tabId: tab.id });
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
});


// Note: tab navigation does not need a RESTORE message — the content script
// is re-injected on each page load and restores blur state from storage in
// its own init() via Store.initCache() + applyInitialBlurState().
