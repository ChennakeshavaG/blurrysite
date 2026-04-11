# Blurry Site — Test Validation & Manual Replication Guide

**267 unit tests across 8 test files.** Last updated 2026-04-11 after the content_script slim refactor.

New test files added in the 2026-04-11 refactor:

## N1. url_matcher.test.js (20 tests) — `tests/unit/url_matcher.test.js`

Covers the extracted `blsi.UrlMatcher`:

| Group | Cases | Manual replication |
|---|---|---|
| Wildcard hostname | exact, subdomain, domain-boundary attack (`notexample.com`), `*.example.com` root-skip | DevTools on any page: `blsi.UrlMatcher.matchesPattern(location.href, 'example.com', 'wildcard')` — expect `true` only on example.com + subdomains |
| Scheme + port + path | scheme restriction, `:8080` port, `/app*` prefix wildcard, trailing-slash tolerance, default port normalization | `matchesPattern('https://example.com:8080/app/home', 'example.com:8080/app*', 'wildcard')` → `true` |
| Regex mode | valid pattern, case insensitivity, ReDoS guard (`(a+)+`, `a**`), invalid regex fallback | `matchesPattern('https://example.com/', '(a+)+', 'regex')` → `false` (not a timeout) |
| MAX_PATTERN_LENGTH | 501-char pattern rejected | `matchesPattern(url, 'a'.repeat(501), 'wildcard')` → `false` |
| resolveSettings | deep merge, first-match-wins, non-matching fall-through, null rules tolerated | Create two rules with same pattern, different `BLUR_RADIUS`. Open a matching page. Popup "Current page" shows the FIRST rule's radius |

## N2. reveal_controller.test.js (12 tests) — `tests/unit/reveal_controller.test.js`

Covers the extracted `blsi.Reveal`:

| Group | Cases | Manual replication |
|---|---|---|
| Click mode | reveal on click, second click on same element keeps reveal (link pass-through), first click calls preventDefault, second click does NOT preventDefault, dismiss on Escape, input/textarea skip, picker-active block, mode=none disables | Popup: set REVEAL_MODE=click. Blur an `<a href>`, click it → unblurs but does NOT navigate. Click it again → navigates to the link. Press Escape after first click → re-blurs without navigating. Click a form `<input>` that is blurred → stays blurred |
| Hover mode | reveal on mouseover, 50ms mouseout debounce | Set REVEAL_MODE=hover. Mouseover blurred element → reveals. Move away → stays revealed ~50ms then hides |
| Lifecycle | clearAll wipes reveal state, destroy removes listeners | Toggle reveal mode in popup — any active reveal snaps back |

## N3. blur_engine.test.js — 18 new tests for folded-in controller APIs

Added under `applyItem / removeItem`, `counters`, `enableBlurAll / disableBlurAll / refreshBlurAll`. Covers:

- Dynamic item apply/remove via selector, sticky item zone creation + path-mismatch skip, null-item no-op.
- `allocateDynamicName` / `allocateStickyName` increment + `resetCounters` zeroes both.
- `applyItem` seeds counters from item name (high-water mark) so session counters never collide with persisted names.
- `enableBlurAll` injects rules + sets `isPageBlurred=true`; `disableBlurAll` removes rules + clears state; `refreshBlurAll` is a no-op when inactive and re-renders when active.
- `_setPickerActiveForObserver` is exposed as a public method (MutationObserver gate).

**Manual replication for folded APIs:** Load the extension, Alt+Shift+B to enable blur-all, then `blsi.BlurEngine.isPageBlurred` in DevTools → `true`. Alt+Shift+B again → `false`. Blur a specific element via the picker, then Alt+Shift+B twice — the picker item survives the blur-all toggle.

---

## 1. blur_engine.test.js (60 tests)

