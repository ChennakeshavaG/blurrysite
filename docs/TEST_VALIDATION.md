# Blurry Site — Test Validation & Manual Replication Guide

This document maps every unit test to the user-facing behavior it protects. **538 tests across 20 test files**, all passing. Run the full suite with `npm run test:unit` (fast, no coverage) or `npm test` (with coverage, ~91% line coverage on `src/`).

---

## 1. blur_engine.test.js (110 tests) — `tests/unit/blur_engine.test.js`

Source module: `src/blur_engine.js` → `blsi.BlurEngine`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| injectRules (8) | `injectRules` adds a `<style>` tag with `bl-si-blurred` CSS rules; `removeRules` removes it; duplicate calls are idempotent; radius var updates propagate; shadow-root injection works | Page load, blur-all toggle | No blur CSS on page — every blur operation is visually broken |
| stampElements (4) | `stampElements` assigns `data-bl-si-id` to elements that lack one; returns `ShadowRoot[]` for shadow hosts; does not re-stamp already-stamped elements | Picker click, sticky zone restore | Elements lose identity across re-renders; sticky zones re-blur wrong nodes |
| tryBlurTextCheck (2) | Returns true when text content matches active categories; returns false otherwise | Blur-all with category filters active | Category filter silently blurs or un-blurs wrong elements |
| applyBlur (3) | Adds `bl-si-blurred` class; applies to element in shadow DOM; does not double-apply | Picker click, sticky zone restore | Blur does not appear on screen |
| removeBlur (2) | Removes `bl-si-blurred` class; no-ops on unblurred element | Unblur item from popup, clear-all shortcut | Blur persists after user removes it |
| toggleBlur (1) | Toggles class on/off | (internal use) | Toggle shortcut produces wrong state |
| isBlurred (4) | Returns true for `bl-si-blurred` class present; false otherwise; checks shadow DOM element; checks element inside blurred parent | Popup "blurred items" list | Popup shows wrong blur state |
| unblurAll (1) | Removes `bl-si-blurred` from all elements in document | Alt+Shift+U shortcut, clear-all popup button | Clear-all leaves blur residue on page |
| shouldBlurElement (4) | Skips extension UI elements, toolbar, overlay; respects `BLUR_CATEGORIES` filter; returns false for disabled category | Blur-all toggle with category settings | Extension blurs its own toolbar; or category toggles have no effect |
| CATEGORY_SELECTORS (1) | All 5 category selectors (`TEXT`, `MEDIA`, `FORM`, `TABLE`, `STRUCTURE`) are defined and non-empty | Settings → blur categories panel | A category toggle silently does nothing |
| matchesActiveCategories (2) | Returns true when element matches an active category; false when category is disabled | Blur-all with category filter | Category filter ignored — wrong elements blurred/skipped |
| Zone overlays — createZoneOverlay (8) | Overlay element created with correct geometry, class, name label, anchor type; appended to correct parent | Picker → draw sticky zone | Sticky zone is invisible or misplaced |
| Zone overlays — removeZoneOverlay (4) | Named zone removed from DOM; no-op on unknown name; `getZoneOverlays` count decrements | Popup → remove zone item | Zone overlay lingers after deletion |
| Zone overlays — removeAllZoneOverlays (2) | All zone overlays cleared | Clear-all shortcut, page unload | Zone overlays stay on page after navigation |
| Zone overlays — getZoneOverlays (1) | Returns live list matching created zones | Popup zone list rendering | Popup shows wrong zone count |
| handleSite item reconciliation (5) | Adds newly stored items; removes items deleted from storage; does not re-blur already-blurred items | Storage update pushed to content_script | Blur disappears on SPA navigation, or duplicate blur applied |
| Counters (5) | `resetCounters` zeroes blur/unblur counts; `allocateDynamicName` returns incrementing names; `allocateStickyName` returns incrementing sticky names | Any blur action | Name collisions between zones; counter drift after reset |
| Page-wide reconcile (16) | `handleDocument` applies blur to all matching elements; respects category filters; handles empty storage; handles SPA re-renders; `observeRoot`/`disconnectObserver` wire MutationObserver | Page load (RESTORE message), SPA navigation | Blur does not restore after navigation; new DOM nodes not blurred |
| Category coverage audit (7) | Every element tag in `CATEGORY_SELECTORS` is covered by exactly one category; no tag appears in two categories | Any blur-all with categories | Tag silently uncovered — element never blurred; or double-blurred |
| ARIA role coverage (7) | Elements with ARIA roles (`role="img"`, `role="table"`, etc.) are matched by the correct category selector | Accessibility-heavy pages | ARIA-driven widgets escape blur |
| Shadow DOM (12) | `handleDocument` traverses open shadow roots; `injectRules` injects into shadow root; `stampElements` returns shadow host list; blur applied inside shadow DOM | Pages with Web Components | Shadow DOM content never blurred |
| Custom element stamping RC-1 (5) | Custom elements (`<my-card>`) stamped with `data-bl-si-id`; re-stamp after disconnect/reconnect uses same id | SPA with custom elements | Sticky zone re-blur targets wrong node after SPA re-render |
| List element placement RC-2 (3) | `<li>` inside `<ul>` inside blurred container correctly identified as STRUCTURE category | Blur-all on page with lists | List items escape blur despite STRUCTURE enabled |
| Reveal descendant cascade RC-3 (2) | `data-bl-si-reveal` on ancestor causes descendant text to appear revealed; removing attribute restores blur | Hover/click reveal on nested content | Nested content stays blurred even when ancestor is revealed |

