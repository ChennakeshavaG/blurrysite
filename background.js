'use strict';

importScripts('src/constants.js', 'src/logger.js');

const MSG = self.pb;
const log = pb.Logger;

/**
 * background.js — PrivacyBlur MV3 Service Worker
 *
 * Responsibilities:
 *  - Relay keyboard command events to the active tab's content script
 *  - Centralise all chrome.storage.local reads/writes
 *  - Manage the right-click context menu entries
 *  - Re-apply persisted blur state whenever a tab finishes loading
 *
 * Settings and deepMerge are sourced from constants.js (pb.DEFAULT_SETTINGS,
 * pb.deepMerge). No local copies.
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

/** Validate a blur item object. Must have type + type-specific fields. */
function isValidBlurItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.type === 'dynamic') {
    return isValidSelector(item.selector) &&
           typeof item.name === 'string' && item.name.length <= 100;
  }
  if (item.type === 'sticky') {
    return typeof item.id === 'string' && item.id.length > 0 &&
           typeof item.name === 'string' && item.name.length <= 100 &&
           typeof item.x === 'number' && typeof item.y === 'number' &&
           typeof item.width === 'number' && typeof item.height === 'number';
  }
  return false;
}

/** Get the unique identifier for a blur item (selector for dynamic, id for sticky). */
function getItemId(item) {
  return item.type === 'dynamic' ? item.selector : item.id;
}

const PER_HOST_ITEM_LIMIT = 10;

// ---------------------------------------------------------------------------
// Write serializer — prevents concurrent get-then-set data loss
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();
const SERIAL_WRITE_TIMEOUT_MS = 10000;

function serialWrite(fn) {
  log.log('serialWrite: queuing write');
  writeQueue = writeQueue.then(() => {
    log.log('serialWrite: executing write fn');
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('serialWrite timeout')), SERIAL_WRITE_TIMEOUT_MS)
      ),
    ]);
  }).catch((err) => {
    console.error('[PrivacyBlur] serialWrite error:', err?.message || err);
  });
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Storage message handler
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log.log('msg:', message.type, sender.tab ? 'tab:' + sender.tab.id : 'popup');
  switch (message.type) {

    // ---- Blur items (typed: dynamic selectors + sticky zones) ----
    case MSG.GET_BLUR_ITEMS: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ items: [] });
        return true;
      }
      chrome.storage.local.get("blurred_items", (result) => {
        const map = result.blurred_items || {};
        sendResponse({ items: map[message.hostname] || [] });
      });
      return true;
    }

    case MSG.SAVE_BLUR_ITEM: {
      log.log('SAVE_BLUR_ITEM: hostname=', message.hostname, 'item=', message.item);
      if (!isValidHostname(message.hostname)) {
        log.log('SAVE_BLUR_ITEM: invalid hostname');
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      if (!isValidBlurItem(message.item)) {
        log.log('SAVE_BLUR_ITEM: invalid item, type=', message.item?.type,
          'id=', message.item?.id, 'name=', message.item?.name,
          'x=', typeof message.item?.x, 'y=', typeof message.item?.y,
          'w=', typeof message.item?.width, 'h=', typeof message.item?.height);
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      sendResponse({ success: true });
      log.log('SAVE_BLUR_ITEM: entering serialWrite');
      serialWrite(() => new Promise((resolve) => {
        log.log('SAVE_BLUR_ITEM: inside serialWrite, reading storage');
        chrome.storage.local.get("blurred_items", (result) => {
          log.log('SAVE_BLUR_ITEM: storage read complete, result=', JSON.stringify(result));
          const map = result.blurred_items || {};
          const list = map[message.hostname] || [];

          if (list.length >= PER_HOST_ITEM_LIMIT) {
            log.log('SAVE_BLUR_ITEM: per-host limit reached');
            resolve();
            return;
          }

          const newId = getItemId(message.item);
          if (!list.some(existing => getItemId(existing) === newId)) {
            list.push(message.item);
          }

          map[message.hostname] = list;
          log.log('SAVE_BLUR_ITEM: writing to storage, items for host:', list.length);
          chrome.storage.local.set({ blurred_items: map }, () => {
            log.log('SAVE_BLUR_ITEM: storage write complete');
            resolve();
          });
        });
      }));
      return true;
    }

    case MSG.REMOVE_BLUR_ITEM: {
      if (!isValidHostname(message.hostname) || !message.itemId) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_items", (result) => {
          const map = result.blurred_items || {};
          const list = (map[message.hostname] || []).filter(
            (item) => getItemId(item) !== message.itemId
          );

          if (list.length > 0) {
            map[message.hostname] = list;
          } else {
            delete map[message.hostname];
          }

          chrome.storage.local.set({ blurred_items: map }, resolve);
        });
      }));
      return true;
    }

    case MSG.CLEAR_HOST: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ success: false, error: "invalid input" });
        return true;
      }
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blurred_items", (result) => {
          const map = result.blurred_items || {};
          delete map[message.hostname];
          chrome.storage.local.set({ blurred_items: map }, resolve);
        });
      }));
      return true;
    }

    case MSG.CLEAR_ALL: {
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ blurred_items: {} }, resolve);
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
      // Validate before persisting — strips invalid values, fills missing with defaults
      const validatedSettings = MSG.validateSettings(message.settings);
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ settings: validatedSettings }, resolve);
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
      if (message.rules.length > 100) {
        sendResponse({ success: false, error: "max 100 rules" });
        return true;
      }
      // Validate and sanitize each rule: enforce field types and size limits.
      // Filter out rules with empty patterns — an empty pattern would match ALL pages.
      const sanitizedRules = message.rules.filter(r => r && typeof r === 'object' &&
        typeof r.pattern === 'string' && r.pattern.trim().length > 0
      ).map(r => ({
        id:          (typeof r.id === 'string' && r.id.length <= 20) ? r.id : 'r_' + Math.random().toString(36).slice(2, 10),
        name:        (typeof r.name === 'string') ? r.name.slice(0, 100) : '',
        pattern:     r.pattern.trim().slice(0, 500),
        patternType: (r.patternType === MSG.PATTERN_TYPES.REGEX || r.patternType === MSG.PATTERN_TYPES.WILDCARD) ? r.patternType : MSG.PATTERN_TYPES.WILDCARD,
        settings:    (r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings) && JSON.stringify(r.settings).length <= 2000) ? r.settings : {},
      }));
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.set({ rules: sanitizedRules }, resolve);
      }));
      return true;
    }

    // ---- Blur-all state per hostname ----
    case MSG.GET_BLUR_STATE: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ blurAll: false });
        return true;
      }
      chrome.storage.local.get("blur_all_hosts", (result) => {
        const hosts = result.blur_all_hosts || {};
        sendResponse({ blurAll: !!hosts[message.hostname] });
      });
      return true;
    }

    case MSG.SAVE_BLUR_STATE: {
      if (!isValidHostname(message.hostname)) {
        sendResponse({ success: false });
        return true;
      }
      sendResponse({ success: true });
      serialWrite(() => new Promise((resolve) => {
        chrome.storage.local.get("blur_all_hosts", (result) => {
          const hosts = result.blur_all_hosts || {};
          if (message.blurAll) {
            hosts[message.hostname] = true;
          } else {
            delete hosts[message.hostname];
          }
          chrome.storage.local.set({ blur_all_hosts: hosts }, resolve);
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
