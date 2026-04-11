# Plan — Slim `src/content_script.js`

**Status:** draft
**Baseline:** `src/content_script.js` = 1090 lines (`wc -l`)
**Target:** ~350–420 lines orchestrator. Delta ≈ **−670 lines** moved into new `src/` IIFE modules.
**Non-goal:** behaviour change. Pure extraction + rewiring. No new features, no contract changes.

---

## 1. Why

`content_script.js` is the orchestrator per `CLAUDE.md` ("binds all modules via `blsi.*` aliases"), but it has accumulated four sub-systems that are self-contained and testable in isolation:

1. URL pattern parsing + matching (~170 lines, pure functions).
2. Reveal management — click / hover / ancestor chain / zone reveal (~215 lines, self-contained state).
3. Blur-item apply/remove dispatch for dynamic + sticky items (~60 lines).
4. Blur-all controller (enable/disable/refresh + MutationObserver) (~90 lines).

These are the bulk of the file. Extracting them leaves a thin orchestrator that does what the name says: wire modules, handle messages, resolve settings, init.

Secondary win: unit-test coverage. Today the URL matcher is only reachable by stubbing `content_script.js`'s IIFE — extracting it to `src/url_matcher.js` makes it a first-class tested module like the others.

---

## 2. Current file map (read before changing anything)

