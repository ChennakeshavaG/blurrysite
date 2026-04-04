# PrivacyBlur — Test Validation & Manual Replication Guide

**215 unit tests across 6 test files.** All validated 2026-04-03.

---

## 1. blur_engine.test.js (48 tests)

### applyBlur (9 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | adds pb-blurred class to element | DevTools console: `PrivacyBlurEngine.applyBlur(document.querySelector('div'), 8)`. Inspect element — `pb-blurred` class present. |
| 2 | sets --pb-radius CSS custom property | Same as above with radius 12. Styles pane shows `--pb-radius: 12px` inline. |
| 3 | uses default radius of 8px when not specified | `PrivacyBlurEngine.applyBlur(el)` — no second arg. Check `--pb-radius: 8px`. |
| 4 | applies CSS filter directly on img elements | Select an `<img>`, apply blur with radius 10. Image appears blurred. Elements panel shows `style="filter: blur(10px)"`. |
| 5 | creates canvas overlay for video elements | Find an HTML5 `<video>`, apply blur. A `<canvas class="pb-canvas-overlay">` appears as sibling in DOM. |
| 6 | starts RAF animation loop for video elements | Blur a playing video. Performance panel shows continuous animation frame callbacks. Canvas updates with video frames. |
| 7 | does not throw on null element | `PrivacyBlurEngine.applyBlur(null)` — no error in console. |
| 8 | does not throw on element not in DOM | `let d = document.createElement('div'); PrivacyBlurEngine.applyBlur(d, 8)` — no error. |
| 9 | calling applyBlur twice is idempotent | Blur same element twice. Only one `pb-blurred` class, no duplicate side effects. |

### removeBlur (6 tests)

| # | Test | Manual Replication |
|---|---|---|
| 10 | removes pb-blurred class | Blur then unblur any element. Class disappears, visual blur gone. |
| 11 | clears --pb-radius custom property | Blur with custom radius, unblur. `--pb-radius` gone from styles. |
| 12 | removes canvas overlay from DOM for video | Blur a video (canvas appears), unblur — canvas removed from DOM. |
| 13 | cancels rAF loop on video removeBlur | Blur+unblur video. Performance panel shows RAF callbacks stop. |
| 14 | does not throw on null element | `PrivacyBlurEngine.removeBlur(null)` — no error. |
| 15 | does not throw on non-blurred element | `PrivacyBlurEngine.removeBlur(anyCleanElement)` — no error, no change. |

### toggleBlur (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 16 | applies blur when element is not blurred | `toggleBlur(el, 8)` on clean element — becomes blurred. |
| 17 | removes blur when element is already blurred | Blur first, then `toggleBlur` — blur removed. |
| 18 | second toggle re-applies blur | Toggle 3 times. Final state: blurred (on/off/on). |

### isBlurred (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 19 | returns false for unblurred element | `PrivacyBlurEngine.isBlurred(anyCleanElement)` — `false`. |
| 20 | returns true for blurred element | Blur element, check `isBlurred(el)` — `true`. |
| 21 | returns false after blur removed | Blur, unblur, check — `false`. |
| 22 | returns false for null | `PrivacyBlurEngine.isBlurred(null)` — `false`, no error. |

### blurAllContent (5 tests)

| # | Test | Manual Replication |
|---|---|---|
| 23 | blurs all img elements | On image-heavy page, `blurAllContent(8)`. All images blur. |
| 24 | blurs all p elements | Same on text-heavy page. All paragraphs blur. |
| 25 | blurs all heading elements h1-h6 | All headings on page blur. |
| 26 | blurs video elements | HTML5 video gets canvas overlay. |
| 27 | does not throw on empty DOM | `about:blank`, `blurAllContent(8)` — no error. |

### unblurAll (5 tests)

| # | Test | Manual Replication |
|---|---|---|
| 28 | removes blur from all blurred elements | Blur several elements, `unblurAll()`. All return to normal. |
| 29 | does not affect non-blurred elements | Note unblurred element state, `unblurAll()`, verify unchanged. |
| 30 | does not throw on empty DOM | `about:blank`, `unblurAll()` — no error. |
| 31 | cleans up orphaned canvas overlays | Manually insert `<canvas class="pb-canvas-overlay">`, `unblurAll()` — canvas removed. |
| 32 | cleans up orphaned text-node wrappers | Insert `<span class="pb-text-node-wrapper">text</span>`, `unblurAll()` — span replaced by text. |

