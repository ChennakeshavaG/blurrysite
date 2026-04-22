# Dossier 1 — Current Shortcut Implementation

## 1. Storage Shape

### Exact Structure of `settings.SHORTCUTS`

The complete default structure is defined in `/Users/keshava-13944/blurrysite/src/constants.js` (lines 151–173):

```javascript
SHORTCUTS: Object.freeze({
  TOGGLE_BLUR_ALL: Object.freeze({
    primaryModifier: 'AltLeft',
    keys: Object.freeze([
      Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
      Object.freeze({ key: 'b',     code: 'KeyB' }),
    ]),
  }),
  TOGGLE_PICKER: Object.freeze({
    primaryModifier: 'AltLeft',
    keys: Object.freeze([
      Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
      Object.freeze({ key: 'p',     code: 'KeyP' }),
    ]),
  }),
  CLEAR_ALL: Object.freeze({
    primaryModifier: 'AltLeft',
    keys: Object.freeze([
      Object.freeze({ key: 'Shift', code: 'ShiftLeft' }),
      Object.freeze({ key: 'u',     code: 'KeyU' }),
    ]),
  }),
})
```

**Per-command shape:**
- `primaryModifier`: A single `event.code` string representing a modifier key (e.g., `'AltLeft'`, `'ControlLeft'`, `'MetaLeft'`). This is the **mandatory** modifier that must be held before additional keys are pressed.
- `keys`: An array of `{ key, code }` objects representing the non-modifier keys required. Order does not matter (simultaneous press detection).

**Validation in `validateSettings()` (constants.js lines 269–285):**
```javascript
result.SHORTCUTS = {};
const sc = (settings.SHORTCUTS && typeof settings.SHORTCUTS === 'object')
  ? settings.SHORTCUTS : {};
for (const action of Object.keys(defaults.SHORTCUTS)) {
  const binding = sc[action];
  if (binding &&
      typeof binding.primaryModifier === 'string' &&
      Array.isArray(binding.keys) &&
      binding.keys.length > 0 &&
      binding.keys.length <= 10 &&
      binding.keys.every(k => k && typeof k.key === 'string' && typeof k.code === 'string')) {
    result.SHORTCUTS[action] = binding;
  } else {
    result.SHORTCUTS[action] = JSON.parse(JSON.stringify(defaults.SHORTCUTS[action]));
  }
}
```

Validation enforces:
- `primaryModifier` is a string
- `keys` is a non-empty array, max 10 elements
- Each key object has both `key` and `code` as strings
- Repairs any invalid binding by restoring the default

**Storage persistence:** `chrome.storage.local` under the `"settings"` key. The background.js service worker reads and merges with defaults on install/startup (background.js lines 49–57), ensuring settings always have a complete shape.

### `primaryModifier` Semantic

`primaryModifier` is **separate from `keys`** to support this matching rule: a shortcut fires only when the primary modifier is held **and all keys in the `keys[]` array are pressed simultaneously**. The distinction allows the system to:
1. Require a mandatory modifier (prevents accidental single-key triggers like just pressing 'B')
2. Support multi-key chords like Alt+Shift+B where Shift is itself a modifier (but not the primary one)

The modifier-vs-non-modifier distinction is enforced by the event listener guard: `isPrimaryModifierHeld()` checks both `event[propertyName]` (the event boolean) and `heldKeys.has(modifierCode)` to verify the specific left/right side.

---

## 2. Dual Representation of Keys: `key` vs `code`

Every shortcut chord element carries both `key` and `code` fields:
```javascript
{ key: 'Shift', code: 'ShiftLeft' }
{ key: 'b',     code: 'KeyB' }
```

### Places That Use `.key`

1. **Popup capture display (popup.js lines 480–482):**
   ```javascript
   function updateDisplay() {
     const parts = [];
     if (scPrimaryMod) parts.push(Renderer.codeLabel(scPrimaryMod));
     for (const k of scKeys) parts.push(Renderer.CODE_LABELS[k.code] || k.key.toUpperCase());
     ui.captureDisplay.textContent = parts.length > 0 ? parts.join(' + ') : I18n.t('shortcut_modal_placeholder');
   }
   ```
   Falls back to `.key.toUpperCase()` if `CODE_LABELS` has no entry for the `.code`.

2. **Popup shortcut capture (popup.js lines 496–507):** Stores both values:
   ```javascript
   scKeys.push({ key: e.key, code: e.code });
   ```

### Places That Use `.code`

1. **Shortcut handler init (shortcut_handler.js lines 168–169):** Extracts codes for O(1) Set lookups:
   ```javascript
   keyCodes: binding.keys.map(k => k.code).filter(Boolean),
   ```

2. **Shortcut handler matching (shortcut_handler.js lines 202–207):** All matching logic uses codes:
   ```javascript
   let allHeld = true;
   for (let j = 0; j < sc.keyCodes.length; j++) {
     if (!heldKeys.has(sc.keyCodes[j])) {
       allHeld = false;
       break;
     }
   }
   ```

3. **Window blur / keydown / keyup listeners (shortcut_handler.js lines 182, 225):**
   ```javascript
   if (event.code) heldKeys.add(event.code);
   if (event.code) heldKeys.delete(event.code);
   ```

4. **Popup capture state (popup.js lines 462, 495–497):**
   ```javascript
   let scKeyCodes = new Set();
   if (MODIFIER_CODES.has(e.code) && scPrimaryMod && !scKeyCodes.has(e.code)) {
     scKeys.push({ key: e.key, code: e.code });
     scKeyCodes.add(e.code);
   }
   ```