| Lines | Block | Extract? |
|---|---|---|
| 1–54 | Header + state + module aliases | Keep |
| 60–118 | `_applyDynamicItem`, `_removeDynamicItem`, `_applyStickyItem`, `_removeStickyItem`, `_applyBlurItem`, `_removeBlurItem` | **Extract** → `blur_item_controller.js` |
| 120–168 | `_enableBlurAll`, `_disableBlurAll`, `_refreshBlurAll`, `applyInitialBlurState` | **Extract** → `blur_all_controller.js` (with observer) |
| 179–214 | `startDomObserver`, `stopDomObserver` | **Extract** → `blur_all_controller.js` (same module as enable/disable — MO only runs while blur-all is active) |
| 216–280 | `pickerCallbacks` object | Keep (tight coupling to `Store`, `Engine`, `Shortcuts`, counters) |
| 288–456 | `MAX_PATTERN_LENGTH`, `parsePattern`, `hostnameMatches`, `pathMatches`, `matchesPattern`, `resolveSettings` | **Extract** → `url_matcher.js` |
| 459–469 | `findBlurredAncestor` | **Extract** → `reveal_controller.js` (only caller is reveal code) |
| 471–687 | All reveal state + `_revealElement`, `_unrevealElement`, `_unrevealAll`, `dismissClickReveal`, `_findZoneAtPoint`, `onRevealClick`, `onRevealKeydown`, `onRevealMouseOver`, `_dismissHoverReveal`, `onRevealMouseOut`, `revealAncestorChain`, `clearRevealedAncestors` | **Extract** → `reveal_controller.js` |
| 689–712 | `shortcutActionMap` | Keep (wires to `handleMessage`) |
| 714–834 | `handleMessage` switch | Keep (orchestrator's job) |
| 836–912 | `applyState` | Keep (orchestrator's job) |
| 914–973 | `init` | Keep |
| 975–1038 | `handleStorageChange` + per-key handlers | Keep |
| 1040–1080 | SPA URL change detection | Keep |
| 1082–1090 | DOM-ready guard + IIFE close | Keep |

---

## 3. New modules

All follow the IIFE pattern in `src/CLAUDE.md`. Loaded **before** `content_script.js` in `manifest.json`. Must only depend on modules loaded earlier.

### 3.1 `src/url_matcher.js` → `blsi.UrlMatcher`

**Public API:**
```js
blsi.UrlMatcher = {
  matchesPattern(url, pattern, patternType),   // bool
  resolveSettings(url, globalSettings, rules), // merged settings
};
```

`parsePattern`, `hostnameMatches`, `pathMatches`, `MAX_PATTERN_LENGTH` stay private inside the IIFE.

**Dependencies:** `blsi.DEFAULT_SETTINGS`, `blsi.deepMerge`, `blsi.PATTERN_TYPES` (already on `blsi` from `constants.js`).

**Load order:** after `constants.js`, before `storage_manager.js` (no dep on storage, so position is flexible — put it right after constants for clarity).

**Test file:** new `tests/unit/url_matcher.test.js`. Covers wildcard hostname, subdomain wildcard, scheme, port, path prefix, regex mode rejection of nested quantifiers, `MAX_PATTERN_LENGTH` guard, `resolveSettings` rule precedence.

### 3.2 `src/blur_item_controller.js` → `blsi.BlurItems`

**Public API:**
```js
blsi.BlurItems = {
  apply(item),                          // dispatches dynamic vs sticky
  remove(item),
  resetCounters(),                      // called from init()
  // getters so content_script can still seed names
  get dynamicCounter(),
  get stickyCounter(),
};
```

Counters move into this module. `pickerCallbacks` in content_script reads/increments them via the getters + an `allocateDynamicName()` / `allocateStickyName()` helper (cleaner than exposing raw setters).

**Revised API (final):**
```js
blsi.BlurItems = {
  apply(item),
  remove(item),
  resetCounters(),
  allocateDynamicName(),   // ++dynamicCounter; return 'Dynamic N'
  allocateStickyName(),    // ++stickyCounter;  return 'Sticky N'
};
```

**Dependencies:** `blsi.BlurEngine`, `blsi.SelectorUtils`.

**Load order:** after `blur_engine.js`, before `content_script.js`.

**Test file:** new `tests/unit/blur_item_controller.test.js`. Counters, dynamic selector resolve failure, sticky percent → pixel math, sticky path mismatch early return, counter seeding from item names.

### 3.3 `src/blur_all_controller.js` → `blsi.BlurAll`

**Public API:**
```js
blsi.BlurAll = {
  enable(settings),
  disable(hostname),           // async — re-applies per-item blurs from Store after clearing
  refresh(settings),           // idempotent re-render when categories/mode/thorough change
  get isActive(),
  _setActive(v),               // used only by onBlurAllChanged cross-tab sync
};
```

Owns: `isPageBlurred`, `domObserver`, `startDomObserver`, `stopDomObserver`. Content script reads `BlurAll.isActive` instead of its own `isPageBlurred` var.

The MutationObserver currently closes over `isPickerActive` and `settings.THOROUGH_BLUR`. Resolve by:
- `BlurAll.enable(settings)` stores a ref to current settings; `refresh(settings)` updates it.
- Picker-active gate: `BlurAll` exposes `_setPickerActive(v)` like `Shortcuts` does, called from the same sites that already call `Shortcuts._setPickerActive`.

**Dependencies:** `blsi.BlurEngine`, `blsi.Storage`.

**Load order:** after `storage_manager.js` + `blur_engine.js`, before `content_script.js`.

**Test file:** new `tests/unit/blur_all_controller.test.js`. Enable injects rules + starts MO; disable removes rules + re-applies items; refresh is no-op when inactive; MO ignores added nodes while picker active; MO skips zone overlay nodes.

### 3.4 `src/reveal_controller.js` → `blsi.Reveal`

**Public API:**
```js
blsi.Reveal = {
  init({ getMode, isPickerActive }),   // attaches document listeners, returns destroy fn
  destroy(),
  clearAll(),                          // called from applyState on mode change + disable
};
```

`getMode` is a function, not a value, so content_script passes `() => settings.REVEAL_MODE` and doesn't need to re-init on every settings change. Same for `isPickerActive`.

Owns: `revealedAncestors`, `clickRevealedEl`, `mouseoutTimer`, `_revealedElements`, `_hoverRevealedEl`, plus `findBlurredTarget`, `findBlurredAncestor`, `_findZoneAtPoint`, all `onReveal*` handlers.

**Dependencies:** `blsi.BlurEngine`, `blsi.REVEAL_MODES`.

**Load order:** after `blur_engine.js`, before `content_script.js`.

**Test file:** new `tests/unit/reveal_controller.test.js`. Click reveal + dismiss, hover reveal + mouseout debounce, zone overlay coord hit-test, ancestor chain reveal, mode change clears state, form-field skip (input/textarea/select/button/contenteditable).

---

## 4. Manifest load order (final)

```
0. constants.js
1. url_matcher.js            ← NEW
2. selector_utils.js
3. storage_manager.js
4. blur_engine.js
5. blur_item_controller.js   ← NEW
6. blur_all_controller.js    ← NEW
7. reveal_controller.js      ← NEW
8. shortcut_handler.js
9. picker.js
10. content_script.js
```

Update `manifest.json` `content_scripts[0].js` array in the same commit as each extraction.

---

## 5. Slimmed `content_script.js` shape

Post-extraction, the orchestrator holds:

- State: `globalSettings`, `settings`, `rules`, `isPickerActive`, `lastContextMenuTarget`, `hostname`, `lastUrl`.
- Module aliases (add `UrlMatcher`, `BlurItems`, `BlurAll`, `Reveal`).
- `pickerCallbacks` (uses `BlurItems.allocateDynamicName` etc.).
- `shortcutActionMap`.
- `handleMessage` switch.
- `applySettingsToDom`, `applyState`.
- `init`, `handleStorageChange` + per-key handlers, SPA URL wrap.
- DOM-ready guard.

Rough line count estimate: **~380 lines**. Matches `popup/popup.js`-ish density — small enough that the whole thing fits in a single `Read` call.

---

## 6. Doc updates (same-commit rule)

Per `CLAUDE.md` §"Documentation Maintenance":

- `CLAUDE.md` **Module Globals** table → 4 new rows.
- `src/CLAUDE.md` **Module Load Order** → update the numbered list.
- `src/CLAUDE.md` **Module-Specific Rules** → add sections for each new module.
- `docs/LLD.md` → add contract entries for the 4 new modules.
- `docs/HLD.md` → update the module diagram if one exists for content_script's sub-structure; no protocol table change (no new messages).
- `docs/TEST_VALIDATION.md` → add entries for every new test in the 4 new test files.
- `tests/CLAUDE.md` → no change expected (same load pattern).

---

## 7. Execution order (one PR per step, or batched — user's call)

Each step is independently mergeable, tests green at every step.

1. **`url_matcher.js`** — lowest risk, pure functions. Extract, wire, update `resolveSettings` call sites in content_script (two places: `init` and `onUrlChange` / `onSettingsChanged` / `onRulesChanged`). Add test file. Expected diff: −170 / +180 across `content_script.js` + new file.
2. **`blur_item_controller.js`** — extract item apply/remove + counters. Wire `pickerCallbacks` and the storage-change handler through `BlurItems`. Add test file. Expected diff: −70 / +110.
3. **`blur_all_controller.js`** — extract enable/disable/refresh + MO. This one touches the most call sites (`handleMessage` TOGGLE_BLUR_ALL + CLEAR_ALL_BLUR, `applyState`, `onBlurAllChanged`, shortcut `CLEAR_ALL`, `init`'s `applyInitialBlurState`). Most likely to regress — do this step on its own, run full manual smoke via `docs/TEST_VALIDATION.md`. Expected diff: −100 / +170.
4. **`reveal_controller.js`** — extract reveal subsystem. Content_script calls `Reveal.init({ getMode: () => settings.REVEAL_MODE, isPickerActive: () => isPickerActive })` from `init`, and `Reveal.clearAll()` from `applyState` on mode change + disable. Expected diff: −215 / +260.

After all four steps: `wc -l src/content_script.js` should read ~380.

---

## 8. Risks + mitigations

| Risk | Mitigation |
|---|---|
| MutationObserver closure captures stale `settings` ref after extraction | `BlurAll.enable/refresh` takes settings as param; store in module-local `_currentSettings`, read inside MO callback |
| `pickerCallbacks` still wants to mutate `dynamicCounter` / `stickyCounter` | Expose `allocateDynamicName()` / `allocateStickyName()` as the only way to bump |
| Reveal state not cleared on `REVEAL_MODE` change | `applyState` calls `Reveal.clearAll()` when `old.REVEAL_MODE !== settings.REVEAL_MODE` — same semantics as today's inline block |
| Tests broken by new load order | Update test harness `loadXxx()` pattern for each new file (follow existing `buildStubSource` scaffold) |
| Cross-browser surface change | Zero — pure refactor, no `chrome.*` calls added or removed |
| Coverage regression | Each new module ships with its own test file; net line coverage should go **up** (url_matcher was previously only exercised through content_script's stub path) |

---

## 9. Out of scope (do not expand)

- No message protocol changes.
- No settings shape changes.
- No CSS class renames.
- No `applyState` restructuring — even though it has a duplicated `// 7.` comment (lines 899 and 906), fixing that is a separate drive-by.
- No `handleMessage` split — it's 120 lines but switch statements don't benefit from extraction.
- No `init` reshuffling.
