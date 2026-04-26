/**
 * screen_share.js — Screen share event bridge (isolated world)
 *
 * Listens for '__blsi_screen_share' CustomEvents dispatched by main_world_bridge.js
 * (world: "MAIN") and relays them to the background via chrome.runtime messaging.
 * Background owns the session record and broadcasts SCREEN_SHARE_NOTIFY; tabs
 * re-resolve via chrome.storage.session.onChanged in storage_model.
 *
 * Also resolves the running tab id once on init via WHO_AM_I, so resolve() can
 * apply per-tab automate suppression and identify the sharing tab.
 *
 * Exposed as blsi.ScreenShare (IIFE — no ES module syntax).
 */

const BlurrySiteScreenShare = (() => {
  'use strict';

  let _handler   = null;
  let _sharePort = null;
  let _myTabId   = null;
  let _whoAmIPromise = null;

  /**
   * Kick off (idempotent) WHO_AM_I round-trip. Returns the cached tab id once
   * resolved. Safe to call from content_script init before _myTabId is known.
   */
  function whoAmI() {
    if (_myTabId !== null) return Promise.resolve(_myTabId);
    if (_whoAmIPromise) return _whoAmIPromise;
    _whoAmIPromise = new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: blsi.command.who_am_i }, function (resp) {
          // Swallow lastError — happens during SW startup races.
          void chrome.runtime.lastError;
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
    destroy(); // deregister any prior listener before adding a new one
    whoAmI(); // fire-and-forget — caches _myTabId for resolve()
    _handler = function(e) {
      if (e.detail.active) {
        // Open a persistent port — its lifetime IS the share's lifetime.
        // Port disconnect fires on any exit: crash, close, navigation, or normal end.
        _sharePort = chrome.runtime.connect({ name: 'blsi-screen-share' });
        chrome.runtime.sendMessage({ type: blsi.command.screen_share_started }).catch(function() {});
      } else {
        // Normal end: disconnect port first (background also reacts to disconnect),
        // then send ENDED as a redundant cleanup signal.
        if (_sharePort) { _sharePort.disconnect(); _sharePort = null; }
        chrome.runtime.sendMessage({ type: blsi.command.screen_share_ended }).catch(function() {});
      }
    };
    document.addEventListener('__blsi_screen_share', _handler);
  }

  function destroy() {
    if (_sharePort) { _sharePort.disconnect(); _sharePort = null; }
    if (_handler) document.removeEventListener('__blsi_screen_share', _handler);
    _handler = null;
  }

  return { init: init, destroy: destroy, whoAmI: whoAmI, getTabId: getTabId };
})();

blsi.ScreenShare = BlurrySiteScreenShare;