### Source of Truth at Runtime

**For matching:** `.code` is the source of truth. `heldKeys` is a `Set<string>` of `event.code` values (line 32–33 shortcut_handler.js). The runtime comparison (lines 202–207) checks only codes. This is correct because `.code` is layout-independent (physical key position).

**For display:** `.code` is the source of truth via `Renderer.CODE_LABELS` lookup table (popup_settings_renderer.js lines 48–54):
```javascript
const CODE_LABELS = {
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt',
  MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd',
  CapsLock: 'CapsLock', Fn: 'Fn',
};
```
Falls back to `.key.toUpperCase()` only if the code has no label (popup.js line 481).

### Why Both Exist

- `.code` is invariant across keyboard layouts (e.g., QWERTY vs AZERTY) — allows data portability and platform-consistency
- `.key` is human-friendly for fallback display and is what the user typically thinks of when they press a key
- Storage and display both store both fields for robustness and future-proofing

### Drift Risk

There is **no guard** preventing `.key` and `.code` from drifting. If captured or edited values have mismatched pairs (e.g., `{ key: 'Z', code: 'KeyB' }`), the handler will use only the `.code` for matching (correct behavior), but display will be inconsistent. The popup capture enforces pairing (lines 496–507), so in normal operation drift is unlikely unless settings are hand-edited in `chrome://extensions` DevTools.

---

## 3. Matching Logic in `shortcut_handler.js`

### Line-by-Line Trace of `init()` and `onKeyDown()`

**Initialization (lines 154–171):**
1. `destroy()` clears previous state (lines 155)
2. Store callbacks reference (line 157)
3. Parse shortcuts into a flat array for fast O(n) iteration (lines 160–171):
   - Skip null/invalid entries (line 163)
   - Pre-extract `.code` values into `keyCodes` array for faster Set lookups (line 168)
   - Store `actionName` and `primaryModifier` alongside codes

**Keydown handler (lines 174–221):**

```javascript
function onKeyDown(event) {
  // Early exits (W3C UI Events spec)
  if (event.repeat) return;
  if (event.isComposing) return;
  if (event.key === 'Dead') return;
  if (event.getModifierState && event.getModifierState('AltGraph')) return;

  // Track this key as held
  if (event.code) heldKeys.add(event.code);

  // Escape: exit picker (always, regardless of shortcut config)
  if (event.key === 'Escape') {
    if (_isPickerActive && typeof registeredCallbacks.onExitPicker === 'function') {
      _isPickerActive = false;
      registeredCallbacks.onExitPicker();
    }
    return;
  }

  // Check each registered shortcut
  for (let i = 0; i < registeredShortcuts.length; i++) {
    const sc = registeredShortcuts[i];

    // Is the primary modifier held?
    if (!isPrimaryModifierHeld(event, sc.primaryModifier)) continue;

    // Are ALL required keys held?
    let allHeld = true;
    for (let j = 0; j < sc.keyCodes.length; j++) {
      if (!heldKeys.has(sc.keyCodes[j])) {
        allHeld = false;
        break;
      }
    }
    if (!allHeld) continue;

    // Match found — fire action
    event.preventDefault();

    if (typeof registeredCallbacks[sc.actionName] === 'function') {
      registeredCallbacks[sc.actionName]();
    }

    const label = ACTION_LABELS[sc.actionName] || sc.actionName;
    showToast('Blurry Site: ' + label, 1500);
    return;
  }
}
```

### Held Keys Tracking

`heldKeys` is a `Set<string>` of `event.code` values (line 33):
- **Populated:** On every keydown (line 182): `if (event.code) heldKeys.add(event.code)`
- **Depopulated:** On every keyup (line 225): `if (event.code) heldKeys.delete(event.code)`
- **Cleared:** On window blur (line 230): `heldKeys.clear()` prevents phantom held keys when focus leaves (e.g., switching to another app)

### Primary Modifier Check: `isPrimaryModifierHeld()`

(Lines 90–102)

```javascript
function isPrimaryModifierHeld(event, modifierCode) {
  // CapsLock: use getModifierState (toggle-based)
  if (modifierCode === 'CapsLock') {
    return event.getModifierState && event.getModifierState('CapsLock');
  }

  // Standard modifiers: check the event boolean first (is the class active?)
  const prop = MODIFIER_PROPERTY_MAP[modifierCode];
  if (!prop || !event[prop]) return false;

  // Then check the specific side via heldKeys
  return heldKeys.has(modifierCode);
}
```

**For AltLeft/AltRight (and other modifier pairs):**
1. Maps modifier code to event property: `AltLeft` → `'altKey'`, `AltRight` → `'altKey'`
2. Checks `event.altKey` — is **any** Alt held?
3. Checks `heldKeys.has(modifierCode)` — is the **specific side** held?
4. Returns true only if **both** are true

This prevents the shortcut from firing if the user pressed AltRight but the config specifies AltLeft (test at line 193–197 of shortcut_handler.test.js confirms this).

**For CapsLock:**
- Uses `event.getModifierState('CapsLock')` (toggle state), not the heldKeys Set (CapsLock is stateful, not simultaneous-press)

### Matching Flow

1. Add the pressed key to `heldKeys` (line 182)
2. Handle Escape specially: if picker active, call `onExitPicker` and exit (lines 185–191)
3. For each registered shortcut:
   a. Is the primary modifier held? (`isPrimaryModifierHeld()`)
   b. Are **all** additional key codes in `sc.keyCodes` in `heldKeys`?
   c. If both true: `preventDefault()`, call the action callback, show toast, return
