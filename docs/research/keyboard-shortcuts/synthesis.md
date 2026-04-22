# Keyboard Shortcuts — Design Synthesis

> Decisions made for Blurry Site v2. Current implementation is in `src/shortcut_handler.js`, `src/shortcut_label.js`, `src/action_registry.js`.

## Problems Solved in v2

| Problem | Fix |
|---|---|
| Dual `key`+`code` storage caused drift | Store `code` only; derive label via `codeToLabel()` |
| 7-file touch to add a new action | `src/action_registry.js` as single source of truth |
| No platform-aware labels | `src/shortcut_label.js` renders `⌘⇧K` (Mac) vs `Ctrl+Shift+K` (Win/Linux) |
| Missing IME/dead-key/AltGr guards | All 8 guards added to matcher |
| Double-fire with `chrome.commands` | Monotonic-clock dedup token in JS handler |

## Data Model (current)

```js
shortcuts = {
  'toggle-blur-all': { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  'toggle-picker':   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  'clear-all':       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
  'screenshot':      { binding: [{ code: 'KeyS', mods: ['Alt', 'Shift'] }] },
}
```

- `code` = `KeyboardEvent.code` (physical, layout-independent)
- `mods` = sorted subset of `{Alt, Control, Meta, Shift}` — left/right folded
- `binding` = array; phase 1 uses length-1 only; phase 2 adds multi-chord sequences

## What Phase 2 Needs

| Feature | Approach |
|---|---|
| Multi-chord sequences (`g i`) | Trie matcher with 1000–1500ms timeout; `binding.length > 1` already valid in storage shape |
| Visual sequence feedback | Status indicator "Press next key…" while in waiting state |
| `when` context clauses | Registry field reserved; no evaluation yet |
| Page-injected help overlay | `?`-key overlay reading live from `blsi.Actions`; input-focus guards |
| Conflict detection | Inline warning in capture UI; save always allowed (VS Code/JetBrains philosophy) |
