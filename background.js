'use strict';

importScripts('src/constants.js');

const MSG = self.PrivacyBlur;

/**
 * background.js — PrivacyBlur MV3 Service Worker
 *
 * Responsibilities:
 *  - Relay keyboard command events to the active tab's content script
 *  - Centralise all chrome.storage.local reads/writes
 *  - Manage the right-click context menu entries
 *  - Re-apply persisted blur state whenever a tab finishes loading
 *
 * Settings and deepMerge are sourced from constants.js (PrivacyBlur.DEFAULT_SETTINGS,
 * PrivacyBlur.deepMerge). No local copies.
 */

// ---------------------------------------------------------------------------
// Context menu setup — created once on service-worker install/startup
// ---------------------------------------------------------------------------
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "pb-blur-element",
      title: "Blur this element",
      contexts: ["all"]
    });

    chrome.contextMenus.create({
      id: "pb-unblur-element",
      title: "Unblur this element",
      contexts: ["all"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();

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
  createContextMenus();
});

// ---------------------------------------------------------------------------
// Context menu click handler
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "pb-blur-element") {
    chrome.tabs.sendMessage(tab.id, { type: MSG.CONTEXT_BLUR }).catch(() => {});
  } else if (info.menuItemId === "pb-unblur-element") {
    chrome.tabs.sendMessage(tab.id, { type: MSG.CONTEXT_UNBLUR }).catch(() => {});
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
    "toggle-picker":   { type: MSG.TOGGLE_PICKER },
    "clear-all-blur":  { type: MSG.CLEAR_ALL_BLUR }
  };

  const message = messageMap[command];
  if (message) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function isValidHostname(h) {
  return (
    typeof h === "string" &&
    h.length > 0 &&
    h.length <= 253 &&
    h !== "__proto__" &&
    h !== "constructor" &&
    h !== "prototype"
  );
}

function isValidSelector(s) {
  return typeof s === "string" && s.length > 0 && s.length <= 2000;
}

// ---------------------------------------------------------------------------
// Write serializer — prevents concurrent get-then-set data loss
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();

function serialWrite(fn) {
  writeQueue = writeQueue.then(fn).catch(() => {});
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Storage message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    // ---- Selectors (unchanged) ----
    case MSG.GET_SELECTORS: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ selectors: [] });
        return true;
      }
      chrome.storage.local.get("blurred_selectors", (result) => {
        const map = result.blurred_selectors || {};
        sendResponse({ selectors: map[message.hostname] || [] });
      });
      return true;
    }

    case MSG.SAVE_SELECTOR: {
      if (!isValidHostname(message.hostname) || !isValidSelector(message.selector)) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_selectors", (result) => {
          const map = result.blurred_selectors || {};
          const list = map[message.hostname] || [];

          if (list.length >= 500) {
            sendResponse({ success: false, error: "per-host limit reached" });
            resolve();
            return;
          }

          if (!list.includes(message.selector)) {
            list.push(message.selector);
          }

          map[message.hostname] = list;
          chrome.storage.local.set({ blurred_selectors: map }, () => {
            sendResponse({ success: true });
            resolve();
          });
        });
      }));
      return true;
    }

    case MSG.REMOVE_SELECTOR: {
      if (!isValidHostname(message.hostname) || !isValidSelector(message.selector)) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_selectors", (result) => {
          const map = result.blurred_selectors || {};
          const list = (map[message.hostname] || []).filter(
            (s) => s !== message.selector
          );

          if (list.length > 0) {
            map[message.hostname] = list;
          } else {
            delete map[message.hostname];
          }

          chrome.storage.local.set({ blurred_selectors: map }, () => {
            sendResponse({ success: true });
            resolve();
          });
        });
      }));
      return true;
    }

    case MSG.CLEAR_HOST: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_selectors", (result) => {
          const map = result.blurred_selectors || {};
          delete map[message.hostname];
          chrome.storage.local.set({ blurred_selectors: map }, () => {
            sendResponse({ success: true });
            resolve();
          });
        });
      }));
      return true;
    }

    case MSG.CLEAR_ALL: {
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ blurred_selectors: {} }, () => {
          sendResponse({ success: true });
          resolve();
        });
      }));
      return true;
    }

    // ---- Settings: full-object storage (no partial merges on save) ----
    case MSG.GET_SETTINGS: {
      chrome.storage.local.get("settings", (result) => {
        const saved = result.settings || {};
        const merged = MSG.deepMerge(MSG.DEFAULT_SETTINGS, saved);
        // Validate and repair — strips invalid values, fills missing with defaults
        const validated = MSG.validateSettings(merged);
        sendResponse({ settings: validated });
      });
      return true;
    }

    case MSG.SAVE_SETTINGS: {
      if (!message.settings || typeof message.settings !== "object" || Array.isArray(message.settings)) {
        sendResponse({ success: false, error: "invalid settings" });
        return true;
      }
      // Full-object storage: write the entire settings object as-is.
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ settings: message.settings }, () => {
          sendResponse({ success: true });
          resolve();
        });
      }));
      return true;
    }

    // ---- URL Rules: array of { id, name, pattern, patternType, settings } ----
    case MSG.GET_RULES: {
      chrome.storage.local.get("rules", (result) => {
        sendResponse({ rules: result.rules || [] });
      });
      return true;
    }

    case MSG.SAVE_RULES: {
      if (!Array.isArray(message.rules)) {
        sendResponse({ success: false, error: "invalid rules" });
        return true;
      }
      // Cap rules at 100 and validate field lengths
      if (message.rules.length > 100) {
        sendResponse({ success: false, error: "max 100 rules" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ rules: message.rules }, () => {
          sendResponse({ success: true });
          resolve();
        });
      }));
      return true;
    }

    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Tab navigation listener — re-apply persisted blur when a page finishes loading
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  if (
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("about:") ||
    tab.url.startsWith("moz-extension://")
  ) {
    return;
  }

  chrome.tabs.sendMessage(tabId, { type: MSG.RESTORE }).catch(() => {});
});
