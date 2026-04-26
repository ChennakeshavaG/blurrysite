/**
 * screen_share.js — Screen share event bridge (isolated world)
 *
 * Listens for '__blsi_screen_share' CustomEvents dispatched by main_world_bridge.js
 * (world: "MAIN") and relays them to the background via chrome.runtime messaging.
 * Background fans out SCREEN_SHARE_BLUR to all other open tabs.
 *
 * The getDisplayMedia() interceptor lives in main_world_bridge.js (world: "MAIN",
 * run_at: "document_start") — no script injection here.
 *
 * Covers: web-app screen shares only. OS-level captures (Zoom desktop, Discord)
 * are not detectable via browser APIs.
 *
 * Exposed as blsi.ScreenShare (IIFE — no ES module syntax).
 */

const BlurrySiteScreenShare = (() => {
  'use strict';

  let _handler   = null;
  let _sharePort = null;

  function init() {
    destroy(); // deregister any prior listener before adding a new one
    _handler = function(e) {
      if (e.detail.active) {
        // Open a persistent port — its lifetime IS the share's lifetime.
        // Port disconnect fires on any exit: crash, close, navigation, or normal end.
        // background.js onConnect handler fans out SCREEN_SHARE_BLUR to other tabs.
        _sharePort = chrome.runtime.connect({ name: 'blsi-screen-share' });
        chrome.runtime.sendMessage({ type: blsi.command.screen_share_started }).catch(function() {});
      } else {
        // Normal end: disconnect port first (triggers background onDisconnect fan-out),
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

  return { init: init, destroy: destroy };
})();

blsi.ScreenShare = BlurrySiteScreenShare;
