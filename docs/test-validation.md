# Blurry Site — Test Validation & Manual Replication Guide

This document maps every unit test to the user-facing behavior it protects. **595 tests across 20 test files**, all passing. Run the full suite with `npm run test:unit` (fast, no coverage) or `npm test` (with coverage, ~91% line coverage on `src/`).

---

## 1. blur_engine.test.js (119 tests) — `tests/unit/blur_engine.test.js`

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
| Mutation dispatcher (9) | `subscribeMutations`/`unsubscribeMutations` exposed; subscriber receives `(MutationRecord[], root)` for childList add and characterData change; unsubscribe stops dispatch; re-registering same name replaces handler; throwing subscriber doesn't stall others; subscribers fire even when picker is active or blur-all is OFF; rejects bad name/handler silently | Any DOM activity (PII detector subscribes here) | Without dispatcher: typed PII unblurred until reload; multiple modules each spinning their own MO is wasteful |

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

## 4. pii_detector.test.js (69 tests) — `tests/unit/pii_detector.test.js`

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
| handleMutations (8) | Subscriber handler dispatched by `blur_engine`'s mutation dispatcher: childList add (TEXT_NODE / ELEMENT_NODE) wraps matches; **characterData** target (typed email in contenteditable, dynamic `.textContent` reassignment) wraps matches — fixes the bug where PII stayed unblurred until reload; text node already wrapped is skipped (no double-wrap); extension UI nodes skipped; attributes mutation type ignored; no-op when `_activeTypes` null or input empty | Type an email into Gmail compose / Slack DM / Notion page (any contenteditable surface) | Typed PII visible during screenshare even with auto-detect on |
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
| Page-write defense (1) | While active, `document.title = '…'` from page code cannot leak; reads still return `Tab`; `disable()` restores the most recent attempted title | Screen-share Gmail / Slack / Twitter where SPA rewrites title (unread counter) | Sensitive title leaks to meeting participants when SPA rewrites `document.title` mid-share |

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

## 15. constants.test.js — `tests/unit/constants.test.js`

Source module: `src/constants.js` → `globalThis.blsi`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| Message types | `blsi.command`, `blsi.popup` objects exist with correct string values | Any message send | Message type string mismatch → message silently dropped |
| isValid / categoryOf | `is_valid('TOGGLE_BLUR_ALL')` → true; unknown → false; `category_of` returns correct bucket | Message validation | Invalid messages processed; valid messages rejected |
| build_default_model | All expected top-level sections present; `shortcuts` populated from `blsi.Actions.defaultBindings()`; result is a fresh clone each call | Fresh install, settings reset | New popup keys missing from defaults; factory reset breaks shortcuts |
| deep_merge | Nested objects merged recursively; arrays replaced not merged; null source returns target | Settings partial update | Nested settings key overwritten instead of merged |
| validate_model | Migrates legacy blur_mode values (`gaussian→blur`, `masked→solid`, `asterisked→hidden`); coerces wrong types to default; handles null/empty input; returns new object | Storage read on startup | Bad stored settings crash content_script; legacy settings not migrated |
| Immutability | Enums (`blur_modes`, `reveal_modes`, etc.) are all frozen | (internal integrity) | Runtime mutation of enums corrupts subsequent checks |
| Boundary values | `blur_radius` min/max; `blur_mode` enum validation; `picker_mode` migration; `pii_mode` migration; `idle_units` hr rejection; `automate_blur` valid/missing/pollution keys; shortcut binding validation | Edge case settings input | Out-of-range values accepted; enum values outside spec accepted |
| site_rules: blur_all invariants (3) | `blur_all:false`, `blur_all:true`, `blur_all:null` all preserved by `validate_model` — not coerced to a different value | User toggles blur-all off/on for a site | `blur_all:false` coerced to null → site never explicitly turns off; toggle appears to have no effect |
| site_rules: item shape validation (3) | New `selectors:string[]` shape passes; legacy `selector:string` shape passes; empty `selectors:[]` is stripped | Picker saves item; then any storage write occurs | New-format items stripped by old filter → items disappear as side-effect of any write (e.g. blur-all toggle) |

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

## 21. popup_render.test.js (27 tests) — `tests/unit/popup_render.test.js`

Unit tests for `BlurrySitePopupRender` — stateless DOM renderer for the popup main view sections.

### renderHtbSection — blur-all mode renders 4 type chips
**Asserts:** When `ACTIVE_MODE='blur-all'`, four `.bl-chip` elements appear in `#bl-htb-chips`.
**Manual:** Load the popup with `ACTIVE_MODE='blur-all'` in settings, open DevTools, confirm `#bl-htb-chips` has 4 children with class `bl-chip`.