### Text content handling (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 33 | wraps bare text nodes in span | Find `<div>` with only text, blur it. DOM shows text inside `<span class="pb-text-node-wrapper">`. |
| 34 | unwraps text nodes when removing blur | Blur then unblur text div. Wrapper disappears, text restored. |
| 35 | does not wrap whitespace-only text nodes | Create `<div>   </div>`, blur — no wrapper appears. |

### Background-image elements (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 36 | applies blur class to elements with background-image | Find div with CSS `background-image` (hero banner), blur. Class `pb-blurred` applied. |
| 37 | does not apply direct style.filter on background-image elements | Same element — `style.filter` should NOT be set inline. Blur via CSS class only. |

### Video blur edge cases (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 38 | handles detached video gracefully | `let v = document.createElement('video'); PrivacyBlurEngine.applyBlur(v, 8)` — no throw, class added. |
| 39 | no duplicate canvases on re-apply | Blur a video, count `.pb-canvas-overlay` — should be 1. |
| 40 | removeBlur on img clears inline filter | Blur img (filter visible), unblur — `style.filter` cleared. |

### blurAllContent advanced (5 tests)

| # | Test | Manual Replication |
|---|---|---|
| 41 | blurs span elements with text | `blurAllContent()` — text-containing spans blur. |
| 42 | blurs link elements with text | Text links blur. |
| 43 | blurs button elements with text | Buttons with text labels blur. |
| 44 | does not double-blur already blurred elements | Blur one element individually, then `blurAllContent()` — no double-processing. |
| 45 | blurs canvas elements | Chart canvases get blur class. |

### toggleBlur edge cases (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 46 | does not throw on null | `PrivacyBlurEngine.toggleBlur(null)` — no error. |
| 47 | does not throw on non-Element | `PrivacyBlurEngine.toggleBlur('hello')` — no error. |
| 48 | uses custom radius when toggling on | `toggleBlur(el, 15)` — check `--pb-radius: 15px`. |

---

## 2. picker.test.js (30 tests)

### activate (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | adds pb-picker-active class to html | Press Alt+Shift+P. Crosshair cursor appears. `<html>` has `pb-picker-active`. |
| 2 | creates toolbar element in DOM | Toolbar appears at top with "Click to blur" instructions. `#pb-picker-toolbar` in DOM. |
| 3 | calling activate twice is safe | Press Alt+Shift+P twice. Only one toolbar exists. |

### hover highlight (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 4 | adds pb-hover-highlight on mouseover | Activate picker, hover over a paragraph. Outline highlight appears. |
| 5 | removes pb-hover-highlight on mouseout | Move mouse away from element. Highlight disappears. |
| 6 | does not throw if target is null on mouseover | Edge case — cursor enters from outside viewport. No crash. |

### click (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 7 | calls onBlur when element is not blurred | Click any unblurred element in picker mode. Element gets blurred. |
| 8 | calls onUnblur when element has pb-blurred | Click a blurred element in picker mode. Blur removed (toggle). |
| 9 | click prevents default event | Click a link in picker mode. Page does NOT navigate. |
| 10 | click stops event propagation | Click a button with page handlers. Button blurred, handler does not fire. |

### Escape key (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 11 | pressing Escape deactivates picker | Press Escape during picker mode. Crosshair gone, toolbar removed. |
| 12 | pressing Escape triggers onDeactivate callback | Content script updates `isPickerActive = false`. |

### deactivate (5 tests)

| # | Test | Manual Replication |
|---|---|---|
| 13 | removes pb-picker-active class | Deactivate picker. Normal cursor restored. |
| 14 | removes toolbar from DOM | Toolbar disappears from page. |
| 15 | calls onDeactivate callback | Content script notified of deactivation. |
| 16 | no blur/unblur after deactivation | Click elements after deactivating. No blur occurs — normal page interaction. |
| 17 | deactivate when not active does not throw | Defensive call succeeds silently. |