### applyBlur (9 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | adds bl-si-blurred class to element | DevTools console: `PrivacyBlurEngine.applyBlur(document.querySelector('div'), 8)`. Inspect element — `bl-si-blurred` class present. |
| 2 | sets --bl-si-radius CSS custom property | Same as above with radius 12. Styles pane shows `--bl-si-radius: 12px` inline. |
| 3 | uses default radius of 8px when not specified | `PrivacyBlurEngine.applyBlur(el)` — no second arg. Check `--bl-si-radius: 8px`. |
| 4 | applies CSS filter directly on img elements | Select an `<img>`, apply blur with radius 10. Image appears blurred. Elements panel shows `style="filter: blur(10px)"`. |
| 5 | creates canvas overlay for video elements | Find an HTML5 `<video>`, apply blur. A `<canvas class="bl-si-canvas-overlay">` appears as sibling in DOM. |
| 6 | starts RAF animation loop for video elements | Blur a playing video. Performance panel shows continuous animation frame callbacks. Canvas updates with video frames. |
| 7 | does not throw on null element | `PrivacyBlurEngine.applyBlur(null)` — no error in console. |
| 8 | does not throw on element not in DOM | `let d = document.createElement('div'); PrivacyBlurEngine.applyBlur(d, 8)` — no error. |
| 9 | calling applyBlur twice is idempotent | Blur same element twice. Only one `bl-si-blurred` class, no duplicate side effects. |

### removeBlur (6 tests)

| # | Test | Manual Replication |
|---|---|---|
| 10 | removes bl-si-blurred class | Blur then unblur any element. Class disappears, visual blur gone. |
| 11 | clears --bl-si-radius custom property | Blur with custom radius, unblur. `--bl-si-radius` gone from styles. |
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
| 31 | cleans up orphaned canvas overlays | Manually insert `<canvas class="bl-si-canvas-overlay">`, `unblurAll()` — canvas removed. |
| 32 | cleans up orphaned text-node wrappers | Insert `<span class="bl-si-text-node-wrapper">text</span>`, `unblurAll()` — span replaced by text. |

### Text content handling (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 33 | wraps bare text nodes in span | Find `<div>` with only text, blur it. DOM shows text inside `<span class="bl-si-text-node-wrapper">`. |
| 34 | unwraps text nodes when removing blur | Blur then unblur text div. Wrapper disappears, text restored. |
| 35 | does not wrap whitespace-only text nodes | Create `<div>   </div>`, blur — no wrapper appears. |

### Background-image elements (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 36 | applies blur class to elements with background-image | Find div with CSS `background-image` (hero banner), blur. Class `bl-si-blurred` applied. |
| 37 | does not apply direct style.filter on background-image elements | Same element — `style.filter` should NOT be set inline. Blur via CSS class only. |

### Video blur edge cases (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 38 | handles detached video gracefully | `let v = document.createElement('video'); PrivacyBlurEngine.applyBlur(v, 8)` — no throw, class added. |
| 39 | no duplicate canvases on re-apply | Blur a video, count `.bl-si-canvas-overlay` — should be 1. |
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
| 48 | uses custom radius when toggling on | `toggleBlur(el, 15)` — check `--bl-si-radius: 15px`. |

### Zone overlay engine (12 tests)

| # | Test | Manual Replication |
|---|---|---|
| 49 | createZoneOverlay injects overlay div into document.body | Call `PrivacyBlurEngine.createZoneOverlay({id:'z1', x:10, y:20, width:100, height:50})`. Inspect DOM — `document.body` has a child with `data-bl-si-zone="z1"`. |
| 50 | createZoneOverlay sets position styles from coordinates | Same as above. Inspect styles — `position:fixed`, `left:10px`, `top:20px`, `width:100px`, `height:50px`. |
| 51 | createZoneOverlay overlay has bl-si-zone-overlay class | Same overlay. Element has `class="bl-si-zone-overlay"`. |
| 52 | createZoneOverlay returns null for missing id | `createZoneOverlay({x:0, y:0, width:10, height:10})` — returns `null`. |
| 53 | createZoneOverlay replaces existing overlay with same id | Create overlay with id `z1`, then create another with same id. Only one `[data-bl-si-zone="z1"]` in DOM. |
| 54 | removeZoneOverlay removes overlay from DOM and tracking | Create overlay `z1`, call `removeZoneOverlay('z1')`. No `[data-bl-si-zone="z1"]` in DOM. `getZoneOverlays()` returns empty. |
| 55 | removeZoneOverlay no-op for unknown id | `removeZoneOverlay('nonexistent')` — no error, no DOM change. |
| 56 | getZoneOverlays returns all active overlays | Create 3 overlays. `getZoneOverlays().length === 3`. |
| 57 | getZoneOverlays returns empty array when none exist | No overlays created. `getZoneOverlays()` returns `[]`. |
| 58 | removeAllZoneOverlays removes all overlays | Create 3 overlays, call `removeAllZoneOverlays()`. `getZoneOverlays()` returns `[]`, no overlay elements in DOM. |
| 59 | unblurAll removes zone overlays along with data-bl-si-blur elements | Blur elements and create zone overlays. `unblurAll()`. Both blurred elements and zone overlays removed. |
| 60 | _isExtensionUI excludes zones: zone overlay not treated as blur target | Create zone overlay, call `blurAllContent()`. Zone overlay does not get `bl-si-blurred` class. |

