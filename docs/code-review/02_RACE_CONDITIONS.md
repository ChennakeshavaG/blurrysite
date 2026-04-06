# Code Review: Race Conditions

## 1. UPDATE_SETTINGS and init() race on applyState
**File:** `src/content_script.js:538-603`
**Severity:** HIGH

Both `init()` and `UPDATE_SETTINGS` handler call `applyState()` concurrently with different settings. Last caller wins, potentially overwriting init's resolved settings.

**Timeline:**
1. init() starts, awaits getSettings()
2. UPDATE_SETTINGS arrives, starts async handler
3. Both call applyState() — settings applied out of order

---

## 2. startDomObserver before Engine is initialized
**File:** `src/content_script.js:79-112, 753`
**Severity:** CRITICAL

If `TOGGLE_BLUR_ALL` fires before `init()` assigns `Engine` (line 753), MO callback calls `Engine.tryBlurTextCheck()` on null → crash.

**Fix:** Guard all Engine calls with null check in handleMessage.

---

## 3. storage.onChanged races with UPDATE_SETTINGS
**File:** `src/content_script.js:859-878`
**Severity:** MEDIUM

Popup saves settings → background writes to storage → both `storage.onChanged` and `UPDATE_SETTINGS` fire, both calling `applyState()` with different merge orders.

---

## 4. Multiple tabs race on blur state
**File:** `src/storage_manager.js:126-135`
**Severity:** MEDIUM

Two tabs call `getBlurState()`/`saveBlurState()` concurrently for same hostname. One tab's state overwrites the other's.

---

## 5. SHORTCUTS validation allows post-validation mutation
**File:** `src/constants.js:268-279`
**Severity:** HIGH

After `validateSettings()`, the SHORTCUTS keys array is a mutable object (not re-frozen after JSON clone). A concurrent modifier could alter shortcut bindings between validation and use.

---

## 6. _textCheckSet may be empty when MO fires
**File:** `src/blur_engine.js:107-117, 242-251`
**Severity:** MEDIUM

`_textCheckSet` is only built inside `injectBlurRules()`. If blur state is restored from storage before `injectBlurRules()` is explicitly called, MO's `tryBlurTextCheck()` checks an empty Set.
