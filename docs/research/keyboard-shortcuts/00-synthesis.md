# Synthesis — Keyboard Shortcuts Research

A distilled takeaway across the three dossiers, focused on driving redesign decisions for Blurry Site.

## Where we are

The current shortcut system (see `01-current-state.md` for the full audit) works but hits three walls:

1. **Dual-representation drift.** Every chord element stores both `key` (layout-dependent logical char) and `code` (layout-independent physical position). Matching uses `code`; display uses either. The two can diverge, and the capture UI accepts `{key:'z', code:'KeyB'}` without error.
2. **Hardcoded action set.** Three actions (`TOGGLE_BLUR_ALL`, `TOGGLE_PICKER`, `CLEAR_ALL`). Adding a fourth requires touching seven files. No registry, no single source of truth.
3. **Minimal UX.** No conflict detection, no platform-aware labels (`L-Alt` on every OS instead of `⌥` on Mac / `Alt` on Win), no sequence chords, no help overlay. Capture modal lacks IME/Dead-key/`Process`/`Unidentified` guards. Primary-modifier vs additional-keys is an asymmetry artifact, not a feature.

## What the industry does

The research (`02-industry.md`) covers 24 products from three categories:

- **Browser extensions**: Vimium (text config, `<c-x>` syntax, `gi`/`gf` sequences, trie matcher), uBlock Origin (delegates to `chrome.commands`), Dark Reader (single hardcoded toggle), Bitwarden/1Password (autofill only), Tampermonkey (per-script, minimal UI).
- **Keyboard-first web apps**: Linear (command palette + `g → i` sequences, hardcoded not customizable), Gmail (original `gi`/`gt`, Settings toggle), GitHub (`@github/hotkey` radix trie, `data-hotkey` HTML attributes, `Mod` token for cross-platform, `?` help), Figma (platform-aware display), Slack/Superhuman (⌘K palette), Notion (fixed).
- **Desktop / OS**: VS Code (`keybindings.json`, when-clauses, scan-code mode with `[KeyK]`, GUI editor, extensions can register commands), JetBrains (keymap schemes, conflict UI), Obsidian (hotkey panel, per-command reset), Sublime (JSON + context arrays), Raycast/Alfred (custom trigger binding).
- **Libraries**: Mousetrap (string API, sequences, `mod` token, no codes), TinyKeys (code-based!, `$mod`, sequences), hotkeys-js (scopes, char-based), react-hotkeys-hook (component scopes), CodeMirror 6 (keymap extension stack), Electron Accelerator (`CmdOrCtrl` grammar).

### Patterns worth stealing

1. **Action registry as the single source of truth.** VS Code, Linear, Figma all derive runtime, help overlay, command palette, and settings UI from one registry. Docs never drift.
2. **Layout-independent via `code`.** TinyKeys and VS Code (optional) use the physical key. Mousetrap and hotkeys-js don't, and users on AZERTY/Dvorak suffer.
3. **Single `CmdOrCtrl`-style token for cross-platform.** Electron's Accelerator, Mousetrap's `mod`, TinyKeys' `$mod`. One binding works on both Mac and Windows.
4. **Trie matcher with 1000–1500ms timeout for sequences.** GitHub's `@github/hotkey` is the canonical open-source example.
5. **Visual conflict warning, not refusal.** VS Code and JetBrains warn inline but allow last-write-wins save. Strictness frustrates users.
6. **Platform-aware label rendering.** Mac shows `⌘⇧K`; Windows/Linux shows `Ctrl+Shift+K`. Storage is uniform; rendering is where the divergence lives.
7. **Help overlay from the registry.** Never hand-author the help page — iterate over the registry at render time so rebinding propagates automatically.

### Patterns to avoid

- Character-based bindings without a layout-independent option (Mousetrap, hotkeys-js, Obsidian).
- Hardcoded help overlays that drift from runtime.
- No capture UI — forcing users to type syntax (Vimium, Sublime).
- Silent conflicts with no warning (Mousetrap, hotkeys-js).
- Dual per-platform configs where a single token would do.
- Storing shortcuts with no serialization / export path.

## The KeyboardEvent landscape

Dossier 3 is the authoritative reference. Key decisions it drives:

### `code` vs `key` — pick one

- `event.key` is the **logical character**. Layout-dependent. On QWERTY the top-left letter key produces `key === 'q'`; on Dvorak the same physical key produces `"'"`. Dead keys return `'Dead'`. IME returns `'Process'`.
- `event.code` is the **physical position**. Layout-independent. `KeyQ` always means the top-left letter key regardless of layout. Not human-readable on its own.
- **Storing both is an anti-pattern.** Pick one as the source of truth. Use `code` for character keys; use `code` (which for non-char keys equals the `key` enum — `Enter`, `Escape`, `F1`, `ArrowUp`) for everything else.
- **Display**: derive the label from `code` via a `codeToLabel()` map. Never store the label.