---

## 2. reveal_controller.test.js (17 tests) — `tests/unit/reveal_controller.test.js`

Source module: `src/reveal_controller.js` → `blsi.Reveal`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Click mode (8) | `init({ getMode: ()=>'click' })` — click on blurred element adds `data-bl-si-reveal`; second click removes it (toggle); click on non-blurred element is no-op; `clearAll` removes all reveal attributes | Settings → reveal mode = click, then click blurred element | Click reveal silently broken; elements stay blurred or permanently revealed |
| Hover mode (2) | `init({ getMode: ()=>'hover' })` — pointerenter adds `data-bl-si-reveal`; pointerleave removes it | Settings → reveal mode = hover, hover over blurred element | Hover reveal broken; element stays blurred on hover |
| clearAll (1) | `clearAll()` removes every `data-bl-si-reveal` attribute across document | Popup "lock screen" action, `destroy()` | Revealed elements stay exposed after lock |
| composedPath shadow DOM (2) | `event.composedPath()[0]` used instead of `event.target`; reveal reaches elements inside shadow roots | Hover/click on blurred Web Component internals | Shadow DOM content cannot be revealed |
| Shadow host reveal (2) | Clicking a shadow host (non-shadow-root element) propagates reveal to the host; parent-chain walk respects boundary | Click reveal on custom element | Shadow component stays blurred even after click |
| destroy (1) | `destroy()` removes event listeners; subsequent clicks/hovers produce no reveal | Page unload, extension disabled | Memory leak; reveal events fire on dead pages |
| Input skip (1) | Reveal does not trigger on `<input>` or `<textarea>` elements | Click/hover on a blurred form input | Form interaction accidentally reveals the field |

---

## 3. picker.test.js (63 tests) — `tests/unit/picker.test.js`

Source module: `src/picker.js` → `blsi.Picker`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Activation (3) | `activate()` sets `bl-si-picker-active` on `<html>`; `isActive` getter returns true; second `activate()` is idempotent | Alt+Shift+P shortcut | Picker CSS not applied; hover highlight missing |
| Hover highlight (3) | Mousing over elements in picker mode adds `bl-si-hover-highlight`; moving to another element transfers highlight; extension UI elements skipped | Mouse movement during picker | No visual feedback which element will be blurred |
| Click behavior (4) | Click blurs the highlighted element; picker mode ends; `callbacks.onBlur` called with element; extension UI click is no-op | Click element in picker mode | Blur does not apply on click; picker stays active forever |
| Escape key (2) | Pressing Escape calls `deactivate()`; `isActive` becomes false | Esc key while picker active | Picker cannot be dismissed; page interaction blocked |
| Deactivation (6) | `deactivate()` removes `bl-si-picker-active`; removes hover highlight; removes event listeners; `isActive` false; toolbar hidden | Alt+Shift+P second press, Escape | Picker CSS lingers; hover highlights remain |
| setSettings (3) | `setSettings({ PICKER_MODE })` updates internal mode without re-activating; `PICKER_MODE: 'dynamic'` vs sticky affects click callback | Settings → picker mode dropdown | Wrong zone type created; picker ignores mode setting |
| isActive getter (4) | Returns true only when activated; false after deactivate; false before first activate; reflects class on `<html>` | Popup status query | Popup shows wrong picker state |
| Hover highlight cleanup (2) | `bl-si-hover-highlight` removed when picker deactivated mid-hover; cleaned on `mouseleave` | Deactivate while hovering | Stale highlight remains on element after picker closed |
| Toolbar (2) | Picker toolbar (`#bl-si-picker-toolbar`) shown on activate; hidden on deactivate | Alt+Shift+P toggle | No "Escape to cancel" toolbar feedback |
| Click boundary conditions (2) | Click outside blurred element in dynamic mode; click on already-blurred element toggles | Click in empty space; click on blurred element | Picker clicks in empty space cause errors; toggle broken |
| Sticky mode (10) | `PICKER_MODE: 'sticky-page'` enters zone-drawing flow on mousedown; mousemove draws preview; mouseup creates zone; anchor stored as `'page'`; `'sticky-screen'` stores `anchor: 'screen'`; zone name increments | Picker → draw box on page | Sticky zone not created; wrong anchor type; zone misplaced on scroll |
| setMode (6) | `setMode('dynamic')`, `setMode('sticky-page')`, `setMode('sticky-screen')` all accepted; mode reflected in next interaction; invalid mode rejected | Settings → picker mode change while picker open | Mode change silently ignored; wrong zone type on next draw |
| i18n integration (7) | Toolbar labels use `blsi.t()` for locale strings; English default; locale change updates labels; missing key falls back to key string | Extension installed in non-English browser | Toolbar shows raw key names instead of translated labels |
| Additional (9) | Pointer capture, zone resize abort on Escape mid-draw, min zone size guard, destroy while drawing | Edge cases during zone drawing | Half-drawn zones committed; tiny mis-clicks create zones |

