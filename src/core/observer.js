/**
 * core/observer.js — MutationObserver lifecycle + idle-batched drain +
 * subscriber dispatch.
 *
 * One observer per root (document + each shadow root + iframes-in-main),
 * keyed in a WeakMap so detached shadow roots GC cleanly. Two independent
 * buffers per MO tick:
 *
 *   _pendingMoNodes     — element-add nodes for the engine's stamp /
 *                         pick-blur / shadow / iframe drain. Gated by
 *                         !pickerActive && (isPageBlurred || pickBlurDynamicActive).
 *   _pendingMutations   — raw MutationRecord[] per root for subscriber
 *                         dispatch (PII detector, future modules). Always
 *                         buffered when ≥ 1 subscriber is registered.
 *
 * The MAIN-world bridge dispatches `__blsi_shadow_attached` events on
 * `attachShadow()` calls because MutationObserver childList does not fire
 * for property assignments. initShadowAttachListener bridges that gap so
 * shadow roots attached after the initial idle pass still get observed.
 *
 * Cross-module reads:
 *   - blsi.EngineState.{getIsPageBlurred, getPickBlurDynamicActive,
 *                       getPickerActive, getCurrentSettings}
 *   - blsi.MarkerEngine.{stampElements, tryBlurTextCheck}
 *   - blsi.CssManager.injectRules
 *   - blsi.TargetEngine.tryPickBlurNode
 *   - blsi.Engine.{handleShadowRoot, handleIframe}   (resolved at MO-callback time)
 *
 * Exposed as blsi.Observer (IIFE — no ES module syntax).
 */

