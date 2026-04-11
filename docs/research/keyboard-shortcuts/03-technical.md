# Dossier 3 — Keyboard Event Technical Reference

## 1. KeyboardEvent Properties — Definitive Reference

The `KeyboardEvent` interface is the foundation for keyboard interaction capture in web applications and browser extensions. Understanding each property's semantics, platform variance, and failure modes is critical for building robust shortcut systems.

### `event.key` — Logical Key Value

**Definition:** Returns a string representing the logical character or named key produced by the key event, accounting for modifier state, keyboard layout, and locale settings.

**Semantics:**
- For printable characters, `key` reflects the actual character: typing 'a' yields `"a"`, typing 'A' (with Shift) yields `"A"`
- For non-character keys, `key` returns a named constant: `"Enter"`, `"Escape"`, `"ArrowUp"`, `"Tab"`, `"Shift"`, `"Control"`, `"Alt"`, `"Meta"`, etc.
- Case sensitivity is inherent: `"k"` and `"K"` are distinct values, controlled entirely by `shiftKey` and the key itself.

**Layout Dependence:**
The critical problem with `key`: it is **layout-dependent**. On a QWERTY keyboard, the top-left letter key produces `key === "q"` when unshifted, `key === "Q"` when shifted. On a Dvorak layout, the same physical key produces `key === "'"` (unshifted) and `key === '"'` (shifted). This means a shortcut stored as `"Ctrl+K"` (using key) will bind to the physical 'K' key on QWERTY but a different physical key on Dvorak, which breaks layout-independent binding.

**Failure Modes:**
- **Dead Keys:** When a dead key is pressed (Option+E on US Mac for combining acute accent), `key` returns the string `"Dead"`, not the combining character. This is a sentinel value requiring special handling.
- **IME Composition:** During Input Method Editor composition (used in Chinese, Japanese, Korean), `key` returns `"Process"` (older) or the partial composition string. The `isComposing` property must be checked to avoid capturing during composition.
- **Unidentified Keys:** For keys that cannot be mapped (hardware-dependent, rare on modern systems), `key` returns `"Unidentified"`.

**Use Case:** Best for single-key bindings where layout matters less (arrow keys, Enter, Tab) and for readable display of what the user typed. Poor for character-based shortcuts in a cross-layout extension.

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key

---

### `event.code` — Physical Key Position

**Definition:** Returns a string representing the physical location of the key on the keyboard, independent of keyboard layout, modifier state, and locale. The string always corresponds to the same key regardless of what character it produces.

**Semantics:**
- Letter keys: `"KeyA"` through `"KeyZ"` (always uppercase 'Key' prefix + letter)
- Number keys: `"Digit0"` through `"Digit9"` (standard row, not numeric pad)
- Numeric pad: `"Numpad0"` through `"Numpad9"`, `"NumpadAdd"`, `"NumpadSubtract"`, `"NumpadMultiply"`, `"NumpadDivide"`, `"NumpadDecimal"`, `"NumpadEnter"`
- Punctuation: `"Minus"`, `"Equal"`, `"BracketLeft"`, `"BracketRight"`, `"Semicolon"`, `"Quote"`, `"Backquote"`, `"Backslash"`, `"Comma"`, `"Period"`, `"Slash"`
- Modifiers: `"ShiftLeft"`, `"ShiftRight"`, `"ControlLeft"`, `"ControlRight"`, `"AltLeft"`, `"AltRight"`, `"MetaLeft"`, `"MetaRight"`
- Navigation: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, `"Home"`, `"End"`, `"PageUp"`, `"PageDown"`
- Whitespace & Control: `"Enter"`, `"Tab"`, `"Escape"`, `"Space"`, `"Backspace"`, `"Delete"`, `"Insert"`
- Function: `"F1"` through `"F24"`
- Media: `"MediaPlayPause"`, `"MediaStop"`, `"MediaTrackNext"`, `"MediaTrackPrevious"`, `"AudioVolumeUp"`, `"AudioVolumeDown"`, `"AudioVolumeMute"`

**Layout Independence:**
This is `code`'s superpower. On QWERTY, `code === "KeyQ"`. On Dvorak, the same physical key (top-left letter) still returns `code === "KeyQ"`. On AZERTY, where the 'A' key is top-left, pressing it returns `code === "KeyQ"` (because the physical position matches QWERTY's 'Q' position). This means shortcuts stored using `code` are truly layout-independent.

**Failure Modes:**
- **Unidentifiable Keys:** Rarely, `code === "Unidentified"` if the system cannot determine the physical key.
- **Platform Variance:** Some specialized keys (media controls, brightness) may report differently across Windows, Mac, and Linux. For example, volume keys might report as `"AudioVolumeUp"` on Chrome but have different names on older Firefox versions.
- **Mobile Devices:** On some Android devices with custom keyboard layouts, `code` may be less reliable. Mobile browsers have different keyboard models.

**Use Case:** Essential for position-based shortcuts (games, editor bindings where you want "the top-left letter key" regardless of layout). The default choice for character keys in modern extensions.

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values

---

### `event.keyCode` — DEPRECATED

**Definition:** A numeric code (typically 0–255) representing the unmodified value of a pressed key, loosely based on ASCII or Windows 1252.

**Why You Must Avoid It:**
`keyCode` is **deprecated** and must not be used in new code. It is included here only for historical context.

1. **Inconsistency:** Different browsers return different values for the same key. For example, pressing `;` (semicolon) returns `keyCode === 186` in some browsers, `59` in others, or `0` in older versions.
2. **Layout Chaos:** `keyCode` values are locale-sensitive and layout-dependent, varying wildly across keyboard layouts. A single `keyCode` value can represent entirely different keys depending on the user's layout.
3. **Incomplete Coverage:** For many keys (especially punctuation and special keys), `keyCode` returns `0`, making it useless.
4. **Case Sensitivity Trap:** `keyCode` does not distinguish between `'a'` and `'A'`. You must manually check `shiftKey` to infer case, which is fragile.

**Migration Path:**
- For character detection, use `event.key` instead: `if (event.key === "Enter")`
- For physical key position, use `event.code` instead: `if (event.code === "KeyK")`

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/keyCode

---

### `event.which` — DEPRECATED ALIAS

**Definition:** An alias for `keyCode` or `charCode` (for keypress events), equally deprecated.

**Status:** Do not use. Use `event.key` or `event.code` instead. Modern browsers support both; legacy code using `which` should be migrated.

---

### `event.location` — Physical Key Location

**Definition:** A numeric constant indicating where on the keyboard the key is located, useful for distinguishing left/right modifier keys and numeric pad keys.

**Values:**
- `DOM_KEY_LOCATION_STANDARD` (0): Single-position key or cannot distinguish sides. Used for most keys.
- `DOM_KEY_LOCATION_LEFT` (1): Left-hand version of the key (e.g., left Shift, left Alt, left Control, left Meta/Command).
- `DOM_KEY_LOCATION_RIGHT` (2): Right-hand version of the key (e.g., right Shift, right Alt, right Control, right Meta/Command).
- `DOM_KEY_LOCATION_NUMPAD` (3): Key is on the numeric keypad (e.g., `Numpad5`, `NumpadAdd`). Firefox reports this reliably when NumLock is active.

**Platform Variance:**
- **Windows:** Consistently reports NUMPAD (3) for numeric pad keys when NumLock is engaged.
- **Mac:** May not distinguish NumPad location on laptops without a physical numeric pad. Magic Keyboard with numeric pad reports correctly.
- **Linux:** Depends on X11 configuration and virtual keyboard state.

**Use Case:**
Essential when you need to distinguish left Ctrl from right Ctrl (rare, but important for AltGr detection on Windows/Linux). Most shortcut systems don't distinguish sides and normalize both to a single "Ctrl" modifier. The numeric pad location is useful if your extension needs to treat numeric pad keys differently (e.g., allowing both `5` and `Numpad5` for the same action, or treating them distinctly).

**Example — Distinguishing Left vs Right:**
```javascript
function getNormalizedModifier(code, location) {
  // Fold left and right to a single name
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Control";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code === "MetaLeft" || code === "MetaRight") return "Meta";
  return null; // Not a modifier
}
```

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/location

---

### `event.ctrlKey`, `event.shiftKey`, `event.altKey`, `event.metaKey` — Modifier State

**Definition:** Boolean flags indicating whether each modifier key is currently pressed during the event.

**Semantics:**
- `ctrlKey`: true if Control (Ctrl) is held. On macOS, also true when Command (Cmd) is held (Command is *not* reported separately via metaKey in some older systems, though modern browsers do report it separately).
- `shiftKey`: true if Shift is held (either left or right).
- `altKey`: true if Alt (or Option on Mac) is held (either left or right). **Critical:** This is also true when AltGr is held on European keyboards (AltGr is physically RightAlt, and the OS reports it as Alt).
- `metaKey`: true if Meta/Command/Windows/Super is held (either left or right). On macOS, this is the Command (⌘) key. On Windows/Linux, this is the Windows/Super key.

**Platform Semantics:**
- **macOS:** Command (Cmd, ⌘) is the primary modifier for native application shortcuts. Control is less common for app shortcuts but used for text editing and terminal. Option (Alt) is for text navigation and special characters.
- **Windows/Linux:** Control (Ctrl) is the primary modifier. Windows/Super key is for system shortcuts. Alt is for menus and accessibility.

**Failure Modes:**
- **AltGr Collision:** On European keyboards, pressing AltGr (right Alt) triggers `altKey === true` and `ctrlKey === true` simultaneously, because the OS emulates AltGr as Ctrl+Alt. This breaks any shortcut using Ctrl+Alt. Solution: use `event.getModifierState("AltGraph")` (see below).
- **Modifier-Only Events:** Pressing Shift alone fires a keydown event with `shiftKey === true` but `code === "ShiftLeft"`. Your capture handler must not commit a shortcut on modifier-only events.
- **Repeat Events:** When a key is held, `keydown` events fire repeatedly with the same modifier state. Use `event.repeat` to detect and potentially ignore held-key presses.

