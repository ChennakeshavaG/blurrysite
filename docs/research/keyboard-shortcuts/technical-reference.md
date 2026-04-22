# Keyboard Shortcuts — Technical Reference

> `KeyboardEvent` API guide for content-script shortcut handling. Vanilla JS, no bundler.

## `key` vs `code` — Pick One

| Property | Value | Layout-dependent? |
|---|---|---|
| `event.key` | Logical character: `'q'` on QWERTY, `"'"` on Dvorak for same physical key | **Yes** |
| `event.code` | Physical position: `'KeyQ'` always = top-left letter key | **No** |

**Rule**: Use `code` for storage and matching. Use `key` only for non-character keys where it equals a stable enum value (`'Enter'`, `'Escape'`, `'F1'`, `'ArrowUp'`). Never store both — causes drift.

**Display**: derive labels via `codeToLabel()` map. Never store the label string.

```js
const CODE_TO_LABEL = {
  Space: 'Space', Enter: '↵', Escape: 'Esc', Backspace: '⌫',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  // KeyA–KeyZ: strip 'Key' prefix → 'A'–'Z'
  // Digit0–Digit9: strip 'Digit' prefix → '0'–'9'
};
```

## Modifier Normalization

Read from event booleans — not from a held-key Set:

```js
function normalizeMods(event) {
  const mods = [];
  if (event.altKey && !event.getModifierState('AltGraph')) mods.push('Alt');
  if (event.ctrlKey) mods.push('Control');
  if (event.metaKey) mods.push('Meta');
  if (event.shiftKey) mods.push('Shift');
  return mods; // already sorted alphabetically
}
```

Left/right variants (`AltLeft`/`AltRight`) fold into a single modifier — no product distinguishes them.

## 8 Required Early-Return Guards

Apply at the top of every `keydown` handler:

```js
document.addEventListener('keydown', e => {
  if (!e.isTrusted) return;                        // 1. reject synthetic events
  if (e.repeat) return;                             // 2. reject OS key-repeat
  if (e.isComposing) return;                        // 3. reject IME composition
  if (e.key === 'Dead') return;                     // 4. reject combining dead keys
  if (e.key === 'Process') return;                  // 5. reject IME (older Chrome)
  if (e.key === 'Unidentified') return;             // 6. reject unknown/synthetic
  if (e.getModifierState('AltGraph')) return;       // 7. reject European AltGr
  if (/^(Alt|Control|Meta|Shift)/.test(e.code)) return; // 8. wait for non-modifier
  // safe to capture
});
```

Current implementation has guards 1–4 and 7. Guards 5, 6, 8 should be added in phase 2.

## AltGr (Critical for EU Keyboards)

On German/Spanish/French keyboards, AltGr is emulated as `Ctrl+Alt`. Binding `Ctrl+Alt+Q` breaks `@` input. Guard:

```js
if (e.getModifierState('AltGraph')) return; // always skip AltGr combinations
```

Also: `chrome.commands` prohibits `Ctrl+Alt+*` for this reason — replicate in capture UI.

## Platform Differences

| Platform | Primary modifier | Display |
|---|---|---|
| macOS | `Meta` (⌘ Command) | `⌘⇧⌥⌃` symbols |
| Windows / Linux | `Control` (Ctrl) | Spelled-out: `Ctrl+Shift+Alt` |

```js
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
```

No `CmdOrCtrl` token needed if you store `mods` as an array — just check `IS_MAC` at render time to swap `Meta` ↔ `Control` labels.

## Browser-Reserved Shortcuts (cannot override)

**Chrome (always blocked):** `Ctrl+T`, `Ctrl+N`, `Ctrl+W`, `Ctrl+F`, `Ctrl+L`, `F12`, `Alt+←/→`

**Firefox (always blocked):** `Alt+F/E/V/H/B/T`, `Ctrl+T/N/W`, `F11`, `F12`

**OS-level (extension cannot intercept):** `Alt+F4`, `Alt+Tab`, `Win+D`, `Cmd+Tab`, `Cmd+Space`

Maintain a warning-only list in `src/shortcut_label.js` (`RESERVED`) — allow save, warn in UI.

## `chrome.commands` Quirks

- Max 4 global commands per extension (Chrome + Firefox)
- Required modifier: must include `Ctrl` or `Alt` (bare `Shift+K` rejected)
- Prohibited: `Ctrl+Alt+*` (AltGr collision)
- User can rebind at `chrome://extensions/shortcuts` — useful escape hatch
- **Double-fire risk**: if the same chord is handled by both `chrome.commands` and a JS `keydown` listener, both fire. Fix: monotonic-clock dedup token in the JS handler (current impl uses this).

## Sequence (Multi-Chord) Matching — Phase 2

```js
// Trie node shape
const trie = {
  'KeyG': {
    terminal: null,           // no single-key action for 'g'
    children: {
      'KeyI': { terminal: 'goto-inbox', children: {} },
      'KeyP': { terminal: 'goto-projects', children: {} },
    }
  }
};

// Matcher state
let pendingNode = null;
let timeoutId = null;

function handleKeydown(e) {
  // ... guards ...
  const node = (pendingNode ?? trie)[e.code];
  if (!node) { resetSequence(); return; }

  clearTimeout(timeoutId);
  if (node.terminal) {
    fireAction(node.terminal);
    resetSequence();
  } else {
    pendingNode = node.children;
    timeoutId = setTimeout(resetSequence, 1500);
    showFeedback('Press next key…');
  }
}
```

The current `binding` array shape (`[{code, mods}]`) already supports sequences — phase 1 skips `binding.length > 1` in the matcher.

## Content Script Pitfalls

- **Cross-origin iframes**: `keydown` events don't propagate from cross-origin frames to the parent — shortcut handler misses keys typed inside them. Documented known limitation.
- **`document.activeElement` inside iframe**: the main frame sees `<iframe>` as focused, not the element inside — `isEditable` checks need `composedPath()` workaround.
- **Synthetic events from page JS**: `!event.isTrusted` guard handles this.
- **Service worker wake-up race**: `chrome.commands` can fire before content script is ready — dedup token covers this.