---

## 2. picker.test.js (30 tests)

### activate (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | adds bl-si-picker-active class to html | Press Alt+Shift+P. Crosshair cursor appears. `<html>` has `bl-si-picker-active`. |
| 2 | creates toolbar element in DOM | Toolbar appears at top with "Click to blur" instructions. `#bl-si-picker-toolbar` in DOM. |
| 3 | calling activate twice is safe | Press Alt+Shift+P twice. Only one toolbar exists. |

### hover highlight (3 tests)

| # | Test | Manual Replication |
|---|---|---|
| 4 | adds bl-si-hover-highlight on mouseover | Activate picker, hover over a paragraph. Outline highlight appears. |
| 5 | removes bl-si-hover-highlight on mouseout | Move mouse away from element. Highlight disappears. |
| 6 | does not throw if target is null on mouseover | Edge case — cursor enters from outside viewport. No crash. |

### click (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 7 | calls onBlur when element is not blurred | Click any unblurred element in picker mode. Element gets blurred. |
| 8 | calls onUnblur when element has bl-si-blurred | Click a blurred element in picker mode. Blur removed (toggle). |
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
| 13 | removes bl-si-picker-active class | Deactivate picker. Normal cursor restored. |
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
| 27 | toolbar has correct ID and class | Inspect toolbar: `id="bl-si-picker-toolbar"`, `class="bl-si-toolbar"`. |
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
| 2 | no ID selector for duplicate IDs | Inject two elements with same ID. `getSelector` returns `[data-bl-si-id="..."]` instead. |
| 3 | stamps data-bl-si-id on ID-less element | Pick any ID-less element, call `getSelector`. Element gets `data-bl-si-id` attribute in DOM. |
| 4 | returns data-bl-si-id attribute selector | Same — returned string matches `[data-bl-si-id="..."]` format. |
| 5 | reuses existing data-bl-si-id on repeat calls | Call `getSelector` twice on same element. Same selector both times. |
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
| 17 | returns element by data-bl-si-id selector | Create element with `data-bl-si-id="abc12345"`, restore — found. |

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
| 28 | whitespace-only ID falls back to data-bl-si-id | `id="   "` treated as absent. Uses `data-bl-si-id`. |
| 29 | does not re-stamp existing data-bl-si-id | Pre-set `data-bl-si-id`, call `getSelector` — value unchanged. |
| 30 | different elements get different IDs | Two elements get different `data-bl-si-id` values. |

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

### saveBlurItem (2 tests)

| # | Test | Manual Replication |
|---|---|---|
| 1 | sends SAVE_BLUR_ITEM message with hostname and item | Open background worker DevTools, blur an element. Confirm `SAVE_BLUR_ITEM` message with correct hostname/item. |
| 2 | resolves with the response from background | Blur succeeds — no console errors. |

### removeBlurItem (1 test)

| # | Test | Manual Replication |
|---|---|---|
| 3 | sends REMOVE_BLUR_ITEM message with correct payload | Unblur an element, monitor background logs for `REMOVE_BLUR_ITEM`. |

### getBlurItems (4 tests)

| # | Test | Manual Replication |
|---|---|---|
| 4 | resolves with items array from background response | Blur elements, reload page. `getBlurItems(location.hostname)` returns saved items. |
| 5 | resolves with empty array when background returns no items | Visit a page with no blurred elements. Returns `[]`. |
| 6 | sends GET_BLUR_ITEMS message with correct hostname | Navigate to a page, monitor messages. Hostname matches `location.hostname`. |
| 7 | resolves with empty array when response is null | Robustness against null background response. |

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
| 17 | rejects when sendMessage triggers lastError | Disable/reload extension while page open. `saveBlurItem` attempt produces error. |
| 18 | getBlurItems handles sendMessage error gracefully by rejecting | Same scenario during page load. |
| 19 | rejects when sendMessage throws synchronously | Extension fully unloaded. Stale content script `saveBlurItem` gets rejection. |
| 20 | clearAll rejects on lastError | Background suspended during clearAll. |
| 21 | clearHost rejects on lastError | Background suspended during clearHost. |