### Modifier handling

- **Drop left/right distinction** (`AltLeft`/`AltRight` → `Alt`). No real product treats them as distinct bindings. Keeping them creates the "wrong side of Alt" bug the current matcher intentionally exploits.
- Read modifiers from the event's own booleans (`altKey`, `ctrlKey`, `metaKey`, `shiftKey`) — not from a held-keys Set. MDN says these are the right source.
- **Never bind `Ctrl+Alt+*`.** This is how European keyboards synthesize AltGr. Binding `Ctrl+Alt+Q` breaks `@` input on German/Spanish/French layouts. Use `event.getModifierState('AltGraph')` as an early-return guard.

### Required early-return guards

1. `event.repeat` — key repeat from OS.
2. `event.isComposing` — IME composition.
3. `event.key === 'Dead'` — combining-accent dead keys.
4. `event.key === 'Process'` — IME active (older Chrome).
5. `event.key === 'Unidentified'` — unknown / synthetic.
6. `event.getModifierState('AltGraph')` — European AltGr.
7. (Recommended) `!event.isTrusted` — synthetic events.
8. `event.code` is a pure modifier — wait for the non-modifier key before committing.

The current matcher has 1–4 and 6, but not 5, 7, 8. The new matcher must have all eight.

### `chrome.commands` quirks

- Max 4 global commands per extension (Chrome & Firefox).
- `suggested_key` has a strict grammar: `"Ctrl"|"Alt"|"Shift"|"MacCtrl"|"Command"` + one primary key. No `Ctrl+Alt+*`. No `Ctrl+Shift+Alt+*`.
- User can rebind via `chrome://extensions/shortcuts` — a useful escape hatch for sites that aggressively capture keys.
- **Double-fire race** when combined with a JS-level handler for the same chord (the current project's bug). Mitigation: treat the JS handler as canonical, and use a monotonic-clock dedup token rather than a fragile time window.

## Decisions for Blurry Site v2

Resolved during the planning phase:

| Area | Decision |
|---|---|
| **Data model** | `{ binding: [{ code, mods }] }`. `code` is W3C `KeyboardEvent.code`. `mods` is a sorted subset of `{Alt, Control, Meta, Shift}`. `binding` is an array so sequences fit naturally in phase 2. |
| **Migration from old shape** | None — clean break. Dev profiles only; users re-bind manually. Validator falls back to registry defaults on malformed entries. |
| **Action registry** | New `src/action_registry.js` as `blsi.Actions`. Frozen JS object with `id`, `label`, `description`, `defaultBinding`, `messageType`, `chromeCommand`. All other modules derive from this. |
| **Matcher** | Rewritten. Reads mods from event booleans, not held-keys Set. All 8 early-return guards. Side-agnostic. |
| **Capture UI** | Modern capture flow (press-to-capture, live preview, all guards). Inline warning for conflicts + known browser-reserved chords. Save always allowed. `Ctrl+Alt+*` rejected as a correctness fix (AltGr). |
| **Label rendering** | Single `src/shortcut_label.js` with `codeToLabel()` + platform-aware `modLabel()`. Mac shows `⌘⇧K`, Windows shows `Ctrl+Shift+K`. |
| **`chrome.commands`** | Kept as fallback. Monotonic-clock dedup, not time-window. JS handler is canonical source of truth. |
| **Sequences (`g i`)** | Phase 2. `binding` array shape is ready; matcher treats `binding.length > 1` as invalid in phase 1. |
| **Scopes (`when` clauses)** | Phase 2. Registry field reserved, no evaluation yet. Escape-exits-picker remains special-cased. |
| **Help overlay** | Phase 1: popup modal (`⌨ Shortcuts` button in footer). Phase 2: page-injected `?`-key overlay with input-focus guards. |
| **Reserved-chord deny list** | None. Warning only. User can bind `Ctrl+T` if they intentionally want to override browser shortcuts (matches VS Code / JetBrains philosophy). |

## Files that will change (for reference)

See the plan file (`~/.claude-alphared/plans/curious-stargazing-wand.md`) for the full file-change inventory. The short version:

- **New**: `src/action_registry.js`, `src/shortcut_label.js`, `tests/unit/action_registry.test.js`, `tests/unit/shortcut_label.test.js`.
- **Rewritten**: `src/shortcut_handler.js`, `popup/popup.js` (capture modal), `popup/popup.html` (capture modal + help overlay).
- **Modified**: `src/constants.js`, `src/content_script.js`, `background.js`, `manifest.json`, `popup/popup_configs.js`, `popup/popup_settings_renderer.js`, `popup/popup.css`, test fixtures.
- **Docs**: `CLAUDE.md`, `src/CLAUDE.md`, `docs/LLD.md`, `docs/HLD.md`, `docs/TEST_VALIDATION.md`.
