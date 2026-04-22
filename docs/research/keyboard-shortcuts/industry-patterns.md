# Keyboard Shortcuts — Industry Patterns

> Research across 24 products. Key patterns for implementing shortcut customization in a browser extension.

## Product Patterns (one-liner each)

| Product | Key approach |
|---|---|
| **Vimium** | Plain-text syntax (`<c-x>`), `gi`/`gf` sequences, trie matcher, help overlay reads live from config |
| **VS Code** | JSON keybindings + `when` clauses, live capture UI with conflict warning (yellow icon), scan-code mode `[KeyK]` for layout-independence |
| **JetBrains** | Predefined keymaps (Vim/Emacs/Eclipse), conflict detection with "Find Actions by Shortcut", XML per-platform storage |
| **GitHub hotkey** | Radix trie, `data-hotkey` HTML attributes, `Mod` cross-platform token, `?` help overlay, 1500ms sequence timeout |
| **Gmail** | Pioneered `g i` sequences; Settings toggle disables all shortcuts |
| **Linear** | Command palette (`Cmd+K`) + `g → i` sequences; hardcoded, not customizable |
| **Figma/Slack/Superhuman** | Fixed shortcuts; command palette for discovery; platform-aware symbol rendering |
| **Mousetrap** | String API, sequences, `mod` token for Mac/Win; character-based (breaks on AZERTY/Dvorak) |
| **TinyKeys** | Like Mousetrap but uses `KeyboardEvent.code` — layout-independent; `$mod` token |
| **hotkeys-js** | Scopes, character-based — same AZERTY problem as Mousetrap |
| **Electron Accelerator** | `CmdOrCtrl+X` grammar, auto-translates at runtime, single chords only |
| **Obsidian** | JSON `hotkeys.json`, press-to-capture UI, no layout-independence option |

## Data Model Patterns

| Shape | Example | When to use |
|---|---|---|
| Plain text | `ctrl+shift+k` | Simple; requires parser; syntax-learning burden |
| JSON object | `{code: "KeyK", mods: ["Control","Shift"]}` | Structured, extensible, validates cleanly — **recommended** |
| Sequence array | `[{code:"KeyG"}, {code:"KeyI"}]` | Multi-chord; pair with trie matcher |
| Trie (GitHub) | `{g: {i: action}}` | O(1) sequence lookup, 1500ms timeout; complex to build |

**Storage**: `chrome.storage.sync` for extensions + JSON export/import option.

## Multi-Chord Sequences

- Enter "waiting" state after first key; 1000–1500ms timeout
- While waiting, block the single-key action if it conflicts
- Show visual feedback: "Press next key (g → _)" — most products skip this and confuse users
- GitHub's `@github/hotkey` library is the canonical open-source trie implementation

## Conflict Detection

| Level | Examples | Behavior |
|---|---|---|
| None | Mousetrap, hotkeys-js, Obsidian | Silent last-write-wins |
| Warning | VS Code, JetBrains | Inline badge; allow save anyway |
| Browser-enforced | `chrome.commands` | Browser blocks duplicate; can't override |

Recommendation: warn inline in capture UI, always allow save — users know best.

## Patterns Worth Stealing

1. **Registry as single source of truth** — VS Code, Linear, Figma all derive help overlay, command palette, and settings UI from one registry. Docs never drift.
2. **`code`-based storage** — TinyKeys, VS Code scan-code mode. AZERTY/Dvorak users get correct bindings.
3. **`CmdOrCtrl` / `$mod` token** — single binding works Mac and Windows; no dual config.
4. **Help overlay generated from registry** — never hand-author; iterate `blsi.Actions.list()` at render time.
5. **Trie + 1500ms timeout** for sequences — GitHub's approach is proven.
6. **Platform-aware label rendering** — store uniform; render diverges (`⌘` vs `Ctrl`).

## Patterns to Avoid

- Character-based bindings only (Mousetrap, hotkeys-js) — breaks non-QWERTY layouts
- Hardcoded help overlay — drifts after rebinding
- Syntax-entry capture (Vimium) — high friction
- Silent conflicts — user doesn't know action was overridden
- Dual per-platform configs — maintenance burden
- No sequence visual feedback — confusing timeout behavior
- No reset button — users get stuck

## Browser Extension Specifics

- `chrome.commands` covers up to 4 global shortcuts; user rebinds via `chrome://extensions/shortcuts`
- For more than 4 actions or richer UI, need custom storage + `keydown` event handling
- Must handle conflicts yourself — browser won't warn for custom shortcuts
- Chrome blocks `Ctrl+Alt+*` in `chrome.commands` (AltGr collision); replicate this restriction in capture UI