---

## 4. pii_detector.test.js (60 tests) — `tests/unit/pii_detector.test.js`

Source module: `src/pii_detector.js` → `blsi.PiiDetector`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| EMAIL (5) | `scan(root, ['EMAIL'])` wraps `local@domain.tld` in `[data-bl-si-pii]` span; ignores non-email text; handles multiple emails in one text node; handles emails adjacent to punctuation | Enable email PII toggle | Email addresses visible in screenshots/screenshares |
| NUMERIC currency prefix (4+1) | `$1,234.56`, `€999`, `£42.00`, `¥10000` wrapped; bare `$` not wrapped | Enable numeric PII | Currency amounts visible in screenshare |
| NUMERIC currency code (2) | `USD 1,234`, `EUR 500` wrapped; `USD` alone not wrapped | Enable numeric PII | Currency-coded amounts escape detection |
| NUMERIC 4+ digits (7) | `\d{4,}` pattern: 4-digit numbers wrapped; 3-digit numbers skipped; numbers inside words skipped; phone numbers wrapped; account numbers wrapped; postal codes wrapped | Enable numeric PII | Short account numbers (4-digit) not blurred; false negatives on financial data |
| NUMERIC phone-like groups (6) | `123-456-7890`, `(555) 123-4567`, `+1-800-555-0100`, international formats wrapped | Enable numeric PII | Phone numbers visible in screenshare |
| PII independence (2) | PII spans carry `[data-bl-si-pii]` only, not `[data-bl-si-blur]`; PII blur active when blur-all is off | PII toggle active, blur-all off | PII content exposed when user uses extension without blur-all |
| Multi-type/null (3) | `scan(root, ['EMAIL','NUMERIC'])` applies both; `scan(root, null)` applies all active types; `scan(root, [])` is no-op | Auto-detect with multiple types enabled | One PII type silently skipped when multiple enabled |
| Scan behavior (8) | `scan` is idempotent (no double-wrapping); handles nested elements; handles empty text nodes; handles text split across siblings; `getMatchCount()` returns total wrapped count; `getPatterns()` returns active pattern map | Any scan invocation | Match count wrong in popup; double-wrapping corrupts DOM |
| clear() (2) | `clear(root)` unwraps all `[data-bl-si-pii]` spans; restores original text nodes | Disable PII toggle | PII spans linger in DOM after toggle off |
| getMatchCount / getPatterns (2) | Count increments per match; `getPatterns()` returns object keyed by type with regex | Popup PII count display | Wrong count shown; pattern inspection broken |
| stopObserving (1) | `stopObserving()` disconnects MutationObserver; new DOM nodes not scanned | Page unload, extension disabled | Memory leak on long-lived pages |
| Default settings (1) | `AUTO_DETECT.EMAIL = false`, `AUTO_DETECT.NUMERIC = false` by default | Fresh install | PII scanning active without user opting in |
| Boolean gating (2) | `NUMERIC = true` detects bare 5-digit number; `NUMERIC = false` produces zero numeric spans | Enable / disable numeric PII toggle | Numbers blurred when user disabled numeric detection, or financial numbers escape when enabled |
| isYear suppression (4) | 4-digit year in 1000–2099 suppressed; 5-digit number not suppressed as year; 4-digit above 2099 detected; 3-digit number below threshold produces no match | Enable numeric PII on pages with dates/years | Copyright years and publication dates blurred unnecessarily |
| isVersion suppression (4) | Number preceded by lowercase `v` suppressed; preceded by uppercase `V` suppressed; followed by `.digit` suppressed; bare number with no version context detected | Enable numeric PII on pages with version strings | Version numbers blurred; or legitimate financial numbers suppressed |
| isPublicPrice suppression (4) | `/month` in window suppresses currency amount; `qty` suppresses; `/year` suppresses; no price context → number detected | Enable numeric PII on e-commerce pages | Public pricing blurred on shopping pages; or financial balances missed |
| isCountNoise suppression (4) | `unread` in window suppresses number; `followers` suppresses; `results` suppresses; no count context → number detected | Enable numeric PII on social/dashboard pages | Unread counts and follower numbers blurred; or invoice totals missed |

