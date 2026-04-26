# action_registry Contract

## Overview

`blsi.Actions` is the single source of truth for every shortcut-driven action in the extension. It declares what actions exist, what their human-readable labels and descriptions are, what their default key bindings are, and which `chrome.commands` name and message type each action maps to. All consumer code (content script, shortcut handler, popup) reads from this registry rather than maintaining their own action lists. The module has no DOM access, no storage access, and no side effects — it is a frozen declaration module.

## Public API

### list()

**What**: Returns an array of all registered action objects.

**Params**: None.

**Returns**: `Action[]` — An array of all action entries in `ACTIONS`, in insertion order. Each entry is a frozen `Action` object (see Data section). The array itself is a fresh `Object.values(ACTIONS)` call each time — callers may iterate it safely but should not cache it across mutations (though `ACTIONS` is frozen, so no mutations occur in practice).

**Side effects**: None.

**Handles**: Always returns a non-empty array as long as at least one action is declared in `ACTIONS`.

---

### get(id)

**What**: Looks up a single action by its kebab-case id.

**Params**:
- `id` (string) — A kebab-case action id, e.g. `'toggle-blur-all'`, `'toggle-picker'`, `'clear-all'`, `'screenshot'`, `'blur-selection'`.

**Returns**: `Action | undefined` — The frozen action object if the id exists in `ACTIONS`; `undefined` if the id is not registered. Callers must guard against `undefined` — there is no sentinel or error thrown for unknown ids.

**Side effects**: None.

**Handles**:
- Known id → returns the frozen action object.
- Unknown id (misspelled, stale reference, wrong case) → returns `undefined`. Callers such as `shortcut_handler.js` use `blsi.Actions.get(actionId).label` — a missing guard on `undefined` will throw a `TypeError`; callers are responsible for checking.
- `id` is `null`, `undefined`, or a non-string → `ACTIONS[id]` returns `undefined` (object property lookup on a frozen object with a non-string key).

---

### ids()

**What**: Returns an array of all registered action ids.

**Params**: None.

**Returns**: `string[]` — All kebab-case action ids from `ACTIONS`, in insertion order. A fresh `Object.keys(ACTIONS)` call each time.

**Side effects**: None.

**Handles**: Always returns a non-empty array as long as at least one action is declared.

---

### defaultBindings()

**What**: Builds a fresh mutable copy of all actions' default bindings, keyed by action id. Used by `blsi.build_default_model()` to seed the `shortcuts` section of the default storage model.

**Params**: None.

**Returns**: `Record<string, { binding: Chord[] }>` — A plain mutable object where each key is a kebab-case action id (e.g. `'toggle-blur-all'`) and each value is `{ binding: [{code, mods}] }`. The returned object and all nested arrays and chord objects are fully mutable copies — mutations do not affect `ACTIONS` or any previously returned object from `defaultBindings()`.

**Side effects**: None. Creates new objects on each call.

**Handles**:
- Each chord's `mods` array is cloned via `[...chord.mods]` — spread copies the frozen source array into a new mutable array.
- Each chord object is reconstructed as `{ code: chord.code, mods: [...chord.mods] }` — a new plain object, not a reference to the frozen original.
- `binding` is an array mapped from `action.defaultBinding` — a new array, not a reference to the frozen source.
- The returned top-level object is a new plain object (`{}`) built by iterating `list()` — not a reference to `ACTIONS`.

---

## Constants / Data

### ACTIONS

`Object` (frozen via `Object.freeze`) — The registry of all shortcut-driven actions. Top-level keys are kebab-case action ids. Each value is also deeply frozen. Structure:

```js
ACTIONS = {
  'toggle-blur-all': Action,
  'toggle-picker':   Action,
  'clear-all':       Action,
  'screenshot':      Action,
  'blur-selection':  Action,
}
```

Each `Action` has the shape:

```js
{
  id:             string,       // kebab-case, matches key in ACTIONS and manifest.json `commands` name
  label:          string,       // short human-readable label shown in toasts and UI rows
  description:    string,       // longer description shown in settings UI
  defaultBinding: Chord[],      // frozen array of frozen chord objects [{code, mods}]
  messageType:    string,       // the content-script message type dispatched when the shortcut fires
  chromeCommand:  string|null,  // matching manifest.json `commands` key, or null if not registered
}
```

Current registered actions:

| id | defaultBinding | messageType | chromeCommand |
|---|---|---|---|
| `toggle-blur-all` | `Alt+Shift+B` | `TOGGLE_BLUR_ALL` | `'toggle-blur-all'` |
| `toggle-picker` | `Alt+Shift+P` | `TOGGLE_PICKER` | `'toggle-picker'` |
| `clear-all` | `Alt+Shift+U` | `CLEAR_ALL_BLUR` | `'clear-all-blur'` |
| `screenshot` | `Alt+Shift+S` | `CAPTURE_VIEWPORT` | `null` |
| `blur-selection` | `Alt+Shift+X` | `BLUR_SELECTION` | `null` |

`ACTIONS` is frozen — do not attempt to add, remove, or modify entries at runtime. All runtime reads should go through `list()`, `get(id)`, or `ids()`.

---

### Chord shape

Each chord object within `defaultBinding` has the shape:

```js
{ code: string, mods: string[] }
```

- `code`: a `KeyboardEvent.code` value (physical key, layout-independent), e.g. `'KeyB'`.
- `mods`: a sorted array of modifier names from `{ 'Alt', 'Control', 'Meta', 'Shift' }`. Left/right modifier folding is handled by `shortcut_handler.js` at match time, not stored here.

In `ACTIONS`, both the chord objects and their `mods` arrays are frozen. `defaultBindings()` provides mutable clones.

---

## Adding a New Action

Three steps — nothing else:

1. Add an entry to `ACTIONS` in `src/action_registry.js`. Choose a kebab-case `id`. Set `chromeCommand: null` if no manifest entry is needed.
2. Add a handler in `content_script.js` → `shortcutActionMap[action.id]` (or equivalent dispatch).
3. Optional: add a matching entry in `manifest.json > commands` if the chord should also fire via `chrome.commands`.

No changes to `shortcut_handler.js` are needed — it reads the action registry dynamically. No changes to `blsi.Actions` public methods are needed — `list()`, `ids()`, and `defaultBindings()` all derive from `ACTIONS` automatically.

---

## Invariants

- `ACTIONS` is frozen at module load — no runtime mutations.
- All action ids are kebab-case. They match `manifest.json > commands` keys exactly (where `chromeCommand` is not `null`), so no separate mapping is needed in background or content script.
- `messageType` on each action is the exact string used in `chrome.runtime.sendMessage` / `handleMessage` dispatch. The registry is the canonical source — do not hardcode message type strings elsewhere.
- `defaultBindings()` always returns a fully independent mutable copy — safe to mutate without affecting `ACTIONS` or any other consumer.
- `get(id)` returns `undefined` for unknown ids — never throws. Callers that assume a known id (e.g. `blsi.Actions.get(id).label`) must guard or accept the TypeError contract.
- The module has no mutable state — it is safe to call from multiple contexts (background, content script, popup) simultaneously.
