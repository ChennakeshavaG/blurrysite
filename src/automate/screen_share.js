/**
 * automate/screen_share.js — Screen share event bridge (isolated world).
 *
 * Listens for '__blsi_screen_share' postMessage events dispatched by main_world_bridge.js
 * (world: "MAIN") and relays them to the background via chrome.runtime port + messaging.
 * Background owns the per-tab session map and broadcasts SCREEN_SHARE_NOTIFY; tabs
 * re-resolve via chrome.storage.session.onChanged in storage_model.
 *
 * Also resolves the running tab id once on init via WHO_AM_I, so resolve() can
 * apply per-tab automate suppression and identify the sharing tab.
 *
 * Loaded in ISOLATED world content scripts (manifest.json content_scripts).
 *
 * Contract: docs/contracts/automate/screen_share.md
 *
 * Exposed as blsi.Automate.ScreenShare (IIFE — no ES module syntax).
 */

(function () {
  'use strict';

  var _State = (globalThis.blsi && globalThis.blsi.Automate && globalThis.blsi.Automate.State) || null;

  var _handler        = null;
  var _sharePorts     = {};
  var _myTabId        = null;
  var _whoAmIPromise  = null;

  function whoAmI() {
    if (_myTabId !== null) return Promise.resolve(_myTabId);
    if (_whoAmIPromise) return _whoAmIPromise;
    _whoAmIPromise = new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: blsi.command.who_am_i }, function (resp) {
          if (chrome.runtime.lastError && globalThis.blsi && blsi.Logger) blsi.Logger.scope('screenShare').warn('whoAmI', chrome.runtime.lastError.message);
          if (resp && typeof resp.tab_id === 'number') {
            _myTabId = resp.tab_id;
          }
          resolve(_myTabId);
        });
      } catch (_) { resolve(_myTabId); }
    });
    return _whoAmIPromise;
  }

  function getTabId() { return _myTabId; }

  function init() {
    if (_handler) return;
    whoAmI();
    _handler = function (e) {
      if (!e.data || e.data.type !== '__blsi_screen_share') return;
      var sid = e.data.streamId;
      if (!sid) return;
      try {
        if (e.data.active) {
          var port = chrome.runtime.connect({ name: 'blsi-ss-' + sid });
          _sharePorts[sid] = port;
          chrome.runtime.sendMessage({
            type: blsi.command.screen_share_started,
            streamId: sid
          }).catch(function () {});
        } else {
          var p = _sharePorts[sid];
          if (p) { p.disconnect(); delete _sharePorts[sid]; }
          chrome.runtime.sendMessage({
            type: blsi.command.screen_share_ended,
            streamId: sid
          }).catch(function () {});
        }
      } catch (_) { /* extension context invalidated — stale content script */ }
    };
    window.addEventListener('message', _handler);
  }

  function destroy() {
    var keys = Object.keys(_sharePorts);
    for (var i = 0; i < keys.length; i++) {
      _sharePorts[keys[i]].disconnect();
    }
    _sharePorts = {};
    if (_handler) window.removeEventListener('message', _handler);
    _handler = null;
  }

  var ScreenShare = Object.freeze({ init: init, destroy: destroy, whoAmI: whoAmI, getTabId: getTabId });

  globalThis.blsi = globalThis.blsi || {};
  globalThis.blsi.Automate = globalThis.blsi.Automate || {};
  globalThis.blsi.Automate.ScreenShare = ScreenShare;
})();
