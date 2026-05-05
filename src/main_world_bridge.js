/**
 * main_world_bridge.js — Native API interceptors (MAIN world)
 *
 * Declared in manifest.json with world:"MAIN" and run_at:"document_start".
 * Runs inside the page's own JavaScript context before any page code executes,
 * so all patches are in place before a web app calls any intercepted API.
 *
 * No chrome.* or blsi.* APIs — communicates with the isolated-world
 * counterparts exclusively via postMessage / CustomEvents.
 *
 * Intercepted APIs:
 *   MediaDevices.prototype.getDisplayMedia  → '__blsi_screen_share' via postMessage
 *   Element.prototype.attachShadow          → '__blsi_shadow_attached' on the element
 */
(function () {
  'use strict';

  // ── Screen share interception ─────────────────────────────────────────────

  if (typeof MediaDevices !== 'undefined' &&
      typeof MediaDevices.prototype.getDisplayMedia === 'function') {

    var _origProto = MediaDevices.prototype.getDisplayMedia;

    function _dispatchScreenShare(active, streamId) {
      window.postMessage(
        { type: '__blsi_screen_share', active: active, streamId: streamId },
        '*'
      );
    }

    function _hookStream(stream) {
      var sid  = stream.id || ('_fb_' + Math.random().toString(36).slice(2, 10));
      var done = false;

      function _checkEnded() {
        if (done || stream.active) return;
        done = true;
        _dispatchScreenShare(false, sid);
      }

      var tracks = stream.getTracks();
      if (tracks.length === 0) { _dispatchScreenShare(false, sid); return; }

      tracks.forEach(function (track) {
        track.addEventListener('ended', _checkEnded);
      });
      stream.addEventListener('inactive', _checkEnded);

      var _poll = setInterval(function () {
        _checkEnded();
        if (done) clearInterval(_poll);
      }, 2000);
    }

    MediaDevices.prototype.getDisplayMedia = async function (constraints) {
      var stream = await _origProto.call(this, constraints);
      var sid = stream.id || ('_fb_' + Math.random().toString(36).slice(2, 10));
      _dispatchScreenShare(true, sid);
      _hookStream(stream);
      return stream;
    };
    MediaDevices.prototype.__blsi_patched = true;

    // ── Same-origin iframe propagation ────────────────────────────────────
    // Closes timing gap: about:blank iframes have contentWindow available
    // synchronously before Chrome's all_frames injection arrives.

    function _patchFrame(win) {
      try {
        if (win && win.MediaDevices &&
            win.MediaDevices.prototype.getDisplayMedia &&
            !win.MediaDevices.prototype.__blsi_patched) {
          var _orig = win.MediaDevices.prototype.getDisplayMedia;
          win.MediaDevices.prototype.getDisplayMedia = async function (c) {
            var s = await _orig.call(this, c);
            var id = s.id || ('_fb_' + Math.random().toString(36).slice(2, 10));
            _dispatchScreenShare(true, id);
            _hookStream(s);
            return s;
          };
          win.MediaDevices.prototype.__blsi_patched = true;
        }
      } catch (_) { /* cross-origin — Chrome all_frames handles it */ }
    }

    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeName === 'IFRAME') {
              _patchFrame(node.contentWindow);
            } else if (node.querySelectorAll) {
              var iframes = node.querySelectorAll('iframe');
              for (var k = 0; k < iframes.length; k++) {
                _patchFrame(iframes[k].contentWindow);
              }
            }
          }
        }
      }).observe(document.documentElement || document, { childList: true, subtree: true });
    }
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