### setSettings (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 18 | updates blurRadius property | Change blur radius in popup while picker active. Subsequent clicks use new radius. |
| 19 | setSettings before activate does not throw | Settings can be configured before picker starts. |
| 20 | partial settings update preserves existing | Change only blur radius. Highlight color unchanged. |

### isActive (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 21 | returns false before activation | Before any action, picker is inactive. |
| 22 | returns true after activation | After Alt+Shift+P, picker is active. |
| 23 | returns false after deactivation | After Escape, picker is inactive again. |
| 24 | returns false after Escape deactivation | Same as 23, specifically Escape-triggered. |

### hover highlight cleanup (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 25 | removes all hover highlights on deactivation | Hover quickly over elements, press Escape. No stale highlights remain. |
| 26 | hover highlight switches between elements | Hover A (highlighted), move to B. B highlighted, A not. |

### toolbar (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 27 | toolbar has correct ID and class | Inspect toolbar: `id="pb-picker-toolbar"`, `class="pb-toolbar"`. |
| 28 | toolbar removed on Escape | Press Escape. Toolbar gone from DOM. |

### click boundary conditions (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 29 | clicking with no callbacks does not throw | Defensive edge case — no crash on malformed callbacks. |
| 30 | does not highlight html or body on mouseover | Move mouse to empty page area. No full-page highlight. |

---

## 3. shortcut_handler.test.js (19 tests)

### multi-key shortcut detection (6 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | fires TOGGLE_BLUR_ALL when Alt+Shift+B pressed | Hold Alt+Shift+B simultaneously. All elements blur. |
| 2 | fires TOGGLE_PICKER when Alt+Shift+P pressed | Hold Alt+Shift+P. Picker activates with crosshair cursor. |
| 3 | fires CLEAR_ALL when Alt+Shift+U pressed | Hold Alt+Shift+U. All blur removed. |
| 4 | does NOT fire when wrong modifier side is held | Hold right-Alt instead of left-Alt with Shift+B. No action fires. |
| 5 | does NOT fire when primary modifier is not held | Press Shift+B without Alt. No action fires. |
| 6 | does NOT fire when not all keys are held | Press Alt+B without Shift. No action fires. |

### callback routing (1 test)

| # | Test | Manual Replication |
|---|---|---|
| 7 | different shortcuts fire different callbacks | Alt+Shift+B fires blur-all, Alt+Shift+P fires picker, Alt+Shift+U fires clear. Each triggers its own callback. |

### Escape key (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 8 | Escape fires onExitPicker when picker active | Activate picker (Alt+Shift+P), press Escape. Picker deactivates. |
| 9 | does NOT fire onExitPicker when picker inactive | Press Escape on any page without picker. No extension effect. |

### early-exit guards (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 10 | ignores repeated keydown events | Hold Alt+Shift+B. Only fires once, repeated keydowns ignored. |
| 11 | ignores events during IME composition | Use CJK input method, press Alt+Shift+B during composition. Extension ignores it. |
| 12 | ignores Dead key events | Use European keyboard, press accent dead key. Extension ignores it. |
| 13 | ignores AltGraph events | On German QWERTZ keyboard, press AltGr+B. Extension ignores it. |

### destroy and re-init (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 14 | removes listeners so shortcuts stop firing | After destroy, Alt+Shift+B no longer triggers blur-all. |
| 15 | re-calling init replaces previous listener | Change settings in popup. New settings take effect immediately, old listener removed. |

### init edge cases (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 16 | supports single modifier + single key | Configure shortcut with one modifier and one key. Fires correctly. |
| 17 | supports MetaLeft as primary modifier | On macOS, set modifier to Command. Cmd+Shift+B triggers. |
| 18 | handles empty shortcuts object gracefully | Corrupted/empty shortcuts silently disable all shortcuts. No crash. |
| 19 | handles null shortcuts gracefully | Null shortcuts input does not throw. Shortcuts disabled. |

---

## 4. selector_utils.test.js (35 tests)