---

## 5. auto_blur.test.js (11 tests) — `tests/unit/auto_blur.test.js`

Source module: `src/auto_blur.js` → `blsi.AutoBlur`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Basic state (1) | `isIdle()` returns false immediately after `init()` | Page load | Wrong idle state reported before any idle period |
| Idle detection (2) | After idle timeout with no activity, `onIdle` callback fires; `isIdle()` becomes true | User walks away from keyboard | Auto-blur never triggers; sensitive content stays visible |
| Idle→Active (1) | Any pointer/keyboard event resets idle timer; `onActive` fires; `isIdle()` false | User returns to keyboard | Page stays blurred after user returns |
| Tab visibility (2) | `visibilitychange` to hidden fires `onTabSwitch`; returning to visible fires `onActive` | User switches browser tabs | Tab-switch blur does not trigger |
| Lifecycle (2) | `destroy()` removes all listeners; subsequent events produce no callbacks; second `destroy()` is safe | Extension unloaded | Memory leak; stale callbacks fire on dead page |
| Mode isolation (2) | `init` without `onIdle` is safe; `init` without `onTabSwitch` is safe | Partial callback config | Unconfigured callback throws; breaks auto-blur init |

---

## 6. tab_privacy.test.js (11 tests) — `tests/unit/tab_privacy.test.js`

Source module: `src/tab_privacy.js` → `blsi.TabPrivacy`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Basic toggle (2) | `enable()` sets `document.title` to `…`; `isActive` getter returns true | Enable tab privacy in popup | Tab title still visible in OS task switcher during screenshare |
| Disable/restore (2) | `disable()` restores original title; `isActive` false | Disable tab privacy | Original title not restored; page title permanently replaced |
| State tracking (1) | `enable()` after `enable()` is idempotent — title stays `…`, isActive stays true | Double-enable edge case | Title set to `…` then original title on second call |
| Idempotence (1) | `disable()` after `disable()` is safe | Double-disable edge case | Throws or corrupts title on redundant disable |
| Favicon creation (2) | `enable()` replaces favicon with blank canvas data URL; favicon `<link>` created if absent | Enable tab privacy | Recognizable site favicon visible in tab strip during screenshare |
| Disable safety (1) | `disable()` when no stored favicon is safe (no throw) | Fresh page with no favicon | Disable throws on pages without favicons |
| Multiple favicons (1) | All `rel="icon"` and `rel="shortcut icon"` links replaced on enable | Pages with multiple favicon variants | Some favicon variants escape replacement |

---

## 7. blur_timer.test.js (9 tests) — `tests/unit/blur_timer.test.js`

Source module: `src/blur_timer.js` → `blsi.BlurTimer`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Basic state (1) | `isActive()` false before `start()`; `getRemaining()` returns 0 | Fresh page load | Timer shown as active before user sets it |
| Start/stop (2) | `start(minutes, onExpire)` sets `isActive()` true; `stop()` clears timer and sets false | Popup → set blur timer | Timer runs forever with no stop; or cannot be started |
| Timer expiry (1) | After elapsed minutes, `onExpire` callback fires; `isActive()` becomes false | Timer countdown reaches zero | Blur does not auto-apply when timer expires |
| Remaining time (2) | `getRemaining()` decrements over time; returns 0 after expiry | Popup timer display | Wrong time remaining shown |
| Error handling (1) | `start(0)` or `start(-1)` throws or is no-op; does not start infinite loop | Invalid timer input in popup | Zero-duration timer fires immediately or runs forever |
| Replacement (1) | Calling `start()` while timer active replaces previous timer | User changes timer duration mid-countdown | Both timers fire; double-blur |

---

## 8. shortcut_handler.test.js (25 tests) — `tests/unit/shortcut_handler.test.js`

Source module: `src/shortcut_handler.js` → `blsi.Shortcuts`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Action matching (7) | `init(shortcuts, callbacks)` fires correct callback when matching chord pressed; matches regardless of left/right modifier key; Alt+Shift+B fires `TOGGLE_BLUR_ALL`; Alt+Shift+P fires `TOGGLE_PICKER`; Alt+Shift+U fires `CLEAR_ALL`; custom re-bound chord fires correctly; old chord after rebind does not fire | Any keyboard shortcut | Shortcut silently fails; user cannot blur/unblur via keyboard |
| Guards (8) | Event in `<input>` skipped; event in `<textarea>` skipped; event during picker active skipped unless Escape; `_setPickerActive(true)` blocks non-Escape shortcuts; AltGr chord not mis-matched as Alt; `metaKey` on non-Mac not matched as Meta; `defaultPrevented` event skipped; shortcut with empty binding array is no-op | Typing in form fields with shortcuts configured | Shortcut fires while user types in a text field |
| Escape handling (3) | Escape key calls `callbacks.onEscape`; fires even when picker active; does not fire `onEscape` when `isPickerActive` false | Press Escape during picker | Picker cannot be dismissed; escape handler not called |
| Fire token (2) | `_getFireToken()` returns unique token per call; tokens differ across invocations | (internal dedup) | Same keydown event processed twice in content_script dedup |
| Lifecycle (5) | `destroy()` removes keydown listener; subsequent keypresses produce no callbacks; second `destroy()` is safe; `init()` after `destroy()` re-registers; callbacks object is optional | Extension disable/reload | Memory leak; dead-page shortcuts still fire |

