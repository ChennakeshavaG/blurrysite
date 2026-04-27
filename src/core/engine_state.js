/**
 * core/engine_state.js — shared private state for the blur engine.
 *
 * Five vars cross module boundaries; centralising them here avoids forward
 * references between core/* IIFEs that load in different orders.
 *
 *   isPageBlurred         — orchestrator writes (engine.js); observer reads (MO gate).
 *   pickerActive          — orchestrator writes (engine.js _setPickerActiveForObserver);
 *                           observer reads (MO gate).
 *   currentSettings       — orchestrator writes (engine.js handleSite); observer reads
 *                           (MO callback); engine.js reads (iframe stamping).
 *   pickBlurDynamicActive — target_engine writes (on item reconcile); observer reads
 *                           (MO gate for pick-blur-only users).
 *   blurredCount          — marker_engine writes (apply/remove/stamp), engine.js writes
 *                           (teardown decrements). Read by engine.js facade getter.
 *
 * Reads happen at call time; before handleSite first runs, getters return the
 * defaults below — callers (MO callback, getters) tolerate the unset state.
 *
 * Exposed as blsi.EngineState (IIFE — no ES module syntax).
 */

const BlurrySiteEngineState = (() => {
  'use strict';

  let _isPageBlurred = false;
  let _pickerActive = false;
  let _currentSettings = null;
  let _pickBlurDynamicActive = false;
  let _blurredCount = 0;

  return {
    getIsPageBlurred() { return _isPageBlurred; },
    setIsPageBlurred(v) { _isPageBlurred = !!v; },

    getPickerActive() { return _pickerActive; },
    setPickerActive(v) { _pickerActive = !!v; },

    getCurrentSettings() { return _currentSettings; },
    setCurrentSettings(v) { _currentSettings = v; },

    getPickBlurDynamicActive() { return _pickBlurDynamicActive; },
    setPickBlurDynamicActive(v) { _pickBlurDynamicActive = !!v; },

    getBlurredCount() { return _blurredCount; },
    incrementBlurredCount() { _blurredCount++; },
    decrementBlurredCount() { _blurredCount--; },
  };
})();

blsi.EngineState = BlurrySiteEngineState;
