# core/engine_state.js — contract

Shared private state for the blur engine. Five vars cross sub-module boundaries; centralising them in `blsi.EngineState` avoids forward references between core/* IIFEs that load in different orders.

## Module identity

- File: `src/core/engine_state.js`
- Global: `blsi.EngineState`
- Load order (manifest.json): after `fonts.js`, before `blur_engine.js`.

## State

| Var | Default | Meaning |
|---|---|---|
| `isPageBlurred` | `false` | True while blur-all is active for the current host on the main document. |
| `pickerActive` | `false` | True while the picker UI is in capture mode. Gates the engine's stamp drain in the MO callback so picker clicks don't race against auto-stamping. |
| `currentSettings` | `null` | Snapshot passed to the most recent `handleSite()` call. MO callback reads this to know which mode / categories / thorough flag to apply when stamping new nodes; iframe stamping reads it too. Null until the first `handleSite()` runs. |
| `pickBlurDynamicActive` | `false` | True when ≥ 1 active dynamic pick-blur item exists. Gates the MO callback so pick-blur-only users (blur-all off) still get late-loading elements stamped. |
| `blurredCount` | `0` | Running count of elements currently stamped with `data-bl-si-blur`. Used by the `blsi.Engine.blurredCount` getter for status reporting. Maintained in O(1) by every apply / remove / stamp / teardown path. |

## Public API

| Method | Returns | Side effects |
|---|---|---|
| `getIsPageBlurred()` | `boolean` | none |
| `setIsPageBlurred(v)` | — | coerces `v` to boolean |
| `getPickerActive()` | `boolean` | none |
| `setPickerActive(v)` | — | coerces `v` to boolean |
| `getCurrentSettings()` | `object \| null` | none |
| `setCurrentSettings(v)` | — | stores reference (no clone) |
| `getPickBlurDynamicActive()` | `boolean` | none |
| `setPickBlurDynamicActive(v)` | — | coerces `v` to boolean |
| `getBlurredCount()` | `number` | none |
| `incrementBlurredCount()` | — | post-increment |
| `decrementBlurredCount()` | — | post-decrement (allows negatives — caller must avoid double-removal) |

## Ownership

| Var | Writer (sole, by convention) | Readers |
|---|---|---|
| `isPageBlurred` | `engine.js` (`handleSite`) | `observer.js` (MO gate), `engine.js` (facade getter) |
| `pickerActive` | `engine.js` (`_setPickerActiveForObserver`) | `observer.js` (MO gate) |
| `currentSettings` | `engine.js` (`handleSite`) | `observer.js` (MO callback for shadow / iframe dispatch), `engine.js` (shadow-attach listener) |
| `pickBlurDynamicActive` | `target_engine.js` (`_reconcileItems`) | `observer.js` (MO gate), `engine.js` (re-attach observer when blur-all off but pick-blur on) |
| `blurredCount` | `marker_engine.js` (apply / remove / stamp), `engine.js` (teardown decrement) | `engine.js` (facade getter) |

## Edge cases

- All getters return defaults before the first `handleSite()` runs. MO callbacks tolerate this — they short-circuit when state is unset.
- `setCurrentSettings(null)` is a valid sentinel (e.g. on extension disable) — readers must null-check.
- `decrementBlurredCount()` can drive the count negative if a caller double-removes. Callers (apply/remove paths) gate on `dataset.blSiBlur` presence first to avoid that.

## Why this module exists (Why)

Splitting `blur_engine.js` into multiple IIFEs requires a way for sub-modules to read/write each other's state without forming circular references at IIFE init time. Putting the 5 cross-cutting vars behind getters/setters in a separate IIFE that loads first (`engine_state.js`) means later modules can capture `blsi.EngineState` once at their own init and read at call time.

## How to apply (How)

- Read state inside functions, not at IIFE init.
- Don't introduce new shared vars here without first asking whether they belong to a single owner module instead. Most state should stay private to its owner; this module is the escape hatch for state that genuinely crosses boundaries.