---

## 9. shortcut_label.test.js (21 tests) — `tests/unit/shortcut_label.test.js`

Source module: `src/shortcut_label.js` → `blsi.ShortcutLabel`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Code labels — letters/digits (8) | `codeLabel('KeyB')` → `'B'`; `codeLabel('Digit3')` → `'3'`; symbols (`Minus`, `Equal`, `BracketLeft`); named keys (`Enter`, `Escape`, `Space`, `Tab`, `Backspace`); arrows → `↑↓←→`; function keys `F1`–`F12`; numpad keys; unknown code → raw code as fallback | Shortcut display in popup | Popup shows raw `KeyB` instead of `B`; user cannot read their shortcuts |
| Modifier labels (1) | Platform-aware: Mac renders `⌥⇧⌘⌃`; Windows/Linux renders `Alt Shift Ctrl Win` | Platform detection at install | Wrong modifier symbols shown on wrong platform |
| Chord label (3) | `chordLabel({code, mods})` combines mod + key; empty mods produces key only; null/undefined chord returns `''` | Shortcut display, capture UI | Chord rendered without modifiers; null chord throws |
| Binding label (3) | Single-chord binding matches `chordLabel`; multi-chord binding joined by space; empty binding returns `''` | Shortcut display in popup | Multi-chord binding shown without separator |
| Chord key (4) | `chordKey` output is mod-order-independent; different codes produce different keys; same chord regardless of mod order; format is `"Alt+Shift\|KeyB"` | Shortcut dedup / storage key | Different mod orderings treated as different shortcuts |
| Binding key (2) | Multi-chord canonical form joins chord keys with space; single chord matches `chordKey` | Shortcut storage/lookup | Multi-chord binding stored with wrong key; lookup fails |

---

## 10. shortcut_reserved.test.js (10 tests) — `tests/unit/shortcut_reserved.test.js`

Source module: `src/shortcut_reserved.js` → `blsi.ShortcutReserved`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Reserved chords (5) | `isReserved({code:'KeyT', mods:['Control']})` → true (Ctrl+T); `Ctrl+W`, `F5`, `F12`, `Ctrl+L` all reserved; `lookup()` returns description string | User binds a reserved chord in popup | No warning shown; user binds extension to browser shortcut that silently fails |
| Non-reserved (2) | `Alt+Shift+B`, `Ctrl+Shift+K` → `isReserved` false | Default extension chords | Default bindings incorrectly flagged as reserved |
| Mod order agnostic (1) | `[Shift, Control]` and `[Control, Shift]` produce same `isReserved` result | Any chord with multiple modifiers | Same chord flagged reserved in one order but not another |
| Platform filter (1) | `Meta+Q` reserved on Mac; may be non-reserved on Windows | Platform-specific behavior | Mac-only reserved chord mis-flagged on Windows |
| Frozen (1) | `RESERVED` array is frozen | (internal integrity) | Runtime code mutates reserved list; warning check breaks |

---

## 11. action_registry.test.js (13 tests) — `tests/unit/action_registry.test.js`

Source module: `src/action_registry.js` → `blsi.Actions`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Exposure (2) | `blsi.Actions` exposed with `list`, `get`, `ids`, `defaultBindings`, `ACTIONS` | Extension load | Action registry unavailable; shortcuts cannot initialize |
| Metadata shape (2) | Each action has `id`, `label`, `description`, `defaultBinding`, `messageType`, `chromeCommand`; `list()` returns 3 entries | Popup shortcut editor display | Missing fields cause popup to crash or show blank labels |
| Frozen (2) | `ACTIONS` object and individual action entries are frozen; `defaultBinding` arrays are frozen | (internal integrity) | Action entries mutated at runtime; binding changes bleed across contexts |
| defaultBindings clone (2) | `defaultBindings()` returns fresh clone; mutating clone does not affect source | Settings reset to defaults | Mutating defaults corrupts factory reset |
| Uniqueness (2) | All `messageType` values unique; all `chromeCommand` values unique | Any message dispatch | Two actions share message type; one action silently hijacks the other |
| Edge cases (1) | `get('DOES_NOT_EXIST')` returns `undefined` without throwing | Unknown action lookup | Registry throws on unknown id; content_script crashes |
| Count (1) | Exactly 3 actions registered | (structural integrity) | Extra undocumented action present; missing action means shortcut non-functional |
| Extra (1) | `ids()` array length matches `list()` length | (structural integrity) | ids/list out of sync |

