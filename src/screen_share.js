/**
 * screen_share.js — Screen share detection via getDisplayMedia() wrapping
 *
 * Injects a tiny script into the page's MAIN world to intercept getDisplayMedia()
 * calls. When a web app (Google Meet, Zoom web, Teams) starts or stops a screen
 * share, notifies the background via SCREEN_SHARE_STARTED / SCREEN_SHARE_ENDED.
 * Background fans out SCREEN_SHARE_BLUR to all other open tabs.
 *
 * Covers: web-app screen shares only. OS-level captures (Zoom desktop, Discord)
 * are not detectable via browser APIs.
 *
 * Exposed as blsi.ScreenShare (IIFE — no ES module syntax).
 */

const BlurrySiteScreenShare = (() => {
  'use strict';

  let _handler = null;

  function _inject() {
    var s = document.createElement('script');
    s.textContent = '(function(){' +
      'var orig=navigator.mediaDevices&&' +
      'typeof navigator.mediaDevices.getDisplayMedia==="function"' +
      '?navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices):null;' +
      'if(!orig)return;' +
      'navigator.mediaDevices.getDisplayMedia=async function(c){' +
      'var stream=await orig(c);' +
      'document.dispatchEvent(new CustomEvent("__blsi_screen_share",{detail:{active:true}}));' +
      'var tracks=stream.getTracks(),n=tracks.length;' +
      'if(n===0){' +
      'document.dispatchEvent(new CustomEvent("__blsi_screen_share",{detail:{active:false}}));' +
      'return stream;}' +
      'tracks.forEach(function(t){' +
      't.addEventListener("ended",function(){' +
      'if(--n===0)document.dispatchEvent(new CustomEvent("__blsi_screen_share",{detail:{active:false}}));' +
      '});});' +
      'return stream;};' +
      '})();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  function init() {
    _inject();
    _handler = function(e) {
      var type = e.detail.active
        ? blsi.command.screen_share_started
        : blsi.command.screen_share_ended;
      chrome.runtime.sendMessage({ type: type }).catch(function() {});
    };
    document.addEventListener('__blsi_screen_share', _handler);
  }

  function destroy() {
    if (_handler) document.removeEventListener('__blsi_screen_share', _handler);
    _handler = null;
  }

  return { init: init, destroy: destroy };
})();

blsi.ScreenShare = BlurrySiteScreenShare;