**Use Case:** Essential for detecting that modifiers are active. Always paired with a non-modifier key to form a valid shortcut. Store the set of active modifiers ({Shift, Control, Alt, Meta}) alongside the primary key code.

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent

---

### `event.getModifierState(key)` — Detailed Modifier Inspection

**Definition:** A method returning a boolean indicating whether a specific modifier is active. It accepts modifier key names (case-sensitive strings) and provides finer-grained control than the simple boolean properties.

**Supported Keys:**
- `"Alt"`, `"AltGraph"`, `"CapsLock"`, `"Control"`, `"Fn"`, `"FnLock"`, `"Hyper"`, `"Meta"`, `"NumLock"`, `"OS"`, `"ScrollLock"`, `"Shift"`, `"Super"`, `"Symbol"`, `"SymbolLock"`, `"Accel"` (deprecated)

**Critical Use Case — AltGraph Detection:**
On European keyboards, `AltGraph` (the combined modifier accessed via the AltGr key) is the key to distinguishing AltGr from Ctrl+Alt:

```javascript
document.addEventListener("keydown", (event) => {
  const isAltGr = event.getModifierState("AltGraph");
  const isCtrlAlt = event.ctrlKey && event.altKey && !isAltGr;
  
  if (isCtrlAlt) {
    // Safe to use Ctrl+Alt as a shortcut (no AltGr collision)
  } else if (isAltGr) {
    // Do NOT bind Ctrl+Alt here; user may be typing AltGr-produced characters
  }
});
```

**Other Modifiers:**
- `"CapsLock"`: true if CapsLock is toggled on. Useful if your extension needs to account for shifted state during capture.
- `"NumLock"`: true if NumLock is active (affects numeric pad behavior).
- `"ScrollLock"`: Rarely used in modern applications; included for completeness.
- `"Fn"`: true if the Fn key is held (Mac laptops and some gaming keyboards). Cannot be captured reliably in JavaScript; often hardware-intercepted.
- `"Meta"` / `"OS"` / `"Super"`: Equivalent names for the same key across platforms. Use whichever your target platform recognizes.
- `"Accel"`: A deprecated virtual modifier representing "Ctrl on Windows/Linux, Cmd on Mac." Modern code should avoid it and handle platform detection explicitly.

**Platform Variance:**
- **Mac:** `Fn` key is often not accessible to JavaScript; the OS intercepts it at a lower level. `Meta` is always the Command key.
- **Windows/Linux:** `Fn` may or may not be reportable depending on the keyboard hardware and driver. `Meta` is the Windows/Super key.
- **Some modifiers** (like `"Hyper"`, `"Symbol"`) are exotic and rarely report true on desktop keyboards; they're present for completeness and compatibility with specialized input devices.

**Use Case:** Essential for detecting AltGr to avoid shortcut collisions with European keyboard special characters. Used to build safe shortcut guards.

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState

---

### `event.repeat` — Key Repeat Flag

**Definition:** A boolean that is true if the key event is a repeat caused by the key being held down.

**Semantics:**
When you hold a key, the OS generates multiple `keydown` events:
1. First `keydown`: `repeat === false` (initial press)
2. Subsequent `keydown` events while held: `repeat === true` (auto-repeat)
3. Single `keyup` on release: always `repeat === false`

**Typical Repeat Rate:** 30–60 events per second, depending on OS and user keyboard settings.

**Use Case:** 
- Capture handlers should ignore `repeat === true` events to avoid duplicate shortcut triggers.
- Games often check `repeat` to ensure a key press is only registered once.
- Text editors may want to distinguish the initial press from repeats (e.g., for different handling of auto-repeat).

**Example:**
```javascript
document.addEventListener("keydown", (event) => {
  if (event.repeat) return; // Ignore repeat events
  // Process initial key press
});
```

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat

---

### `event.isComposing` — IME Composition Flag

**Definition:** A boolean that is true if the event fires during an Input Method Editor (IME) composition session.

**IME Context:**
IMEs are used in East Asian languages (Chinese, Japanese, Korean, Thai, Vietnamese) where dozens or hundreds of characters can be produced from a single keystroke. The user types Roman characters or codes, the IME builds up a composition, and then the user commits it to text. During composition, each keystroke is tentative.

**Semantics:**
- `isComposing === true` between `compositionstart` and `compositionend` events.
- During composition, `key` may return `"Process"` (older) or the partial composition string.
- A final `compositionend` event fires when composition completes.

**Typical Composition Flow:**
1. User focuses an input field with an IME active.
2. `compositionstart` fires.
3. User types; `keydown` events fire with `isComposing === true`, `key === "Process"`.
4. The IME displays a composition popup (underlined text in the input field).
5. User presses space or Enter to commit.
6. `compositionend` fires.
7. `keydown` events resume with `isComposing === false`.

**Use Case:**
Shortcut capture handlers must reject events with `isComposing === true` to avoid capturing half-formed compositions. If the user is trying to bind a shortcut while using an IME, you'll get garbage data.

**Example:**
```javascript
document.addEventListener("keydown", (event) => {
  if (event.isComposing) return; // Ignore IME composition
  // Process shortcut capture
});
```

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing

---

### `event.isTrusted` — User Event vs Synthetic

**Definition:** A boolean that is true only if the event was generated by a genuine user interaction; false if the event was created programmatically via `dispatchEvent()` or synthesized by JavaScript.

**Semantics:**
- `isTrusted === true`: The user physically pressed/released a key. The browser generated the event.
- `isTrusted === false`: JavaScript code called `new KeyboardEvent(...)` and `dispatchEvent(element, event)`, or a browser extension injected the event.

**Security Implication:**
Browsers restrict certain actions (copy, paste, full-screen, notification permissions) to user-initiated events only. Synthetic events cannot trigger these restricted actions. This prevents malicious scripts from simulating user actions.

**Use Case:**
In a shortcut capture handler, you typically want `isTrusted === true` to ensure the user actually pressed the key. Ignore synthetic events:

```javascript
document.addEventListener("keydown", (event) => {
  if (!event.isTrusted) return; // Ignore synthetic events
  // Process user's keystroke
});
```

**Browser Extension Context:**
In a content script, events from the page's own JavaScript will have `isTrusted === false`. Events from the user's keyboard interaction will have `isTrusted === true`.

**MDN Reference:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isTrusted (note: as of 2025, this is documented under the Event interface, not KeyboardEvent specifically, but applies to all keyboard events)

---

## 2. The `code` vs `key` Decision — Definitive Tradeoff Analysis

This is the central architectural decision for any keyboard shortcut system. The choice determines whether shortcuts are layout-independent, human-readable, and portable across devices.

### Using `code` (Physical Key Position) — Recommended for Character Keys

**Advantages:**
1. **Layout Independence:** Same physical key position always maps to the same `code` string, regardless of keyboard layout (QWERTY, Dvorak, AZERTY, Colemak, etc.). A shortcut bound to `code === "KeyK"` works identically for all users, regardless of their layout.
2. **Industry Standard:** VS Code, Figma, Blender, and most modern editors use `code`-based keybindings. Users expect this behavior.
3. **Portable Bindings:** A user who switches from QWERTY to Dvorak expects their shortcuts to stay on the same physical keys. Using `code` guarantees this.
4. **Non-Character Keys are Stable:** For non-printable keys like `"Enter"`, `"Escape"`, `"ArrowUp"`, both `key` and `code` are identical, so `code` loses no readability.