---

## 12. storage_manager.test.js (~31 tests) — `tests/unit/storage_manager.test.js`

Source module: `src/storage_manager.js` → `blsi.Storage`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| saveBlurItem (2+) | Sends `SAVE_BLUR_ITEM` message with `{host, item}`; item persisted across calls | Picker click blurs element | Blur not saved; disappears on page reload |
| removeBlurItem (1) | Sends `REMOVE_BLUR_ITEM`; item no longer in `getBlurItems` result | Popup → remove item | Item re-appears after removal |
| getBlurItems (4) | Returns array for host; empty array for unknown host; filters to current host only; handles storage error gracefully | Page load RESTORE | Wrong items restored; items from other sites appear |
| clearHost (2) | Removes all items for host; items for other hosts untouched | Popup → clear this site | Items from other sites deleted; or site items persist after clear |
| clearAll (2) | Removes all blur items everywhere; sends `CLEAR_ALL` message | Popup → clear all sites | Some items survive clear-all |
| getSettings (3) | Returns merged settings (storage + defaults); missing keys filled from defaults; returns `DEFAULT_SETTINGS` shape | Any settings access | Missing settings key causes crash or wrong default behavior |
| saveSettings (2) | Sends `SAVE_SETTINGS` with partial object; subsequent `getSettings` reflects change | Any settings change in popup | Setting change not persisted; reverts on reload |
| getRules / saveRules (4) | `getRules` returns array; empty when none set; `saveRules` persists; subsequent get reflects saved rules | URL rules panel in popup | URL rules not persisted; site-specific settings lost |
| getBlurState / saveBlurState (2) | Persists and retrieves `{ blurAll, host }` shape | blur-all toggle persistence | Blur-all state not remembered across reload |
| Guard clauses (7+) | `saveBlurItem(null)` no-op; `removeBlurItem(undefined)` no-op; invalid host rejected; `saveSettings({})` is safe no-op; message send failure handled without throw | Invalid inputs from popup | Storage functions throw on bad input; crash popup |

---

## 13. url_matcher.test.js (20 tests) — `tests/unit/url_matcher.test.js`

Source module: `src/url_matcher.js` → `blsi.UrlMatcher`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Wildcard mode (11) | `matchesPattern('https://example.com/page', 'example.com/*')` → true; `*` matches any path; `*.example.com` matches subdomains; exact match; no match on wrong host; protocol agnostic; trailing slash handling; `MAX_PATTERN_LENGTH` enforced; empty pattern; pattern with query string; path prefix wildcard | URL rules configured in popup | Site-specific rules not applied; rules apply to wrong sites |
| Regex mode (4) | Pattern wrapped in `/` treated as regex; valid regex matches; invalid regex caught gracefully; regex flags not supported (no `//i`) | Advanced users using regex patterns | Regex rule silently does nothing; invalid regex crashes matcher |
| resolveSettings (5) | `resolveSettings(url, rules, defaultSettings)` returns base settings when no rule matches; merges matching rule's overrides; first-match wins for overlapping rules; empty rules returns defaults; null URL returns defaults | Page load on site with URL rules | Rule overrides not applied; wrong settings used for site |

---

## 14. selector_utils.test.js (35 tests) — `tests/unit/selector_utils.test.js`

Source module: `src/selector_utils.js` → `blsi.SelectorUtils`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| getSelector core (8) | Returns `[data-bl-si-id="…"]` for stamped element; falls back to tag+id for un-stamped; falls back to tag+class for no-id; handles `<body>` and `<html>`; handles detached element; handles SVG element; unique selector per unique element; handles `null` | Restore saved blur items on page load | Selector resolves to wrong element; blur re-applied to wrong node |
| generateId (3) | Returns string of `[a-z0-9]`; length ≥ 8; uniqueness across 1000 calls | Any element stamping | ID collision — two elements share selector |
| restoreSelector (6) | `restoreSelector(doc, selector)` finds element by `[data-bl-si-id]`; falls back to `querySelector`; returns null when not found; handles prefixed selector; works after SPA re-render stamped new id | RESTORE message on page load | Saved blur item does not re-blur correct element |
| restoreAllSelectors (6) | `restoreAllSelectors(doc, items)` applies `restoreSelector` to each item; skips null results; returns array of resolved elements; handles empty array; handles items with no selector; count matches found elements | Bulk restore on page load | Some items not restored; array length wrong |
| getSelector edge cases (7) | Iframe element; element with no parent; very deep nesting; element with whitespace-only class; multiple classes; class name with special chars; element removed mid-call | Complex DOM structures | Selector generation throws or produces unparseable string |
| restoreSelector edge cases (3) | Selector with CSS special chars in id value; selector targeting `<html>`; malformed selector string | Restoring items with special characters in page | Malformed selector throws; crashes content_script on restore |
| generateId robustness (2) | Crypto-random source used when available; falls back to Math.random | Environments without crypto.getRandomValues | IDs predictable; collision risk in large pages |

