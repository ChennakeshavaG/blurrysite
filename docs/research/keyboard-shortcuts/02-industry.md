# Dossier 2 — Industry Research: Keyboard Shortcut UX & Storage Patterns

## Executive Summary

This research explores how best-in-class tools handle keyboard shortcuts across data storage, UI capture, display, conflict detection, and extensibility. The findings span 24 major products and libraries: Vimium, Vimium-C, uBlock Origin, Dark Reader, Bitwarden, 1Password, Tampermonkey, Linear, Gmail, GitHub, Notion, Figma, Slack, Superhuman, VS Code, JetBrains IDEs, Obsidian, Sublime Text, Raycast, Alfred, macOS System Settings, Mousetrap, TinyKeys, hotkeys-js, react-hotkeys-hook, CodeMirror 6, and Electron's Accelerator API.

The clearest patterns that emerge are:
1. **Data models vary widely** — from plain strings (`"ctrl+shift+k"`) to JSON objects (`{key, modifiers}`) to arrays tracking physical key codes.
2. **Layout-independence is optional but important** — using `KeyboardEvent.code` (physical position) enables bindings to work across QWERTY, AZERTY, and Dvorak, but most tools default to `key` (character).
3. **Platform modifier handling** uses three approaches: single-token `CmdOrCtrl` (Electron), dual-config (VS Code), or platform-specific translation (Slack/Linear).
4. **Sequence support** (e.g., `g i`) is common in Gmail-inspired tools (Linear, Vimium, GitHub) but requires careful timeout handling (typically 1000–1500ms).
5. **Conflict detection** ranges from non-existent (most web apps) to basic warning (JetBrains) to sophisticated (VS Code when clause evaluation).
6. **Extensibility is rare** — only VS Code and Vimium allow users to add entirely new bindable actions; most tools limit customization to rebinding existing commands.

---

## Section 1: Browser Extensions

### 1.1 Vimium / Vimium-C

**Overview**: Vimium is the open-source keyboard-driven browser extension that pioneered Vim-style web navigation. Vimium-C is a community-maintained fork with enhanced features.

#### Storage / Data Model

Vimium stores custom key mappings in a **plain-text format** edited through the Options page. The syntax is minimal:
- `map <key> <command>` – bind a key
- `unmap <key>` – remove a binding
- `unmapAll` – reset all