**Disadvantages:**
1. **Not Human-Readable:** `"KeyK"` and `"Digit1"` and `"Backquote"` are not obvious to users. You must maintain a `codeToLabel()` mapping to display shortcuts.
2. **Display Mapping Complexity:** You need canonical mappings like:
   - `"KeyA"` → `"A"`, `"KeyZ"` → `"Z"`
   - `"Digit0"` → `"0"`, `"Digit9"` → `"9"`
   - `"Minus"` → `"-"`, `"Equal"` → `"="`, `"Backquote"` → `` ` ``
   - `"BracketLeft"` → `"["`, `"BracketRight"` → `"]"`
   - Platform-aware: `"MetaLeft"` → `"⌘"` on Mac, `"Super"` on Linux, `"Win"` on Windows
3. **User Confusion in Capture UI:** When capturing a shortcut, the user presses 'k' but you display `"KeyK"`. This mismatch requires explanation or clever UI design.

**When to Use Code:**
- For all character keys (a-z, 0-9, punctuation, symbols).
- Any system where users may switch keyboard layouts.
- Production extensions targeting international users.

---

### Using `key` (Logical Character) — Justified Only for Non-Character Keys

**Advantages:**
1. **Human-Readable:** `key === "a"` is intuitive. When displaying a shortcut, users immediately understand what they pressed.
2. **Simple for ASCII:** For English-only, ASCII-based shortcuts, using `key` avoids the codeToLabel() mapping entirely.
3. **Alignment with Speech:** If you describe a shortcut aloud, "Ctrl+K" naturally maps to `key === "Control"` and `key === "k"`.

**Disadvantages:**
1. **Layout-Dependent:** A shortcut stored as `"Ctrl+k"` binds to the physical 'K' key on QWERTY but a different key on Dvorak. User expectations break.
2. **Case Sensitivity Trap:** You must decide: do you store `"K"` or `"k"`? If you normalize to lowercase, you lose the shift state. If you store the exact case, you must carefully track Shift during capture.
3. **Dead Keys Fail:** Pressing Option+E (dead key) on US Mac yields `key === "Dead"`, not a usable shortcut.
4. **IME Produces "Process":** In IME composition, `key === "Process"`, which is useless.
5. **Unidentified Keys:** Rare, but `key === "Unidentified"` on some hardware.
6. **AltGr Breaks:** On European keyboards, users often use AltGr to type special characters. If you ask them to rebind a shortcut, `key` may capture the AltGr-produced character, not the physical key they thought they were binding.

**When to Use Key:**
- **Non-character keys only:** `"Enter"`, `"Escape"`, `"Tab"`, `"ArrowUp"`, `"F1"`, `"Home"`, `"PageUp"`, etc. These have stable, layout-independent, human-readable `key` values.
- Single-layout, ASCII-only extensions with no international user base (rare in 2025).

---

### The Hybrid (Storing Both) — Anti-Pattern

**Why Not to Store Both:**
1. **Redundancy:** Storing `{ code: "KeyK", key: "k" }` is redundant. They are derived from the same event; one is sufficient.
2. **Drift Risk:** Over time, data may become inconsistent (e.g., `{ code: "KeyK", key: "d" }` from incorrect capture or migration). You must maintain invariants.
3. **Bloated Storage:** Extensions have limited storage quota. Redundant data wastes it.
4. **Serialization Complexity:** JSON representation becomes larger; more code to validate during deserialization.
5. **No Clear Semantics:** Which field is canonical? If both are present, does code take precedence? The ambiguity invites bugs.

**Do Not Do This:** ✗ `{ code: "KeyB", key: "b", mods: ["Alt", "Shift"] }`

---

### Recommended Hybrid Strategy — Code + Smart Labels

**The Correct Pattern:**
1. **Store `code` as the source of truth** for character keys (a-z, 0-9, punctuation).
2. **Maintain a canonical `codeToLabel()` mapping** to generate human-readable labels for display and serialization.
3. **For non-character keys, store `key` directly** because it's both layout-independent and human-readable.

**Justification:**
- **Layout Independence:** Shortcuts remain portable across layout changes.
- **Human Readability:** Display labels (derived from `code` via mapping) are clear.
- **Serialization:** Store the string grammar (e.g., `"Ctrl+Shift+K"`) for users and config files, but internally track `code` values.
- **Industry Alignment:** Matches VS Code, Figma, and modern editors.

**Code to Label Mapping (Abbreviated):**
```javascript
const codeToLabel = {
  // Letters
  "KeyA": "A", "KeyB": "B", /* ... */ "KeyZ": "Z",
  // Numbers
  "Digit0": "0", "Digit1": "1", /* ... */ "Digit9": "9",
  // Punctuation
  "Minus": "-", "Equal": "=", "BracketLeft": "[", "BracketRight": "]",
  "Backslash": "\\", "Semicolon": ";", "Quote": "'", "Comma": ",",
  "Period": ".", "Slash": "/", "Backquote": "`",
  // Navigation
  "ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→",
  "Home": "Home", "End": "End", "PageUp": "PgUp", "PageDown": "PgDn",
  // Whitespace & Special
  "Enter": "Enter", "Escape": "Esc", "Tab": "Tab", "Space": "Space",
  "Backspace": "Backspace", "Delete": "Delete",
  // Modifiers (display as symbols or names)
  "ShiftLeft": "⇧", "ShiftRight": "⇧", "ControlLeft": "⌃", "ControlRight": "⌃",
  "AltLeft": "⌥", "AltRight": "⌥", "MetaLeft": "⌘", "MetaRight": "⌘",
  // Function keys
  "F1": "F1", "F2": "F2", /* ... */ "F24": "F24",
};

function codeToLabel(code, platform = "auto") {
  const baseLabel = codeToLabel[code] || code;
  if (platform === "mac" || (platform === "auto" && isMac())) {
    return baseLabel === "Control" ? "⌃" : baseLabel;
  }
  return baseLabel;
}
```

---

## 3. Modifier Keys — The Hairy Details

Modifier keys (Shift, Control, Alt, Meta/Command) are the foundation of multi-key shortcuts. Handling their left/right distinction, normalization, and platform semantics is intricate.

### Left vs Right Modifiers — When to Distinguish

**Code Values:**
- Shift: `"ShiftLeft"` (0x002A) vs `"ShiftRight"` (0x0036)
- Control: `"ControlLeft"` (0x001D) vs `"ControlRight"` (0xE01D)
- Alt: `"AltLeft"` (0x0038) vs `"AltRight"` (0xE038)
- Meta/Command: `"MetaLeft"` (0xE05B) vs `"MetaRight"` (0xE05C)

**When to Care:**
- **AltGr Detection:** On Windows and Linux, the right Alt key (`"AltRight"` / `code === "AltRight"`) is physically the AltGr key. Combining `event.code === "AltRight"` and `event.getModifierState("AltGraph")` reliably detects AltGr without false positives from Ctrl+Alt.
- **Gaming:** Left vs right Shift may matter for precise control (e.g., differentiating sprint from walk).
- **Accessibility:** Some users may only have left modifiers bound or vice versa.

**When to NOT Care (99% of Cases):**
- Most keyboard shortcuts don't distinguish sides. Ctrl+Z works with either Control key. Shift+A works with either Shift key.

**Normalization Pattern:**
Store modifiers as a normalized set of strings: `{"Shift", "Control", "Alt", "Meta"}`. Fold both sides to a single name.

```javascript
function normalizeModifiers(event) {
  const mods = new Set();
  if (event.shiftKey) mods.add("Shift");
  if (event.ctrlKey) mods.add("Control");
  if (event.altKey && !event.getModifierState("AltGraph")) {
    // Only add "Alt" if it's NOT AltGr
    mods.add("Alt");
  }
  if (event.metaKey) mods.add("Meta");
  return mods;
}
```

---

### Normalization — Folding Left and Right

**Standard Practice:**
In the vast majority of shortcut systems, users bind Ctrl+K once and it works with either Control key. This simplifies storage and user experience.

**Implementation:**
```javascript
function getModifierSet(event) {
  // Returns a Set or array of normalized modifier names
  const mods = [];
  if (event.shiftKey) mods.push("Shift");
  if (event.ctrlKey) mods.push("Control");
  if (event.altKey) mods.push("Alt");
  if (event.metaKey) mods.push("Meta");
  return new Set(mods); // Deduplicate, return as set
}

// Internally, store shortcuts as:
// { code: "KeyK", mods: ["Control"] }
// When matching, check: event.code === "KeyK" && hasModifier("Control")
```

**Display Representation:**
Platform-aware formatting:
- **Mac:** `Cmd+Shift+K` or `⌘⇧K` (use ⌘ for Cmd, ⇧ for Shift)
- **Windows/Linux:** `Ctrl+Shift+K`

```javascript
function formatShortcut(code, mods, platform = "auto") {
  const isMac = platform === "mac" || navigator.platform.includes("Mac");
  const parts = [];
  
  // Modifiers in conventional order: Ctrl/Cmd, Alt/Option, Shift
  if (mods.includes("Control")) {
    parts.push(isMac ? "Cmd" : "Ctrl");
  }
  if (mods.includes("Alt")) {
    parts.push(isMac ? "Option" : "Alt");
  }
  if (mods.includes("Shift")) {
    parts.push("Shift");
  }
  
  // Primary key
  const label = codeToLabel[code] || code;
  parts.push(label);
  
  return parts.join(isMac ? "" : "+");
}
```

---

### `metaKey` Semantics — Cmd/Win/Super

**Definitions:**
- **macOS:** The Command key (⌘). The standard primary modifier for application shortcuts. Always reports `metaKey === true`.
- **Windows:** The Windows key (Win), sometimes called the Super key. Less commonly used for application shortcuts; Alt+Tab and Win+X are system-level.
- **Linux:** The Super key, often with no standard binding in desktop applications. GNOME activities button uses it by default.

**Handling "CmdOrCtrl" Pattern:**
Many Electron-based applications and cross-platform libraries use a virtual modifier called `"CmdOrCtrl"` in keybinding strings to automatically map to the native primary modifier:
- On Mac: `"CmdOrCtrl+K"` becomes `"Cmd+K"`
- On Windows/Linux: `"CmdOrCtrl+K"` becomes `"Ctrl+K"`

**Implementation for Extensions:**
```javascript
function isCmdOrCtrl(event, platform = "auto") {
  const isMac = platform === "mac" || /Mac/.test(navigator.platform);
  return isMac ? event.metaKey : event.ctrlKey;
}

// In shortcut definition:
// { id: "TOGGLE", chord: [{ code: "KeyK", mods: ["CmdOrCtrl"] }] }
// When matching:
if (event.code === "KeyK" && isCmdOrCtrl(event)) {
  // Fire the shortcut
}
```

**When to Use:**
For cross-platform extensions, always use `"CmdOrCtrl"` logic. Store as `"Meta"` in the mods set and translate during platform-specific display/matching.

---

### The `Fn` Key — Usually Inaccessible

**Definition:** The Fn key on Mac laptops and some gaming keyboards, used to alter function key behavior (F1 usually means brightness down, Fn+F1 means actual F1).

**Limitation:** The Fn key is usually intercepted at the hardware/driver level and does not reach JavaScript. You cannot reliably detect `Fn` in a `keydown` event. `event.getModifierState("Fn")` may return true on some devices, but this is not universal.

**Workaround:** If you need to support Fn-modified keys, you must coordinate with the extension's host environment (OS-level hook, native code, or content-script bypass). This is rarely necessary for keyboard shortcuts.

---

## 4. AltGr — The Killer Corner Case

On European keyboards (German, Spanish, Polish, French, Czech, etc.), the right Alt key is labeled "AltGr" and is used to type special characters that require two levels of shift. For example:

- German QWERTZ: AltGr+5 → `€`
- Spanish: AltGr+4 → `€`, AltGr+[ → `{`
- French AZERTY: AltGr+0 → `@`, AltGr+9 → `}`

**The Problem:**
The Windows and Linux OS layer emulates AltGr as `Ctrl+Alt` for backward compatibility with older compact keyboards that don't have a distinct AltGr key. This means when the user presses AltGr+5 to type `€`, JavaScript sees:
- `event.ctrlKey === true`
- `event.altKey === true`
- `event.code === "Digit5"`

If your extension binds `Ctrl+Alt+5` as a shortcut, it **blocks the user from typing €**. The browser consumes the event, preventing the OS from generating the character.

**Detection and Avoidance:**
Use `getModifierState("AltGraph")` to distinguish AltGr from Ctrl+Alt:

```javascript
function isAltGr(event) {
  // AltGraph is true when AltGr is pressed
  // event.code === "AltRight" confirms it's the right Alt key (AltGr on EU keyboards)
  return event.getModifierState("AltGraph") && event.code === "AltRight";
}