### renderHtbSection — active blur-all chip has bl-chip--active class
**Asserts:** The chip matching `BLUR_MODE` (e.g. `frosted`) has class `bl-chip--active`.
**Manual:** With `BLUR_MODE='frosted'`, open popup; the Frosted chip should be highlighted amber.

### renderHtbSection — pick-blur mode renders 3 type chips (no redacted/masked)
**Asserts:** `ACTIVE_MODE='pick-blur'` yields 3 chips; none have `data-type='redacted'` or `'masked'`; one has `data-type='color'`.
**Manual:** Switch `ACTIVE_MODE` to `pick-blur` in storage, open popup; confirm 3 chips (Gaussian, Frosted, Color).

### renderHtbSection — pick-blur mode shows a note element below chips
**Asserts:** A `.bl-htb-note` element exists below chips when `ACTIVE_MODE='pick-blur'`.
**Manual:** In pick-blur mode, note text "Redacted & Masked available in Blur All mode." appears below chips.

### renderHtbSection — blur-all mode shows no note element
**Asserts:** No `.bl-htb-note` in blur-all mode.
**Manual:** In blur-all mode, no note text between chips and summary.

### renderHtbSection — blur-all summary has Covers row listing enabled categories
**Asserts:** Summary has a Covers row; its value includes keys for enabled categories only.
**Manual:** With TEXT+TABLE enabled (rest off), Covers row shows "Text, Tables".

### renderHtbSection — summary Strength row uses Moderate label for radius 6
**Asserts:** A Strength summary row exists with value containing `htb_strength_moderate` for `BLUR_RADIUS=6`.
**Manual:** With `BLUR_RADIUS=6`, Strength row shows "Moderate (6px)".

### renderHtbSection — summary Strength row uses Subtle label for radius 3
**Asserts:** Strength row value contains `htb_strength_subtle` for `BLUR_RADIUS=3`.
**Manual:** Set `BLUR_RADIUS=3` in storage, open popup; Strength shows "Subtle (3px)".

### renderHtbSection — summary Strength row uses Strong label for radius 10
**Asserts:** Strength row value contains `htb_strength_strong` for `BLUR_RADIUS=10`.
**Manual:** Set `BLUR_RADIUS=10`, confirm "Strong (10px)".

### renderHtbSection — pick-blur mode has no Covers row in summary
**Asserts:** No `htb_label_covers` in summary when pick-blur mode.
**Manual:** In pick-blur mode, summary has no Covers row.

### renderHtbSection — color mode shows Color row and no Strength/Reveal rows
**Asserts:** `PICK_BLUR_TYPE='color'` shows a Color row; no Strength or Reveal row.
**Manual:** Set `PICK_BLUR_TYPE='color'`, open popup; only Color row visible in summary.

### renderPiiSection — master toggle is checked when EMAIL is true
**Asserts:** `#bl-pii-master` is checked when `AUTO_DETECT.EMAIL=true`.
**Manual:** Set `AUTO_DETECT.EMAIL=true` in storage, open popup; PII toggle appears on.

### renderPiiSection — master toggle is unchecked when both are false
**Asserts:** `#bl-pii-master` unchecked when both EMAIL and NUMERIC are false.
**Manual:** Both false in storage; toggle appears off.

### renderPiiSection — renders 4 PII mode chips
**Asserts:** Four `.bl-chip` elements in `#bl-pii-chips`.
**Manual:** Open popup; PII section shows Gaussian, Frosted, Redacted, Asterisked chips.

### renderPiiSection — active PII chip has bl-chip--active and bl-chip--sky
**Asserts:** Chip matching `PII_MODE` has both `bl-chip--active` and `bl-chip--sky`.
**Manual:** With `PII_MODE='redacted'`, the Redacted chip should be highlighted sky/cyan.

### renderAutomateSection — renders 3 summary rows
**Asserts:** `#bl-automate-summary` has exactly 3 `.bl-summary-row` children.
**Manual:** Open popup; Automate section shows Timer, Idle, Tab Switch rows.

### renderAutomateSection — TIMER disabled shows Off value
**Asserts:** Timer row value is `automate_off` when TIMER.ENABLED=false.
**Manual:** Disable timer in settings; Timer row shows "Off".

### renderAutomateSection — IDLE enabled with value=5 unit=min shows value and unit key
**Asserts:** Idle row value is "5 automate_unit_min" when IDLE={VALUE:5, UNIT:'min', ENABLED:true}.
**Manual:** Enable idle with 5 min; row shows "5 min".