**Example from documentation** ([github.com/philc/vimium](https://github.com/philc/vimium)):
```
" Comments start with quote or hash
map j scrollDown
map k scrollUp
map <c-d> scrollPageDown
map <c-u> scrollPageUp
map gi goToInput
```

Modifier keys use angle-bracket syntax:
- `<c-x>` = Ctrl+x
- `<a-x>` = Alt+x
- `<s-x>` = Shift+x
- `<m-x>` = Meta/Cmd+x

**Layout-independence**: Uses character codes, not physical keys, so does NOT support AZERTY/Dvorak transparently.

#### Capture UI

Vimium does NOT use a "live key capture" UI. Users must **type the shortcut string** into the text field (e.g., `<c-s>` for Ctrl+S). This is low-friction for power users but requires learning the syntax.

#### Display / Label Rendering

Shortcuts are displayed as-is in the text editor. No special rendering to symbols (e.g., ⌘, ⇧).

#### Conflict Detection

None. Last-write-wins. If you bind two actions to the same chord, the second definition overrides.

#### Sequences

Fully supported. `map gi goToInput` creates a sequence where the user presses `g`, then `i` (within ~1000ms).

#### Platform Handling

The Options page is shown per-browser; no explicit CmdOrCtrl token. Instead, users write `<m-x>` for Meta on Mac, `<c-x>` for Ctrl on Windows/Linux. This requires **two separate configurations**.

#### Extensibility

Users can bind existing Vimium commands but **cannot define new actions**. The list of 40+ commands is hard-coded.

#### Help Overlay

Pressing `?` opens a help dialog with **personalized keybindings** (the live state of the Options page). This is single-source-of-truth: the help always matches the current config.

---

### 1.2 uBlock Origin

**Overview**: Minimalist ad blocker with very limited keyboard customization.

#### Storage / Data Model

Uses the **Chrome Extension `chrome.commands` API** exclusively. No custom UI. Users configure shortcuts via `chrome://extensions/shortcuts` or `about:addons` (browser native).

#### Available Actions

- Alt+Z – Element Zapper
- Alt+X – Element Picker
- Alt+L – Logger
- (Platform-dependent opening of uBO popup)

#### Capture UI

Uses the **browser's native shortcut capture UI**. Users click a shortcut field and press the chord; the browser records it.

#### Data Model

The `chrome.commands` API stores accelerators as strings (similar to Electron). No documentation on internal storage.

#### Conflict Detection

Browser-level. The browser warns if two extensions claim the same chord.

#### Extensibility

**None**. uBO exposes exactly 4 shortcuts; users cannot add new actions or bind new commands.

---

### 1.3 Dark Reader

**Overview**: Dark mode toggle for any website.

#### Available Shortcuts

- Mac: Shift+Option+A
- Windows: Alt+Shift+D

#### Capture UI

Users click "Modify" links to configure shortcuts. Uses browser-native capture (likely `chrome.commands` or Firefox equivalent).

#### Data Model

Not publicly documented. Likely stored in `chrome.storage.local` or Firefox's equivalent.

#### Extensibility

Two hard-coded shortcuts: "toggle extension globally" and "toggle current site". No customization of actions.

---

### 1.4 Bitwarden / 1Password

**Overview**: Password managers with autofill shortcuts.

#### Bitwarden Specifics

**Default shortcut**: Ctrl/Cmd + Shift + L (autofill login)

**Capture UI**: Browser-native. Users go to `chrome://extensions/shortcuts` or Firefox `about:addons` to customize.

**Data Model**: Stored in browser extension storage (implementation details not documented).

**Cross-platform**: Bitwarden requires users to manually configure each platform because the browser APIs handle per-platform shortcuts, but users can set different bindings on Mac vs. Windows.

#### 1Password Specifics

Not detailed in research, but community forums indicate 1Password uses a different default (Cmd+\) and may allow more customization through the 1Password Settings UI.

#### Extensibility

Both allow customization of autofill shortcut only. Cannot add new actions.

---

### 1.5 Tampermonkey / Violentmonkey

**Overview**: Userscript managers.

#### Storage / Data Model

Tampermonkey and Violentmonkey **do not natively expose a shortcut customization UI**. Userscript authors must implement their own keyboard handling using libraries.

#### Violentmonkey Library

Violentmonkey ships a **shortcut library** via CDN:
```javascript
// @require https://cdn.jsdelivr.net/npm/@violentmonkey/shortcut@1
```

Authors can programmatically register shortcuts:
```javascript
shortcut.register('ctrl+shift+s', () => {
  alert('Ctrl+Shift+S pressed');
});
```

This is **per-script, not global**. Each script defines its own shortcuts.

#### Capture UI

Authors typically use Mousetrap or TinyKeys (see libraries section) to capture keys, or raw `keydown` events.

#### Extensibility

Fully extensible per-script. Authors can expose a settings UI to let users rebind shortcuts if desired, but this is optional.

---

## Section 2: Web Applications Known for Keyboard-First UX

### 2.1 Linear

**Overview**: Keyboard-first project management tool famous for fast keyboard navigation and command palette.

#### Storage / Data Model

Linear's internal architecture is not open-source, so storage details are not public. However, from user-facing behavior:

- Shortcuts are **fixed by the product**, not user-customizable.
- Uses a **command palette** (Cmd+K on Mac, Ctrl+K on Windows/Linux) that lists all 200+ actions and is searchable by name.

#### Keyboard Patterns

Linear pioneered the "G then…" pattern for navigation shortcuts:
- `g` then `i` = go to Inbox
- `g` then `v` = go to current cycle
- `g` then `b` = go to Backlog

Also uses prefix sequences for operations:
- `o` then `f` = open Favorites
- `e` to assign/move issues

#### Capture UI

No user-facing capture UI. Shortcuts are fixed.

#### Display / Label Rendering

The command palette shows labels with modifier keys: `⌘K` on Mac, `Ctrl+K` elsewhere. Symbols use Unicode: `⌘` (command), `⇧` (shift), `⌥` (option), `⌃` (control).

#### Scope / Context Awareness

Some shortcuts are **context-aware**. Many navigation shortcuts only work in list/board view, not while editing. This is baked into the command palette logic.

#### Help Overlay

Pressing `?` opens a help dialog with all available shortcuts, grouped by category. Single source of truth: the UI and the help stay in sync because they read from the same data.

#### Conflict Detection

Not applicable; no user customization.

---

### 2.2 Gmail

**Overview**: Originated the `gi`, `gt`, `gs` sequence pattern that influenced Linear, GitHub, and others.

#### Keyboard Shortcuts (Non-Customizable)

- `gi` = go to Inbox
- `gt` = go to Sent
- `gs` = go to Starred
- `gd` = go to Drafts
- `ga` = go to All Mail
- `gk` = go to Tasks

#### Data Model

Not publicly documented, but Gmail likely uses a hard-coded action registry with sequence matching logic built into the client (JavaScript).

#### Enable / Disable

Users can toggle keyboard shortcuts on/off in Settings > Keyboard shortcuts, but cannot remap or add new shortcuts.

#### Platform Rendering

Display uses labels like "Shift+D" for Shift+d, using Latin notation, not Unicode symbols (in the web UI).

---

### 2.3 GitHub

**Overview**: Heavy keyboard presence with help overlay (press `?`), command palette (Cmd+K), and sequences like `g i`, `.`, `t`.

#### Hotkey Library

GitHub maintains a public **JavaScript hotkey library** ([github.com/github/hotkey](https://github.com/github/hotkey)) that powers all its shortcuts.

**Data Structure**: Uses a **Radix Trie** under the hood:
- Single keys (`j`) are leaf nodes.
- Sequences (`g i`) create nested nodes: `g → {i: action}`.
- This allows efficient matching and prevents conflicts (e.g., `g` blocks single-key `g` bindings for ~1500ms during sequence wait).

**Shortcut Format**:
```
j, k       — Previous / Next (aliases separated by comma)
g i        — Go to Issues (sequence, space-separated)
Control+Alt+h — Modifier combinations
Mod+k      — Cross-platform (Meta on Mac, Ctrl elsewhere)
```

#### Capture UI

GitHub does not expose a custom shortcut editor. Shortcuts are hard-coded via `data-hotkey` HTML attributes:
```html
<button data-hotkey="g i">View Issues</button>
```

#### Help Overlay

Pressing `?` (or Shift+?) shows a dialog listing all available shortcuts. The overlay is rendered from the same `data-hotkey` attributes, ensuring no drift.

#### Extensibility

None. Shortcuts are embedded in HTML templates and cannot be customized by users.

---

### 2.4 Notion

**Overview**: Note-taking and project management app.

#### Keyboard Shortcuts

**Fixed and non-customizable**. Users cannot rebind or add new shortcuts.

Modifier combos:
- Mac: Cmd+Option (Cmd+⌥)
- Windows/Linux: Ctrl+Shift

#### Capture UI

None. No settings panel for shortcuts.

#### Help Overlay

No dedicated help overlay. Shortcuts are documented in Notion's help center.

#### Extensibility

None. Shortcuts are hard-coded.

---

### 2.5 Figma

**Overview**: Design tool with cross-platform keyboard shortcuts.

#### Keyboard Layout Support

Figma acknowledges different keyboard layouts and allows users to select their **layout preference** in Settings > Keyboard. Defaults to US QWERTY.

#### Display Rendering

Figma renders shortcuts with Unicode symbols:
- ⌘ (Command on Mac)
- ⇧ (Shift)
- ⌃ (Control)
- ⌥ (Option)

#### Platform Handling

Figma's shortcuts are published in two variants (Mac and Windows) on their shortcuts reference page ([shortcuts.design](https://shortcuts.design/tools/toolspage-figma/)).

#### Customization

Not mentioned in public documentation. Shortcuts appear fixed.

---

### 2.6 Slack

**Overview**: Team messaging with command palette and quick-switcher.

#### Key Shortcuts

- Cmd+K (Mac) / Ctrl+K (Windows) – Quick switcher for channels/DMs
- Cmd+/ (Mac) / Ctrl+/ (Windows) – Command palette to search commands
- J / K – Navigate conversations

#### Platform Rendering

Slack displays shortcuts with platform-aware labels:
- Mac: Uses `⌘`, `⌥`, `⇧`, `⌃` symbols in help text.
- Windows: Uses spelled-out `Ctrl`, `Shift`, `Alt`.

#### Customization

Slack does not allow rebinding shortcuts. Shortcuts are fixed.

#### Scope Awareness

Some shortcuts only work in specific contexts (e.g., message navigation only in conversation view).

---

### 2.7 Superhuman

**Overview**: Keyboard-first email client with command palette and vim-like navigation.

#### Key Shortcuts

- Cmd+K – Command palette
- J / K – Next / Previous conversation
- N / P – Next / Previous message
- ? – Help overlay with all shortcuts

#### Command Palette

The command palette is the central feature, listing all 200+ actions and supporting fuzzy search.

#### Help Overlay

Pressing `?` shows a searchable help with all shortcuts grouped by category.

#### Customization

Not documented as customizable in public sources. Shortcuts appear to be fixed.

---

## Section 3: Desktop / IDE Tools

### 3.1 VS Code

**Overview**: Industry standard for keyboard shortcut configuration and the most sophisticated system in this research.

#### Storage / Data Model

Two-layer system:
1. **Default keybindings**: Hard-coded in VS Code, stored as JSON array. Each entry:
   ```json
   {
     "key": "ctrl+k ctrl+s",
     "command": "workbench.action.openGlobalKeybindings",
     "when": "editorTextFocus"
   }
   ```

2. **User keybindings**: Stored in `~/.config/Code/User/keybindings.json` (Linux) or platform equivalent.

**Key fields**:
- `key`: The key combination (space-separated for chords like `ctrl+k ctrl+s`)
- `command`: VS Code command ID (e.g., `editor.action.formatDocument`)
- `when`: Optional context condition (e.g., `editorTextFocus`, `editorLangId == 'javascript'`)
- `args`: Optional arguments passed to the command
- `mac`, `linux`, `win`: Platform-specific overrides

#### Layout Independence

VS Code provides **two modes**:
1. **Character-based** (default): `ctrl+k` binds to the character 'k'
2. **Layout-independent** via scan codes: Use `[Slash]` instead of `/` to bind to the physical slash key regardless of layout.

**Documentation** from [code.visualstudio.com](https://code.visualstudio.com/docs/getstarted/keybindings):
> "VS Code allows you to perform most tasks using the keyboard... The Keyboard Shortcuts editor can be opened using Ctrl+K Ctrl+S."

#### Capture UI

Two methods:
1. **GUI Editor**: Search for a command, right-click, "Change Keybinding", press the chord. VS Code records it and warns of conflicts.
2. **Direct JSON editing**: Edit `keybindings.json` with text.

**Define Keybinding dialog** (Ctrl+K Ctrl+K): Presents a visual, real-time capture interface. As you press keys, the dialog shows the parsed result and any conflicts.

#### Conflict Detection

**Built-in**: If you assign a chord already used, VS Code highlights it with a yellow warning icon and lists the conflicting command. Conflicts are **not prevented**; last-write-wins, but the UI warns.

#### Platform Handling

VS Code uses **three-level platform specification**:
```json
{
  "key": "ctrl+k",
  "command": "myCommand",
  "mac": "cmd+k"
}
```
This entry applies to Windows/Linux, and the `mac` field overrides it on macOS.

Alternatively, use `[KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code)` values like `[BracketLeft]` for layout-independence.

#### Sequences / Two-Key Chords

Fully supported. Chords are written as space-separated: `"ctrl+k ctrl+s"`. The system waits ~1500ms between the first and second chord before timeout.

#### Scope / Context Awareness

Sophisticated **when clauses** control when shortcuts apply:
- `editorTextFocus` – active text editor
- `editorLangId == 'javascript'` – specific language
- `inDebugMode` – debugger running
- `config.editor.formatOnSave == true` – user setting
- Complex expressions: `editorFocus && !editorReadOnly && config.editor.autoSave != 'off'`

Reference: [code.visualstudio.com/api/references/when-clause-contexts](https://code.visualstudio.com/api/references/when-clause-contexts)

#### Extensibility

VS Code's command palette (`F1`) lists all 1000+ commands (built-in + extension commands). Extensions register new commands via the Extension API, and users can bind any command to any chord.

This is **fully extensible**: you can add new actions at runtime.

#### Help Overlay

No traditional help overlay. Instead:
- **Keyboard Shortcuts editor** (Ctrl+K Ctrl+S) is searchable and shows all commands and their bindings.
- **Command Palette** (Ctrl+Shift+P) is the primary discovery mechanism.

Both are dynamic and reflect live extensions.

#### Reset / Defaults

Per-binding reset (red X icon next to binding in GUI). Or edit `keybindings.json` directly to delete lines and restore defaults.

#### Import / Export

No built-in export, but users can back up `keybindings.json` manually. Community extensions exist for sharing keybindings.

---

### 3.2 JetBrains IDEs (IntelliJ IDEA, PyCharm, etc.)

**Overview**: Professional IDEs with keymap schemes and conflict detection.

#### Keymap Schemes

JetBrains offers **predefined keymaps**:
- Mac OS
- macOS System Shortcuts (to avoid conflicts)
- Windows
- Linux
- Emacs
- Vim
- Eclipse
- NetBeans
- Visual Studio

Users select a scheme in Settings > Keymap. When modified, a copy is created as a custom scheme.

#### Storage / Data Model

Keymaps are stored as **XML files** inside the IDE's config directory, not JSON. Each keymap lists all actions and their bindings.

#### Conflict Detection

**Built-in warning system**:
- When you assign a new shortcut, IntelliJ shows a warning if it conflicts with:
  - Another IDE action
  - System shortcuts (macOS, Windows, etc.)
- Users can resolve by reassigning the conflicting action.

**Finding conflicts**: Settings > Keymap > Find Actions by Shortcut. Press a chord, and the IDE lists all actions bound to it.

#### Platform Handling

Different keymaps per platform (Mac OS, Windows, Linux). Users must manually switch or configure if working cross-platform.

#### Extensibility

Limited. Plugins can register new actions, but the shortcut assignment UI and lists are controlled by JetBrains. Not as open as VS Code.

#### Reset / Defaults

Right-click a keymap > Restore defaults. Or switch to a predefined keymap.

---

### 3.3 Obsidian

**Overview**: Note-taking app with plugin ecosystem.

#### Storage / Data Model

Hotkeys are stored in **`.obsidian/hotkeys.json`** inside the vault directory.

**Format** (JSON array):
```json
[
  {
    "id": "editor:insert-link",
    "key": "Ctrl-K"
  },
  {
    "id": "editor:toggle-bold",
    "key": "Ctrl-B"
  }
]
```

Each entry maps a command ID to a key string.

#### Capture UI

Obsidian provides a **Hotkeys settings panel** (Settings > Hotkeys). Users can:
- Search for a command
- Click the key field and press the chord to capture it
- Clear/remove a binding

The capture is live: press Ctrl+B, and the field records "Ctrl-B".

#### Layout Independence

Uses character-based keys (e.g., "Ctrl-K"), not layout-independent scan codes. AZERTY users would have issues.

#### Platform Handling

The key format does not distinguish platforms. Single `hotkeys.json` for both Mac and Windows, so users must use chords that work on both (no Cmd-only on Mac).

#### Extensibility

Plugins can register new commands and expose hotkey bindings for them. The core Obsidian team controls the command list, but the ecosystem extends it.

#### Reset / Defaults

No per-binding reset button mentioned in public docs. Users can delete entries from `hotkeys.json` or delete the entire file and restart.

---

### 3.4 Sublime Text

**Overview**: Minimal, highly customizable text editor.

#### Storage / Data Model

Keybindings are defined in **`.sublime-keymap` JSON files**:

```json
[
  {
    "keys": ["ctrl+shift+p"],
    "command": "show_overlay",
    "args": {"overlay": "command_palette"}
  },
  {
    "keys": ["ctrl+shift+b"],
    "command": "build"
  }
]
```

Default bindings are in `Default.sublime-keymap`. User overrides go in `User/Default.sublime-keymap`.

#### Context Arrays

Sublime supports **conditional bindings via context**:

```json
{
  "keys": ["escape"],
  "command": "cancel_build",
  "context": [
    {"key": "has_next_result", "operator": "equal", "operand": true}
  ]
}
```

This binding only applies if the `has_next_result` context key is true.

#### Sequences

Multi-key sequences are supported by listing multiple keys:
```json
{
  "keys": ["ctrl+k", "ctrl+0"],
  "command": "fold_all"
}
```

#### Capture UI

None built-in. Users must edit the JSON directly.

#### Layout Independence

Uses character keys (e.g., `ctrl+slash`), not scan codes. Not layout-independent.

#### Extensibility

Fully extensible. Plugins can register new commands and users can bind any chord to any command via `.sublime-keymap` files.

---

### 3.5 Raycast / Alfred / Spotlight

**Overview**: macOS app launchers with custom hotkey binding.

#### Raycast

**Hotkey binding**: Users can assign a global hotkey to any command or application in Raycast's settings.

- Default: Cmd+Space (but conflicts with Spotlight by default)
- Users customize in Preferences > Extensions > [Command] > Hotkey
- Raycast **requires at least one modifier key** in the hotkey. Bare keys like `j` are not allowed.

**Data Model**: Not documented, likely in Raycast's preference storage (probably binary plist or JSON).

**Capture UI**: Text field where you click and press the desired chord.

#### Alfred

**Hotkey binding**: Similar to Raycast, but varies between free and Powerpack:
- Free version: Single global hotkey to activate Alfred
- Powerpack ($99): Per-workflow hotkeys, more customization

**Capture UI**: Similar text field click-to-record interface.

#### Spotlight (macOS Native)

**Native implementation**: System Settings > Keyboard > Keyboard Shortcuts > Spotlight.

Users can toggle individual Spotlight functions (search, reveal file, etc.) or reassign the global Spotlight hotkey.

**Data Model**: Stored in macOS's `com.apple.symbolichotkeys` plist (binary, not user-editable without tools).

---

### 3.6 macOS System Settings → Keyboard Shortcuts

**Overview**: Native operating system keyboard shortcut capture UI.

#### Capture UI

The native macOS experience:
1. System Settings > Keyboard > Keyboard Shortcuts
2. Select a category (e.g., Screenshots, Spotlight, App Shortcuts)
3. Click a shortcut field and press the desired chord

**Behavior**:
- Captures modifiers and keys in real-time
- Shows parsed result (e.g., "Shift+Cmd+4")
- Prevents invalid bindings (must have at least one modifier for most contexts)

#### Display / Label Rendering

macOS uses **Unicode symbols** for modifiers:
- ⌘ = Command
- ⌥ = Option (Alt)
- ⇧ = Shift
- ⌃ = Control

These are rendered natively in menus and settings dialogs.

#### Platform Handling

macOS-specific. Windows and Linux use different UIs (see System Settings equivalents in Windows, GNOME).

#### Conflict Detection

Yellow warning triangle appears next to conflicting shortcuts. macOS prevents the same chord from being bound to two system functions simultaneously.

---

## Section 4: JavaScript / Web Libraries

### 4.1 Mousetrap

**Overview**: Classic lightweight keyboard shortcut library by Craig Campbell. 2kb minified/gzipped.

Reference: [craig.is/killing/mice](https://craig.is/killing/mice)

#### API

```javascript
Mousetrap.bind('ctrl+s', () => console.log('Saved'));
Mousetrap.bind('g i', () => console.log('Gmail-style sequence'));
Mousetrap.bind('command', () => console.log('Command key on Mac'));
```

#### Data Model

**String-based**, parsed at runtime. No persistent storage built-in; up to the consumer to store in localStorage or backend.

Supported key names:
- Single keys: `a`, `b`, `/`, etc.
- Modifiers: `ctrl`, `shift`, `alt`, `command`, `cmd`
- Special keys: `backspace`, `delete`, `enter`, `esc`, `space`, `tab`, `up`, `down`, `left`, `right`
- Function keys: `f1` through `f19`

#### Sequences

Fully supported: `Mousetrap.bind('g i', callback)` triggers after pressing `g`, then `i` within ~1000ms.

#### Cross-Platform

Built-in `mod` helper:
```javascript
Mousetrap.bind('mod+s', callback); // Cmd on Mac, Ctrl elsewhere
```

#### Layout Independence

Uses `keyCode` events (deprecated, character-based), not `code` (physical keys). **Not layout-independent**.

#### Scope

Mousetrap binds globally or to a specific element:
```javascript
const elem = document.getElementById('input');
Mousetrap(elem).bind('ctrl+s', callback);
```

#### Limitations

- No built-in conflict detection
- No context awareness (no "when" clauses)
- Limited to global hotkeys or single-element scoping (not tree-based like VS Code)

---

### 4.2 TinyKeys

**Overview**: Modern, minimal library (~650B) emphasizing layout-independence.

Reference: [github.com/jamiebuilds/tinykeys](https://github.com/jamiebuilds/tinykeys)

#### API

```javascript
import { tinykeys } from "tinykeys"

tinykeys(window, {
  "Shift+D": () => alert("Chord"),
  "y e e t": () => alert("Sequence (max 1000ms between keys)"),
  "$mod+([0-9])": () => alert("Regex support")
})
```

#### Data Model

**String-based**, parsed at runtime. Supports:
- Single keys (via `code` property): `"KeyA"`
- Modifiers: `Control`, `Shift`, `Alt`, `Meta`, `AltGraph`
- Sequences (space-separated): `"y e e t"`
- Regex patterns: `"$mod+([0-9])"` matches Cmd/Ctrl + any digit

#### Layout Independence

**Key difference from Mousetrap**: TinyKeys matches against **`KeyboardEvent.code`** (physical key) by default, making it layout-independent:
- `"KeyA"` triggers the physical A key, regardless of QWERTY/AZERTY/Dvorak
- `"$mod"` auto-translates to `Meta` on Mac, `Control` on Windows/Linux

#### Sequences

Supported with configurable timeout (default 1000ms):
```javascript
tinykeys(window, {
  "y e e t": callback
}, { timeout: 1500 })
```

#### Scope

Element-based or window-level.

#### Advantages Over Mousetrap

TinyKeys author argues:
1. **Layout-independent by design** — uses `code` not deprecated `keyCode`
2. **Smaller size** — 650B vs. Mousetrap's 2KB
3. **Regex support** — `"$mod+([0-9])"` is more powerful than fixed strings

---

### 4.3 hotkeys-js

**Overview**: Robust library by jaywcjlove with good cross-browser support.

Reference: [github.com/jaywcjlove/hotkeys-js](https://github.com/jaywcjlove/hotkeys-js)

#### API

```javascript
hotkeys('ctrl+a,cmd+a', (event) => {
  event.preventDefault()
  console.log('Ctrl+A pressed (aliases separated by comma)')
})

hotkeys('a b c', (event) => {
  console.log('Sequence: a, then b, then c')
})

hotkeys.setScope('page')
hotkeys.getScope()
```

#### Data Model

String-based, with support for **aliases** (comma-separated):
- `ctrl+a,cmd+a` – two aliases for the same action

#### Sequences

Supported: `'a b c'` fires when user presses `a`, then `b`, then `c` in sequence.

#### Scopes

Hotkeys-js provides **scoping** via `hotkeys.setScope()`:
```javascript
hotkeys('j', { scope: 'gmail' }, () => { /* ... */ })
hotkeys.setScope('gmail')
```

This allows the same key to trigger different actions in different scopes (useful for SPAs).

#### Cross-Platform

Built-in `mod` translation (though nomenclature differs from Mousetrap):
```javascript
hotkeys('shift+a', callback)
```

#### Layout Independence

Uses character-based keys (deprecated APIs), **not layout-independent**.

#### Features

- Filter by form element type: `hotkeys.filter = { INPUT: true, TEXTAREA: true }`
- Pause/resume globally or per-scope
- Dependencies: None (standalone)

---

### 4.4 react-hotkeys-hook

**Overview**: Modern React hook library for keyboard shortcuts in functional components.

Reference: [react-hotkeys-hook.vercel.app](https://react-hotkeys-hook.vercel.app/)

#### API

```javascript
import { useHotkeys } from 'react-hotkeys-hook'

function MyComponent() {
  useHotkeys('ctrl+k', () => {
    console.log('Cmd K pressed')
  })

  useHotkeys('g i', () => {
    console.log('Gmail-style sequence')
  })
}
```

#### Data Model

String-based shortcut syntax (inherited from Mousetrap / hotkeys-js):
- Single chords: `'ctrl+k'`
- Sequences: `'g i'`
- Multiple modifiers: `'shift+alt+p'`

#### Scoping / Component-Level Binding

Hotkeys can be scoped to a component using a **ref**:
```javascript
const inputRef = useRef()
useHotkeys('esc', () => clearInput(), {}, [inputRef])
```

Hotkey only triggers when `inputRef` element is focused.

#### Options

```javascript
useHotkeys('ctrl+k', callback, {
  enabled: true,                    // Enable/disable
  enableOnFormTags: false,           // Ignore if typing
  enableOnContentEditable: false,    // Ignore in contenteditable
  combinationKey: '+',               // How to join modifiers
  splitKey: ',',                     // How to separate aliases
  scopes: '*',                       // Scope filter
  keyup: undefined,                  // Trigger on keyup
  keydown: true                      // Trigger on keydown
})
```

#### Layout Independence

Uses character-based keys, **not layout-independent**.

#### React-Specific Features

- Dependencies array (like `useEffect`) for cleanup
- Auto-cleanup on unmount
- Composable with other hooks

---

### 4.5 @github/hotkey

**Overview**: GitHub's production keyboard shortcut library.

Reference: [github.com/github/hotkey](https://github.com/github/hotkey)

#### Data Structure: Radix Trie

GitHub's library uses a **Radix Trie** for efficient sequence matching:

```
g
├─ c (for "g c" – go to conversations)
├─ i (for "g i" – go to issues)
└─ p (for "g p" – go to pull requests)
```

When the user presses `g`, the system enters a "waiting" state for ~1500ms, waiting for the second key. If `c` arrives, it matches. If timeout, it reverts.

#### Hotkey String Format

```
j               — single key
g i             — sequence (space-separated)
s, /            — aliases (comma-separated)
Control+Alt+h   — modifiers (case-insensitive)
Mod+k           — cross-platform (Meta on Mac, Control elsewhere)
```

#### HTML Declaration

```html
<button data-hotkey="g i">View Issues</button>
<button data-hotkey="s, /">Search</button>
```

The library reads `data-hotkey` attributes and installs handlers automatically.

#### API

```javascript
install()      — register all data-hotkey elements on the page
uninstall()    — remove all handlers
```

#### Capture UI

None. Hotkeys are embedded in HTML at template time.

#### Accessibility

The library emphasizes user choice: developers should provide options to disable or remap hotkeys, and the library follows W3C guidance on character key shortcuts ([w3.org/WAI/WCAG21/Understanding/character-key-shortcuts.html](https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts.html)).

---

### 4.6 CodeMirror 6 Keymap System

**Overview**: Text editor library with sophisticated keymap precedence handling.

Reference: [codemirror.net/docs/guide/](https://codemirror.net/docs/guide/)

#### Extension Architecture

CodeMirror 6 uses **extensions** for all features, including keymaps. Precedence is controlled by:
1. Explicit precedence level (`highest`, `default`, `low`, `lowest`)
2. Order within the same precedence level

#### Keymap Example

```javascript
import { keymap } from "@codemirror/view"
import { EditorView } from "@codemirror/view"

const myKeymap = [
  {
    key: "Ctrl-d",
    run: deleteChar,
    shift: extendSelection
  },
  {
    key: "Cmd-Enter",
    run: submitForm
  }
]

const editor = new EditorView({
  extensions: [keymap.of(myKeymap)],
  parent: document.body
})
```

#### Precedence Rules

When multiple keymaps bind the same key, they are tried in precedence order. The first one that returns `true` wins.

```javascript
[
  keymap.of(customKeymap, Prec.highest),
  keymap.of(defaultKeymap, Prec.default),
  keymap.of(fallbackKeymap, Prec.low)
]
```

#### Platform Variants

The `key` field can include platform prefixes (though not explicitly documented in the excerpt retrieved):
- CodeMirror 6 recommends using separate keymaps or conditional configuration for platform-specific bindings.

#### Scope / Context

No built-in "when" clauses, but editors can be nested and each maintains its own keymap stack, providing scope.

---

## Section 5: Electron & System-Level APIs

### 5.1 Electron Accelerator API

**Overview**: String-based keyboard shortcut format for cross-platform Electron apps.

Reference: [electronjs.org/docs/latest/api/accelerator](https://www.electronjs.org/docs/latest/api/accelerator)

#### Accelerator String Format

```javascript
const { globalShortcut } = require('electron')

globalShortcut.register('CmdOrCtrl+X', () => {
  console.log('Quit app')
})

globalShortcut.register('Cmd+A', () => {
  console.log('Mac only')
})

globalShortcut.register('Ctrl+A', () => {
  console.log('Windows and Linux only')
})
```

#### Syntax

Each accelerator is a string of modifiers and a single key code, joined by `+`:

**Modifiers**:
- `CommandOrControl` (alias `CmdOrCtrl`) – ⌘ on Mac, Ctrl on Windows/Linux
- `Command` (alias `Cmd`) – ⌘ on Mac only
- `Control` (alias `Ctrl`) – Ctrl on Windows/Linux
- `Shift` (alias `S`)
- `Alt`
- `Option` (alias `⌥`, Mac only)
- `AltGr` (Windows/Linux)
- `Super` (alias `Meta`) – Windows key on Windows, Command on Mac

**Key Codes**:
- Letters: `A`, `B`, ..., `Z` (case-insensitive)
- Numbers: `0` through `9`
- Function keys: `F1` through `F24`
- Special: `Plus`, `Space`, `Tab`, `Backspace`, `Delete`, `Insert`, `Return`/`Enter`, `Esc`/`Escape`
- Arrow keys: `Up`, `Down`, `Left`, `Right`
- Home, End, PageUp, PageDown
- Media keys: `MediaPlayPause`, `MediaStop`, `MediaNextTrack`, `MediaPreviouTrack`

#### Platform Overrides

The same code can register different accelerators per platform:

```javascript
const { app, Menu } = require('electron')

const template = [
  {
    label: 'Edit',
    submenu: [
      {
        label: 'Undo',
        accelerator: process.platform === 'darwin' ? 'Cmd+Z' : 'Ctrl+Z',
        role: 'undo'
      }
    ]
  }
]
```

#### CmdOrCtrl Magic

`CmdOrCtrl` is parsed at runtime by Electron and translated:
- **macOS**: → `Cmd`
- **Windows/Linux**: → `Ctrl`

This is the simplest cross-platform pattern in the industry.

#### Sequences

**No support for key sequences** like `g i`. Electron accelerators only support single chords (one or more modifiers + one key code).

---

## Section 6: Comparison Table

| Product | Data Model | Layout-Independent? | Sequences? | Platform Modifier | Conflict Detection | Extensibility |
|---------|-----------|---------------------|-----------|-------------------|-------------------|---------------|
| **Vimium** | Plain text (`<c-x>` format) | No (char-based) | Yes | Dual config (`<m-x>` vs `<c-x>`) | None | Rebind only |
| **uBlock Origin** | Browser API (chrome.commands) | Browser-dependent | No | Browser handles | Browser-level | None |
| **Linear** | Hard-coded (not customizable) | N/A | Yes (g → i) | Cmd/Ctrl handled by UI | N/A | None |
| **Gmail** | Hard-coded | N/A | Yes (gi, gt) | Platform-aware UI | N/A | None |
| **GitHub** | HTML data-hotkey attributes + Radix Trie | No (char-based) | Yes | `Mod+k` token | Limited (timeout-based) | None |
| **VS Code** | JSON (`keybindings.json`) | Yes (scan codes) | Yes (ctrl+k ctrl+s) | Platform-level override | Yes (with warning) | Full (extensions) |
| **JetBrains** | XML keymaps | No (char-based) | Yes | Multiple keymap schemes | Yes (with warning) | Limited (plugins) |
| **Obsidian** | JSON (`hotkeys.json`) | No (char-based) | No | Single config | None | Plugins can add actions |
| **Sublime** | JSON (`.sublime-keymap`) | No (char-based) | Yes | Single config | None | Full (plugins + user editing) |
| **Mousetrap** | String (runtime, no storage) | No (deprecated APIs) | Yes | `mod` token | None | Full (bind anything) |
| **TinyKeys** | String (runtime, no storage) | Yes (code-based) | Yes | `$mod` token | None | Full (bind anything) |
| **hotkeys-js** | String (runtime, no storage) | No (char-based) | Yes | Implicit | None | Full + scopes |
| **react-hotkeys-hook** | String (inherited from hotkeys-js) | No | Yes | N/A | None | Full (component-scoped) |
| **GitHub hotkey lib** | String (Radix Trie storage) | No (char-based) | Yes | `Mod+` prefix | Yes (1500ms timeout) | HTML data-attributes |
| **CodeMirror 6** | JavaScript objects (keymap extension) | No (char-based) | No (single chords only) | Conditional config | None | Full (extension stack) |
| **Electron Accelerator** | String (`CmdOrCtrl+X` format) | No (named key codes) | No (single chords only) | `CmdOrCtrl` token | None | Full (programmatic) |

---

## Section 7: Synthesis – Patterns Worth Stealing

### 7.1 Single Source of Truth for Help

**Best example**: Vimium (help overlay always matches options page), Linear (help overlay reads from live command registry), VS Code (Keyboard Shortcuts editor + Command Palette are data-driven).

**Pattern**: Don't hardcode help text. Extract shortcut labels and descriptions from the runtime data structure (action registry, keybindings, etc.). When users change a binding, the help automatically updates.

**For Blurry Site**: Store each action with a description and binding. Render the help overlay from this same source. If a user rebinds, the help reflects it immediately.

### 7.2 Layout-Independence via Code Property

**Best example**: TinyKeys (uses `KeyboardEvent.code`), VS Code (optional scan code mode with `[KeyK]` syntax).

**Pattern**: Offer both modes:
1. **Character-based** (default): `ctrl+k` binds to the 'k' character. Simple, suits most users on QWERTY.
2. **Layout-independent** (opt-in): `[KeyK]` binds to physical K position. For power users on AZERTY or Dvorak.

This requires parsing either the key name or the W3C code name, and storing the preference.

### 7.3 Cross-Platform Modifier with Single Token

**Best example**: Electron's `CmdOrCtrl`, Mousetrap's `mod`, tinykeys' `$mod`.

**Pattern**: Provide a magic token that auto-translates at runtime:
- `CmdOrCtrl+K` → `Cmd+K` on Mac, `Ctrl+K` on Windows
- Store as the token string, resolve at display/execution time

**Advantage**: Users write one binding, it works everywhere. No need for dual configurations.

**For Blurry Site**: If you allow users to customize, expose `CmdOrCtrl` or `Mod` as a token.

### 7.4 Trie-Based Sequence Matching with Timeout

**Best example**: GitHub's hotkey library (Radix Trie), Gmail (`gi`, `gt`), Linear (`g → i`).

**Pattern**: Build a trie of sequences. When a user presses the first key, enter a waiting state (~1000–1500ms) for the next key. If timeout, revert to single-key handling.

**Data structure**:
```javascript
{
  'g': {
    'i': 'goToInbox',
    'f': 'goToFavorites'
  },
  'j': 'nextItem'
}
```

**Conflict prevention**: While waiting for the second key of `g i`, the single key `g` is unavailable. This prevents ambiguity.

### 7.5 Context Awareness with "When" Clauses

**Best example**: VS Code (`when` clauses), Sublime Text (context arrays).

**Pattern**: Each binding optionally includes a condition expression:
```json
{
  "key": "ctrl+s",
  "command": "save",
  "when": "editorFocus && !editorReadOnly"
}
```

Conditions can include:
- UI focus state
- Language / file type
- User setting values
- Plugin state

This allows the same key to do different things in different contexts without manual scoping.

### 7.6 Visual Conflict Warning, Not Prevention

**Best example**: VS Code (yellow warning), JetBrains (warning in dialog).

**Pattern**: Allow the user to bind duplicate chords. Warn them with a visual indicator, but don't refuse the save. Let last-write-wins.

**Rationale**: Strictness (refusal) frustrates users who want to override system shortcuts or quickly test a binding. A warning is sufficient.

### 7.7 Platform-Aware Label Rendering

**Best example**: Linear/Slack (use `⌘`, `⇧`, `⌥`, `⌃` on Mac; spell out `Cmd`, `Shift`, `Alt`, `Ctrl` on Windows), Figma (platform-specific shortcut pages).

**Pattern**: At display time, check the platform and render the appropriate label:
```javascript
const renderLabel = (key, platform) => {
  if (platform === 'darwin') {
    return key.replace('Cmd', '⌘').replace('Shift', '⇧').replace('Option', '⌥')
  } else {
    return key.replace('Ctrl', 'Ctrl').replace('Shift', 'Shift')
  }
}
```

### 7.8 Command Palette as Discovery Mechanism

**Best example**: VS Code (Ctrl+Shift+P), Linear (Cmd+K), Slack (Cmd+K), Superhuman (Cmd+K).

**Pattern**: Build a searchable command palette that lists all actions (built-in + user-added). Users discover shortcuts here, and it's a fallback when they forget a binding. Make the palette fuzzy-searchable and show the shortcut label next to each action.

### 7.9 Extensibility via Command Registration

**Best example**: VS Code (extensions register commands and keybindings), Sublime Text (plugins + user `keybindings.json`).

**Pattern**: Design the system so users can:
1. Add new commands/actions (not just rebind existing ones)
2. Bind any key to any action
3. Optionally import/export keybinding configurations

This is complex but powerful. Simpler apps (Linear, Gmail) skip extensibility and hard-code all actions, which is fine for their use cases.

### 7.10 Per-Component or Scope Isolation

**Best example**: react-hotkeys-hook (component-scoped), hotkeys-js (named scopes), Sublime Text (context arrays).

**Pattern**: Allow hotkeys to be active only in specific contexts:
- React: bind only when a ref is focused
- Scopes: globally switch which set of hotkeys is active (e.g., edit mode vs. normal mode)
- Context: evaluate a condition at keypress time

This prevents conflicts and allows the same key to do different things depending on mode.

---

## Section 8: Patterns to Avoid

### 8.1 Character-Based Keys Without Layout Independence Option

**Pitfall**: Mousetrap, hotkeys-js, Obsidian all use `event.key` (character-based) by default. This breaks for users on non-QWERTY layouts.

**Impact**: A user on AZERTY keyboard trying to bind `ctrl+a` actually gets the physical key that produces 'a' on QWERTY, which is different on their layout.

**Better**: Provide an option or mode for scan codes. At minimum, document the limitation.

### 8.2 No Conflict Detection or Warning

**Pitfall**: Mousetrap, hotkeys-js, Obsidian have no built-in conflict detection.

**Impact**: Users unknowingly bind two actions to the same key. Last-write-wins, silently. No indication which action got overridden.

**Better**: At minimum, warn when a new binding shadows an existing one.

### 8.3 Help Overlay Hardcoded and Out of Sync

**Pitfall**: Some apps hardcode help text in a separate data file or UI. When shortcuts change, the help is forgotten.

**Impact**: Users read the help and try a shortcut, but it doesn't work because the code changed.

**Better**: Help overlay should read from the runtime data (action registry + keybindings). Auto-generated, always accurate.

### 8.4 No Capture UI (Users Must Type Syntax)

**Pitfall**: Vimium requires users to type `<c-s>` syntax. Sublime Text requires JSON. Requires learning syntax and is error-prone.

**Impact**: High friction for end users. Power users tolerate it, but it excludes non-technical users.

**Better**: Provide a "press keys to capture" UI (like macOS System Settings, JetBrains, Obsidian). Store the binding in whatever format internally, but capture via UI.

### 8.5 Sequences With No Visible Feedback

**Pitfall**: If a user presses `g`, then waits 2 seconds, then presses `i`, the second `i` might be misinterpreted as a single key. No UI feedback that the system is waiting.

**Impact**: Confusing behavior. Users don't know if they're in "sequence wait" mode.

**Better**: Show a visual indicator (e.g., "Press the next key in the sequence" tooltip or status bar message) while waiting.

### 8.6 Dual Configurations Per Platform Instead of CmdOrCtrl Token

**Pitfall**: Requiring users to configure both `cmd+k` (Mac) and `ctrl+k` (Windows) separately.

**Impact**: Doubles the configuration burden. Users on both platforms have to maintain two keybinding sets.

**Better**: Use `CmdOrCtrl+K` or `$mod+K` and auto-translate at runtime.

### 8.7 Storing Shortcuts Without Serialization Mechanism

**Pitfall**: Some libraries (Mousetrap, TinyKeys) bind at runtime in JavaScript without storing to disk. No backup, no export, no version control.

**Impact**: User's customizations are lost on browser refresh or reload. Not portable across machines.

**Better**: If you support customization, persist to localStorage, IndexedDB, or a backend API. Provide import/export.

### 8.8 No Reset / Restore Defaults Button

**Pitfall**: If the user accidentally breaks shortcuts (e.g., binds everything to the same key), there's no easy undo.

**Impact**: User frustration. They have to manually unbind or restart with defaults.

**Better**: Provide per-binding reset (red X) and global "Restore Defaults" button.

### 8.9 Complex Context Logic Without Clear Documentation

**Pitfall**: VS Code's `when` clauses are powerful but the list of context keys is long and scattered across docs.

**Impact**: Users don't know what conditions are available, so they can't effectively use advanced features.

**Better**: Provide an autocomplete / picker UI for context keys (VS Code does this in the GUI editor, which helps).

### 8.10 Sequences Without Visual Timeout Indication

**Pitfall**: If the system times out waiting for the second key in a sequence, it silently reverts to single-key mode without telling the user.

**Impact**: User presses `g`, sees nothing, presses `i` 2 seconds later thinking `i` is bound globally. Confusing.

**Better**: Show a tooltip or status message like "Waiting for next key… (timeout in 0.5s)".

---

## Section 9: Technical Recommendations for Blurry Site

### 9.1 Data Model

**Recommendation**: Use a JSON structure combining character-based (default) and optional layout-independent modes:

```javascript
{
  "action": "toggleBlur",
  "key": "ctrl+b",
  "code": "[KeyB]",            // Optional, for layout-independence
  "platform": "CmdOrCtrl",     // Use magic token
  "label": "Toggle Blur",
  "description": "Blur the current tab",
  "when": "tabActive"          // Optional context
}
```

### 9.2 Storage

Store in Chrome's `chrome.storage.sync` for seamless cross-device sync. Provide JSON export/import for backup.

### 9.3 Capture UI

Build a "press to capture" dialog (similar to macOS System Settings or Obsidian). Record the user's key press, parse it, and store internally. Offer an optional toggle to show the raw string for manual editing.

### 9.4 Display

Render shortcuts using platform-aware symbols:
- macOS: `⌘B` (using Unicode symbols)
- Windows/Linux: `Ctrl+B` (spelled out)

Use a utility function that checks `navigator.platform` or `navigator.userAgent` to decide.

### 9.5 Conflict Detection

Scan all bindings on save. If a duplicate is found, show a yellow warning badge and list the conflicting action. Allow the save (last-write-wins) but don't let the user dismiss the warning easily.

### 9.6 Sequences

Implement a simple trie-based matcher with 1000ms timeout. While waiting for the next key, show a status message like "Press next key (g → _)". Use a visual indicator (outline, highlight) in the UI.

### 9.7 Help Overlay

Render help from the runtime action registry. Each action should have `label`, `description`, and current `binding`. When the user rebinds, the help updates automatically.

### 9.8 Scope / Context

Start simple: don't implement context awareness initially. If needed later, add a `when` field to each action and evaluate simple conditions like `tabActive`, `contentFocus`, etc.

### 9.9 Extensibility

For a first release, limit to rebinding built-in actions. If the extension grows, consider a plugin API (lower priority).

### 9.10 Reset

Per-binding reset button in the UI. Global "Restore Defaults" clears all and reloads from the built-in action list.

---

## Section 10: Key Sources & References

- **Vimium**: [github.com/philc/vimium](https://github.com/philc/vimium), [vimium.github.io](https://vimium.github.io/)
- **VS Code**: [code.visualstudio.com/docs/getstarted/keybindings](https://code.visualstudio.com/docs/getstarted/keybindings), [code.visualstudio.com/api/references/when-clause-contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
- **Mousetrap**: [craig.is/killing/mice](https://craig.is/killing/mice)
- **TinyKeys**: [github.com/jamiebuilds/tinykeys](https://github.com/jamiebuilds/tinykeys)
- **hotkeys-js**: [github.com/jaywcjlove/hotkeys-js](https://github.com/jaywcjlove/hotkeys-js)
- **react-hotkeys-hook**: [react-hotkeys-hook.vercel.app](https://react-hotkeys-hook.vercel.app/)
- **GitHub hotkey**: [github.com/github/hotkey](https://github.com/github/hotkey)
- **CodeMirror 6**: [codemirror.net/docs/guide/](https://codemirror.net/docs/guide/)
- **Electron Accelerator**: [electronjs.org/docs/latest/api/accelerator](https://www.electronjs.org/docs/latest/api/accelerator)
- **KeyboardEvent.code**: [developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code)
- **Bitwarden**: [bitwarden.com/help/keyboard-shortcuts](https://bitwarden.com/help/keyboard-shortcuts/)
- **JetBrains**: [jetbrains.com/help/idea/keyboard-shortcuts-troubleshooting.html](https://www.jetbrains.com/help/idea/keyboard-shortcuts-troubleshooting.html), [jetbrains.com/help/idea/configuring-keyboard-and-mouse-shortcuts.html](https://www.jetbrains.com/help/idea/configuring-keyboard-and-mouse-shortcuts.html)
- **Obsidian**: [help.obsidian.md/hotkeys](https://help.obsidian.md/hotkeys), [help.obsidian.md/data-storage](https://help.obsidian.md/data-storage)
- **Sublime Text**: [sublimetext.com/docs/key_bindings.html](https://www.sublimetext.com/docs/key_bindings.html)
- **GitHub Docs**: [docs.github.com/en/get-started/accessibility/keyboard-shortcuts](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)
- **Linear Docs**: [linear.app/docs/keyboard-shortcuts](https://linear.app/docs/keyboard-shortcuts)
- **Slack**: [slack.com/help/articles/201374536-Slack-keyboard-shortcuts](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- **Notion**: [notion.com/help/keyboard-shortcuts](https://www.notion.com/help/keyboard-shortcuts)
- **Figma**: [help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard](https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard)
- **Superhuman**: [help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts)
- **Raycast**: [manual.raycast.com/hotkey](https://manual.raycast.com/hotkey), [manual.raycast.com/command-aliases-and-hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys)
- **macOS**: [support.apple.com/en-us/102650](https://support.apple.com/en-us/102650)

---

## Conclusion

The landscape of keyboard shortcut UX reveals **no universal "best" approach**, but rather **a spectrum of trade-offs**:

- **Browser extensions** use the browser's native shortcut APIs, requiring minimal custom UI.
- **Web apps** (Linear, Gmail, GitHub) hard-code shortcuts for performance and simplicity, trading extensibility for consistency.
- **IDEs** (VS Code, JetBrains) offer the most sophisticated systems, supporting extensibility, context awareness, and conflict detection.
- **Libraries** (Mousetrap, TinyKeys, hotkeys-js) prioritize lightweight, runtime-only binding with minimal persistence.

For **Blurry Site's redesign**, the most applicable lessons are:

1. **Use a trie-based system** for sequences (`g → b` to toggle blur).
2. **Offer both character-based and layout-independent modes** for flexibility.
3. **Implement live "press to capture" UI** for ease of use.
4. **Render help from runtime data** to ensure accuracy.
5. **Use CmdOrCtrl token** for cross-platform simplicity.
6. **Warn on conflicts** but don't prevent saves.
7. **Start with rebinding; extend to custom actions** if the extension grows.

This dossier provides the foundation for a keyboard shortcut system that rivals the sophistication of Linear, GitHub, and VS Code while remaining approachable for end users.
