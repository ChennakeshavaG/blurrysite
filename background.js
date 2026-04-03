'use strict';

/**
 * background.js — PrivacyBlur MV3 Service Worker
 *
 * Responsibilities:
 *  - Relay keyboard command events to the active tab's content script
 *  - Centralise all chrome.storage.local reads/writes
 *  - Manage the right-click context menu entries
 *  - Re-apply persisted blur state whenever a tab finishes loading
 */

// ---------------------------------------------------------------------------
// Default settings — used when no saved value exists yet
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = Object.freeze({
  blurRadius: 8,
  transitionDuration: 200,
  highlightColor: "#f59e0b",
  revealOnHover: false,
  enabled: true,
  shortcuts: Object.freeze({
    chordKey1: "k",
    chordKey2: "v",
    chordModifier: "ctrl"
  })
});

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
});

// Also recreate menus when the service worker wakes from suspension,
// because chrome.contextMenus is only persistent across sessions when
// created inside onInstalled; a second call is harmless (removeAll guards it).
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

// ---------------------------------------------------------------------------
// Context menu click handler
// ---------------------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "pb-blur-element") {
    chrome.tabs.sendMessage(tab.id, { type: "CONTEXT_BLUR" }).catch(() => {
      // Content script not yet injected — silently ignore
    });
  } else if (info.menuItemId === "pb-unblur-element") {
    chrome.tabs.sendMessage(tab.id, { type: "CONTEXT_UNBLUR" }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Commands API relay — forward keyboard commands to the active tab
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const messageMap = {
    "toggle-blur-all": { type: "TOGGLE_BLUR_ALL" },
    "toggle-picker":   { type: "TOGGLE_PICKER" },
    "clear-all-blur":  { type: "CLEAR_ALL_BLUR" }
  };

  const message = messageMap[command];
  if (message) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * A valid hostname is a non-empty string ≤253 chars.
 * Blocks prototype-pollution keys like "__proto__" and "constructor".
 */
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

/** Selectors are capped at 2000 chars to prevent storage quota abuse. */
function isValidSelector(s) {
  return typeof s === "string" && s.length > 0 && s.length <= 2000;
}

// ---------------------------------------------------------------------------
// Write serializer — prevents concurrent get-then-set data loss
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();

/**
 * Enqueue a storage mutation. Each callback receives no arguments, must
 * perform its own get/set, and return a Promise. Mutations execute serially.
 */
function serialWrite(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Storage message handler — content scripts delegate all storage I/O here
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    // ---- Read selectors for a hostname ----
    case "GET_SELECTORS": {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ selectors: [] });
        return true;
      }
      chrome.storage.local.get("blurred_selectors", (result) => {
        const map = result.blurred_selectors || {};
        sendResponse({ selectors: map[message.hostname] || [] });
      });
      return true; // keep channel open for async sendResponse
    }

    // ---- Persist a newly blurred selector ----
    case "SAVE_SELECTOR": {
      if (!isValidHostname(message.hostname) || !isValidSelector(message.selector)) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_selectors", (result) => {
          const map = result.blurred_selectors || {};
          const list = map[message.hostname] || [];

          // Cap at 500 selectors per host to prevent quota exhaustion
          if (list.length >= 500) {
            sendResponse({ success: false, error: "per-host limit reached" });
            resolve();
            return;
          }

          // Avoid storing duplicate selectors
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

    // ---- Remove a single selector from a hostname ----
    case "REMOVE_SELECTOR": {
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

    // ---- Wipe all selectors for a specific hostname ----
    case "CLEAR_HOST": {
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

    // ---- Wipe the entire blurred_selectors map ----
    case "CLEAR_ALL": {
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ blurred_selectors: {} }, () => {
          sendResponse({ success: true });
          resolve();
        });
      }));
      return true;
    }

    // ---- Read settings, merged with defaults ----
    case "GET_SETTINGS": {
      chrome.storage.local.get("settings", (result) => {
        const saved = result.settings || {};
        const merged = deepMerge(DEFAULT_SETTINGS, saved);
        sendResponse({ settings: merged });
      });
      return true;
    }

    // ---- Persist a partial settings update ----
    case "SAVE_SETTINGS": {
      if (!message.settings || typeof message.settings !== "object" || Array.isArray(message.settings)) {
        sendResponse({ success: false, error: "invalid settings" });
        return true;
      }
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("settings", (result) => {
          const current = result.settings || {};
          const updated = deepMerge(current, message.settings);
          chrome.storage.local.set({ settings: updated }, () => {
            sendResponse({ success: true });
            resolve();
          });
        });
      }));
      return true;
    }

    default:
      // Unknown message types are silently ignored
      break;
  }
});

// ---------------------------------------------------------------------------
// Tab navigation listener — re-apply persisted blur when a page finishes loading
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when the page has fully loaded and has a URL we can work with
  if (changeInfo.status !== "complete" || !tab.url) return;

  // Skip chrome:// and extension:// URLs where content scripts cannot run
  if (
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("about:") ||
    tab.url.startsWith("moz-extension://")
  ) {
    return;
  }

  chrome.tabs.sendMessage(tabId, { type: "RESTORE" }).catch(() => {
    // Content script not yet ready — this is normal for some page types
  });
});

// ---------------------------------------------------------------------------
// Utility — deep-merge two plain objects (second wins on conflicts)
// ---------------------------------------------------------------------------
function deepMerge(base, override) {
  const result = Object.assign({}, base);

  for (const key of Object.keys(override)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (
      override[key] !== null &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      typeof base[key] === "object" &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }

  return result;
}