4. If no shortcut matches, fall through (the keydown event propagates normally)

### Events That Trigger Match Attempts

- **keydown** only: Match attempts happen on every keydown (line 174)
- **keyup** has no match logic — only removes the code from heldKeys (line 224–226)
- This prevents spurious matches as keys are released (e.g., releasing B in a partial Alt+Shift+B sequence doesn't re-trigger)

### Early-Exit Guards

(Lines 175–179)

```javascript
if (event.repeat) return;           // Ignore key-repeat events
if (event.isComposing) return;       // Ignore IME composition
if (event.key === 'Dead') return;    // Ignore dead-key (accents)
if (event.getModifierState && event.getModifierState('AltGraph')) return; // AltGr on right-Alt
```

These guard against:
- **repeat:** Keyboard repeat OS behavior (long-press firing repeated keydowns)
- **isComposing:** IME composition (e.g., typing Chinese or Japanese characters)
- **Dead:** Dead keys for accents (e.g., backtick on macOS Option-E, which produces `event.key === 'Dead'`)
- **AltGraph:** Right-Alt on some keyboards (European layouts use AltGr for special characters; conflicts with Alt shortcuts)

The test at lines 296–303 confirms Dead key events are ignored.

### No Special Handling for Shift / Ctrl / Meta

Shift, Ctrl, and Meta are handled identically to the AltLeft check:
1. Check the event boolean (`shiftKey`, `ctrlKey`, `metaKey`)
2. Check the specific side in `heldKeys`

If the config says `primaryModifier: 'ShiftLeft'` and the user presses ShiftRight, the match fails (not tested, but consistent with the AltRight logic).

---

## 4. How `chrome.commands` Fits In

### Commands Declared in manifest.json

(manifest.json lines 44–66)

```javascript
"commands": {
  "toggle-blur-all": {
    "suggested_key": {
      "default": "Alt+Shift+B",
      "mac": "Alt+Shift+B"
    },
    "description": "Toggle blur on all page content"
  },
  "toggle-picker": {
    "suggested_key": {
      "default": "Alt+Shift+P",
      "mac": "Alt+Shift+P"
    },
    "description": "Activate element picker mode (hover and click to blur)"
  },
  "clear-all-blur": {
    "suggested_key": {
      "default": "Alt+Shift+U",
      "mac": "Alt+Shift+U"
    },
    "description": "Remove blur from all elements on the current page"
  }
}
```

These are **browser-level keyboard commands** that the browser intercepts at the OS level and relays to the extension's background script.

### Why Dual Handling (Both `chrome.commands` and JS Handler)

The extension has **two separate shortcut systems:**

1. **Browser-level (`chrome.commands`):** Declared in manifest, OS-intercepted, always available even if page is offline or extension has errors
2. **JS-level (`shortcut_handler.js`):** Runs in content script after page loads, respects IME/composition, configurable

### Race Condition: `lastToggleTime` Dedup

(content_script.js lines 153–172)

```javascript
const lastToggleTime = {};
const TOGGLE_DEDUP_MS = 300;

function handleMessage(message, _sender, sendResponse) {
  const { type } = message;
  log.flow('msg.in', { type });

  // Dedup toggle commands that fire from both manifest and JS handler
  if (type === MSG.TOGGLE_BLUR_ALL || type === MSG.TOGGLE_PICKER || type === MSG.CLEAR_ALL_BLUR) {
    const now = Date.now();
    if (lastToggleTime[type] && now - lastToggleTime[type] < TOGGLE_DEDUP_MS) {
      if (sendResponse) sendResponse({ ok: true, deduped: true });
      return false;
    }
    lastToggleTime[type] = now;
  }
  // ... handler continues
}
```

**Why this exists:**

When the user presses Alt+Shift+B:
1. The OS intercepts the key and tells the browser
2. The browser fires `chrome.commands.onCommand('toggle-blur-all')` in the background script (background.js line 84)
3. Background relays a message to the content script: `{ type: MSG.TOGGLE_BLUR_ALL }`
4. **Simultaneously**, the JS shortcut handler in content_script is also listening for keydown, and it fires the same action

Without dedup, `TOGGLE_BLUR_ALL` would execute twice in rapid succession:
- JS handler runs synchronously (toggles blur ON)
- Background relays the command asynchronously (toggles blur OFF) → net result is no-op

**Race resolution:**
- Any duplicate message within 300ms of the previous one is dropped
- This assumes the JS handler fires before the background relay completes (reasonable given async messaging latency)

### Source of Truth: Neither is Authoritative

Neither system is the "source of truth" — they're **redundant with dedup**:
- **Browser commands** are reliable and always available
- **JS handler** is faster (no IPC) and more flexible (can be reconfigured without extension restart)
- The dedup ensures only one action fires per keystroke

### What Happens When JS Shortcut Differs from `chrome.commands`

If the user rebinds the JS shortcut to something `chrome.commands` can't express:

**Example:** User rebinds TOGGLE_BLUR_ALL to Ctrl+Alt+Shift+B (4 keys)
- `chrome.commands` only accepts: single modifier + single non-modifier key
- User changes in popup UI are stored to `settings.SHORTCUTS.TOGGLE_BLUR_ALL`
- JS handler reads the new config and fires on Ctrl+Alt+Shift+B
- Browser still fires `chrome.commands` on the original Alt+Shift+B
- Dedup handles both

**Limitation:** There is no way to disable the browser command or rebind it from the extension; the user would see two actions firing for one keystroke (or the dedup would suppress one). This is documented as a known gap.

---

## 5. Popup Capture Flow

### Trace from Button Click to Save

1. **User clicks shortcut button** (e.g., "Edit Alt+Shift+B"):
   - Renderer calls `onChange('SHORTCUTS.TOGGLE_BLUR_ALL', { _openCapture: true, action: 'TOGGLE_BLUR_ALL' })`
   - popup.js `onSettingChanged()` detects `_openCapture` flag (line 144–146) and calls `openShortcutModal(actionName)`

2. **Modal opens (openShortcutModal, lines 466–560):**
   - Clears previous state (`scPrimaryMod = null`, `scKeys = [], scKeyCodes = new Set()`)
   - Shows modal with "Press a key combo..." placeholder
   - Attaches capture keydown handler at capture phase (line 514): `document.addEventListener('keydown', scKeydownHandler, true)`

3. **User presses keys (scKeydownHandler, lines 485–511):**

   ```javascript
   scKeydownHandler = (e) => {
     e.preventDefault();
     e.stopPropagation();
     if (e.key === 'Escape') { closeShortcutModal(); return; }

     if (!scPrimaryMod && MODIFIER_CODES.has(e.code)) {
       scPrimaryMod = e.code;
       updateDisplay();
       return;
     }
     if (MODIFIER_CODES.has(e.code) && scPrimaryMod && !scKeyCodes.has(e.code)) {
       scKeys.push({ key: e.key, code: e.code });
       scKeyCodes.add(e.code);
       updateDisplay();
       return;
     }
     if (!MODIFIER_CODES.has(e.code) && !scKeyCodes.has(e.code)) {
       if (!scPrimaryMod) {
         ui.captureDisplay.textContent = I18n.t('shortcut_modal_no_modifier');
         return;
       }
       scKeys.push({ key: e.key, code: e.code });
       scKeyCodes.add(e.code);
       ui.captureDisplay.className = 'bl-si-capture bl-si-capture--done';
       ui.scModalSave.disabled = false;
       updateDisplay();
     }
   };
   ```

   **State machine:**
   - First modifier key press: `scPrimaryMod = e.code` (e.g., 'AltLeft')
   - Additional modifiers (while primary is held): added to `scKeys` (e.g., ShiftLeft)
   - First non-modifier: added to `scKeys` (e.g., 'KeyB'), enables Save button
   - Duplicate keys are ignored (`!scKeyCodes.has(e.code)`)

   **Normalized chord:** `{ primaryModifier: 'AltLeft', keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'b', code: 'KeyB' }] }`

4. **Display rendering (updateDisplay, lines 478–483):**
   ```javascript
   function updateDisplay() {
     const parts = [];
     if (scPrimaryMod) parts.push(Renderer.codeLabel(scPrimaryMod));
     for (const k of scKeys) parts.push(Renderer.CODE_LABELS[k.code] || k.key.toUpperCase());
     ui.captureDisplay.textContent = parts.length > 0 ? parts.join(' + ') : I18n.t('shortcut_modal_placeholder');
   }
   ```
   Renders: `"L-Alt + L-Shift + B"` (using `CODE_LABELS` for modifiers, uppercase for letters)

5. **Save (onSave, lines 516–531):**
   ```javascript
   const onSave = async () => {
     try {
       if (!scPrimaryMod || scKeys.length === 0) return;
       const shortcutKey = 'SHORTCUTS.' + scAction;
       Renderer.setByPath(settings, shortcutKey, {
         primaryModifier: scPrimaryMod,
         keys: scKeys.map(k => ({ key: k.key, code: k.code })),
       });
       await saveSettings(true);
       Renderer.updateAll(settings);
       closeShortcutModal();
       showToast(I18n.t('shortcut_saved'));
     } finally {
       cleanup();
     }
   };
   ```
   - Validates primary + at least one key
   - Writes to `settings.SHORTCUTS[action]`
   - Calls `saveSettings()` → `Store.saveSettings()` → background.js
   - Content script picks up via `Store.onChange()` and calls `Shortcuts.init()` with new config

### Captured Elements and Normalization

**Captures `.code`:** Yes, the handler captures both `.key` and `.code` (lines 496, 506):
```javascript
scKeys.push({ key: e.key, code: e.code });
```

**Normalization:** `e.code` is already normalized by the browser (W3C standard, layout-independent). No further normalization is done in the modal.

**Rendering labels back to user:** Uses `Renderer.CODE_LABELS` lookup first, falls back to `.key.toUpperCase()` (popup.js line 481).

### Special Key Handling

**AltGr:** No special handling in the modal — if the user presses AltGr (which is Ctrl+Alt on some layouts), it appears as two keys in the capture. The shortcut handler has a guard (`getModifierState('AltGraph')`) to reject AltGr chords, so the user cannot save them.

**Dead keys:** No special handling — if the user presses a dead key (e.g., backtick on macOS), it will appear as `event.key === 'Dead'`. The user must press the full combination (e.g., backtick + vowel to produce accented character), or the modal will capture 'Dead' as a key (unusual, likely a user error).

**IME:** No guard in the modal — if the user is in an IME composition window, they can still open the modal and capture keys. The shortcut handler itself has `event.isComposing` guard, so IME-generated events won't fire shortcuts.

**Numpad keys:** Captured normally — `event.code` distinguishes `Numpad0` from `Digit0`. Display renders the code if no label found.

**Arrow keys / Function keys:** Captured as `ArrowUp`, `F1`, etc. Rendered using `.key.toUpperCase()` if no label found. No special logic.

### Reset to Default

(Lines 533–546)

```javascript
const onReset = async () => {
  try {
    const defaults = MSG.DEFAULT_SETTINGS.SHORTCUTS[scAction];
    if (defaults) {
      Renderer.setByPath(settings, 'SHORTCUTS.' + scAction, JSON.parse(JSON.stringify(defaults)));
      await saveSettings(true);
      Renderer.updateAll(settings);
    }
    closeShortcutModal();
    showToast(I18n.t('shortcut_reset_done'));
  } finally {
    cleanup();
  }
};
```

Resets the shortcut to the default from `DEFAULT_SETTINGS.SHORTCUTS[actionName]`, persists via `saveSettings()`.

### Known Bugs / Quirks

**Dead key bug on macOS:** If the user presses Option-E (dead accent) on macOS, the event fires with `event.key === 'Dead'`. The shortcut handler guards against this (line 178), but the modal doesn't. The user could accidentally capture 'Dead' if they don't complete the accent combination. This would save a useless shortcut (one that can never match).

**No validation for duplicate bindings:** If the user binds two actions to the same chord (e.g., Alt+Shift+B for both TOGGLE_BLUR_ALL and TOGGLE_PICKER), the first match in the loop fires. No conflict warning is shown.

**No conflict detection with browser shortcuts:** If the user rebinds to Ctrl+T (Chrome "new tab"), the JS handler will fire, but the browser command will also execute. Dedup only prevents the same action from firing twice, not different actions.

---

## 6. Hardcoded Limits and Extensibility

### Action Count and List

**Hardcoded actions:** 3 actions with predefined shortcuts:
1. `TOGGLE_BLUR_ALL`
2. `TOGGLE_PICKER`
3. `CLEAR_ALL` (stored as `CLEAR_ALL_BLUR` in message types, `CLEAR_ALL` in shortcut config)

These are hardcoded in:
- `constants.js` (DEFAULT_SETTINGS.SHORTCUTS, lines 151–173)
- `manifest.json` (commands, lines 44–66)
- `background.js` (messageMap, lines 88–92)
- `shortcut_handler.js` (ACTION_LABELS, lines 56–60)
- `content_script.js` (shortcutActionMap, lines 130–149)
- Tests (DEFAULT_SHORTCUTS, shortcut_handler.test.js lines 125–138)

**Adding a new action would require:**
1. Add to `DEFAULT_SETTINGS.SHORTCUTS` in constants.js
2. Add command to manifest.json
3. Add to messageMap in background.js
4. Add label to ACTION_LABELS in shortcut_handler.js
5. Add callback to shortcutActionMap in content_script.js
6. Add test case to shortcut_handler.test.js

**Minimum count:** 6 files (likely 7 with UI config updates).

### Extensibility Constraints

**Can a user add a NEW action binding?**
- No. Actions are hardcoded in constants and manifest. Adding a new action requires extension modification and restart.

**Can a chord be length 4?**
- Yes, technically. Validation allows `keys.length` up to 10 (constants.js line 279). The handler iterates over all codes in `keyCodes`, so a 4-key chord (e.g., `primaryModifier: 'AltLeft', keys: [ShiftLeft, CtrlLeft, KeyB]`) would work. However, the UI modal only captures one primary + up to N additional keys sequentially, and there's no UI to create a 4-key chord (the modal closes after the first non-modifier key). **Answer: technically yes via manual settings edit, but not via UI.**

**Can a single-key chord (just 'K') exist?**
- No. Validation enforces `keys.length > 0` (line 278) but also requires `primaryModifier` to be a string. So the minimum is `primaryModifier + 1 key`.

**Non-modifier chords (Gmail-style 'G then T' sequences)?**
- No. The handler only matches simultaneous presses. There is no sequencing logic (no "remember the last key for N ms" state machine).

**OS-specific defaults (Cmd vs Ctrl)?**
- No. manifest.json has OS-specific suggested keys (lines 46–48):
  ```javascript
  "suggested_key": {
    "default": "Alt+Shift+B",
    "mac": "Alt+Shift+B"
  }
  ```
  But the actual defaults in constants.js are hardcoded to `AltLeft` for all platforms. On macOS, users must manually rebind to `MetaLeft` if they want Cmd.

### Changes Needed to Support Full Customization

To allow users to define arbitrary new actions with shortcuts:
1. Remove hardcoding of action names from constants.js and manifest.json
2. Implement an action registry (plugin system)
3. Update manifest.json parsing to be dynamic (not possible; manifest is static)
4. Store action definitions in settings (breaking change)
5. Rework popup UI to support arbitrary action creation

**Verdict:** Major architecture change, not minor refactor.

---

## 7. Display and Label Formatting

### Canonical Labeling Function

`Renderer.codeLabel()` in popup_settings_renderer.js (lines 56–58):

```javascript
function codeLabel(code) {
  return CODE_LABELS[code] || code;
}
```

Looks up the code in `CODE_LABELS` table (lines 48–54), or returns the raw code if not found.

### CODE_LABELS Table

(popup_settings_renderer.js lines 48–54)

```javascript
const CODE_LABELS = {
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt',
  MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd',
  CapsLock: 'CapsLock', Fn: 'Fn',
};
```

Uses:
- **Abbreviations:** "L-Shift" (not "Left Shift"), "L-Cmd" (not "Left Command")
- **Abbreviations for main modifiers:** "Ctrl", "Alt", "Cmd" (not full names)
- **CapsLock unadorned:** "CapsLock" (toggle key)

### Display Formatting Decision: Where "Shift" vs "⇧" Gets Decided

Hardcoded in the CODE_LABELS table — there is no separate display mode (no OS-specific unicode symbols). The labels are English abbreviations only.

**Not implemented:**
- macOS symbols: ⇧ (Shift), ⌥ (Alt/Option), ⌃ (Ctrl), ⌘ (Cmd)
- Linux/Windows labels: "Shift", "Alt", "Ctrl", "Win"

**Cross-platform handling:** None. The same labels are used everywhere.

### Chord Display in Modal

(popup.js lines 478–483)

```javascript
function updateDisplay() {
  const parts = [];
  if (scPrimaryMod) parts.push(Renderer.codeLabel(scPrimaryMod));
  for (const k of scKeys) parts.push(Renderer.CODE_LABELS[k.code] || k.key.toUpperCase());
  ui.captureDisplay.textContent = parts.length > 0 ? parts.join(' + ') : I18n.t('shortcut_modal_placeholder');
}
```

Example rendering: `"L-Alt + L-Shift + B"` (modifier labels + uppercase letter).

---

## 8. Conflict Detection and Validation

### Duplicate Action Bindings

If two actions are bound to the same chord, **no validation or warning occurs**. The handler simply fires the first matching action in the loop (line 194–220 shortcut_handler.js):

```javascript
for (let i = 0; i < registeredShortcuts.length; i++) {
  const sc = registeredShortcuts[i];
  // ... if matches ...
  event.preventDefault();
  if (typeof registeredCallbacks[sc.actionName] === 'function') {
    registeredCallbacks[sc.actionName]();
  }
  // ... show toast ...
  return;  // <-- exits loop, only first match fires
}
```

**Result:** If both `TOGGLE_BLUR_ALL` and `TOGGLE_PICKER` are bound to Alt+Shift+B, whichever is earlier in the `registeredShortcuts` array fires (order depends on object iteration order of the input, which is insertion order in modern JS).

### Native Browser Shortcut Collisions

If the user rebinds to Ctrl+T (Chrome "new tab"):
- **JS handler:** Fires the blur action
- **Browser:** Also handles Ctrl+T and opens a new tab
- **Result:** Both actions occur

**Dedup only prevents the same action from firing twice, not collisions with browser actions.**

### Validation in `validateSettings()`

(constants.js lines 269–285)

```javascript
result.SHORTCUTS = {};
const sc = (settings.SHORTCUTS && typeof settings.SHORTCUTS === 'object')
  ? settings.SHORTCUTS : {};
for (const action of Object.keys(defaults.SHORTCUTS)) {
  const binding = sc[action];
  if (binding &&
      typeof binding.primaryModifier === 'string' &&
      Array.isArray(binding.keys) &&
      binding.keys.length > 0 &&
      binding.keys.length <= 10 &&
      binding.keys.every(k => k && typeof k.key === 'string' && typeof k.code === 'string')) {
    result.SHORTCUTS[action] = binding;
  } else {
    result.SHORTCUTS[action] = JSON.parse(JSON.stringify(defaults.SHORTCUTS[action]));
  }
}
```

Checks:
- Each action exists in defaults
- `primaryModifier` is a non-empty string
- `keys` is a non-empty array (max 10 elements)
- Each key object has both `key` and `code` as strings

**No checks for:**
- Duplicate chords across actions
- Conflict with native shortcuts
- Invalid modifier codes (e.g., typo 'CtrlLeftt')
- Empty chord (no primary modifier specified)

---

## 9. Test Coverage in `shortcut_handler.test.js`

### Test List with Summaries

**Setup (lines 18–25):**
- `loadShortcutHandler()` loads the real module or evaluates a stub

**Test suite `blsi.Shortcuts` (lines 142–384):**

#### Shortcut Detection Suite (lines 151–246)

1. **"fires TOGGLE_BLUR_ALL when Alt+Shift+B pressed"** (lines 152–164)
   - Verifies callback fires once when all keys are held simultaneously
   
2. **"fires TOGGLE_PICKER when Alt+Shift+P pressed"** (lines 166–175)
   - Verifies callback fires for the second action
   
3. **"fires CLEAR_ALL when Alt+Shift+U pressed"** (lines 177–186)
   - Verifies callback fires for the third action
   
4. **"does NOT fire when wrong modifier side is held"** (lines 188–198)
   - Holds AltRight instead of AltLeft → callback should not fire
   - Tests that modifier side matters
   
5. **"does NOT fire when primary modifier is not held"** (lines 200–208)
   - Presses B without Alt → callback should not fire
   
6. **"does NOT fire when not all keys are held"** (lines 210–219)
   - Alt + B without Shift → callback should not fire
   
7. **"different shortcuts fire different callbacks"** (lines 221–245)
   - Multiple actions fire independently with correct callbacks

#### Escape Key Suite (lines 250–269)

8. **"fires onExitPicker when picker is active"** (lines 251–259)
   - Sets `_isPickerActive(true)` and presses Escape → `onExitPicker` fires
   
9. **"does NOT fire onExitPicker when picker is inactive"** (lines 261–268)
   - Escape without picker active → `onExitPicker` does not fire

#### Early Exit Guards Suite (lines 273–317)

10. **"ignores repeated keydown events"** (lines 274–283)
    - Event with `repeat: true` flag → callback should not fire
    
11. **"ignores events during IME composition"** (lines 285–294)
    - Event with `isComposing: true` → callback should not fire
    
12. **"ignores Dead key events"** (lines 296–303)
    - `event.key === 'Dead'` → callback should not fire
    
13. **"ignores AltGraph events"** (lines 305–316)
    - Event with `getModifierState('AltGraph') === true` → callback should not fire

#### Destroy Suite (lines 321–347)

14. **"removes listeners so shortcuts stop firing"** (lines 322–332)
    - After `destroy()`, shortcut should not fire
    
15. **"re-calling init replaces previous listener"** (lines 334–346)
    - Calling `init()` twice with different callbacks → only second callback fires

#### Custom Shortcuts Suite (lines 351–383)

16. **"supports single modifier + single key"** (lines 352–362)
    - Ctrl+B configuration → callback fires
    
17. **"supports MetaLeft (Command) as primary modifier"** (lines 364–374)
    - Cmd+1 configuration → callback fires on Mac
    
18. **"handles empty shortcuts object gracefully"** (lines 376–378)
    - Empty config → no crash
    
19. **"handles null shortcuts gracefully"** (lines 380–382)
    - Null config → no crash

### Behaviors Locked In by Tests

- **Modifier side matters:** AltRight ≠ AltLeft (test 4)
- **All keys must be held simultaneously** (test 6)
- **Escape always exits picker** (test 8)
- **Repeat events are ignored** (test 10)
- **IME-generated events are blocked** (test 11)
- **Dead keys are blocked** (test 12)
- **AltGr blocks matching** (test 13)
- **destroy() fully cleans up** (test 14)
- **init() is idempotent** (test 15)
- **Custom configs work** (tests 16–17)

### What Tests Don't Cover

- Window blur clearing `heldKeys` (no `blur` event test)
- Toast display (showToast is mocked in tests)
- Keyup tracking (keyup events are fired but not asserted on)
- Modifier code mapping accuracy (tests use mock code values)
- Code vs key dual representation (tests only use provided code values)

---

## 10. Documentation Current State

### LLD.md §5 (shortcut_handler.js)

(docs/LLD.md lines 298–384)

Provides TypeScript-style interface, state variables table, and pseudocode for `init()` and `isPrimaryModifierHeld()`.

**Current excerpt:**
```
### shortcut_handler.js

### State

| Variable | Type | Purpose |
|---|---|---|
| `heldKeys` | `Set<string>` | Set of `event.code` values currently held down |
| `activeKeydownListener` | `Function \| null` | Reference to the installed keydown handler |
| ...

### Public API

interface PrivacyBlurShortcuts {
  init(shortcuts: Record<string, ShortcutBinding>, callbacks: ShortcutCallbacks): void;
  destroy(): void;
  showToast(text: string, duration?: number): void;
  _setPickerActive(active: boolean): void;
}

### init — held-key matching logic

init(shortcuts, callbacks)
  destroy()  // detach any existing listeners, clear heldKeys
  ...
```

**Status:** Accurate. Matches the actual implementation.

### CLAUDE.md Settings Shape SHORTCUTS Block

(CLAUDE.md lines 84–99)

```javascript
settings.SHORTCUTS = {
  TOGGLE_BLUR_ALL: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'b', code: 'KeyB' }]
  },
  TOGGLE_PICKER: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'p', code: 'KeyP' }]
  },
  CLEAR_ALL_BLUR: {
    primaryModifier: 'AltLeft',
    keys: [{ key: 'Shift', code: 'ShiftLeft' }, { key: 'u', code: 'KeyU' }]
  }
}
```

**Status:** Accurate. Matches DEFAULT_SETTINGS exactly (note: docs say `CLEAR_ALL_BLUR` but code uses `CLEAR_ALL` as the config key — **this is a discrepancy**).

### src/CLAUDE.md (shortcut_handler.js rules)

(src/CLAUDE.md lines 124–140)

```
### shortcut_handler.js
- `init(shortcuts, callbacks)` accepts `{ ACTION_NAME: { primaryModifier, keys: [{ key, code }] } }`.
- Tracks held keys via `Set<code>` on keydown/keyup. Window blur clears the Set.
- Matches shortcuts by checking: is primaryModifier held? Are ALL keys in keys[] held simultaneously?
- Key matching uses `event.code` (physical key, layout-independent).
- Early-exit guards: `event.repeat`, `event.isComposing`, `event.key === "Dead"`, `getModifierState("AltGraph")`.
- Fires `callbacks[actionName]` for any matched shortcut (TOGGLE_BLUR_ALL, TOGGLE_PICKER, CLEAR_ALL).
- Fires `callbacks.onExitPicker` on Escape when `_isPickerActive === true`.
- Listeners registered at capture phase (`addEventListener("keydown"/"keyup", fn, true)`).
- `_setPickerActive(v)` must be in the public return object.
```

**Status:** Accurate.

### Contradictions and Drift

1. **CLAUDE.md says `CLEAR_ALL_BLUR`, code uses `CLEAR_ALL`:**
   - constants.js: `CLEAR_ALL: { ... }` (line 166)
   - CLAUDE.md line 95: `CLEAR_ALL_BLUR: { ... }`
   - background.js messageMap: `"clear-all-blur": { type: MSG.CLEAR_ALL_BLUR }` (line 91)
   - Message type in constants.js: `CLEAR_ALL_BLUR` (line 47)
   - **Discrepancy:** Config key is `CLEAR_ALL`, message type is `CLEAR_ALL_BLUR`. Docs use the message type name inconsistently.

2. **No documentation of dedup mechanism:**
   - LLD.md and CLAUDE.md don't mention `lastToggleTime` or the 300ms dedup
   - This is a critical piece of the shortcut system but is undocumented
   - Not a contradiction, just a gap

---

## 11. Known Limitations and Pain Points

### TODO Comments

None found in shortcut_handler.js. System appears complete.

### Code Smells

1. **String concatenation for chord display (popup.js line 481):**
   ```javascript
   parts.join(' + ')
   ```
   Hardcoded separator ' + '. No i18n for the separator (e.g., French might use "ET" instead). Minor issue.

2. **Magic number 300 for dedup (content_script.js line 158):**
   ```javascript
   const TOGGLE_DEDUP_MS = 300;
   ```
   No explanation of why 300ms was chosen. Seems arbitrary (reasonable guess: enough time for async background relay to complete, but short enough to not feel like lag).

3. **Inline event listener attachment without named function reference (popup.js lines 514, 551–559):**
   ```javascript
   document.addEventListener('keydown', scKeydownHandler, true);
   // later...
   ui.scModalSave.addEventListener('click', onSave);
   ui.scModalCancel.addEventListener('click', onCancel);
   ui.scModalReset.addEventListener('click', onReset);
   // cleanup() must manually remove them
   function cleanup() {
     ui.scModalSave.removeEventListener('click', onSave);
     ui.scModalCancel.removeEventListener('click', onCancel);
     ui.scModalReset.removeEventListener('click', onReset);
   }
   ```
   Works, but requires careful manual cleanup. If `cleanup()` is forgotten, listeners leak. The modal reuses the same UI elements, so this is a risk.

4. **Duplicate MODIFIER_CODES definitions:**
   - `shortcut_handler.js` line 79–83
   - `popup.js` line 454–457
   - Both define the same set. No shared constant. Maintainability risk if one is updated.

### Validation Gaps

1. **No check for valid modifier codes:**
   - `validateSettings()` accepts any string as `primaryModifier`
   - Typo like `'CtrlLeftt'` would pass validation
   - Runtime matching would silently fail (no error, just no match)

2. **No check for chord length limits in runtime:**
   - Validation allows up to 10 keys
   - Handler accepts any length
   - No practical limit (OS/browser may have their own limits)

3. **No validation that both `.key` and `.code` are valid:**
   - Accepts any strings
   - At runtime, only `.code` is used (for matching), so invalid `.key` is harmless
   - But if storage corruption occurs, invalid `.code` would silently not match

---

## Key Findings & Gaps Summary

### Design Strengths

1. **Dual system with dedup:** Browser commands + JS handler provides redundancy and fast response
2. **Layout-independent code tracking:** Using `event.code` avoids QWERTY/AZERTY issues
3. **Configurable per-action:** Users can rebind shortcuts in the UI without extension restart
4. **Comprehensive early-exit guards:** Handles repeat, IME, dead keys, AltGr

### Critical Gaps

1. **No shortcut conflict detection:** Two actions can bind to the same chord; first match wins silently
2. **No browser shortcut conflict warning:** User can rebind to Ctrl+T with no warning
3. **No dynamic action registry:** Adding new actions requires code changes and extension reload
4. **Master dedup bug potential:** If dedup window is too short, double-fire can occur; if too long, slow actions are suppressed
5. **Action name string duplication:** `CLEAR_ALL` (config) vs `CLEAR_ALL_BLUR` (message type) creates confusion; docs inconsistent

### Hardcoded Constraints

1. **Only 3 actions:** TOGGLE_BLUR_ALL, TOGGLE_PICKER, CLEAR_ALL (no user-defined actions)
2. **Only simultaneous chords:** No sequencing (no Gmail-style "G then T")
3. **Minimum 1 non-modifier key:** Can't bind a single modifier (e.g., just "Alt")
4. **OS-specific defaults not supported:** All platforms default to Alt+..., not Cmd+... on Mac
5. **Manifest commands immutable:** Browser-level shortcuts can't be unbound or rebound via extension API

### Extensibility Roadblocks

1. **6+ files to add a new action:** constants, manifest, background, shortcut_handler, content_script, tests, UI configs
2. **Manifest is static:** Can't add `chrome.commands` entries at runtime
3. **No plugin/hook system:** Extension can't load extension-provided actions

### Maintainability Debt

1. **Duplicate MODIFIER_CODES constants:** In shortcut_handler.js and popup.js
2. **Docs name drift:** CLEAR_ALL vs CLEAR_ALL_BLUR used inconsistently
3. **Dedup mechanism undocumented:** Critical race resolution not explained in LLD/CLAUDE
4. **Toast display location hardcoded:** Shows in content script only; no hook for popup toast (popup has its own toast system)

### Suggested Next Steps for Redesign

1. **If supporting user-defined actions:** Decouple action registry from manifest; implement a proper settings-based action store
2. **If preventing conflicts:** Add validation pass in `validateSettings()` to reject duplicate chords, or compute and display conflicts in popup UI
3. **If supporting complex chords:** Implement a chord parsing/matching engine that supports sequences, time-based patterns, optional keys
4. **If supporting cross-platform defaults:** Store OS-detected defaults separately; allow platform-specific bindings in settings
5. **If improving UX:** Show warnings for browser shortcut conflicts, offer "remap browser shortcut" guidance, reduce magical numbers (300ms → configurable debounce)

---

**End of Dossier**