const BlurrySiteObserver = (() => {
  'use strict';

  const State  = blsi.EngineState;

  // WeakMap<root, MutationObserver> — auto-GCs entries when a shadow root is
  // GC'd (host removed from DOM).
  const _observers = new WeakMap();

  let _stampIdlePending = false;
  let _stampQueue = [];           // [{root, cats, thorough, mode}]
  const _pendingMoNodes = [];     // nodes collected by MO; drained by a single idle
  let _moIdlePending = false;

  // Mutation dispatcher — subscribers receive raw MutationRecord[] per root in
  // the same idle drain. Insertion order is preserved (Map).
  const _subscribers = new Map();   // name → handler(mutations, root)
  const _pendingMutations = new Map(); // root → MutationRecord[]

  let _shadowAttachHandler = null; // capture listener for __blsi_shadow_attached events

  function _scheduleIdle(fn) {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(fn, { timeout: 300 });
    } else {
      setTimeout(fn, 0);
    }
  }

  function _scheduleStampIdle() {
    if (_stampIdlePending) return;
    _stampIdlePending = true;
    _scheduleIdle(_flushStampQueue);
  }

  // Drain MO-collected work and dispatch raw mutations to subscribers.
  // Engine drain runs first (stamp / pick-blur / shadow / iframe), then
  // subscribers receive their per-root MutationRecord[] in registration order.
  // Subscriber errors are caught so one bad subscriber can't stall others.
  function _drainMoIdle() {
    _moIdlePending = false;

    // 1. Engine drain — element-centric childList work.
    const blurAllOn = State.getIsPageBlurred();
    const pickBlurOn = State.getPickBlurDynamicActive();
    const _settings = State.getCurrentSettings();
    if ((blurAllOn || pickBlurOn) && _pendingMoNodes.length > 0) {
      const Marker = blsi.MarkerEngine;
      const Targets = blsi.TargetEngine;
      const facade = blsi.Engine;
      const thorough = _settings ? !!_settings.thorough_blur : false;
      const raw = _pendingMoNodes.splice(0);
      // Drop nodes whose subtree is already covered by an ancestor in the
      // same batch — prevents double-walking when a SPA inserts a container
      // in one MO tick and its children in another before the idle fires.
      const nodes = raw.filter(n =>
        !raw.some(other => other !== n && other.contains && other.contains(n))
      );
      for (let n = 0; n < nodes.length; n++) {
        const node = nodes[n];
        if (blurAllOn) Marker.tryBlurTextCheck(node, thorough);
        if (pickBlurOn) Targets.tryPickBlurNode(node);
        if (blurAllOn && _settings) {
          if (node.shadowRoot && !_observers.has(node.shadowRoot)) {
            facade.handleShadowRoot(_settings, node.shadowRoot);
          }
          if (node.tagName === 'IFRAME') {
            facade.handleIframe(_settings, node);
          }
        }
        const children = node.querySelectorAll('*');
        for (let i = 0; i < children.length; i++) {
          if (blurAllOn) Marker.tryBlurTextCheck(children[i], thorough);
          if (pickBlurOn) Targets.tryPickBlurNode(children[i]);
          if (blurAllOn && _settings) {
            if (children[i].shadowRoot && !_observers.has(children[i].shadowRoot)) {
              facade.handleShadowRoot(_settings, children[i].shadowRoot);
            }
            if (children[i].tagName === 'IFRAME') {
              facade.handleIframe(_settings, children[i]);
            }
          }
        }
      }
    } else if (!blurAllOn && !pickBlurOn) {
      // Engine inactive — discard the engine-only node buffer from a stale tick.
      // _pendingMutations are NOT discarded here; subscribers (PII / future)
      // are dispatched in step 2 below regardless of engine state.
      _pendingMoNodes.length = 0;
    }

    // 2. Subscriber dispatch — raw MutationRecord[] per root, in registration order.
    if (_subscribers.size > 0 && _pendingMutations.size > 0) {
      const buckets = Array.from(_pendingMutations.entries());
      _pendingMutations.clear();
      for (let i = 0; i < buckets.length; i++) {
        const root = buckets[i][0];
        const recs = buckets[i][1];
        for (const [name, handler] of _subscribers) {
          try {
            handler(recs, root);
          } catch (err) {
            if (typeof blsi !== 'undefined' && blsi.Logger) {
              blsi.Logger.scope('engine').error('subscriber error', name, err);
            }
          }
        }
      }
    } else if (_pendingMutations.size > 0) {
      // No subscribers — drop buffered mutations.
      _pendingMutations.clear();
    }
  }

  function _flushStampQueue(deadline) {
    _stampIdlePending = false;
    while (_stampQueue.length > 0) {
      if (deadline && deadline.timeRemaining() < 1) {
        _scheduleStampIdle();
        return;
      }
      // teardown() clears the queue for the inactive path — no extra guard needed.
      const { root, cats, thorough, mode } = _stampQueue.shift();

      const shadowRoots = blsi.MarkerEngine.stampElements(root, cats, thorough, mode);

      // observeRoot and CSS injection for discovered shadow roots happen
      // immediately (eager), before the SR is queued for stamp work, so
      // content added to the SR before the idle processes it is captured.
      for (const sr of shadowRoots) {
        blsi.CssManager.injectRules(sr, cats, mode);
        observeRoot(sr);
        _stampQueue.push({ root: sr, cats, thorough, mode });
      }
    }
  }

  /**
   * Register a MutationObserver on `root` to stamp new text-check elements
   * and activate shadow roots as they appear. Idempotent — no-op if `root`
   * already has an active observer.
   *
   * Observation target: `root.body ?? root`
   *   - document: observes document.body
   *   - shadowRoot: observes the shadow root itself (shadowRoot.body is undefined)
   */
  function observeRoot(root) {
    if (_observers.has(root)) return;
    const target = root.body ?? root;
    if (!target) return;

    const obs = new MutationObserver((mutations) => {
      // Two independent buffers per MO tick:
      //   1. _pendingMoNodes — element-add nodes for engine drain (stamp /
      //      pick-blur / shadow / iframe). Gated by !pickerActive and (blur-all
      //      OR pick-blur-dynamic active). Picker active silences this side
      //      because the picker owns the cursor and must not race against
      //      auto-stamping.
      //   2. _pendingMutations.get(root) — raw MutationRecord[] for subscriber
      //      dispatch (PII detector, future modules). Always buffered when at
      //      least one subscriber is registered, regardless of picker state or
      //      blur-all/pick-blur state. PII is independent of blur-all and must
      //      keep wrapping typed text while the picker is open.
      const engineActive = !State.getPickerActive() && (State.getIsPageBlurred() || State.getPickBlurDynamicActive());
      const hasSubscribers = _subscribers.size > 0;
      if (!engineActive && !hasSubscribers) return;

      if (hasSubscribers) {
        let bucket = _pendingMutations.get(root);
        if (!bucket) {
          bucket = [];
          _pendingMutations.set(root, bucket);
        }
        for (let i = 0; i < mutations.length; i++) bucket.push(mutations[i]);
      }

      let engineCollected = false;
      if (engineActive) {
        for (const mutation of mutations) {
          if (mutation.type !== 'childList') continue;
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.dataset && node.dataset.blSiZone !== undefined) continue;
            _pendingMoNodes.push(node);
            engineCollected = true;
          }
        }
      }

      if (!engineCollected && !hasSubscribers) return;

      // One idle per batch. Flag prevents duplicate scheduling when the MO
      // fires multiple times before the idle runs (e.g. async SPA inserts).
      if (_moIdlePending) return;
      _moIdlePending = true;
      _scheduleIdle(_drainMoIdle);
    });
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

  /**
   * Capture-phase listener for '__blsi_shadow_attached' CustomEvents fired by
   * main_world_bridge.js when a page calls Element.prototype.attachShadow().
   *
   * MutationObserver childList+subtree never fires for attachShadow() — it is a
   * property assignment, not a DOM tree mutation. This listener bridges the gap:
   * any shadow root attached after the idle-stamp pass is immediately observed
   * and queued for stamping, so its content is blurred on the next idle tick.
   */
  function initShadowAttachListener() {
    if (_shadowAttachHandler) return;
    _shadowAttachHandler = function (e) {
      const settings = State.getCurrentSettings();
      if (!State.getIsPageBlurred() || !settings) return;
      const el = e.target;
      if (!el || !el.shadowRoot) return;
      if (_observers.has(el.shadowRoot)) return;
      blsi.Engine.handleShadowRoot(settings, el.shadowRoot);
    };
    document.addEventListener('__blsi_shadow_attached', _shadowAttachHandler, true);
  }

  function removeShadowAttachListener() {
    if (!_shadowAttachHandler) return;
    document.removeEventListener('__blsi_shadow_attached', _shadowAttachHandler, true);
    _shadowAttachHandler = null;
  }

  // ── Mutation dispatcher public surface ─────────────────────────────────────
  // Subscribers receive raw MutationRecord[] per root inside the engine's
  // idle drain. They never own observers themselves.
  //
  // Order: invoked AFTER the engine's own stamp / pick-blur / shadow / iframe
  // pass for that batch, in registration order.
  //
  // The picker-active gate suppresses the engine's stamp drain only —
  // subscribers still fire while the picker is open. PII detector relies on
  // this to keep wrapping typed text during picker mode.
  function subscribeMutations(name, handler) {
    if (typeof name !== 'string' || !name) return;
    if (typeof handler !== 'function') return;
    _subscribers.set(name, handler);
    // Guarantee a live document MO so the subscriber receives mutations even
    // when no other engine state (blur-all / pick-blur-dynamic) keeps one
    // attached. PII detector uses this path: it scans on subscribe, then
    // relies on dispatched mutations for late-loading content. observeRoot
    // is idempotent — no-op if already observing.
    if (typeof document !== 'undefined') observeRoot(document);
  }

  function unsubscribeMutations(name) {
    _subscribers.delete(name);
    // If nothing else needs the document MO, drop it so we don't leave a
    // running observer with no consumer. Engine state must be re-checked here
    // because blur-all / pick-blur paths attach via observeRoot directly.
    if (
      _subscribers.size === 0
      && !State.getIsPageBlurred()
      && !State.getPickBlurDynamicActive()
      && typeof document !== 'undefined'
    ) {
      disconnectObserver(document);
    }
  }

  // ── Helpers used by the orchestrator on teardown ──────────────────────────
  // Engine teardown clears observer-internal buffers for the root being torn
  // down. Exposed so engine.js teardown stays self-contained without reaching
  // into observer's private maps.

  function hasSubscribers() {
    return _subscribers.size > 0;
  }

  function clearPendingMutations(root) {
    _pendingMutations.delete(root);
  }

  function clearStampQueueForRoot(root) {
    _stampQueue = _stampQueue.filter(item => item.root !== root);
  }

  function pushStampQueueItem(item) {
    _stampQueue.push(item);
  }

  return {
    // MO lifecycle
    observeRoot,
    disconnectObserver,

    // Shadow attach event bridge (initialised by orchestrator handleMainDocument)
    initShadowAttachListener,
    removeShadowAttachListener,

    // Mutation dispatcher
    subscribeMutations,
    unsubscribeMutations,
    hasSubscribers,

    // Used by orchestrator handleMainDocument / handleShadowRoot / teardown
    clearPendingMutations,
    clearStampQueueForRoot,
    pushStampQueueItem,
    scheduleStampIdle: _scheduleStampIdle,
  };
})();

blsi.Observer = BlurrySiteObserver;