### getSelector (8 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | returns #id when element has unique ID | `PrivacyBlurSelectorUtils.getSelector(document.querySelector('#content'))` — returns `'#content'`. |
| 2 | no ID selector for duplicate IDs | Inject two elements with same ID. `getSelector` returns `[data-pb-id="..."]` instead. |
| 3 | stamps data-pb-id on ID-less element | Pick any ID-less element, call `getSelector`. Element gets `data-pb-id` attribute in DOM. |
| 4 | returns data-pb-id attribute selector | Same — returned string matches `[data-pb-id="..."]` format. |
| 5 | reuses existing data-pb-id on repeat calls | Call `getSelector` twice on same element. Same selector both times. |
| 6 | returns null for body element | `getSelector(document.body)` — `null`. |
| 7 | returns null for null input | `getSelector(null)` — `null`. |
| 8 | generated selector round-trips via querySelector | Get selector, use it with `document.querySelector()`. Returns same element. |

### generateId (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 9 | returns 8-character string | `PrivacyBlurSelectorUtils.generateId()` — 8 chars. |
| 10 | returns hex string (0-9, a-f) | Output matches `/^[0-9a-f]{8}$/`. |
| 11 | returns unique values on repeated calls | Generate 50 IDs in a Set — nearly all unique. |

### restoreSelector (6 tests)

| # | Test | Manual Replication |
|---|---|---|
| 12 | returns element for valid selector | `restoreSelector('#some-real-id')` — returns the element. |
| 13 | returns null for stale selector | `restoreSelector('#nonexistent')` — `null`. |
| 14 | returns null for invalid CSS selector | `restoreSelector('##bad!!!')` — `null`, no error. |
| 15 | returns null for null input | `restoreSelector(null)` — `null`. |
| 16 | returns null for empty string | `restoreSelector('')` — `null`. |
| 17 | returns element by data-pb-id selector | Create element with `data-pb-id="abc12345"`, restore — found. |

### restoreAllSelectors (6 tests)

| # | Test | Manual Replication |
|---|---|---|
| 18 | filters out stale selectors | Mix of valid/stale selectors — only valid ones returned. |
| 19 | all stale returns empty array | All selectors point to removed elements — `[]`. |
| 20 | empty array returns empty array | `restoreAllSelectors([])` — `[]`. |
| 21 | invalid selector in array does not throw | `restoreAllSelectors(['##bad'])` — no error, returns `[]`. |
| 22 | non-array input returns empty array | `restoreAllSelectors(null)` — `[]`. |
| 23 | all valid returns all elements | 3 elements by ID — all 3 returned. |

### getSelector edge cases (7 tests)

| # | Test | Manual Replication |
|---|---|---|
| 24 | returns null for documentElement | `getSelector(document.documentElement)` — `null`. |
| 25 | returns null for undefined | `getSelector(undefined)` — `null`. |
| 26 | handles special characters in ID | Element with `id="my:special.id"` — CSS-escaped selector works. |
| 27 | handles numeric-starting ID | Element with `id="123numeric"` — CSS-escaped selector works. |
| 28 | whitespace-only ID falls back to data-pb-id | `id="   "` treated as absent. Uses `data-pb-id`. |
| 29 | does not re-stamp existing data-pb-id | Pre-set `data-pb-id`, call `getSelector` — value unchanged. |
| 30 | different elements get different IDs | Two elements get different `data-pb-id` values. |

### restoreSelector edge cases (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 31 | returns null for undefined | `restoreSelector(undefined)` — `null`. |
| 32 | returns null for numeric input | `restoreSelector(42)` — `null`. |
| 33 | handles complex selectors | `.container > .text` — works with `querySelector`. |

### generateId robustness (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 34 | 100 IDs all match hex format | Stress test — all 100 match `/^[0-9a-f]{8}$/`. |
| 35 | high uniqueness over 500 generations | Set of 500 IDs has >= 495 unique entries. |

---

## 5. storage_manager.test.js (33 tests)

### saveBlurredElement (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | sends SAVE_SELECTOR message | Open background worker DevTools, blur an element. Confirm `SAVE_SELECTOR` message with correct hostname/selector. |
| 2 | resolves with background response | Blur succeeds — no console errors. |