### guard clauses (7 tests)

| # | Test | Manual Replication |
|---|---|---|
| 22 | saveBlurItem returns early for empty hostname | Programmatic guard — `sendMessage` never called with empty hostname. |
| 23 | saveBlurItem returns early for null item | Same — null item blocked. |
| 24 | removeBlurItem returns early for empty hostname | Same pattern. |
| 25 | getBlurItems returns empty array for empty hostname | Returns `[]` without messaging background. |
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

## Constants Tests (constants.test.js)

### Message type categories (3 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 1 | exposes all storage message types | `GET_BLUR_ITEMS`, `SAVE_BLUR_ITEM`, `REMOVE_BLUR_ITEM`, `CLEAR_HOST`, `CLEAR_ALL`, `GET_SETTINGS`, `SAVE_SETTINGS`, `GET_RULES`, `SAVE_RULES` | `blsi.STORAGE.SAVE_BLUR_ITEM === 'SAVE_BLUR_ITEM'` in DevTools |
| 2 | exposes all command message types | `TOGGLE_BLUR_ALL`, `TOGGLE_PICKER`, `CLEAR_ALL_BLUR`, `RESTORE`, `CONTEXT_BLUR`, `CONTEXT_UNBLUR` | `blsi.COMMAND.TOGGLE_BLUR_ALL` in DevTools |
| 3 | exposes all popup message types | `UPDATE_SETTINGS`, `GET_STATUS`, `UNBLUR_ITEM` | `blsi.POPUP.UNBLUR_ITEM === 'UNBLUR_ITEM'` in DevTools |

### Flat shorthand access (1 test)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 4 | all message types accessible at top level | `blsi.SAVE_BLUR_ITEM === 'SAVE_BLUR_ITEM'`, plus command and popup types | `blsi.SAVE_BLUR_ITEM` in DevTools |

### isValid (3 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 5 | returns true for known message types | `isValid('GET_BLUR_ITEMS')` etc. return `true` | `blsi.isValid('GET_BLUR_ITEMS')` in DevTools |
| 6 | returns false for unknown strings | `isValid('UNKNOWN_TYPE')` returns `false` | `blsi.isValid('FOO')` in DevTools |
| 7 | returns false for non-string input | `isValid(null)`, `isValid(42)` return `false` | `blsi.isValid(null)` in DevTools |

### categoryOf (4 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 8 | returns correct category for storage types | `categoryOf('SAVE_BLUR_ITEM')` returns `'STORAGE'` | `blsi.categoryOf('SAVE_BLUR_ITEM')` in DevTools |
| 9 | returns correct category for command types | `categoryOf('TOGGLE_BLUR_ALL')` returns `'COMMAND'` | `blsi.categoryOf('TOGGLE_BLUR_ALL')` in DevTools |
| 10 | returns correct category for popup types | `categoryOf('UPDATE_SETTINGS')` returns `'POPUP'` | `blsi.categoryOf('UPDATE_SETTINGS')` in DevTools |
| 11 | returns null for unknown types | `categoryOf('UNKNOWN')` returns `null` | `blsi.categoryOf('FOO')` in DevTools |

### DEFAULT_SETTINGS (4 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 12 | contains all expected top-level keys | BLUR_RADIUS=10, TRANSITION_DURATION=200, etc. | `blsi.DEFAULT_SETTINGS` in DevTools |
| 13 | is frozen (immutable) | `Object.isFrozen` returns `true` | `Object.isFrozen(blsi.DEFAULT_SETTINGS)` in DevTools |
| 14 | SHORTCUTS is frozen with 3 actions | 3 keys, all defined | Check `Object.keys(blsi.DEFAULT_SETTINGS.SHORTCUTS).length` |
| 15 | each shortcut has primaryModifier and keys array | all shortcuts have required shape | Inspect each shortcut object |

### DEFAULT_SETTINGS.BLUR_CATEGORIES (3 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 16 | DEFAULTS.BLUR_CATEGORIES exists and is frozen | defined and frozen | Check Object.isFrozen |
| 17 | has correct default values | text:true, media:true, form:false, table:true, structure:true | Compare each key |
| 18 | has exactly 5 keys | length is 5 | Check Object.keys length |