function isCtrlAlt(event) {
  // Ctrl+Alt (both true) but NOT AltGr
  return event.ctrlKey && event.altKey && !event.getModifierState("AltGraph");
}

// In capture handler:
document.addEventListener("keydown", (event) => {
  if (isAltGr(event)) {
    // Do NOT bind Ctrl+Alt here; let the character through
    return;
  }
  if (isCtrlAlt(event)) {
    // Safe to use Ctrl+Alt as a shortcut
  }
});
```

**Chrome Extension Manifest Restriction:**
The Chrome `chrome.commands` API explicitly forbids `Ctrl+Alt` combinations in manifest's `suggested_key` to prevent exactly this collision:

From the Chrome Docs: "Key combinations with Ctrl+Alt are prohibited to avoid conflicts with the AltGr key."

**Recommendation:**
Never use `Ctrl+Alt+*` as a shortcut in a browser extension, even if you think it's safe. Use `Ctrl+Shift+*` or other combinations instead. Reserve Ctrl+Alt for system-level functionality where the collision is understood and managed (e.g., IME switching).

---

## 5. Dead Keys and IME — Non-ASCII Input

### Dead Keys

**Definition:** A dead key (combining key) produces no character by itself but modifies the next character typed. Common on Mac and many international layouts.

**Examples:**
- US Mac: Option+E (dead acute accent) → wait for next key → types `é` when followed by 'e'
- French AZERTY: ` (backtick, dead grave) → Types `à`, `è`, `ù`, etc.
- Spanish: ´ (dead acute) → Types `á`, `é`, `í`, `ó`, `ú`

**JavaScript Behavior:**
When a dead key is pressed, `keydown` fires with:
- `event.key === "Dead"` (sentinel string)
- `event.code === "KeyE"` (or whichever physical key)
- The actual character (e.g., accent) is not available in the event

The composed character only appears on the next keystroke (non-dead key) or when the composition is committed.

**In Shortcut Capture:**
If the user presses a dead key during shortcut capture, you'll get `key === "Dead"`. You must reject it:

```javascript
if (event.key === "Dead") {
  console.log("User pressed a dead key. Ignore and wait for next key.");
  return; // Don't commit yet
}
```

This is why capture UIs typically wait for a non-modifier, non-dead key before committing.

---

### IME Composition

**Definition:** Input Method Editor (IME) is used in East Asian languages (Chinese, Japanese, Korean) and some other complex scripts to input a large character set via a small keyboard.

**Example Flow (Chinese Pinyin IME):**
1. User types 'n', 'i', 'h', 'a', 'o' (nihao, "hello" in pinyin romanization).
2. During typing, `keydown` fires for each letter with `isComposing === true`, `key === "Process"`.
3. IME displays a popup with candidate characters (你好, etc.).
4. User presses Space or a number key to select a candidate.
5. `compositionend` fires.
6. The selected characters are inserted into the text field.

**JavaScript Behavior During Composition:**
- `keydown` events fire with `isComposing === true`.
- `event.key` returns `"Process"` (older browsers) or the partial composition string.
- `event.code` still returns the physical key.
- Modifier keys are reported normally (`ctrlKey`, `altKey`, etc.).
- The `input` event fires with the final composed text.

**In Shortcut Capture:**
Reject any keydown with `isComposing === true`:

```javascript
if (event.isComposing) {
  console.log("User is in IME composition. Ignore.");
  return; // Don't commit yet
}
```

If the user is in an IME session and tries to rebind a shortcut without rejecting composition events, you'll capture `key === "Process"` and store that, which is useless.

---

### Guard Pattern for Capture Handlers

The canonical pattern that libraries like Mousetrap follow:

```javascript
function captureKeyboardShortcut(event) {
  // Reject non-user events
  if (!event.isTrusted) return;
  
  // Reject composition in progress
  if (event.isComposing) return;
  
  // Reject dead keys
  if (event.key === "Dead") return;
  
  // Reject unidentified keys
  if (event.key === "Unidentified") return;
  
  // Reject if key is a modifier itself (Shift, Control, etc.)
  const isSingleModifier = [
    "Shift", "Control", "Alt", "Meta",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
    "AltLeft", "AltRight", "MetaLeft", "MetaRight"
  ].includes(event.code);
  if (isSingleModifier) return; // Wait for a non-modifier key
  
  // Reject AltGr to avoid blocking character input
  if (event.getModifierState("AltGraph")) return;
  
  // Now we have a valid, user-initiated keystroke
  // Capture modifiers and code
  const mods = normalizeModifiers(event);
  const code = event.code;
  
  // Commit the shortcut
  console.log(`Captured: ${[...mods].join("+")}+${code}`);
  event.preventDefault(); // Prevent default browser action
  // ... store the shortcut
}

document.addEventListener("keydown", captureKeyboardShortcut);
```

---

## 6. Platform Differences — Mac vs Windows vs Linux

Keyboard shortcut conventions vary significantly across platforms, driven by historical precedent and OS-level shortcuts.

### macOS

**Primary Modifier:** Command (Cmd, ⌘)
- Most application shortcuts use Cmd+key (Cmd+C, Cmd+Z, Cmd+S).
- Command is the native primary modifier; Ctrl is less common and reserved for system use and terminal.
- Option (Alt) is used for text navigation (Option+Left → word left, Option+Up → paragraph up) and special characters.

**Typical Conventions:**
- Cmd+C: Copy
- Cmd+V: Paste
- Cmd+Z: Undo
- Cmd+Shift+Z: Redo
- Cmd+Q: Quit app
- Cmd+H: Hide app
- Cmd+M: Minimize
- Cmd+Option+Esc: Force Quit

**Function Keys Behavior:**
F1–F12 are often mapped to hardware functions (brightness, volume) by default. Users must press Fn+F1 to access the actual function key. Some apps allow remapping this behavior in settings.

**Numpad:** Mac keyboards (except Magic Keyboard with numeric pad) often lack a physical numeric pad. Laptops use an on-screen overlay or Bluetooth numeric pad.

---

### Windows / Linux

**Primary Modifier:** Control (Ctrl)
- Most application shortcuts use Ctrl+key (Ctrl+C, Ctrl+Z, Ctrl+S).
- Alt is used for menu access (Alt+F for File menu) and system shortcuts (Alt+Tab, Alt+F4).
- Windows/Super key is used for system-level shortcuts (Win+D for desktop, Win+X for quick menu).

**Typical Conventions:**
- Ctrl+C: Copy
- Ctrl+V: Paste
- Ctrl+Z: Undo
- Ctrl+Y: Redo
- Ctrl+S: Save
- Alt+F4: Close window
- Alt+Tab: Switch window
- Win+L: Lock screen (Windows)

**Function Keys Behavior:**
F1–F12 are standard function keys without media override on most Windows keyboards. F1 is typically Help, F2 is rename, F5 is refresh, F11 is fullscreen, F12 is developer tools.

**Numpad:** Standard on full-size Windows keyboards. On laptops, a numeric keypad overlay may be available (Shift+NumLock toggles it).

---

### Convention Translation — CmdOrCtrl

Applications targeting multiple platforms often use a "CmdOrCtrl" token in shortcut definitions to map to the native primary modifier:

**VS Code's Approach:**
VS Code's `keybindings.json` uses platform-specific conditions:

```json
[
  {
    "key": "cmd+p",
    "command": "workbench.action.quickOpen",
    "when": "isWeb || isMac"
  },
  {
    "key": "ctrl+p",
    "command": "workbench.action.quickOpen",
    "when": "!isMac && !isWeb"
  }
]
```

Or more succinctly:
```json
[
  {
    "key": "ctrl+p",
    "command": "workbench.action.quickOpen"
  },
  {
    "key": "cmd+p",
    "mac": "cmd+p",
    "command": "workbench.action.quickOpen"
  }
]
```

**Electron's Accelerator Grammar:**
Electron's Menu API uses the `"CmdOrCtrl"` token directly:

```javascript
const menu = [{
  label: "File",
  submenu: [{
    label: "Open",
    accelerator: "CmdOrCtrl+O",
    click() { /* ... */ }
  }]
}];
```

Electron automatically translates `"CmdOrCtrl+O"` to `"Cmd+O"` on Mac and `"Ctrl+O"` on Windows/Linux.

**Implementation for This Extension:**
Store bindings with a `"CmdOrCtrl"` token or handle platform detection at matching time:

```javascript
function matchesShortcut(storedShortcut, event) {
  const isMac = /Mac/.test(navigator.platform);
  
  // If the stored shortcut uses "CmdOrCtrl", match against the native primary
  const isMatch = storedShortcut.mods.some(mod => mod === "CmdOrCtrl")
    ? (isMac ? event.metaKey : event.ctrlKey)
    : (storedShortcut.mods.includes("Control") ? event.ctrlKey : true) &&
      (storedShortcut.mods.includes("Alt") ? event.altKey : true) &&
      (storedShortcut.mods.includes("Shift") ? event.shiftKey : true) &&
      (storedShortcut.mods.includes("Meta") ? event.metaKey : true);
  
  return isMatch && event.code === storedShortcut.code;
}
```

---

## 7. Non-Modifier Shortcuts and Sequences

### Single-Key Bindings — Avoiding Capture in Input Fields

Gmail-style shortcuts like 'j' (next), 'k' (previous), 'c' (compose) are powerful but risky: the 'j' keydown should not trigger if the user is typing in a search box.

**The Standard Guard:**
```javascript
function isTextInput(element) {
  return element.matches("input[type='text'], textarea, [contenteditable]") ||
         (element.nodeName === "INPUT" && ["text", "email", "password", "search", "url"].includes(element.type));
}

document.addEventListener("keydown", (event) => {
  if (isTextInput(event.target)) {
    // User is typing; ignore single-key shortcuts
    return;
  }
  
  if (event.code === "KeyJ") {
    // Safe to trigger 'j' shortcut
  }
});
```

**Variation — Allow Modifiers in Input:**
If you want `Ctrl+K` to work even in input (e.g., for a command palette), check for modifiers:

```javascript
if (isTextInput(event.target) && !(event.ctrlKey || event.metaKey)) {
  // Ignore single-key presses in input, but allow Ctrl+*
  return;
}
```

---

### Sequence Chords — `g i`, `g t`

**Definition:** Vim-style key sequences where the first keystroke commits immediately (if it's a modifier), then a timeout window opens for the second keystroke.

**Examples:**
- Gmail: 'g' then 'i' → go to inbox; 'g' then 'a' → go to all mail
- Vim: 'g' then 'i' → go to insert position; 'g' then 'g' → go to line 1

**Implementation Pattern:**
```javascript
class SequenceCapture {
  constructor(timeoutMs = 1000) {
    this.timeout = timeoutMs;
    this.buffer = [];
    this.timer = null;
  }
  
  capture(code) {
    this.buffer.push(code);
    clearTimeout(this.timer);
    
    // Check if sequence matches
    const sequence = this.buffer.join(" ");
    if (this.isKnownSequence(sequence)) {
      this.executeSequence(sequence);
      this.reset();
      return;
    }
    
    // If buffer is too long or time elapses, reset
    this.timer = setTimeout(() => this.reset(), this.timeout);
  }
  
  isKnownSequence(sequence) {
    return ["g i", "g a", "g t"].includes(sequence);
  }
  
  executeSequence(sequence) {
    console.log(`Execute: ${sequence}`);
  }
  
  reset() {
    this.buffer = [];
    clearTimeout(this.timer);
  }
}

const seqCapture = new SequenceCapture(1000);
document.addEventListener("keydown", (event) => {
  if (!isTextInput(event.target) && event.code.startsWith("Key")) {
    seqCapture.capture(event.code);
  }
});
```

**Mousetrap.js Approach:**
The popular Mousetrap library handles sequences like this:

```javascript
// Using mousetrap library (pseudo-code):
Mousetrap.bind(["g", "i"], () => {
  alert("go to inbox");
});

Mousetrap.bind(["g", "t"], () => {
  alert("go to threads");
});
```

Internally, Mousetrap maintains a sequence buffer, matches prefixes, and fires callbacks on completion or timeout.

---

## 8. Browser and OS Shortcut Collisions

**Critical:** Certain shortcuts are reserved by the browser and OS and cannot be intercepted or overridden. Attempting to bind them will silently fail or have unexpected behavior.

### Chrome/Chromium Reserved Shortcuts

**Cannot Override (browser consumes):**
- `Ctrl+T` — New tab
- `Ctrl+N` — New window
- `Ctrl+W` — Close tab
- `Ctrl+Shift+W` — Close window
- `Ctrl+Tab` — Next tab
- `Ctrl+Shift+Tab` — Previous tab
- `Ctrl+Shift+T` — Restore closed tab
- `Ctrl+Shift+Del` — Clear browsing data
- `F11` — Fullscreen
- `F12` — Developer Tools
- `Ctrl+Shift+I` — Open DevTools
- `Ctrl+Shift+J` — Open DevTools Console
- `Ctrl+Shift+K` — Open DevTools Console (alternate)
- `Ctrl+Shift+C` — DevTools element picker
- `Ctrl+F` — Find (in page)
- `Ctrl+G` — Find next
- `Ctrl+Shift+G` — Find previous
- `Ctrl+H` — History
- `Ctrl+J` — Downloads
- `Ctrl+L` — Jump to address bar
- `Alt+Left` — Back
- `Alt+Right` — Forward
- `Alt+Home` — Home page

**Mac (Cmd replaces Ctrl):**
- `Cmd+Q` — Quit Chrome
- `Cmd+W` — Close tab
- `Cmd+N` — New window
- `Cmd+Shift+T` — Restore tab

---

### Firefox Reserved Shortcuts

Firefox is particularly strict:

**Cannot Override:**
- `Alt+F` — File menu
- `Alt+E` — Edit menu
- `Alt+V` — View menu
- `Alt+H` — History menu
- `Alt+B` — Bookmarks menu
- `Alt+T` — Tools menu
- `Ctrl+T` — New tab
- `Ctrl+N` — New window
- `Ctrl+W` — Close tab
- `Ctrl+Tab` — Next tab
- `Ctrl+Shift+Tab` — Previous tab
- `Ctrl+Shift+T` — Restore tab
- `Ctrl+L` — Address bar
- `Ctrl+F` — Find
- `F11` — Fullscreen
- `F12` — Developer Tools
- `Ctrl+Shift+K` — DevTools Console

---

### Windows / OS Level

**Cannot Override (OS consumes):**
- `Alt+F4` — Close window
- `Alt+Tab` — Switch window
- `Win+X` — Quick menu (Windows 8+)
- `Win+V` — Clipboard history (Windows 10+)
- `Win+D` — Show/hide desktop
- `Win+L` — Lock screen
- `Win+E` — File Explorer
- `Win+I` — Settings
- `Ctrl+Alt+Del` — Task Manager (sometimes; varies by context)

---

### macOS / OS Level

**Cannot Override (OS consumes):**
- `Cmd+Option+Esc` — Force Quit
- `Cmd+Tab` — Application switcher
- `Cmd+Space` — Spotlight search
- `Control+Space` or `Cmd+Space` — Input method switcher (East Asian)
- `Fn+F1–F12` — Brightness, volume, media controls (if using default Mac behavior)
- `Cmd+Q` — Quit (though apps can intercept for save prompts)
- `Cmd+M` — Minimize (standard macOS convention)
- `Cmd+H` — Hide (standard macOS convention)

---

### Reference

- Chrome docs: https://support.google.com/chrome/answer/157179
- Firefox docs: https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly

---

## 9. chrome.commands API Specifics (MV3)

Since this extension uses the `chrome.commands` API, understanding its constraints and behavior is essential.

### Manifest Declaration

Commands are declared in `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "commands": {
    "toggle-blur": {
      "suggested_key": {
        "default": "Ctrl+Shift+B",
        "mac": "Command+Shift+B"
      },
      "description": "Toggle blur"
    },
    "focus-mode": {
      "suggested_key": {
        "windows": "Ctrl+Alt+M",
        "mac": "Command+Option+M",
        "linux": "Ctrl+Alt+M"
      },
      "description": "Enter focus mode"
    }
  }
}
```

### Keyboard Shortcut Rules

From the Chrome Documentation:

**Modifier Requirements:**
"Extension command shortcuts must include either `Ctrl` or `Alt`." This means:
- `Ctrl+K` ✓
- `Alt+K` ✓
- `Shift+K` ✗ (no Ctrl or Alt; not allowed alone)
- `Ctrl+Shift+K` ✓ (includes Ctrl)
- `Alt+Shift+K` ✓ (includes Alt)

**Prohibited Combinations:**
- `Ctrl+Alt+*` — Prohibited to avoid AltGr conflicts (mentioned previously).
- Media key modifiers — Media keys (MediaPlayPause, AudioVolumeUp, etc.) cannot have modifiers.

**Allowed Modifiers:**
- `Ctrl` (Windows/Linux), `Command` (Mac), `MacCtrl` (explicitly Control on Mac)
- `Alt` or `Option` (Mac), `Alt` (Windows/Linux)
- `Shift`
- None of these may be used with Media keys.

**Modifier Token Mapping:**
| Token | Windows | Mac | Linux |
|-------|---------|-----|-------|
| `Ctrl` | Control | Command | Control |
| `Command` | (invalid) | Command | (invalid) |
| `MacCtrl` | (invalid) | Control | (invalid) |
| `Option` | (invalid) | Option (Alt) | (invalid) |
| `Alt` | Alt | Alt | Alt |
| `Shift` | Shift | Shift | Shift |

Example — Platform-Specific Modifiers:
```json
{
  "suggested_key": {
    "default": "Ctrl+Shift+B",
    "mac": "Command+Shift+B"
  }
}
```

Or with MacCtrl:
```json
{
  "suggested_key": {
    "default": "Ctrl+Shift+B",
    "mac": "MacCtrl+Shift+B"
  }
}
```

### Global Commands

Extensions can mark commands as global to trigger even when Chrome is not in focus:

```json
{
  "commands": {
    "toggle-blur": {
      "suggested_key": {
        "default": "Ctrl+Shift+B"
      },
      "global": true,
      "description": "Toggle blur"
    }
  }
}
```

**Limitations:**
- **ChromeOS does not support global commands.**
- Global shortcuts are limited to `Ctrl+Shift+[0..9]` on Windows/Linux for safety (to avoid conflicts with other applications).
- On Mac, global shortcuts can use any combination of Command, Option, Shift, but it's recommended to use safe combinations.

### Dynamic Command Updates

At runtime, extensions can read and modify commands:

```javascript
// Background service worker
chrome.commands.getAll((commands) => {
  commands.forEach(cmd => {
    console.log(`${cmd.name}: ${cmd.shortcut}`);
  });
});

chrome.commands.update({
  name: "toggle-blur",
  shortcut: "Ctrl+Shift+C" // User changed it via chrome://extensions/shortcuts
});
```

### Listening for Commands

The `chrome.commands.onCommand` event fires when a command is executed via its shortcut:

```javascript
// Background service worker
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "toggle-blur":
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {action: "toggle-blur"});
      });
      break;
    case "focus-mode":
      // Handle focus mode
      break;
  }
});
```

### Reserved Commands

`_execute_action` is a reserved command that triggers the extension's action (icon click) without firing `onCommand`:

```json
{
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y"
      }
    }
  }
}
```

When the user presses Ctrl+Shift+Y, the extension's action is triggered (icon appearance changes, popup opens, etc.), but `onCommand` listeners are **not** fired.

---

### The Double-Fire Problem — JS Shortcuts + chrome.commands

**The Issue:** If your extension registers both a `chrome.commands` shortcut and a JS-level keyboard event listener for the same chord, both may fire, causing double execution.

**Example:**
```json
// manifest.json
{
  "commands": {
    "toggle-blur": {
      "suggested_key": "Ctrl+Shift+B"
    }
  }
}
```

```javascript
// service worker
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-blur") {
    // First execution
    toggleBlur();
  }
});

// Content script (separate JS handler)
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.code === "KeyB") {
    // Second execution (duplicate!)
    toggleBlur();
  }
});
```

**Solution — Deduplication:**
As the project already does with `TOGGLE_DEDUP_MS`:

```javascript
let lastToggleTime = 0;
const TOGGLE_DEDUP_MS = 100;

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-blur") {
    lastToggleTime = Date.now();
    toggleBlur();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.code === "KeyB") {
    const now = Date.now();
    if (now - lastToggleTime > TOGGLE_DEDUP_MS) {
      toggleBlur(); // Only fire if not already fired by chrome.commands
    }
  }
});
```

Alternatively, disable the JS handler if the command is defined in `manifest.json`, and rely entirely on `chrome.commands`.

---

### Firefox WebExtensions Differences

Firefox uses the same `browser.commands` API (or `chrome.commands` polyfilled):

**Manifest Syntax (identical to Chrome):**
```json
{
  "manifest_version": 3,
  "browser_specific_settings": {
    "gecko": {
      "id": "addon@example.com"
    }
  },
  "commands": {
    "toggle-blur": {
      "suggested_key": {
        "default": "Ctrl+Shift+B"
      },
      "description": "Toggle blur"
    }
  }
}
```

**API Usage (identical):**
```javascript
browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-blur") {
    // Handle command
  }
});
```

**Differences:**
- Firefox may be less restrictive on certain modifier combinations than Chrome.
- Firefox respects Alt+key shortcuts less strictly than Chrome.
- Some reserved browser shortcuts differ (e.g., Firefox uses Ctrl+Shift+K for console, Chrome uses Ctrl+Shift+J).

---

## 10. Recommended Data Model for This Extension

Given all the above analysis, here are two concrete proposals for storing and managing keyboard shortcuts.

### Option A — Code-Based Object Model (Recommended)

**Rationale:**
- Layout-independent (code-based).
- Explicit, structured representation.
- Easy to serialize and validate.
- Matches how VS Code internally represents shortcuts.

**Data Structure:**

```typescript
interface Shortcut {
  id: string; // Unique identifier (e.g., "TOGGLE_BLUR_ALL")
  sequences: Chord[][]; // Array of sequences; each sequence is an array of chords
}

interface Chord {
  code: string; // Physical key code (e.g., "KeyB", "ShiftLeft", "Enter")
  mods: string[]; // Normalized modifiers (e.g., ["Control", "Shift"])
  // Alternative: altCodes?: string[] // For bindings that accept multiple physical keys (e.g., "Enter" or "NumpadEnter")
}
```

**JSON Example:**

```json
{
  "shortcuts": [
    {
      "id": "TOGGLE_BLUR_ALL",
      "sequences": [
        [
          { "code": "KeyB", "mods": ["Control", "Shift"] }
        ]
      ]
    },
    {
      "id": "TOGGLE_FOCUS_MODE",
      "sequences": [
        [
          { "code": "KeyM", "mods": ["Control", "Shift"] }
        ],
        [
          { "code": "KeyF", "mods": ["Control", "Alt", "Shift"] }
        ]
      ]
    },
    {
      "id": "GO_TO_INBOX",
      "sequences": [
        [
          { "code": "KeyG", "mods": [] },
          { "code": "KeyI", "mods": [] }
        ]
      ]
    }
  ]
}
```

**Matching Logic:**

```javascript
class ShortcutMatcher {
  constructor(shortcuts) {
    this.shortcuts = shortcuts;
    this.sequenceBuffer = [];
    this.sequenceTimer = null;
    this.SEQUENCE_TIMEOUT_MS = 1000;
  }

  normalizeModifiers(event) {
    const mods = [];
    if (event.shiftKey) mods.push("Shift");
    if (event.ctrlKey) mods.push("Control");
    if (event.altKey && !event.getModifierState("AltGraph")) {
      mods.push("Alt");
    }
    if (event.metaKey) mods.push("Meta");
    return mods;
  }

  matchChord(code, mods, chord) {
    if (code !== chord.code) return false;
    const modsSet = new Set(mods);
    const chordModsSet = new Set(chord.mods);
    return (
      modsSet.size === chordModsSet.size &&
      [...modsSet].every(m => chordModsSet.has(m))
    );
  }

  captureKeydown(event) {
    if (!event.isTrusted) return null;
    if (event.isComposing) return null;
    if (event.key === "Dead" || event.key === "Unidentified") return null;
    if (event.getModifierState("AltGraph")) return null;

    const isSingleModifier = ["Shift", "Control", "Alt", "Meta"].some(
      mod => event.code.includes(mod)
    );
    if (isSingleModifier && event.code !== "Enter") return null;

    const code = event.code;
    const mods = this.normalizeModifiers(event);

    // Build current chord
    const currentChord = { code, mods };

    // Check if this chord matches any known shortcuts
    let matchedShortcut = null;
    for (const shortcut of this.shortcuts) {
      for (const sequence of shortcut.sequences) {
        // Single-chord sequences
        if (sequence.length === 1) {
          if (this.matchChord(code, mods, sequence[0])) {
            matchedShortcut = shortcut;
            break;
          }
        }
        // Multi-chord sequences (e.g., "g i")
        else {
          // Check if this chord completes a sequence
          if (this.sequenceBuffer.length < sequence.length) {
            if (
              this.matchChord(
                code,
                mods,
                sequence[this.sequenceBuffer.length]
              )
            ) {
              this.sequenceBuffer.push(currentChord);

              if (this.sequenceBuffer.length === sequence.length) {
                matchedShortcut = shortcut;
                this.sequenceBuffer = [];
                clearTimeout(this.sequenceTimer);
                break;
              } else {
                // Partial match; reset timeout
                clearTimeout(this.sequenceTimer);
                this.sequenceTimer = setTimeout(() => {
                  this.sequenceBuffer = [];
                }, this.SEQUENCE_TIMEOUT_MS);
              }
            } else {
              // No match; reset buffer
              this.sequenceBuffer = [];
              clearTimeout(this.sequenceTimer);
            }
          }
        }
        if (matchedShortcut) break;
      }
      if (matchedShortcut) break;
    }

    return matchedShortcut;
  }
}
```

**Advantages:**
- Layout-independent via `code`.
- Sequences are first-class (multi-key bindings).
- Structured, strongly-typed.
- Explicit modifier handling.

**Disadvantages:**
- More verbose JSON.
- Requires parsing and matching logic.
- Not directly human-readable (need codeToLabel mapping for display).

---

### Option B — Grammar String Model (Alternative)

**Rationale:**
- Compact, human-readable string representation.
- Easy for users to understand and edit directly.
- Similar to Electron's Accelerator grammar.

**String Grammar:**
```
<shortcut> ::= <sequence> ( "|" <sequence> )*
<sequence> ::= <chord> ( " " <chord> )*
<chord> ::= <modifiers>? <key>
<modifiers> ::= <modifier> ( "+" <modifier> )*
<modifier> ::= "Ctrl" | "Shift" | "Alt" | "Meta" | "Cmd" | "CmdOrCtrl" | "Control"
<key> ::= "KeyA" | "KeyB" | ... | "Enter" | "Escape" | ... (any valid code or key)
```

**Examples:**

```json
{
  "shortcuts": [
    {
      "id": "TOGGLE_BLUR_ALL",
      "bindings": ["Ctrl+Shift+B"]
    },
    {
      "id": "TOGGLE_FOCUS_MODE",
      "bindings": ["Ctrl+Shift+M", "Ctrl+Alt+Shift+F"]
    },
    {
      "id": "GO_TO_INBOX",
      "bindings": ["g i"]
    },
    {
      "id": "COPY_NATIVE",
      "bindings": ["CmdOrCtrl+C"]
    }
  ]
}
```

**Parser and Matcher:**

```javascript
function parseShortcutString(str) {
  const sequences = str.split("|").map(seq => seq.trim());
  return sequences.map(seq => {
    if (seq.includes(" ")) {
      // Multi-chord sequence
      return seq.split(" ").map(chord => parseChord(chord.trim()));
    } else {
      // Single chord
      return [parseChord(seq)];
    }
  });
}

function parseChord(chordStr) {
  const parts = chordStr.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);

  // Normalize modifiers
  const normalizedMods = mods.map(mod => {
    const m = mod.toLowerCase();
    if (m === "ctrl" || m === "control") return "Control";
    if (m === "shift") return "Shift";
    if (m === "alt" || m === "option") return "Alt";
    if (m === "meta" || m === "cmd" || m === "command") return "Meta";
    if (m === "cmdorctrl") return "CmdOrCtrl";
    return mod;
  });

  // Code is the key (physical position)
  const code = keyToCode(key); // Map "a" to "KeyA", "Enter" to "Enter", etc.

  return { code, mods: normalizedMods };
}

function keyToCode(key) {
  // Map human-readable names to code values
  const mapping = {
    "a": "KeyA", "b": "KeyB", /* ... */, "z": "KeyZ",
    "0": "Digit0", "1": "Digit1", /* ... */, "9": "Digit9",
    "Enter": "Enter", "Escape": "Escape", "Tab": "Tab",
    "ArrowUp": "ArrowUp", "ArrowDown": "ArrowDown", "ArrowLeft": "ArrowLeft", "ArrowRight": "ArrowRight",
    // ... full mapping
  };
  return mapping[key] || key; // Assume key is already a code if not in mapping
}

function shortcutToString(chord, mods) {
  const codeToLabel = {
    "KeyA": "A", /* ... */ "KeyZ": "Z",
    "Digit0": "0", /* ... */ "Digit9": "9",
    "Enter": "Enter", "Escape": "Esc", "Tab": "Tab",
    // ...
  };

  const label = codeToLabel[chord.code] || chord.code;
  const modStr = mods.map(mod => {
    if (mod === "Control") return navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
    if (mod === "Alt") return navigator.platform.includes("Mac") ? "Option" : "Alt";
    if (mod === "Meta") return "Meta";
    if (mod === "Shift") return "Shift";
    return mod;
  }).join("+");

  return modStr ? `${modStr}+${label}` : label;
}
```

**Advantages:**
- Compact, human-readable.
- Similar to VS Code and Electron.
- Easy for users to understand.
- Can be edited directly in config files.

**Disadvantages:**
- Requires parsing.
- String validation is more complex.
- `"CmdOrCtrl"` needs runtime translation.
- Less structured than objects.

---

### Recommendation

**Use Option A (Code-Based Object Model)** with the following refinements:

1. **Store as code-based objects internally** for clarity and validation.
2. **Provide a serialization method** to convert to human-readable strings (e.g., `"Ctrl+Shift+B"`) for UI display and user-facing config.
3. **Implement a parser** to accept both formats: users can edit shortcuts as strings in config files, which are parsed into code objects on load.

**Hybrid Approach:**

```javascript
class Shortcut {
  constructor(id, sequences) {
    this.id = id;
    this.sequences = sequences; // Code-based objects internally
  }

  static fromString(id, bindingStrings) {
    // Parse user-facing strings into code objects
    const sequences = bindingStrings.map(str => parseShortcutString(str));
    return new Shortcut(id, sequences);
  }

  toStrings() {
    // Convert back to user-facing strings for display/editing
    return this.sequences.map(seq =>
      seq.map(chord => shortcutToString(chord.code, chord.mods)).join(" ")
    );
  }

  static toJSON() {
    // Serialize to JSON with human-readable strings as fallback
    return {
      id: this.id,
      sequences: this.sequences,
      _display: this.toStrings() // For reference in config files
    };
  }
}

// Storage (JSON):
const config = {
  shortcuts: [
    {
      "id": "TOGGLE_BLUR_ALL",
      "sequences": [[{ "code": "KeyB", "mods": ["Control", "Shift"] }]],
      "_display": ["Ctrl+Shift+B"]
    }
  ]
};
```

This approach gives you the best of both worlds: internal structure and clarity with external human readability.

---

## 11. Display Label Generation

Converting a stored shortcut into a user-facing label is essential for UI clarity.

### Code-to-Label Mapping

**Standard Mapping Table:**

```javascript
const codeToLabel = {
  // Letters (a-z)
  "KeyA": "A", "KeyB": "B", "KeyC": "C", "KeyD": "D", "KeyE": "E",
  "KeyF": "F", "KeyG": "G", "KeyH": "H", "KeyI": "I", "KeyJ": "J",
  "KeyK": "K", "KeyL": "L", "KeyM": "M", "KeyN": "N", "KeyO": "O",
  "KeyP": "P", "KeyQ": "Q", "KeyR": "R", "KeyS": "S", "KeyT": "T",
  "KeyU": "U", "KeyV": "V", "KeyW": "W", "KeyX": "X", "KeyY": "Y",
  "KeyZ": "Z",

  // Numbers (0-9)
  "Digit0": "0", "Digit1": "1", "Digit2": "2", "Digit3": "3", "Digit4": "4",
  "Digit5": "5", "Digit6": "6", "Digit7": "7", "Digit8": "8", "Digit9": "9",

  // Punctuation
  "Minus": "-", "Equal": "=", "BracketLeft": "[", "BracketRight": "]",
  "Backslash": "\\", "Semicolon": ";", "Quote": "'", "Comma": ",",
  "Period": ".", "Slash": "/", "Backquote": "`",

  // Navigation
  "ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→",
  "Home": "Home", "End": "End", "PageUp": "PgUp", "PageDown": "PgDn",

  // Whitespace and Editing
  "Enter": "Enter", "Escape": "Esc", "Tab": "Tab", "Space": "Space",
  "Backspace": "Backspace", "Delete": "Delete", "Insert": "Insert",

  // Function Keys
  "F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4", "F5": "F5",
  "F6": "F6", "F7": "F7", "F8": "F8", "F9": "F9", "F10": "F10",
  "F11": "F11", "F12": "F12", "F13": "F13", "F14": "F14", "F15": "F15",
  "F16": "F16", "F17": "F17", "F18": "F18", "F19": "F19", "F20": "F20",
  "F21": "F21", "F22": "F22", "F23": "F23", "F24": "F24",

  // Numeric Pad
  "Numpad0": "0", "Numpad1": "1", "Numpad2": "2", "Numpad3": "3",
  "Numpad4": "4", "Numpad5": "5", "Numpad6": "6", "Numpad7": "7",
  "Numpad8": "8", "Numpad9": "9", "NumpadAdd": "+", "NumpadSubtract": "-",
  "NumpadMultiply": "*", "NumpadDivide": "/", "NumpadDecimal": ".",
  "NumpadEnter": "Enter",

  // Media (if keyboard has dedicated keys)
  "MediaPlayPause": "Play/Pause", "MediaStop": "Stop",
  "MediaTrackNext": "Next", "MediaTrackPrevious": "Prev",
  "AudioVolumeUp": "Vol+", "AudioVolumeDown": "Vol-", "AudioVolumeMute": "Mute",
  "BrowserBack": "Back", "BrowserForward": "Forward", "BrowserRefresh": "Refresh",
};