### renderAutomateSection — TAB_SWITCH enabled shows On value
**Asserts:** Tab Switch row value is `automate_on` when TAB_SWITCH.ENABLED=true.
**Manual:** Enable tab switch; row shows "On".

### renderModesSection — blur-all active: #bl-mode-active gets blur-all and active classes
**Asserts:** `#bl-mode-active` has `bl-mode-block--blur-all` and `bl-mode-block--active`.
**Manual:** With `ACTIVE_MODE='blur-all'`, top block shows Blur All styling with amber accent.

### renderModesSection — blur-all active: #bl-mode-waiting gets pick-blur and waiting classes
**Asserts:** `#bl-mode-waiting` has `bl-mode-block--pick-blur` and `bl-mode-block--waiting`.
**Manual:** Bottom dimmed block shows "Pick & Blur" label.

### renderModesSection — pick-blur active: #bl-mode-active gets pick-blur and active classes
**Asserts:** `#bl-mode-active` has `bl-mode-block--pick-blur` and `bl-mode-block--active` when `ACTIVE_MODE='pick-blur'`.
**Manual:** With `ACTIVE_MODE='pick-blur'`, top block shows sky accent.

### renderModesSection — blur-all active block contains bl-blur-all-toggle checkbox
**Asserts:** `#bl-blur-all-toggle` checkbox exists inside `#bl-mode-active` for blur-all mode.
**Manual:** In blur-all mode, mode block contains a toggle switch.

### renderModesSection — bl-blur-all-toggle is checked when ENABLED=true
**Asserts:** `#bl-blur-all-toggle` is checked when `ENABLED=true`.
**Manual:** With blur enabled, toggle appears on.

### renderModesSection — bl-blur-all-toggle is unchecked when ENABLED=false
**Asserts:** `#bl-blur-all-toggle` is unchecked when `ENABLED=false`.
**Manual:** With blur disabled (but mode=blur-all), toggle appears off.

### renderModesSection — pick-blur active block contains bl-open-picker button
**Asserts:** `#bl-open-picker` button exists in `#bl-mode-active` for pick-blur mode.
**Manual:** In pick-blur mode, "Open Picker" button visible in top block.

### renderModesSection — blur-all active block contains subtitle with type and category count
**Asserts:** Active blur-all block has `.bl-mode-block__subtitle` whose text includes the blur type name and category count.
**Manual:** With `BLUR_MODE='gaussian'` and 4 categories enabled, subtitle shows "Gaussian · 4 categories".

---

## 22. storage_model.test.js — `tests/unit/storage_model.test.js`

Source module: `src/storage_model.js` → `blsi.Model`