### removeBlurredElement (1 test)

| # | Test | Manual Replication |
|---|---|---|
| 3 | sends REMOVE_SELECTOR message | Unblur an element, monitor background logs for `REMOVE_SELECTOR`. |

### getBlurredSelectors (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 4 | resolves with selectors array | Blur elements, reload page. `getBlurredSelectors(location.hostname)` returns saved selectors. |
| 5 | empty response yields empty array | Visit a page with no blurred elements. Returns `[]`. |
| 6 | sends correct hostname | Navigate to a page, monitor messages. Hostname matches `location.hostname`. |
| 7 | null response yields empty array | Robustness against null background response. |

### clearHost (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 8 | sends CLEAR_HOST with hostname | Use popup "Clear this site" button. Monitor background for `CLEAR_HOST`. |
| 9 | does not send CLEAR_ALL accidentally | Only `CLEAR_HOST` appears in logs, not `CLEAR_ALL`. |

### clearAll (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 10 | sends CLEAR_ALL message | Use popup "Clear all sites" button. Monitor background for `CLEAR_ALL`. |
| 11 | no hostname in CLEAR_ALL | Message payload has no hostname field. |

### getSettings (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 12 | returns merged defaults when storage empty | Clear extension storage. `getSettings()` returns all default values. |
| 13 | stored values override defaults | Save custom settings via popup. `getSettings()` reflects overrides. |
| 14 | fills missing keys with defaults | Only change blur radius. Other settings remain at defaults. |

### saveSettings (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 15 | sends partial settings to background | Change one setting. Only that partial is in the `SAVE_SETTINGS` message. |
| 16 | sends SAVE_SETTINGS message type | Confirm message type in logs. |

### error handling (5 tests)

| # | Test | Manual Replication |
|---|---|---|
| 17 | rejects on lastError | Disable/reload extension while page open. Blur attempt produces error. |
| 18 | getBlurredSelectors handles error | Same scenario during page load. |
| 19 | rejects on synchronous throw | Extension fully unloaded. Stale content script gets rejection. |
| 20 | clearAll rejects on lastError | Background suspended during clearAll. |
| 21 | clearHost rejects on lastError | Background suspended during clearHost. |

### guard clauses (7 tests)

| # | Test | Manual Replication |
|---|---|---|
| 22 | saveBlurredElement early return for empty hostname | Programmatic guard — `sendMessage` never called with empty hostname. |
| 23 | saveBlurredElement early return for empty selector | Same — empty selector blocked. |
| 24 | removeBlurredElement early return for empty hostname | Same pattern. |
| 25 | getBlurredSelectors returns [] for empty hostname | Returns `[]` without messaging background. |
| 26 | clearHost early return for empty hostname | Same pattern. |
| 27 | saveSettings early return for null | Null input blocked. |
| 28 | saveSettings early return for non-object | String input blocked. |

### DEFAULT_SETTINGS (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 29 | exposes DEFAULT_SETTINGS publicly | DevTools: `PrivacyBlurStorage.DEFAULT_SETTINGS` is defined. |
| 30 | contains expected keys | Object has `blurRadius`, `highlightColor`, `transitionDuration`, `revealOnHover`, `enabled`. |
| 31 | contains shortcuts sub-object | `DEFAULT_SETTINGS.shortcuts` has `chordKey1`, `chordKey2`, `chordModifier`. |

### getSettings merging (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 32 | returns complete object for null response | Clear all storage. Defaults still returned. |
| 33 | stored values override defaults | Save overrides, confirm merge precedence. |

---

## Category-Based Blur Tests (blur_engine.test.js)