const modifierToLabel = {
  "Control": { default: "Ctrl", mac: "⌃" },
  "Shift": { default: "⇧", mac: "⇧" },
  "Alt": { default: "Alt", mac: "⌥" },
  "Meta": { default: "Win", mac: "⌘" },
};

function formatShortcutLabel(code, mods, options = {}) {
  const { style = "text", platform = "auto" } = options;
  const isMac = platform === "mac" || /Mac/.test(navigator.platform);

  const parts = [];

  // Add modifiers in standard order: Ctrl/Cmd, Alt/Option, Shift
  for (const mod of ["Control", "Alt", "Shift", "Meta"]) {
    if (mods.includes(mod)) {
      const labels = modifierToLabel[mod];
      if (style === "symbol") {
        parts.push(labels.mac || labels.default);
      } else if (isMac && mod === "Control") {
        parts.push("Control"); // Rarely used on Mac
      } else if (isMac && mod === "Meta") {
        parts.push("Cmd");
      } else if (isMac && mod === "Alt") {
        parts.push("Option");
      } else {
        parts.push(labels.default);
      }
    }
  }

  // Add the primary key
  const label = codeToLabel[code] || code;
  parts.push(label);

  const separator = style === "symbol" ? "" : "+";
  return parts.join(separator);
}