| Group | What it asserts | User trigger | User impact |
|---|---|---|---|
| init_cache / get | `init_cache()` populates in-memory cache from `chrome.storage.local`; `get()` returns cached model without I/O | Any page load | Content script/popup reads stale or missing model |
| patch_section / save_settings | `patch_section(section, delta)` deep-merges and writes; `save_settings(patch)` routes to `model.global_default_settings` | Popup saves a setting | Setting change not persisted; reverts on reload |
| get_site_entry / set_site_entry / remove_site_entry | CRUD on `site_rules` array; `set_site_entry` upserts; `remove_site_entry` is no-op when absent | Site-specific settings changes | Wrong hostname entry modified; rules pile up without deduplicate |
| save_blur_state — ON path | `save_blur_state('example.com', true)` writes `blur_all:true` to the site entry | User enables blur-all for a site | Blur not persisted; off after page reload |
| save_blur_state — OFF path (3) | `save_blur_state('example.com', false)` writes `blur_all:false`; storage is written (not skipped); items on the same host survive the write | User turns off blur-all for a site | **Root cause of toggle-off bug**: `blur_all:false` not written, or written but items stripped as side-effect |
| save_blur_state — guards | Empty hostname → no storage write | Invalid popup state | Storage polluted with empty-hostname entries |
| get_cached_blur_state / get_blur_state | Synchronous cache read; inherits global when no per-host entry | Content script hot path (MO callback) | Wrong blur state used for site; MO triggers re-apply already-off blur |
| save_blur_item / get_blur_items | Appends dynamic and sticky items; deduplicates by selector / selectors[0] / id; enforces per-host limit of 10; rejects invalid types and null | Picker saves an element blur | Duplicate items accumulate; over-limit items accepted causing storage bloat |
| save_blur_item — new selectors[] shape (2) | Accepts `{ selectors: string[] }` shape; deduplicates by `selectors[0]` | Picker with multi-selector items | New-format items rejected; picker cannot save blurred elements |
| remove_blur_item | Removes item by id; does not affect other items | Popup → remove item | Item re-appears after removal; wrong item removed |
| clear_host / clear_all | `clear_host` clears blur_all + items + automate_blur for one host; `clear_all` clears everything atomically | Popup → clear site / clear all | Items from other sites deleted; or items survive after clear |
| resolve | Returns `engage = manual_blur \|\| automate_any`; includes `blur_items` and `shortcuts` | Content script init and storage change | Wrong blur-all state resolved; items not included in resolved settings |
| resolve: engage is true when only automate fires (manual = false) | `engage = true`, `automate_blur_only = true`, `automate_blur_skipped = false` when automate fires with no manual/pick blur | Start screen share on a site with no prior blur | Automate blur not applied; or applied with wrong flags |
| resolve: automate_blur_only uses default blur_mode and blur_radius | When `automate_blur_only = true`, `blur_mode` and `blur_radius` are reset to DEFAULT_MODEL values even if user configured custom values | Set frosted mode + custom radius; trigger screen share; check blur style | Automate uses user's frosted/custom radius instead of defaults |
| resolve: automate_blur_skipped = true when blur_all is already enabled | `automate_blur_skipped = true`, `automate_blur_only = false` when manual blur is on | Enable blur-all; start screen share; check resolved flags | Automate applies second blur-all on top of existing blur |
| resolve: automate_blur_skipped = true when pick_and_blur is enabled | `automate_blur_skipped = true`, `engage = false` when pick_and_blur enabled (no manual blur_all) | Enable pick-and-blur; start screen share; check resolved flags | Automate incorrectly adds blur-all when pick-blur is active |
| resolve: automate_blur_only and automate_blur_skipped are false when automate not firing | Both flags `false` with no automate active | No automate triggers set; resolve hostname | Spurious true on flags when automate is idle |
| get_rules / save_rules | Wildcard/regex rule CRUD | URL rules panel | Rules not saved; wrong rule applied to site |
| save_automate_blur / clear_automate_blur | Per-trigger write and clear for a hostname (idle + tab_switch only) | Automate triggers (idle, tab-switch) | Automate state not updated; blur persists after trigger ends |
| save_automate_blur rejects screen_share | `save_automate_blur('host', 'screen_share', true)` no-ops; entry has no `screen_share` key — that state lives in the global session record | Code path that mistakenly tries the legacy 3-trigger shape | Per-hostname automate_blur grows a stale `screen_share: true` and shadows the global record |
| save_automate_blur is a no-op when value already matches cache | Second `save_automate_blur('host','idle',true)` after the first does NOT call `chrome.storage.session.set` | Repeated `onIdle` writes within auto_blur, or any path that re-asserts the current trigger value | Cross-tab `chrome.storage.onChanged` re-enters `applyState` on every echo, tearing down the live idle timer and re-firing the toast |
| save_automate_blur writes when value flips back | `idle: true → false` issues exactly one session write | Genuine activity-driven `onActive` after an idle window | False-negative short-circuit; legitimate clear is dropped, idle blur sticks |
| patch_automate_blur is a no-op when patch results in identical entry | Same `{idle, tab_switch}` patch applied twice issues one write | Repeated `onActive` patches batched after multiple activities | Same loop as above via `patch_automate_blur` instead of `save_automate_blur` |
| patch_automate_blur writes when at least one trigger flips | One-key change with the other unchanged still issues a write | Switching only `tab_switch` while leaving `idle` as-is | Genuine partial flips silently dropped |
| set_screen_share_active / set_screen_share_inactive | `active` flag, `sharing_tab_id`, and `started_at` populated/cleared correctly | Background `onConnect` / `onDisconnect` for `'blsi-screen-share'` port | Tab record never reflects live share; mid-share opened tabs miss blur |
| resolve: sharing tab itself does NOT receive screen-share blur | `tab_id === sharing_tab_id` branch silences ss trigger for the sharer | User starts a share — the sharing tab should remain unblurred while others blur | Sharer's own page becomes unreadable mid-share |
| resolve: feature disabled silences screen-share blur | Even when `blsi_screen_share.active=true`, `automate.settings.screen_share.enabled=false` keeps `triggers.screen_share=false` | User disables the feature globally | Feature toggle ignored; tabs blur on every share |
| suppress_screen_share('site_session') | Hostname pushed to `blsi_screen_share.suppressed_sites[]`; only that host stops blurring | Toast or notif card → "This site (session)" | Other tabs on the same host keep blurring; or all hosts get suppressed |
| suppress_screen_share('tab') | Tab id pushed to `blsi_automate_suppressed_tabs`; ALL automate triggers (idle, tab_switch, screen_share) silenced for that tab | Toast or notif card → "This tab" | Idle/tab_switch keep firing on a "suppressed" tab; or per-tab leaks across tabs |
| suppress_screen_share('feature') | Flips `automate.settings.screen_share.enabled = false` AND clears the session record | Toast or notif card → "Disable feature" | Feature toggle stays on; session record left active |
| unsuppress_screen_share | Reverses tab + site_session suppressions | Popup notif card → "Undo" | Suppression is sticky; user can't recover without restart |
| set_screen_share_active resets per-tab suppression | A new share starts with empty `blsi_automate_suppressed_tabs` (mitigates Chrome tab-id reuse) | Two consecutive shares; suppress a tab during the first | Recycled tab id silently silenced in the next share |
| resolve: skip_reason = 'site_rule' | When a matching exact rule blurs the page AND screen-share is also live, `automate_blur_skipped=true` and `skip_reason='site_rule'` | Open popup mid-share on a site with a matching rule | Card shows wrong reason text or 4-action row instead of info-only |
| init_cache strips legacy automate_blur.screen_share | One-time migration on first load: legacy `{ idle, tab_switch, screen_share }` per-hostname entries are reduced to `{ idle, tab_switch }`; empty entries dropped | Upgrade from a build that wrote the legacy shape | Stale `screen_share: true` shadows the new global record |
| capture_snapshot (6) | Returns exactly SNAPSHOT_KEYS; values match default model; reflects in-flight changes; `blur_categories` and `pick_blur_color` are deep copies (mutations don't affect cache) | Popup "Save as site rule" form opens | Wrong keys in snapshot; object mutation corrupts cached model |
| save_site_snapshot (6) | Creates new exact rule with snapshot in `.settings`; updates existing rule (other fields preserved); replaces previous snapshot on second save; works for wildcard rules; rejects invalid hostname; rejects null snapshot | User clicks Save on site rule form | Snapshot not stored; existing items/blur_all lost; invalid input accepted |
| clear_site_snapshot (4) | Resets `.settings` to `{}` while preserving other rule fields; returns null from get_site_snapshot after clear; no-op when rule not found; no-op for invalid hostname | User removes snapshot from a rule | Other rule data (blur_all, items) lost; rule entry deleted; clear fails silently |
| get_site_snapshot (4) | Returns null when rule missing; null when settings is `{}`; returns settings object after save; null after clear | Popup list renders rule snapshot summary | Empty snapshot shown as non-empty; null returned for rules with saved snapshot |
| validate_model snapshot passthrough (5) | All SNAPSHOT_KEYS survive validate_model; unknown keys stripped; invalid blur_categories values repaired to defaults; invalid pick_blur_color repaired to defaults; empty `{}` survives as `{}` | Extension update triggers re-validation of stored model | SNAPSHOT_KEYS stripped on model migration; bad values accepted without repair |
| resolve with full snapshot (4) | Exact site_rule snapshot overrides all SNAPSHOT_KEYS in resolved output; wildcard rule snapshot overrides global; exact wins over wildcard; non-SNAPSHOT_KEYS come from global/feature settings | Content script resolves settings on page load | Snapshot not applied; wrong settings used; wildcard snapshot overrides exact |

**Manual replication for save_blur_state — OFF path:**
1. Install extension; navigate to any page (e.g. `https://example.com`)
2. Open popup → enable Blur All (toggle ON)
3. Use picker to blur at least one element
4. Open popup → toggle blur-all OFF
5. Reload the page
6. Open popup — blur-all toggle must remain OFF; blurred items must still be listed

---

## Known Test Quality Issues

| Module | Issue |
|---|---|
| `pii_detector` | NUMERIC regex was `\d{5,}` instead of `\d{4,}` in source — fixed 2026-04-17. Tests were correct; source was wrong. 4-digit account numbers were silently passing through. |
| `screenshot` | `download does not throw` is a vacuous test — jsdom cannot simulate anchor click behavior. The assertion only verifies the call does not throw, not that a download was initiated. |
| `screenshot` | `cancelCrop removes the overlay` has no DOM assertion — only verifies no-throw. If `cancelCrop` is a no-op, the test still passes. Needs a `document.querySelector` assertion against the overlay element. |
| `content_i18n` | Tests 2–7 cover the same API shape (`init`, `t`, `currentLang`) as the deleted `popup_i18n` tests, but using a different language resolution source (`navigator.language` vs the old `chrome.i18n.getUILanguage()`). |
| `selector_utils` | The entire class-based selector strategy branch inside `getSelector` (fallback via class name list when no `data-bl-si-id` and no element id) has zero test coverage. Selector correctness in class-heavy SPAs is untested. |