---

## 15. constants.test.js (54 tests) — `tests/unit/constants.test.js`

Source module: `src/constants.js` → `globalThis.blsi`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Message types (3) | `blsi.STORAGE`, `blsi.COMMAND`, `blsi.POPUP` objects exist with correct string values; no undefined entries | Any message send | Message type string mismatch → message silently dropped |
| Flat shorthand (1) | `blsi.COMMAND.TOGGLE_BLUR_ALL === 'TOGGLE_BLUR_ALL'` etc. match values used in background.js | Runtime message dispatch | Handler key mismatch → blur/unblur commands never received |
| isValid (3) | `isValid('TOGGLE_BLUR_ALL')` → true; unknown type → false; null/undefined → false | Message validation in background.js | Invalid messages processed; valid messages rejected |
| categoryOf (4) | Returns correct `BLUR_CATEGORIES` key for known type; returns null for unknown; handles all 5 categories | Category filter logic | Wrong category returned; category toggle affects wrong elements |
| DEFAULT_SETTINGS (4) | All expected top-level keys present (`BLUR_RADIUS`, `REVEAL_MODE`, `THOROUGH_BLUR`, `PICKER_MODE`, `BLUR_CATEGORIES`, `AUTO_DETECT`); no unknown keys; types correct | Fresh install, settings reset | Wrong defaults applied; setting key missing causes crash |
| BLUR_CATEGORIES (3) | Default has all 5 keys (`TEXT`, `MEDIA`, `FORM`, `TABLE`, `STRUCTURE`); all boolean; default values match doc | Fresh install | Category toggle broken for default-off categories |
| buildDefaultSettings (2) | Returns object with `SHORTCUTS` populated from `blsi.Actions.defaultBindings()`; result is a fresh clone each call | Settings reset, first install | Shortcuts not in default settings; factory reset breaks shortcuts |
| deepMerge (4) | Nested objects merged recursively; arrays replaced not merged; null source returns target; nested null key handled | Settings partial update | Nested settings key overwritten instead of merged; null key crashes |
| validateSettings (12) | Migrates legacy `PICKER_MODE: 'sticky'` → `'sticky-page'`; removes unknown keys; coerces wrong types to default; preserves valid shortcuts; rejects invalid modifier; handles empty object; handles null; returns new object (does not mutate); `AUTO_DETECT.NUMERIC` coerced to boolean; `BLUR_RADIUS` clamped to range; `REVEAL_MODE` enum validated; deeply nested unknown keys stripped | Storage read on startup | Bad stored settings crash content_script; legacy settings not migrated |
| Immutability (2) | `DEFAULT_SETTINGS` is frozen at top level; `BLUR_CATEGORIES` sub-object is frozen | (internal integrity) | Runtime mutation of defaults corrupts subsequent fresh installs |
| Boundary values (11) | `BLUR_RADIUS` min/max; `MAX_PATTERN_LENGTH`; empty string shortcut binding; chord with all mods; chord with no mods; `REVEAL_MODE` all valid enum values; `NUMERIC` boolean coercion (truthy/falsy); `MODIFIER_CODES` array non-empty; `REVEAL_DFS_MAX_DEPTH` is positive integer | Edge case settings input | Out-of-range values accepted; enum values outside spec accepted |

---

## 16. logger.test.js (10 tests) — `tests/unit/logger.test.js`

Source module: `src/logger.js` → `blsi.Logger`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Silent by default (1) | `log`, `warn`, `flow` produce no console output when `enabled = false` (default) | Normal user operation | Debug noise in user's console on production install |
| Error always writes (1) | `error()` writes to console regardless of `enabled` state | Any runtime error | Errors silently swallowed; bugs invisible to users |
| Enable/disable (2) | `enable()` sets `enabled` true and writes to `chrome.storage.local`; `disable()` restores silence | Developer toggle in DevTools: `blsi.Logger.enable()` | Debug log toggle not persisted across pages |
| Flow/scope (3) | `flow(tag, data)` writes structured log; `scope(name)` returns tagged logger with all methods; `scope` logger inherits enabled state | Developer debugging with named scopes | Scoped logger methods undefined; flow logging broken |
| Cross-context sync (2) | `chrome.storage.onChanged` listener flips `enabled` when `blsi_debug` key changes; popup and content_script stay in sync | DevTools enable in popup context visible in content_script | Debug toggle in one context not seen in others |
| Init from storage (1) | On load, reads `blsi_debug` from storage; `enabled` reflects stored value | Page reload while debug on | Debug mode resets after every navigation |

---

## 17. content_i18n.test.js (11 tests) — `tests/unit/content_i18n.test.js`