// Usage:
const code = "KeyB";
const mods = ["Control", "Shift"];

console.log(formatShortcutLabel(code, mods, { style: "text" }));
// Output: "Ctrl+Shift+B"

console.log(formatShortcutLabel(code, mods, { style: "text", platform: "mac" }));
// Output: "Cmd+Shift+B"

console.log(formatShortcutLabel(code, mods, { style: "symbol", platform: "mac" }));
// Output: "⌘⇧B"
```

### Platform-Aware Display

Shortcuts should be formatted according to platform conventions:

```javascript
function getKeyLabel(code, platform = "auto") {
  const isMac = platform === "mac" || /Mac/.test(navigator.platform);
  const basicLabel = codeToLabel[code] || code;

  // Platform-specific overrides
  if (isMac) {
    // On Mac, sometimes use different names
    const macLabels = {
      "Enter": "Return",
      "Escape": "Esc",
      "Control": "⌃",
      "MetaLeft": "⌘",
      "MetaRight": "⌘",
      "AltLeft": "⌥",
      "AltRight": "⌥",
      "ShiftLeft": "⇧",
      "ShiftRight": "⇧",
    };
    return macLabels[code] || basicLabel;
  } else {
    return basicLabel;
  }
}

function formatForUI(code, mods, platform = "auto") {
  const isMac = platform === "mac" || /Mac/.test(navigator.platform);
  const modLabels = mods.map(mod => {
    if (isMac && mod === "Control") return "⌃";
    if (isMac && mod === "Meta") return "⌘";
    if (isMac && mod === "Alt") return "⌥";
    if (isMac && mod === "Shift") return "⇧";
    return modifierToLabel[mod]?.default || mod;
  });
  const keyLabel = getKeyLabel(code, platform);
  return modLabels.length > 0
    ? `${modLabels.join("")}${keyLabel}`
    : keyLabel;
}

// Display in UI:
console.log(formatForUI("KeyB", ["Control", "Shift"], "mac"));
// Output: "⌘⇧B"

console.log(formatForUI("KeyB", ["Control", "Shift"], "windows"));
// Output: "Ctrl+Shift+B"
```

---

## 12. Capture UI — How to Not Get Burned

A keyboard shortcut capture dialog is where users set their own bindings. The implementation must handle edge cases carefully.

### Canonical Capture Flow

This is the pattern used by VS Code, Sublime, and reputable shortcut libraries:

**HTML:**
```html
<div id="capture-dialog">
  <h2>Record Keyboard Shortcut</h2>
  <p id="capture-prompt">Press keys for the shortcut...</p>
  <p id="capture-preview">Waiting...</p>
  <button id="cancel-btn">Cancel</button>
  <button id="clear-btn">Clear</button>
</div>
```

**JavaScript:**
```javascript
class KeyboardCaptureUI {
  constructor(onCommit, onCancel) {
    this.onCommit = onCommit;
    this.onCancel = onCancel;
    this.capturedChord = null;
    this.capturedMods = new Set();
  }

  show() {
    const dialog = document.getElementById("capture-dialog");
    dialog.style.display = "block";
    this.reset();

    // Bind events
    document.addEventListener("keydown", this.handleKeydown.bind(this), { capture: true });
    document.addEventListener("keyup", this.handleKeyup.bind(this), { capture: true });
    document.getElementById("cancel-btn").addEventListener("click", () => this.cancel());
    document.getElementById("clear-btn").addEventListener("click", () => this.reset());
  }