### buildDefaultSettings (2 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 19 | returns a mutable deep clone | clone can be modified without affecting original | Modify clone, check original unchanged |
| 20 | nested objects are also cloned | modifying nested clone does not affect frozen original | Change BLUR_CATEGORIES.FORM on clone |

### deepMerge (4 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 21 | merges flat keys | `{A:1,B:2}` + `{B:3}` = `{A:1,B:3}` | `blsi.deepMerge({A:1},{A:2})` in DevTools |
| 22 | merges nested objects | nested override replaces inner key only | Test with nested objects |
| 23 | blocks prototype pollution keys | `__proto__` and `constructor` ignored | Attempt pollution, verify safe |
| 24 | does not mutate base | frozen base survives merge | Merge over frozen object |

### validateSettings (8 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 25 | returns full defaults for null input | null yields complete defaults | `blsi.validateSettings(null)` in DevTools |
| 26 | preserves valid values | custom values kept | Pass valid overrides, check preserved |
| 27 | replaces out-of-range BLUR_RADIUS with default | 999, -1, 'abc' all reset to 10 | `blsi.validateSettings({BLUR_RADIUS:999})` |
| 28 | replaces invalid REVEAL_MODE with default | 'invalid', 42 reset to 'hover' | Test with bad REVEAL_MODE |
| 29 | replaces invalid HIGHLIGHT_COLOR with default | 'red', '#fff' reset to '#f59e0b' | Test with bad color |
| 30 | replaces non-boolean category values with defaults | 'yes', 1 reset to boolean defaults | Test with non-boolean categories |
| 31 | replaces broken shortcut binding with default | missing keys restored | Test with broken shortcut shape |
| 32 | fills missing keys with defaults | empty object gets all defaults | `blsi.validateSettings({})` |

### Immutability (2 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 33 | top-level pb namespace is extensible | `typeof pb === 'object'` | Modules attach to pb at runtime |
| 34 | category objects are frozen | STORAGE, COMMAND, POPUP all frozen | Check `Object.isFrozen(blsi.STORAGE)` |

### validateSettings boundary values (10 tests)

| # | Test Name | Asserts | Manual Replication |
|---|---|---|---|
| 35 | BLUR_RADIUS accepts min boundary (2) | radius 2 accepted | `blsi.validateSettings({BLUR_RADIUS:2})` |
| 36 | BLUR_RADIUS accepts max boundary (30) | radius 30 accepted | `blsi.validateSettings({BLUR_RADIUS:30})` |
| 37 | BLUR_RADIUS rejects below min (1) | radius 1 reset to default | `blsi.validateSettings({BLUR_RADIUS:1})` |
| 38 | BLUR_RADIUS rejects above max (31) | radius 31 reset to default | `blsi.validateSettings({BLUR_RADIUS:31})` |
| 39 | SHORTCUTS rejects empty keys array | empty keys falls back to default | Test with `keys: []` |
| 40 | SHORTCUTS rejects keys exceeding limit (11) | 11 keys falls back to default | Test with 11-element keys array |
| 41 | deepMerge stops at depth limit | depth 6+ returns override directly | Test with deeply nested object |
| 42 | PICKER_MODE defaults to sticky | `DEFAULT_SETTINGS.PICKER_MODE === 'sticky'` | `blsi.DEFAULT_SETTINGS.PICKER_MODE` in DevTools |
| 43 | PICKER_MODE validates against enum | 'sticky' and 'dynamic' accepted, 'invalid' rejected | `blsi.validateSettings({PICKER_MODE:'invalid'})` resets to default |
| 44 | PICKER_MODES enum exists | `PICKER_MODES.STICKY === 'sticky'`, `PICKER_MODES.DYNAMIC === 'dynamic'` | `blsi.PICKER_MODES.STICKY` in DevTools |
| 45 | BLUR_MODE validates against enum | 'gaussian' and 'frosted' accepted, 'invalid' rejected | `blsi.validateSettings({BLUR_MODE:'invalid'})` resets to default |

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
| storage_manager | #15-16, 22-28 | Guard clause and settings tests may be incompatible with the `buildStubSource()` stub. Stub does not match real source contract. |
