/**
 * core/observer.js — MutationObserver lifecycle, idle-batched buffer
 * processing, and subscriber dispatch.
 *
 * One observer per root (document + each shadow root + cross-origin iframes
 * in main frame), keyed in a WeakMap so detached shadow roots GC cleanly.
 *
 * Cross-module reads (resolved at call time, not import time):
 *   - blsi.EngineState.{getIsPageBlurred, getPickBlurDynamicActive,
 *                       getPickerActive, getCurrentSettings}
 *   - blsi.MarkerEngine.{stampElements, tryBlurTextCheck}
 *   - blsi.CssManager.injectRules
 *   - blsi.TargetEngine.tryPickBlurNode
 *   - blsi.Engine.{handleDocument, handleIframe}
 *
 * Exposed as blsi.Observer (IIFE — no ES module syntax).
 */

const BlurrySiteObserver = (() => {
  'use strict';

  const State = blsi.EngineState;

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 1 — Module state (private)
  // ───────────────────────────────────────────────────────────────────────

  // One MutationObserver per root. WeakMap auto-GCs entries when a shadow
  // root becomes unreachable.
  const _observers = new WeakMap();

  // Stamp queue: roots awaiting initial element-stamp pass. Populated by the
  // engine orchestrator on init / handleSite; processed on idle.
  let _stampQueue = [];               // [{root, cats, thorough, mode}]
  let _stampProcessScheduled = false;

  // MO buffers: filled by callbacks, processed together on idle.
  //   _engineNodeBuffer       — element-add nodes for engine pass (stamp /
  //                             pick-blur / shadow / iframe). Gated by
  //                             !pickerActive AND (blurAll || pickBlurDyn).
  //   _subscriberRecordBuffer — raw MutationRecord[] per root for subscriber
  //                             dispatch. Always buffered when ≥ 1 subscriber
  //                             registered; runs even while picker is open
  //                             (PII must keep wrapping typed text).
  const _engineNodeBuffer = [];
  const _subscriberRecordBuffer = new Map();   // root → MutationRecord[]
  let _processScheduled = false;

  // Chunked engine drain: flat work items carried across idle ticks.
  var ENGINE_CHUNK_SIZE = 500;
  var _engineWorkRemainder = [];

  // Subscribers (PII detector, future modules). Insertion order preserved.
  const _subscribers = new Map();     // name → handler(records, root)

  // Listener for `__blsi_shadow_attached` events from main_world_bridge.js.
  let _shadowAttachHandler = null;

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 2 — Idle scheduling primitive
  // ───────────────────────────────────────────────────────────────────────

  function _runWhenIdle(fn) {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(fn, { timeout: 300 });
    } else {
      setTimeout(fn, 0);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 3 — Stamp queue (initial stamping for new roots)
  //
  //  Discovered shadow roots are observed + CSS-injected eagerly so content
  //  added before the idle stamp is captured; the stamp itself is deferred
  //  to the next queue iteration.
  // ───────────────────────────────────────────────────────────────────────

  function _scheduleStampProcessing() {
    if (_stampProcessScheduled) return;
    _stampProcessScheduled = true;
    _runWhenIdle(_processStampQueue);
  }

  function _processStampQueue(deadline) {
    _stampProcessScheduled = false;
    while (_stampQueue.length > 0) {
      if (deadline && deadline.timeRemaining() < 1) {
        _scheduleStampProcessing();
        return;
      }
      const { root, cats, thorough, mode } = _stampQueue.shift();

      const newShadowRoots = blsi.MarkerEngine.stampElements(root, cats, thorough);

      for (const sr of newShadowRoots) {
        blsi.CssManager.injectRules(sr, cats, mode);
        observeRoot(sr);
        _stampQueue.push({ root: sr, cats, thorough, mode });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 4 — MutationObserver (live DOM change capture)
  //
  //  Each root gets its own MO. Callbacks only buffer — actual work runs on
  //  idle in SECTION 5.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Attach a MutationObserver to `root`. Idempotent.
   * Observation target is `root.body ?? root` (document → body; shadowRoot → itself).
   */
  function observeRoot(root) {
    if (_observers.has(root)) return;
    const target = root.body ?? root;
    if (!target) return;

    const obs = new MutationObserver((mutations) => _onMutations(root, mutations));
    obs.observe(target, { childList: true, subtree: true, characterData: true });
    _observers.set(root, obs);
  }

  function disconnectObserver(root) {
    const obs = _observers.get(root);
    if (obs) {
      obs.disconnect();
      _observers.delete(root);
    }
  }

  function _onMutations(root, mutations) {
    // Picker-active silences engine work because the picker owns the cursor
    // and must not race auto-stamping. Subscribers still fire.
    const engineActive = !State.getPickerActive()
                         && (State.getIsPageBlurred() || State.getPickBlurDynamicActive());
    const hasSubs = _subscribers.size > 0;
    if (!engineActive && !hasSubs) return;

    if (hasSubs) _bufferRecordsForSubscribers(root, mutations);

    const engineCollected = engineActive && _collectEngineNodes(mutations);

    if (!engineCollected && !hasSubs) return;

    // Single-flight gate: MO can fire many times before the idle runs.
    if (_processScheduled) return;
    _processScheduled = true;
    _runWhenIdle(_processObservedChanges);
  }

  function _bufferRecordsForSubscribers(root, mutations) {
    let bucket = _subscriberRecordBuffer.get(root);
    if (!bucket) {
      bucket = [];
      _subscriberRecordBuffer.set(root, bucket);
    }
    for (let i = 0; i < mutations.length; i++) bucket.push(mutations[i]);
  }

  // Returns true if any nodes were buffered. Skips zone overlays — they
  // belong to TargetEngine.
  function _collectEngineNodes(mutations) {
    let collected = false;
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.dataset && node.dataset.blSiZone !== undefined) continue;
        if (node.dataset && node.dataset.blSiPii !== undefined) continue;
        _engineNodeBuffer.push(node);
        collected = true;
      }
    }
    return collected;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 5 — Buffer processing (handle captured changes on idle)
  //
  //  Engine pass first, then subscriber dispatch. Subscriber errors are
  //  isolated — one bad subscriber can't stall others.
  // ───────────────────────────────────────────────────────────────────────

  function _processObservedChanges() {
    _processScheduled = false;

    var work;
    if (_engineWorkRemainder.length > 0) {
      work = _engineWorkRemainder;
      _engineWorkRemainder = [];
    } else {
      var nodes = _prepareEngineNodes();
      work = nodes ? _flattenForProcessing(nodes) : null;
    }

    if (work && work.length > 0) {
      var remaining = _processEngineChunk(work);
      if (remaining) {
        _engineWorkRemainder = remaining;
        _processScheduled = true;
        _runWhenIdle(_processObservedChanges);
        return;
      }
    }

    _dispatchToSubscribers();

    if (_engineNodeBuffer.length > 0 || _subscriberRecordBuffer.size > 0) {
      _processScheduled = true;
      _runWhenIdle(_processObservedChanges);
    }
  }

  function _prepareEngineNodes() {
    var blurAllOn = State.getIsPageBlurred();
    var pickBlurOn = State.getPickBlurDynamicActive();

    if (!blurAllOn && !pickBlurOn) {
      _engineNodeBuffer.length = 0;
      return null;
    }
    if (_engineNodeBuffer.length === 0) return null;

    var raw = _engineNodeBuffer.splice(0);
    var nodeSet = new Set(raw);
    return raw.filter(function (n) {
      var p = n.parentNode;
      while (p) {
        if (nodeSet.has(p)) return false;
        p = p.parentNode;
      }
      return true;
    });
  }

  function _flattenForProcessing(nodes) {
    var work = [];
    for (var i = 0; i < nodes.length; i++) {
      work.push(nodes[i]);
      var desc = nodes[i].querySelectorAll('*');
      for (var j = 0; j < desc.length; j++) work.push(desc[j]);
    }
    return work;
  }

  function _processEngineChunk(work) {
    var blurAllOn = State.getIsPageBlurred();
    var pickBlurOn = State.getPickBlurDynamicActive();
    var settings = State.getCurrentSettings();

    if (!blurAllOn && !pickBlurOn) return null;

    var Marker = blsi.MarkerEngine;
    var Targets = blsi.TargetEngine;
    var facade = blsi.Engine;
    var thorough = settings ? !!settings.thorough_blur : false;

    var end = Math.min(ENGINE_CHUNK_SIZE, work.length);
    for (var i = 0; i < end; i++) {
      _processNode(work[i], blurAllOn, pickBlurOn, settings, thorough, Marker, Targets, facade);
    }
    if (end >= work.length) return null;
    return work.slice(end);
  }

  function _processNode(node, blurAllOn, pickBlurOn, settings, thorough, Marker, Targets, facade) {
    if (blurAllOn) Marker.tryBlurTextCheck(node, thorough);
    if (pickBlurOn) Targets.tryPickBlurNode(node);
    if (blurAllOn && settings) {
      if (node.shadowRoot && !_observers.has(node.shadowRoot)) {
        facade.handleDocument(settings, node.shadowRoot);
      }
      if (node.tagName === 'IFRAME') {
        facade.handleIframe(settings, node);
      }
    }
  }

  function _dispatchToSubscribers() {
    if (_subscriberRecordBuffer.size === 0) return;
    if (_subscribers.size === 0) {
      _subscriberRecordBuffer.clear();
      return;
    }
    const buckets = Array.from(_subscriberRecordBuffer.entries());
    _subscriberRecordBuffer.clear();
    for (let i = 0; i < buckets.length; i++) {
      const root = buckets[i][0];
      const records = buckets[i][1];
      for (const [name, handler] of _subscribers) {
        try {
          handler(records, root);
        } catch (err) {
          if (blsi.Logger) blsi.Logger.scope('engine').error('subscriber error', name, err);
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 6 — Subscriber pub/sub
  //
  //  Subscribers receive raw MutationRecord[] per root inside the engine's
  //  idle pass, in registration order. They never own observers themselves.
  // ───────────────────────────────────────────────────────────────────────

  function subscribeMutations(name, handler) {
    if (typeof name !== 'string' || !name) return;
    if (typeof handler !== 'function') return;
    _subscribers.set(name, handler);
    // Guarantee a live document MO so subscribers receive mutations even
    // when blur-all and pick-blur-dynamic are both off (PII-only path).
    if (typeof document !== 'undefined') observeRoot(document);
  }

  function unsubscribeMutations(name) {
    _subscribers.delete(name);
    // Drop the document MO if nothing else needs it. Engine state must be
    // re-checked because blur-all / pick-blur paths attach via observeRoot.
    if (
      _subscribers.size === 0
      && !State.getIsPageBlurred()
      && !State.getPickBlurDynamicActive()
      && typeof document !== 'undefined'
    ) {
      disconnectObserver(document);
    }
  }

  function hasSubscribers() {
    return _subscribers.size > 0;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 7 — Shadow root attach bridge
  //
  //  MutationObserver childList+subtree never fires for attachShadow() —
  //  it's a property assignment, not a tree mutation. main_world_bridge.js
  //  patches Element.prototype.attachShadow and dispatches a CustomEvent;
  //  this listener catches it and observes the new shadow root immediately.
  // ───────────────────────────────────────────────────────────────────────

  function initShadowAttachListener() {
    if (_shadowAttachHandler) return;
    _shadowAttachHandler = function (e) {
      const settings = State.getCurrentSettings();
      if (!State.getIsPageBlurred() || !settings) return;
      const el = e.target;
      if (!el || !el.shadowRoot) return;
      if (_observers.has(el.shadowRoot)) return;
      blsi.Engine.handleDocument(settings, el.shadowRoot);
    };
    document.addEventListener('__blsi_shadow_attached', _shadowAttachHandler, true);
  }

  function removeShadowAttachListener() {
    if (!_shadowAttachHandler) return;
    document.removeEventListener('__blsi_shadow_attached', _shadowAttachHandler, true);
    _shadowAttachHandler = null;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 8 — Teardown helpers (used by engine orchestrator)
  // ───────────────────────────────────────────────────────────────────────

  function clearPendingMutations(root) {
    _subscriberRecordBuffer.delete(root);
  }

  function clearStampQueueForRoot(root) {
    _stampQueue = _stampQueue.filter(item => item.root !== root);
  }

  function pushStampQueueItem(item) {
    _stampQueue.push(item);
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SECTION 9 — Public surface
  // ───────────────────────────────────────────────────────────────────────

  return {
    observeRoot,
    disconnectObserver,

    initShadowAttachListener,
    removeShadowAttachListener,

    subscribeMutations,
    unsubscribeMutations,
    hasSubscribers,

    clearPendingMutations,
    clearStampQueueForRoot,
    pushStampQueueItem,
    scheduleStampIdle: _scheduleStampProcessing,
  };
})();

blsi.Observer = BlurrySiteObserver;