  handleKeydown(event) {
    event.preventDefault();
    event.stopPropagation();

    // Step 1: Validate user event
    if (!event.isTrusted) {
      console.log("Ignoring non-user event");
      return;
    }

    // Step 2: Reject if composing (IME in progress)
    if (event.isComposing) {
      console.log("Ignoring IME composition");
      return;
    }

    // Step 3: Reject dead keys
    if (event.key === "Dead") {
      console.log("Ignoring dead key");
      return;
    }

    // Step 4: Reject unidentified
    if (event.key === "Unidentified") {
      console.log("Ignoring unidentified key");
      return;
    }

    // Step 5: Reject AltGr
    if (event.getModifierState("AltGraph")) {
      console.log("Ignoring AltGr (character input)");
      return;
    }

    // Step 6: Update captured modifiers
    this.capturedMods.clear();
    if (event.shiftKey) this.capturedMods.add("Shift");
    if (event.ctrlKey) this.capturedMods.add("Control");
    if (event.altKey) this.capturedMods.add("Alt");
    if (event.metaKey) this.capturedMods.add("Meta");

    // Step 7: Check if it's a modifier-only key
    const isModifierKey = ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
                          "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code);

    if (isModifierKey) {
      // User pressed a modifier. Update preview but don't commit.
      this.updatePreview();
      return;
    }

    // Step 8: Non-modifier key pressed. Commit the shortcut.
    this.capturedChord = event.code;
    this.updatePreview();
    this.commit();
  }

  handleKeyup(event) {
    // Optional: detect when user releases all keys
    // Could auto-commit if a timeout expires with no activity
  }

  updatePreview() {
    const mods = Array.from(this.capturedMods).sort();
    const label = this.capturedChord
      ? formatShortcutLabel(this.capturedChord, mods)
      : mods.length > 0
      ? mods.join("+") + "+?"
      : "Waiting...";
    document.getElementById("capture-preview").textContent = label;
  }

  commit() {
    if (!this.capturedChord) return;

    const result = {
      code: this.capturedChord,
      mods: Array.from(this.capturedMods)
    };

    this.onCommit(result);
    this.hide();
  }

  cancel() {
    this.onCancel();
    this.hide();
  }

  reset() {
    this.capturedChord = null;
    this.capturedMods.clear();
    this.updatePreview();
  }

  hide() {
    document.removeEventListener("keydown", this.handleKeydown.bind(this), { capture: true });
    document.removeEventListener("keyup", this.handleKeyup.bind(this), { capture: true });
    document.getElementById("capture-dialog").style.display = "none";
  }
}

// Usage:
const capture = new KeyboardCaptureUI(
  (chord) => {
    console.log(`Captured: ${chord.code} with mods ${chord.mods}`);
    // Save to storage
  },
  () => {
    console.log("Capture cancelled");
  }
);

document.getElementById("bind-shortcut-btn").addEventListener("click", () => capture.show());
```

### Key Principles

1. **Use capture phase:** `addEventListener(..., { capture: true })` to intercept keys before other listeners.
2. **Prevent default:** `event.preventDefault()` and `stopPropagation()` to avoid page interaction during capture.
3. **Validate strictly:** Reject non-trusted, composing, dead, unidentified, and AltGr events.
4. **Preview in real-time:** Show the shortcut label as the user holds modifiers.
5. **Commit on non-modifier:** Auto-save when the user presses the primary key (non-modifier).
6. **Escape to cancel:** Listen for Escape to abort without saving.
7. **Clear button:** Allow user to reset and try again.

### Advanced — Conflict Detection

```javascript
function checkConflict(newChord, existingShortcuts) {
  for (const shortcut of existingShortcuts) {
    for (const sequence of shortcut.sequences) {
      if (sequence.length === 1) {
        const existing = sequence[0];
        if (existing.code === newChord.code &&
            new Set(existing.mods).size === new Set(newChord.mods).size &&
            [...new Set(existing.mods)].every(m => newChord.mods.includes(m))) {
          return { conflict: true, conflictingShortcut: shortcut };
        }
      }
    }
  }
  return { conflict: false };
}

// In capture UI:
const { conflict, conflictingShortcut } = checkConflict(
  { code: "KeyB", mods: ["Control", "Shift"] },
  existingShortcuts
);

if (conflict) {
  alert(`This shortcut is already bound to: ${conflictingShortcut.id}`);
  // Option to override or cancel
}
```

---

## Recommendations for This Extension

Based on the comprehensive analysis above, here are specific recommendations for redesigning the shortcut system:

### 1. **Adopt Code-Based Storage (Immediate)**
- Replace the current hybrid model with code-based objects internally.
- Store as: `{ id: "TOGGLE_BLUR_ALL", sequences: [[{ code: "KeyB", mods: ["Control", "Shift"] }]] }`
- Eliminate the `key` field; it's redundant and causes the confusion you're experiencing.

### 2. **Implement a `codeToLabel()` Mapping (Phase 1)**
- Create a comprehensive mapping table (provided in Section 11).
- Use it for all UI display, so users see "Ctrl+Shift+B" not "KeyB+Control+Shift".
- Platform-aware: display "Cmd" on Mac, "Ctrl" on Windows/Linux.

### 3. **Upgrade the Capture Handler (Phase 1)**
- Use the canonical capture flow from Section 12.
- Reject dead keys, IME composition, AltGr, unidentified, and non-trusted events.
- Don't commit on modifier-only keys; wait for the primary key.
- Show real-time preview labels.

### 4. **Migrate Existing Shortcuts (Phase 2)**
- Write a migration script that converts old format `{ primaryModifier, keys }` to new `{ code, mods }`.
- Example transformation:
  ```javascript
  // Old: { primaryModifier: "AltLeft", keys: [{ key: "Shift", code: "ShiftLeft" }, { key: "b", code: "KeyB" }] }
  // New: { code: "KeyB", mods: ["Alt", "Shift"] }
  ```
  - `"AltLeft"` → `"Alt"` in mods (normalize left/right)
  - `"ShiftLeft"` → `"Shift"` in mods
  - `code: "KeyB"` stays as-is
  - Flatten the structure.

### 5. **Avoid Ctrl+Alt Combinations (Ongoing)**
- Do NOT register Ctrl+Alt+X as a shortcut in the manifest or capture UI.
- Use Ctrl+Shift+X instead.
- Document this restriction for users.

### 6. **Handle the Double-Fire Problem (Phase 1)**
- If using both `chrome.commands` (manifest) and JS handlers (content script), implement deduplication with `TOGGLE_DEDUP_MS` (already done in the codebase).
- Or disable one of the two sources and rely entirely on `chrome.commands`.

### 7. **Sequence Support (Phase 2, Optional)**
- If you want to support multi-key sequences like Gmail ('g' then 'i'), implement the sequence buffer and timeout pattern from Section 7.
- Store as: `sequences: [[ { code: "KeyG", mods: [] }, { code: "KeyI", mods: [] } ]]`

### 8. **Cross-Layout Testing (QA)**
- Test shortcuts on QWERTY, Dvorak, and AZERTY layouts.
- Verify that a shortcut bound to the physical 'B' key location works correctly on all layouts.
- Use online keyboard layout simulators or ask international users to test.

### 9. **Documentation Update**
- Update the extension's help or settings to explain the new shortcut model.
- Example user-facing explanation:
  > "Shortcuts are bound to physical key positions, not characters. If you use a US QWERTY keyboard and bind Ctrl+Shift+B to 'Toggle Blur', it will work the same physical key on Dvorak or AZERTY, but the character produced will differ."

### 10. **Deprecation Path (Future)**
- If supporting legacy configs, accept the old format on import, validate it, and immediately convert to new format on save.
- Never mix old and new formats in the same config.

---

## References and Further Reading

### Official Documentation
- **MDN KeyboardEvent:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent
- **MDN KeyboardEvent.key:** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
- **MDN KeyboardEvent.code:** https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values
- **MDN KeyboardEvent.getModifierState():** https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState
- **Chrome chrome.commands API:** https://developer.chrome.com/docs/extensions/reference/api/commands
- **Firefox browser.commands API:** https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/commands
- **VS Code Keybindings:** https://code.visualstudio.com/docs/configure/keybindings
- **Electron Keyboard Shortcuts:** https://www.electronjs.org/docs/tutorial/keyboard-shortcuts

### Browser Shortcuts
- **Chrome Keyboard Shortcuts:** https://support.google.com/chrome/answer/157179
- **Firefox Keyboard Shortcuts:** https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly
- **Browser Safe Shortcuts Guide:** https://www.xjavascript.com/blog/available-keyboard-shortcuts-for-web-applications/

### AltGr and International Keyboards
- **AltGr Key (Wikipedia):** https://en.wikipedia.org/wiki/AltGr_key
- **AltGr Key Guide (IONOS):** https://www.ionos.com/digitalguide/websites/web-development/alt-gr-key/
- **Microsoft Q&A: AltGr Behavior:** https://learn.microsoft.com/en-us/answers/questions/2396539/why-does-altgr-key-only-uses-alt-instead-of-alt-ct

### Libraries and Tools
- **Mousetrap.js:** https://craig.is/killing/mice (keyboard shortcut library)
- **Electron Menu/Accelerators:** https://github.com/electron/electron/blob/main/docs/tutorial/keyboard-shortcuts.md

---

## Conclusion

The confusion in your current system stems from mixing layout-dependent (`key`) and layout-independent (`code`) properties, and storing both creates drift risk. The definitive recommendation is:

1. **Use `code` as the source of truth** for all character keys (a-z, 0-9, punctuation).
2. **Normalize modifiers** to a simple set ({Shift, Control, Alt, Meta}), folding left and right.
3. **Maintain a canonical display mapping** (`codeToLabel()`) to keep the internal representation clean while providing readable UI labels.
4. **Guard the capture handler** strictly: reject composition, dead keys, AltGr, and non-trusted events.
5. **Avoid Ctrl+Alt combinations** to respect European keyboard users and comply with `chrome.commands` restrictions.
6. **Implement deduplication** if using both manifest commands and JS handlers.
7. **Test cross-layout** to ensure portability.

This design aligns with industry standards (VS Code, Figma, Electron), maintains simplicity, and scales to future features like sequences and user customization.

---

*Dossier compiled with references to MDN Web Docs, Chrome Developer Documentation, Mozilla Developer Documentation, and community best practices. Valid as of April 2026.*
