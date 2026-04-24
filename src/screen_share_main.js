/**
 * screen_share_main.js — getDisplayMedia interceptor (MAIN world)
 *
 * Declared in manifest.json with world:"MAIN" and run_at:"document_start".
 * Runs inside the page's own JavaScript context before any page code executes,
 * so the wrapper is in place before a web app can call getDisplayMedia().
 *
 * No chrome.* or blsi.* APIs — communicates with the isolated-world
 * screen_share.js exclusively via a CustomEvent on document.
 */
(function () {
  'use strict';

  if (!navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== 'function') return;

  var _orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

  function _dispatch(active) {
    document.dispatchEvent(
      new CustomEvent('__blsi_screen_share', { detail: { active: active } })
    );
  }

  navigator.mediaDevices.getDisplayMedia = async function (constraints) {
    var stream = await _orig(constraints);
    _dispatch(true);

    var tracks  = stream.getTracks();
    var pending = tracks.length;

    if (pending === 0) { _dispatch(false); return stream; }

    tracks.forEach(function (track) {
      track.addEventListener('ended', function () {
        if (--pending === 0) _dispatch(false);
      });
    });

    return stream;
  };
}());