Source module: `src/content_i18n.js` → `blsi.ContentI18n`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Module exposure (1) | `blsi.ContentI18n` exposed with `init`, `t`, `currentLang` | Content script load | Content script i18n unavailable; toast messages broken |
| Language init (3) | `init('en')` resolves English strings; `t('key')` returns correct text; `currentLang` reflects resolved language | Content script initialization | Toast and content-side strings show wrong language |
| Auto resolution (3) | `init()` resolves from `navigator.language` (not `chrome.i18n`); falls back to `'en'`; partial match (`'de-AT'` → `'de'`) | User browser locale | Content script uses wrong language source; mismatches popup locale |
| Parameter fallback (1) | `t('KEY', 'fallback string')` returns fallback when key missing | Missing key in content strings | Content throws or shows blank when key missing |
| Key as fallback (1) | `t('MISSING_KEY')` returns `'MISSING_KEY'` string when no fallback provided | Any missing content string | Content script crashes on unknown key |
| Warn dedup (1) | Missing key warning emitted once per key per session | (log hygiene) | Console flooded on pages with missing content strings |
| Fetch failure (1) | Network failure loading locale JSON falls back to English silently | Offline use, CSP restriction | Content script crashes on i18n load failure |

---

## 19. screenshot.test.js (7 tests) — `tests/unit/screenshot.test.js`

Source module: `src/screenshot.js` → `blsi.Screenshot`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| captureViewport (3) | `captureViewport()` sends `CAPTURE_VISIBLE_TAB` message and resolves with data URL; handles rejection; resolves with null on no permission | Popup → screenshot button | Screenshot fails silently; error not surfaced to user |
| download (1) | `download(dataUrl, filename)` creates `<a>` with `download` attribute and clicks it without throwing (jsdom limitation — see Known Issues) | Screenshot → download button | Download triggered with wrong filename or not at all |
| startCrop (1) | `startCrop()` creates overlay element and attaches it to document body | Screenshot → crop mode button | Crop overlay not shown; crop UI broken |
| cancelCrop (2) | `cancelCrop()` removes overlay; `cancelCrop()` when no overlay active is safe (no throw — see Known Issues) | Escape during crop, cancel button | Crop overlay not removed; subsequent screenshot attempts broken |

---

## 20. selection_blur.test.js (13 tests) — `tests/unit/selection_blur.test.js`

Source module: `src/selection_blur.js` → `blsi.SelectionBlur`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| blurSelection (6) | `blurSelection(range)` wraps selection in `[data-bl-si-blur]` span with unique id; works on text-only range; works on partially-selected element; handles collapsed range (no-op); handles null range; result appears in `getSelectionBlurs()` | Text selection → blur shortcut or context menu | Text selection blur creates no span; selection not blurred |
| clearAll (1) | `clearAll()` unwraps all selection blur spans; restores text nodes | Clear-all shortcut, page unload | Selection blurs linger after clear-all |
| getSelectionBlurs (1) | Returns array of `{ id, selector, text }` for all active selection blurs | Popup → selection blur list | Wrong list shown; items missing from popup |
| removeSelectionBlur (1) | `removeSelectionBlur(id)` removes specific span by id; restores text | Popup → remove single selection blur | Wrong item removed; or item cannot be removed |
| ID uniqueness (1) | IDs from `blurSelection` calls never repeat across 100 calls | Multiple text selections on same page | ID collision — removing one selection blurs removes both |
| destroy (1) | `destroy()` removes event listeners and clears state; subsequent calls are safe | Extension unloaded | Memory leak; event handlers fire on dead page |
| Edge cases (2) | Range spanning two block elements; range containing inline elements (bold, links) — span correctly wraps content | Complex text selections | Selection blur fails on formatted text; span corrupts nested HTML |

---

## Known Test Quality Issues

| Module | Issue |
|---|---|
| `pii_detector` | NUMERIC regex was `\d{5,}` instead of `\d{4,}` in source — fixed 2026-04-17. Tests were correct; source was wrong. 4-digit account numbers were silently passing through. |
| `screenshot` | `download does not throw` is a vacuous test — jsdom cannot simulate anchor click behavior. The assertion only verifies the call does not throw, not that a download was initiated. |
| `screenshot` | `cancelCrop removes the overlay` has no DOM assertion — only verifies no-throw. If `cancelCrop` is a no-op, the test still passes. Needs a `document.querySelector` assertion against the overlay element. |
| `content_i18n` | Tests 2–7 cover the same API shape (`init`, `t`, `currentLang`) as the deleted `popup_i18n` tests, but using a different language resolution source (`navigator.language` vs the old `chrome.i18n.getUILanguage()`). |
| `selector_utils` | The entire class-based selector strategy branch inside `getSelector` (fallback via class name list when no `data-bl-si-id` and no element id) has zero test coverage. Selector correctness in class-heavy SPAs is untested. |
