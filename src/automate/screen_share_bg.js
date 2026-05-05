/**
 * automate/screen_share_bg.js — Background-only screen-share port/message handler.
 *
 * Owns the 'blsi-screen-share' port lifecycle, SCREEN_SHARE_STARTED/ENDED message
 * handling, WHO_AM_I relay, and SCREEN_SHARE_NOTIFY broadcast. Calls State APIs to
 * manage the per-tab blsi_screen_share session map; content tabs read it via State's
 * in-memory caches + chrome.storage.session.onChanged.
 *
 * Loaded in BACKGROUND service worker only (importScripts in background.js).
 *
 * Contract: docs/contracts/automate/screen_share_bg.md
 *
 * Exposed as blsi.Automate.ScreenShareBg (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  var State = (globalThis.blsi && globalThis.blsi.Automate && globalThis.blsi.Automate.State) || null;
  var log   = (globalThis.blsi && globalThis.blsi.Logger) ? globalThis.blsi.Logger.scope('screenShareBg') : null;

  var _sharePorts       = new Map();
  var _connect_listener = null;
  var _message_listener = null;

  function _broadcastScreenShareNotify(excludeTabId) {
    chrome.tabs.query({}, function (tabs) {
      if (chrome.runtime.lastError) { if (log) log.warn('broadcast query', chrome.runtime.lastError.message); return; }
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        if (!tab.id) continue;
        if (excludeTabId !== undefined && tab.id === excludeTabId) continue;
        chrome.tabs.sendMessage(tab.id, { type: blsi.command.screen_share_notify }).catch(function () {});
      }
    });
  }

  function _tabHasActivePorts(tabId) {
    var iter = _sharePorts.values();
    var entry;
    while (!(entry = iter.next()).done) {
      if (entry.value.tabId === tabId) return true;
    }
    return false;
  }

  function _onConnect(port) {
    if (!port.name || port.name.indexOf('blsi-ss-') !== 0) return;
    var tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (!tabId) return;

    _sharePorts.set(port.name, { tabId: tabId, port: port });
    if (log) log.flow('screenShare.portOpen', { tabId: tabId, port: port.name });
    State.set_screen_share_active(tabId, port.name);

    port.onDisconnect.addListener(function () {
      _sharePorts.delete(port.name);
      if (log) log.flow('screenShare.portClose', { tabId: tabId, port: port.name });
      var tabHasMore = _tabHasActivePorts(tabId);
      Promise.resolve(
        tabHasMore
          ? State.remove_stream(tabId, port.name)
          : State.set_screen_share_inactive(tabId)
      ).then(function () {
        _broadcastScreenShareNotify();
      });
    });
  }

  function _onMessage(message, sender, sendResponse) {
    if (!message) return;

    if (message.type === blsi.command.screen_share_started) {
      var senderTabId = sender.tab && sender.tab.id;
      var sid = message.streamId;
      var streamKey = sid ? 'blsi-ss-' + sid : null;
      Promise.resolve(State.set_screen_share_active(senderTabId, streamKey)).then(function () {
        _broadcastScreenShareNotify(senderTabId);
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === blsi.command.screen_share_ended) {
      var endTabId = sender.tab && sender.tab.id;
      var endSid = message.streamId;
      var endStreamKey = endSid ? 'blsi-ss-' + endSid : null;
      var tabHasMore = endStreamKey ? _tabHasActivePorts(endTabId) : false;
      Promise.resolve(
        tabHasMore
          ? State.remove_stream(endTabId, endStreamKey)
          : State.set_screen_share_inactive(endTabId)
      ).then(function () {
        _broadcastScreenShareNotify();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === blsi.command.who_am_i) {
      var tabId = sender && sender.tab && sender.tab.id;
      sendResponse({ tab_id: typeof tabId === 'number' ? tabId : null });
      return false;
    }
  }

  function _reconcile_stale_shares() {
    var ss = State.get_screen_share_state();
    if (!ss.active || !ss._sharing_tab_ids || !ss._sharing_tab_ids.length) return;
    chrome.tabs.query({}, function (tabs) {
      if (chrome.runtime.lastError) { if (log) log.warn('reconcile query', chrome.runtime.lastError.message); return; }
      var live = new Set(tabs.map(function (t) { return t.id; }));
      ss._sharing_tab_ids.forEach(function (id) {
        if (!live.has(id)) State.set_screen_share_inactive(id);
      });
      var suppressed = State.get_suppressed_tabs();
      suppressed.forEach(function (id) {
        if (!live.has(id)) State.remove_suppressed_tab(id);
      });
    });
  }

  function init() {
    if (!State) return;
    _reconcile_stale_shares();

    _connect_listener = _onConnect;
    chrome.runtime.onConnect.addListener(_connect_listener);

    _message_listener = _onMessage;
    chrome.runtime.onMessage.addListener(_message_listener);
  }

  function destroy() {
    if (_connect_listener) {
      chrome.runtime.onConnect.removeListener(_connect_listener);
      _connect_listener = null;
    }
    if (_message_listener) {
      chrome.runtime.onMessage.removeListener(_message_listener);
      _message_listener = null;
    }
  }

  var ScreenShareBg = Object.freeze({ init: init, destroy: destroy });

  globalThis.blsi = globalThis.blsi || {};
  globalThis.blsi.Automate = globalThis.blsi.Automate || {};
  globalThis.blsi.Automate.ScreenShareBg = ScreenShareBg;
})();
