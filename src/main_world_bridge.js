/**
 * main_world_bridge.js — Native API interceptors (MAIN world)
 *
 * Declared in manifest.json with world:"MAIN" and run_at:"document_start".
 * Runs inside the page's own JavaScript context before any page code executes,
 * so all patches are in place before a web app calls any intercepted API.
 *
 * No chrome.* or blsi.* APIs — communicates with the isolated-world
 * counterparts exclusively via CustomEvents on document / target elements.
 *
 * Intercepted APIs:
 *   navigator.mediaDevices.getDisplayMedia  → '__blsi_screen_share' on document
 *   Element.prototype.attachShadow          → '__blsi_shadow_attached' on the element
 */
(function () {
  'use strict';

  // ── Screen share interception ─────────────────────────────────────────────

  if (navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function') {

    var _origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

    function _dispatchScreenShare(active) {
      window.postMessage(
        { type: '__blsi_screen_share', active: active },
        '*'
      );
    }

    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      var stream = await _origGetDisplayMedia(constraints);
      _dispatchScreenShare(true);

      var tracks  = stream.getTracks();
      var pending = tracks.length;

      if (pending === 0) { _dispatchScreenShare(false); return stream; }

      tracks.forEach(function (track) {
        track.addEventListener('ended', function () {
          if (--pending === 0) _dispatchScreenShare(false);
        });
      });

      return stream;
    };
  }

  // ── Shadow root attachment interception ───────────────────────────────────
  // attachShadow() is not a DOM tree mutation — MutationObserver never fires
  // for it. Patching here lets blur_engine.js discover and observe shadow roots
  // that are attached asynchronously (after the idle-callback stamp pass).
  // Closed shadow roots are skipped — el.shadowRoot returns null from outside
  // the component regardless, so there is nothing to observe.

  if (typeof Element !== 'undefined' &&
      typeof Element.prototype.attachShadow === 'function') {

    var _origAttachShadow = Element.prototype.attachShadow;

    Element.prototype.attachShadow = function (init) {
      var shadow = _origAttachShadow.call(this, init);
      if (!init || init.mode !== 'closed') {
        this.dispatchEvent(
          new CustomEvent('__blsi_shadow_attached', { bubbles: true, composed: true })
        );
      }
      return shadow;
    };
  }

}());