Tests added for the category-aware `blurAllContent(radius, options)` API.

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 1 | blurs only media elements when only media category enabled | img blurred, p and input not | Set up DOM with img+p+input, call blurAllContent with only media ON, check classes |
| 2 | blurs only text elements when only text category enabled | p blurred, img and input not | Set up DOM with p+img+input, call with only text ON |
| 3 | blurs form elements when form category enabled | input, textarea, select all blurred | Set up form elements, call with only form ON |
| 4 | does not blur form elements when form category off | input not blurred, p blurred | Default-like categories (form OFF), verify input skipped |
| 5 | blurs table cells when table category enabled | td blurred | Table with td, call with only table ON |
| 6 | blurs structure elements with text when structure enabled | div with text blurred | Div with bare text, call with only structure ON |
| 7 | does not blur empty structure elements | div without direct text not blurred | Div with only span child, call with structure ON |
| 8 | backward compatible: no options defaults to all categories on | p and img blurred | Call blurAllContent(8) with no second arg |
| 9 | backward compatible: empty options defaults to all categories on | p and img blurred | Call blurAllContent(8, {}) |
| 10 | does not throw when all categories off | no elements blurred, no throw | Call with all categories false |
| 11 | text-check elements only blurred with meaningful text | span with text blurred, empty span not | Three spans: text, empty, whitespace-only |
| 12 | new text elements (strong, em, code) blurred when text on | all three blurred | strong+em+code with text, text category ON |
| 13 | button is in form category, not structure | button not blurred by structure, blurred by form | Test with structure-only then form-only |
| 14 | invalidateSelectorCache causes rebuild | form ON then OFF produces different results | Blur with form ON, invalidate, blur with form OFF |
| 15 | matchesActiveCategories true for img when media on | returns true | Create img, call with media ON |
| 16 | matchesActiveCategories false for img when media off | returns false | Create img, call with media OFF |
| 17 | matchesActiveCategories false for unknown tags | returns false | Create custom-widget, call with all ON |
| 18 | matchesActiveCategories false for null | returns false | Call with null element |
| 19 | matchesActiveCategories defaults to all categories | returns true for p | Call without categories arg |
| 20 | CATEGORY_SELECTORS is frozen | Object.isFrozen returns true | Check frozen state |
| 21 | CATEGORY_SELECTORS has 5 categories | exactly 5 keys | Check key count |
| 22 | each category has alwaysBlur and textCheck arrays | both are arrays | Iterate and check |

## Category Constants Tests (constants.test.js)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 1 | DEFAULTS.BLUR_CATEGORIES exists and is frozen | defined and frozen | Check Object.isFrozen |
| 2 | has correct default values | text:true, media:true, form:false, table:true, structure:true | Compare each key |
| 3 | has exactly 5 keys | length is 5 | Check Object.keys length |

## Category Storage Tests (storage_manager.test.js)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 1 | returns blurCategories merged with defaults | partial override preserved, defaults kept | Mock response with {form:true}, check all 5 keys |
| 2 | returns default blurCategories when none saved | all defaults present | Mock response with {}, check defaults |

## Category E2E Test (mutation_loop.spec.js)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 1 | MutationObserver respects categories: form elements not blurred when form OFF | injected input/textarea not blurred, injected p blurred | Activate blur-all with default categories, inject input+textarea+p via console, check classes |

---

## Known Test Quality Issues

| File | Test | Issue |
|---|---|---|
| blur_engine | #9 (applyBlur idempotent) | Weak — `classList.add` is inherently idempotent. Would pass without the `isBlurred` guard. |
| blur_engine | #36-37 (background-image) | jsdom may not detect inline `backgroundImage` via `getComputedStyle`, taking generic path instead. Test passes but may not exercise the intended branch. |
| blur_engine | #39 (video no duplicate canvases) | Misleading name — only calls `applyBlur` once, never tests re-apply. |
| blur_engine | #40 (img filter clear) | Misplaced in "video blur edge cases" describe block. |
| picker | #6 (null target mouseover) | Name says "null" but tests Document target (non-Element). |
| picker | #20 (partial settings) | Claims to test partial merge but only asserts onBlur fires. |
| picker | #26 (highlight switches) | Does not verify el1 loses highlight when el2 gains it. |
| selector_utils | #16 (empty string) | Overly permissive assertion (`== null || instanceof Element`). Should be `toBeNull()`. |
| storage_manager | #15-16, 22-31 | 12 tests are incompatible with the `buildStubSource()` stub. Stub does not match real source contract. |
