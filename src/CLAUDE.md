# src/ — Module Authoring Guide

See `../CLAUDE.md` for the full project rules. This file covers src/-specific patterns.

## IIFE Pattern (mandatory)

Every file in src/ must follow this exact structure:

```js
/**
 * module_name.js — one-line purpose
 *
 * Exposed as blsi.Xxx (IIFE — no ES module syntax).
 */

const BlurrySiteXxx = (() => {
  'use strict';

  // private state here

  function publicMethod() { ... }

  return { publicMethod };
})();

blsi.Xxx = BlurrySiteXxx;
```

Rules:
- No `import` / `export` / `require` anywhere.
- One `window.*` assignment per file, at the very end.
- The global name is always `BlurrySite` + PascalCase module name.
- `'use strict'` inside the IIFE.

---

## Critical: Module Globals

Every source file exposes exactly one window global. Wrong name → silent `undefined` crash in page context.

## Module Load Order (enforced by manifest.json)

```
MAIN world (world:"MAIN", run_at:"document_start" — separate content_scripts entry):
  main_world_bridge.js  → no global; patches getDisplayMedia (posts '__blsi_screen_share' via postMessage)
                          and attachShadow (dispatches '__blsi_shadow_attached' on element)

Isolated world (run_at:"document_idle"):
 0. constants.js          → globalThis.blsi (message types + DEFAULTS)
 1. content_i18n.js       → blsi.ContentI18n (popup/content i18n loader: init, t, currentLang)
 2. logger.js             → blsi.Logger (flow logger; toggle persisted at chrome.storage.local.blsi_debug; cross-context sync via storage.onChanged)
 3. action_registry.js    → blsi.Actions (single source of truth for shortcut-driven actions)
 4. shortcut_label.js     → blsi.ShortcutLabel (platform-aware label rendering + canonical chord keys + reserved chord list)
 5. url_matcher.js        → blsi.UrlMatcher
 6. selector_utils.js     → blsi.SelectorUtils
 7. storage_model.js      → blsi.Model (direct chrome.storage access; single blsi_model key; resolve/patch/debounced_patch)
 8. tab_privacy.js        → blsi.TabPrivacy (title masking; enable/disable/isActive)
 9a. pii/pii_state.js      → blsi.PiiState (shared private state for PII sub-modules; PII_ATTR + match count + active types)
 9b. pii/pii_checksums.js  → blsi.PiiChecksums (pure-math checksum algos: luhn / verhoeff / mod97 / mod11Weighted / iso7064Mod11_2 / isbn13 / isbn10)
 9c. pii/pii_pre_filter.js → blsi.PiiPreFilter (Stage 0 whole-node drops: isExtensionUI, isInsidePiiSpan, isInsideCodeBlock, hasDigit)
 9d. pii/pii_country.js    → blsi.PiiCountry (page-country signal: detect / detectFromInputs / _resetCache; cached once per scan)
 9e. pii/pii_suppressors.js → blsi.PiiSuppressors (Stage 4 FP cascade: isYear/isVersion/isHexColor/isYearRange/isPercentage/isScientificNotation/isMeasurement/isResolution/isOrdinalLabel/isDateLike/isOrderRef/isPublicPrice/isCountNoise + falsePositivesCheck)
 9f. pii/pii_detectors.js  → blsi.PiiDetectors (Phase 5 consolidation: every detector is a frozen row in STAGE1_DETECTORS / STAGE2_DETECTORS driven by unified _runDescriptor — Stage 1 dispositive → identifier sub-pass → Stage 2 country/keyword-gated → Stage 3 NUMERIC_RE)
 9g. pii/pii.js            → blsi.PiiDetector (facade; scan/clear/handleMutations/getMatchCount/getPatterns)
10. fonts.js              → blsi.Fonts (embedded WOFF2 font assets; FONT_FACE string for "bl-si-redact-asterisk")
11. core/engine_state.js  → blsi.EngineState (shared private state for engine sub-modules)
12. core/categories.js    → blsi.Categories (frozen tag/role data; CATEGORY_SELECTORS / CATEGORY_ORDER / DEFAULT_CATS)
13. core/css_manager.js   → blsi.CssManager (blur-all + pick-blur + PII rule injection; selector cache; SVG filter)
14. core/marker_engine.js → blsi.MarkerEngine (element stamping; applyBlur/removeBlur/isBlurred; matchesActiveCategories)
15. core/observer.js      → blsi.Observer (one MO per root + idle-batched drain + subscriber pub/sub)
16. core/target_engine.js → blsi.TargetEngine (zones + dynamic items + popup-hover highlight; reconcileItems)
17. engine.js             → blsi.Engine (facade + orchestrator; handleSite/teardown/unblurAll; re-exports core/*)
18. automate/state.js     → blsi.Automate.State (shared phase enums + KEYS + read/write/ignore helpers; per-trigger ignore_tabs/ignore_sites; both contexts)
18a. automate/screen_share.js → blsi.Automate.ScreenShare (postMessage bridge; init/destroy/whoAmI/getTabId — listens for window 'message' with type '__blsi_screen_share' from MAIN world, opens port 'blsi-screen-share' + sends SCREEN_SHARE_STARTED/ENDED; port disconnect = crash-safety)
18b. automate/overlay.js  → blsi.Automate.Overlay (viewport overlay primitive; show/hide/update; content only)
18c. automate/visibility.js → blsi.Automate.Visibility (per-tab Page Lifecycle observer; init({tab_id})/destroy)
18d. automate/manager.js  → blsi.Automate.Manager (automate orchestrator; drives Overlay from live state via Model.on_automate_change; init({tab_id,get_host_url,ss_stop_actions})/destroy/on_url_change — only screen-share carries action buttons; idle is persistent info-only, tab-switch is a 3s info notification)
20. reveal_controller.js  → blsi.Reveal
20a. toast.js             → blsi.Toast (in-page floating toast; show/dismiss/clearIfTransient — distinct from popup_ui toast)
21. shortcut_handler.js   → blsi.Shortcuts
22. selection_blur.js     → blsi.SelectionBlur (text selection blur; init/destroy/blurSelection/clearAll)
23. screenshot.js         → blsi.Screenshot (viewport capture; captureViewport/download/copyToClipboard)
24. picker.js             → blsi.Picker
25. content_script.js     → (no global, binds all above)
```

A module may only depend on modules loaded before it.
`content_script.js` binds all globals to local aliases inside `init()` (after DOM ready), not at top-level.

---

## Module-Specific Rules

### pii/pii_state.js
- Shared private state for the PII sub-modules. Internal `_matchCount` (number) and `_activeTypes` (object | null) are private; only mutate via the exposed setters (`incrementMatchCount` / `resetMatchCount` / `setActiveTypes` / `clearActiveTypes`).
- `PII_ATTR` is the single source of truth for the data attribute name used on PII spans (`data-bl-si-pii`). Every other PII module must read it from here — never hard-code the string.
- `getActiveTypes()` returns the current `{ email, numeric }` object or `null` (= unseeded). Modules treat `null` as "no scan has run yet" and no-op accordingly.

### pii/pii_checksums.js
- Pure-math validators consumed by Stage 1 + Stage 2 detectors. No DOM, no storage, no globals — every function takes a string + (where parameterised) numeric weights and returns a boolean or numeric residue.
- Phase 3 + Phase 4 ship: `luhn` (mod-10 — PAN, IMEI, SIN, NPI), `verhoeff` (Aadhaar D5-group), `mod97` (IBAN, ISO 13616), `mod11Weighted` (NHS / BSN / Personnummer — generic, returns residue 0..10 or -1), `iso7064Mod11_2` (Chinese resident ID, accepts `'X'` for 10), `isbn13` (weighted mod-10), `isbn10` (weighted mod-11, accepts `'X'` for 10).
- Deferred (no consumer yet): `bech32` / `base58check` (BTC wallets), `mod89` (AU ABN), `iso7064Mod11_10` (DE Steuer-ID), letter-tables (Codice Fiscale / DNI / NIE / NRIC SG). Each lands alongside the detector that needs it.
- Adding an algorithm: pure function in this file → `describe` block in `pii_checksums.test.js` → entry in `pii_checksums.md` Public API → entry in `pii_checksums.tests.md` Test File Layout → consumer detector in `pii_detectors.js`.

### pii/pii_pre_filter.js
- `isExtensionUI(node)` enumerates the 6 extension-owned ancestor selectors and returns `true` for any descendant of those — so the PII scan skips toolbars, popups, picker UI, etc.
- `isInsidePiiSpan(node)` reads `PII_ATTR` from `blsi.PiiState` (do NOT hard-code the attribute name) and returns `true` for any node already inside a PII wrapper — prevents re-wrapping during mutations.
- Phase 1 will add `isInsideCodeBlock` + the M1 digit pre-screen here. Keep all whole-node drop heuristics in this module — pattern modules must not re-implement them.

### pii/pii_country.js
- Page-level country signal — `detect()` (DOM-aware, cached) + `detectFromInputs(inputs)` (pure) + `_resetCache()`. Returns ISO 3166 alpha-2 or `null`.
- Priority chain: meta tags (`geo.country`, `og:locale`, `content-language`) → `<html lang>` (region subtag required, bare `en` rejected) → ccTLD allow-list (~45 entries; `.io` / `.me` / `.tv` / `.co` deliberately excluded as gTLDs) → currency-density (single-country symbols only: `£`/`₹`/`₩`/`₽`; threshold ≥3 occurrences in first 1000 chars).
- Cache lifecycle (PERF.md M6): `detect()` runs at most once per scan even on heavy pages with thousands of text nodes. Facade `pii.scan()` calls it at the top and seeds `blsi.PiiState.setCountry(...)`. `_resetCache()` clears for SPA invalidation paths + tests.
- Adding a ccTLD: append to `_TLD_TO_COUNTRY` in source + add a TP test (`example.<tld> → <country>`) in `pii_country.test.js` + bump the contract list.
- Adding a currency symbol: append to `_CURRENCY_HINT` only if the symbol maps to a single country. Multi-country symbols (`$`, `€`, `¥`) belong nowhere — they hurt precision more than they help.

### pii/pii_suppressors.js
- `NUMERIC_PROFILE` (`'precise' | 'aggressive'`) is a developer-only constant inside the IIFE. Users only see on/off.
- **falsePositivesCheck pattern**: each check is `(matchText, text, matchIndex) => boolean`. Return `true` to suppress.
- **Adding a check**: (1) write the function, (2) decide which **cost tier** it belongs in and add to that tier array (`_CHECKS_STRUCTURAL` for match-self / ~1µs; `_CHECKS_TRAILING` for next 4–10 chars; `_CHECKS_PRECEDING` for back 30 chars; `_CHECKS_KEYWORD_50` for ±50-char window; `_CHECKS_KEYWORD_LARGE` for ±100/150-char window), (3) confirm it appears in the spread inside `FALSE_POSITIVE_CHECKS.precise` (added automatically since the array spreads the tier arrays), (4) add tests, (5) update `docs/contracts/pii/pii_suppressors.tests.md`.
- `falsePositivesCheck` delegates to `falsePositivesCheckCascade` when profile is `'precise'`; cascade walks tiers in cost order with `||` short-circuit between tiers and `Array.some` short-circuit within each tier. Never put suppression logic in pattern modules — keep it here.
- Active profile checks: `precise` runs all 14 (Phase 1 Tier-A: isHexColor, isYearRange, isPercentage, isScientificNotation, isMeasurement, isResolution, isOrdinalLabel, isDateLike, isOrderRef; Phase 5: isStatistic; alongside the original isYear/isVersion/isPublicPrice/isCountNoise); `aggressive` runs only `isVersion`.
- `isYear` suppresses 4-digit numbers in 1000–2099 (dates, copyright years).
- `isVersion` suppresses numbers preceded by `v`/`V` or followed by `.digit` (semver build numbers).
- `isHexColor` suppresses 3/6/8-hex strings preceded by `#`.
- `isYearRange` suppresses `YYYY-YYYY` / `YYYY YYYY` with both endpoints in 1000–2099.
- `isPercentage` / `isScientificNotation` — trailing `%` / `e[+-]?\d`.
- `isMeasurement` — trailing unit token (`KB`/`MB`/`GHz`/`fps`/`°C`/`km`/`kg`/`sec`/`min`/`hr`/etc.).
- `isResolution` — `\d+[ ]?[x×:][ ]?\d+` pattern.
- `isOrdinalLabel` — preceding multilingual ordinal precursor (`Section`/`Chapter`/`Page`/`Step`/etc., 30-char window).
- `isDateLike` — ISO 8601 / slash / dot / week / ordinal-date structural fingerprints + multilingual `date`/`posted`/`expires`/etc. keyword window (50 chars). Keyword fallback gated on match-shape (≤10 chars, no `+`, matches `\d{1,4}` bare or `\d{1,4}[ /.\-]\d{1,4}(?:[ /.\-]\d{1,4})?`) so phone / account numbers near date keywords are NOT suppressed.
- `isOrderRef` — multilingual `order`/`tracking`/`invoice`/`case`/`SKU`/`ISBN` keyword window (50 chars).
- `isStatistic` — `p<`/`n=`/`CI`/`SD`/`SE`/`R²`/`r=`/`cohort`/`confidence interval`/`sample size` keyword window (30 chars). Suppresses figures in research papers and stats dashboards.
- `isPublicPrice` suppresses matches near multilingual price keywords: `/month`/`cart`/`qty`/`quantity`/`units`/`rating`/`reviews`/`stars`/`price`/`cost`/`total`/`subtotal`/`sale`/`discount`/`MRP` + ES/FR/DE/IT/JA/ZH/HI equivalents (100-char window).
- `isCountNoise` suppresses matches near multilingual engagement keywords: `unread`/`notifications`/`messages`/`followers`/`likes`/`views`/`comments`/`results`/`stock`/`available`/`inventory`/`page`/`of` + ES/FR/DE/JA/ZH/HI equivalents (150-char window).

### pii/pii_detectors.js
- Pattern catalog + match finder. `EMAIL_RE`, `NUMERIC_RE`, `PATTERNS`, `STAGE1_DETECTORS`, `STAGE2_DETECTORS`, `findMatches(text, types)`, `getPatterns()`.
- **Phase 5 consolidation** — every detector is a frozen row in `STAGE1_DETECTORS` (dispositive) or `STAGE2_DETECTORS` (context-gated) driven by a single `_runDescriptor` runner. Adding a detector is a one-row data change. Users see one `numeric` toggle; per-detector behaviour is configured by maintainers via descriptor rows — there is **no popup UI exposing individual detectors**. Do not introduce per-detector user-facing config.
- **Descriptor shape**: `{ id, regex, checksum?, dispositive?, countries?, keywordRe?, keywordWindow?, action, preScreen? }`. Decision flow: `preScreen` -> overlap -> `checksum` -> context-gate (`dispositive` ? PASS : `country in countries` ? PASS : `keywordRe` matches window ? PASS : SKIP) -> push to `consumed[]` + (if `'emit'`) `matches[]`.
- **`findMatches` runs four layers** in order, sharing a per-call `consumed[]` tracker: Stage 1 (`_runStage1` over `STAGE1_DETECTORS`) -> identifier sub-pass (`_runIdentifierPass` — DISPOSITIVE_RES + PREFIX_RE) -> Stage 2 (`_runStage2` over `STAGE2_DETECTORS`) -> Stage 3 (NUMERIC_RE + Stage 4 FP cascade). SUPPRESS-action detectors (ISBN-13) push to `consumed[]` without emitting (anti-PII).
- **Stage 1 dispositive set** (shape-bound or shape+checksum, no country/keyword required): `card_pan` (Luhn + IIN), `iban` (mod-97 + country-length), `eth_wallet`, `isbn_13` (suppress), `e164_phone` (`+` prefix), `aadhaar` (Verhoeff), `cn_id` (ISO 7064 mod-11-2), `nric_sg`, `curp_mx`, `emirates_id`, `nie_es`, `codice_fiscale`, `postal_uk`, `postal_ca`, `ipv6`, `gps_dms`, `plus_code`. Letter-table validators (Codice Fiscale, NIE, NRIC) deliberately **dropped** in favour of country-aware positional shape — see "checksum policy" below.
- **Stage 2 context-gated set** (validators read country signal + keyword window): `mac_address` (shape), `ipv4` (private-range suppress + keyword), `imei` (Luhn + keyword), `ssn_us` (range gate + US/keyword), `nhs_uk` (mod-11 + GB/keyword), `bsn_nl` (11-test + NL/keyword), `npi_us` (Luhn(80840+) + keyword), `dni_es` (ES/keyword), `abn_au` (AU/keyword), `mrn` (medical keyword), `postal_jp/au/nl/br`, `us_zip4`, `eircode_ie` (all country-gated to avoid shape collisions).
- **Adding a detector** in 4 steps: (1) regex constant near the top of the file in the right grouping; (2) optional checksum function — if it requires a new algorithm, add to `pii_checksums.js` first with its own tests + contract entry; (3) frozen descriptor entry in the right array (Stage 1 if dispositive, Stage 2 otherwise); (4) integration test in `pii.test.js` (drive country via `<html lang>`, NOT `blsi.PiiState.setCountry()` — the facade clobbers it during scan).
- **Checksum policy**: keep cheap algorithms with Stage-4 cascade savings (Luhn, Verhoeff, mod-97, mod-11 weighted, ISO 7064 mod-11-2, ISBN-10/13). Skip heavy or marginal ones — letter-table validators (Codice Fiscale / DNI / NIE / NRIC SG) drop in favour of country-aware positional shape; Base58Check / bech32 (BTC) deferred entirely (use prefix + keyword if/when added). Tradeoff: ~1% extra FP for letter-table-shaped IDs without country gate, ~0% on country-gated pages.
- **Pattern order matters in `NUMERIC_RE`**: 7 alternations (currency-prefix / currency-code-suffix / comma-thousands / **parens-phone** / cc-and-2-digit-phone / phone-like-fallback / bare-4+-digits). Phone-form separator class is `[ \- ]` — NBSP via `\u00A0` escape (raw NBSP gets lost on copy-paste).
- **Identifier-context sub-pass** runs after Stage 1, before Stage 2. Bespoke logic (does NOT use `_runDescriptor`) because PREFIX_RE captures a value group that the generic descriptor shape doesn't model. Two passes: `DISPOSITIVE_RE` (single alternation regex combining 18 provider patterns: Bearer / AKIA / ghp_ / github_pat_ / sk_/pk_ / AIza / xox- / JWT / glpat- / sk-ant- / sk- / SG. / npm_ / pypi- / AC / dop_v1_ / dckr_pat_ / hf_) + `PREFIX_RE` (`KEYWORD[: = # - --] value`). Value-validator: `length >= 12` AND contains at least one non-letter character AND not all-same-char.
- `findMatches` retrieves cached regex instances via `blsi.PiiState.getCachedRegex(prototype)` — never call `.exec()` on a live pattern object directly (lastIndex would persist).
- Calls `blsi.PiiSuppressors.falsePositivesCheck` only on the Stage 3 NUMERIC_RE path — email matches and Stage 1/2 hits skip the suppressor cascade entirely.
- Sorts and de-overlaps results before returning so the facade can splice text right-to-left without conflicts.

### pii/pii.js
- Facade — exposes `scan(rootEl, types, onDone?)`, `cancelChunkedScan()`, `clear(rootEl)`, `handleMutations(mutations, root)`, `getMatchCount()`, `getPatterns()` as `blsi.PiiDetector`. Public global name preserved from the pre-split single file for backward compat.
- PII spans carry `[data-bl-si-pii="email"|"numeric"]` only — no `[data-bl-si-blur]`. Independent of blur-all.
- `scan(rootEl, types, onDone?)` — `TreeWalker(NodeFilter.SHOW_TEXT)` collects all text nodes first. When `onDone` is provided, processing is **chunked** across idle callbacks (`CHUNK_SIZE = 500` nodes per tick) to avoid long-task violations; `onDone(totalCount)` fires on completion. Without `onDone`, runs synchronously (legacy/test path). Skips extension UI (`PiiPreFilter.isExtensionUI`) and already-wrapped nodes (`PiiPreFilter.isInsidePiiSpan`).
- `cancelChunkedScan()` — cancels any in-flight chunked scan. Called by `content_script.applyState` on PII-disable path.
- `_wrapTextNode(textNode, matches)` — processes matches **right-to-left** so earlier offsets stay valid after each `splitText`. Each match: `splitText(end)` then `splitText(start)` then `replaceChild(span, matchNode)`. Spans carry `[data-bl-si-pii]` only — no `[data-bl-si-blur]`.
- `clear(rootEl)` — removes all `[data-bl-si-pii]` spans, restores text, resets match count via `PiiState.resetMatchCount()`. Does NOT clear active types — a subsequent `handleMutations` after `clear` is still meaningful.
- `handleMutations(mutations, root)` — subscriber to the engine's mutation dispatcher. Handles `childList` (new TEXT_NODE → wrap; new ELEMENT_NODE → scan subtree) and `characterData` (text node whose `textContent` changed → wrap matches). Skips text nodes already inside a `[data-bl-si-pii]` wrapper. **No-op when `PiiState.getActiveTypes()` returns `null`** — `scan()` must run first to seed it. **Buffers mutations** when a chunked scan is in progress (`_scanComplete === false`) — buffer is drained after the final chunk completes. `cancelChunkedScan` discards the buffer.
- PII detector owns no observer; `content_script.applyState` calls `Engine.subscribeMutations('pii', handleMutations)` when PII is enabled.
- **Cross-node keyword lookaround** — `_processTextNode` has a fallback for digit-only text nodes in their own element (e.g. `<span>90002883607</span>`): when `findMatches` returns empty, `_precedingText(tn, 120)` walks backward through siblings/parents (stops at block-level boundaries) and `hasKeywordTrail` checks for a trailing PII keyword. Rescues values suppressed by `isYear` or too short for NUMERIC_RE when a keyword like "Customer ID:" precedes in a sibling element.
- `blur_engine.isVisuallyBlurred` returns `true` for `element.dataset.blSiPii` — reveal_controller can find and reveal PII spans.

### engine.js + core/*

**Navigation**: the engine is split across `src/engine.js` (facade + orchestrator) and `src/core/*` (sub-modules). For any change, read the matching contract first:

| Change | Contract |
|---|---|
| Category data (tags / roles) | `docs/contracts/core/categories.md` |
| CSS injection (any of the three systems) | `docs/contracts/core/css_manager.md` |
| Stamping / element queries / picker apply / reveal predicates | `docs/contracts/core/marker_engine.md` |
| MutationObserver, idle drain, mutation dispatcher | `docs/contracts/core/observer.md` |
| Zones, items, counters, popup highlight | `docs/contracts/core/target_engine.md` |
| Cross-cutting state (`isPageBlurred`, `currentSettings`, etc.) | `docs/contracts/core/engine_state.md` |
| Top-level handleSite / teardown / facade re-export | `docs/contracts/engine.md` |

The original section markers (`§CATEGORY-SELECTORS`, `§CSS-INJECTION`, etc.) are preserved as comments at the top of each `core/*` file for orientation. Test groups in `tests/unit/engine.test.js` mirror those markers.

- `applyBlur` is idempotent — guards via direct `element.dataset.blSiBlur` attribute check, NOT `isBlurred()`. `isBlurred()` is used by picker / context-menu unblur paths to check whether a clicked element has a stored item; those paths intentionally ignore role-only matches because there is no storage entry to remove.
- Two blur checks:
  - `isBlurred(el)` — "is this stamped or tag-rule blurred?" Used by picker.js and content_script.js (context-menu ancestor walk).
  - `isVisuallyBlurred(el)` — same as `isBlurred` PLUS role-based CSS matches (`<button role="tab">` under FORM, etc.). Used by reveal_controller.js for ancestor / descendant walks so hover reveal can clear filter on role-matched parents. Do NOT widen `isBlurred` to subsume this — it would route picker clicks on role-blurred elements into unblur paths that silently no-op against storage.
- Video elements use `videoOverlayMap` (WeakMap) to track canvas + RAF handle. Never store canvas on `el._pbCanvas` — that was a previous iteration.
- Canvas class must be `"bl-si-canvas-overlay"` exactly. CSS in `styles/content.css` references this.
- IMG blur: `data-bl-si-blur` attribute + CSS rule `[data-bl-si-blur] { filter: blur(var(--bl-si-radius)) }`. No inline `style.filter`.

#### Zone overlay methods
- `createZoneOverlay(zoneData)` appends an overlay `<div>` to `document.body`. Overlays use the `data-bl-si-zone` attribute (set to `zoneData.id`) for identification.
- **Anchor**: `zoneData.anchor` is `'page'` (default) or `'screen'`.
  - `'page'` → `position: absolute`; coordinates are document-space; the zone scrolls with the page content. `_applyStickyItem` re-projects via `xPct`/`yPct` against the current `scrollWidth`/`scrollHeight` to survive layout changes. Applies on every page under its host (no per-path scoping).
  - `'screen'` → `position: fixed`; coordinates are viewport-space; the zone stays on screen during scroll. Raw `x`/`y` are used as-is. Applies on every page under its host.
- Overlay stamps `data-bl-si-zone-anchor="page"|"screen"` for debugging/CSS.
- `removeZoneOverlay(zoneId)` removes the overlay matching `zoneId` from DOM and internal tracking.
- `getZoneOverlays()` returns an array of all active zone overlay elements.
- `removeAllZoneOverlays()` removes all zone overlays from DOM and tracking.
- `unblurAll()` also calls `removeAllZoneOverlays()` to clean up zones alongside blurred elements.
- `_isExtensionUI` excludes zone overlays (elements with `bl-si-zone-overlay` class) from being treated as blur targets.

#### Category-based blurring
- `CATEGORY_SELECTORS` is a frozen constant mapping each category to `{ alwaysBlur: string[], textCheck: string[], roles?: string[] }`. Keys are UPPER_SNAKE_CASE: TEXT, MEDIA, FORM, TABLE, STRUCTURE. Element lists sourced from `docs/BLUR_CATEGORIES.md`.
- Selector cache (`selectorCache`) stores pre-joined selector strings keyed by a category toggle string — rebuilds automatically on key miss via `getSelectors(cats)`, no manual invalidation needed. The cache entry carries both `tagSet` and `roleSet` for the JS consumers.
- `matchesActiveCategories(element, categories)` uses the cached `tagSet` for O(1) tag lookup first, then falls through to a `getAttribute("role")` + `roleSet` check for ARIA role coverage (currently FORM only — `<div role="button">` etc.). `shouldBlurElement` was deleted — it had zero production callers and duplicated decision logic that lives in `_evaluateAndStamp`.
- `CATEGORY_SELECTORS` entries may include an optional `roles` list. `buildSelectors` emits `[role="X"]` attribute selectors into the generated `alwaysBlurSelector` CSS string so the browser handles role matching natively; do NOT hand-edit the selector string — only mutate roles by editing the `CATEGORY_SELECTORS` data shape.
- `_structuralTags` is derived from `STRUCTURE.textCheck` and prevents thorough-mode bypass for structural containers (`<div>`, `<section>`, etc.) to avoid nested-blur leaks on hover reveal. `<li>`/`<dt>`/`<dd>` were moved to `STRUCTURE.alwaysBlur` (not textCheck) so CSS injection covers `::marker` pseudo-elements unconditionally — they are no longer in `_structuralTags`.

#### Single orchestration entry point: `handleSite(settings)`
- `async handleSite(settings)` — one arg: the full resolved settings snapshot from `blsi.Model.resolve(hostname, url)`. The resolved object already includes `engage` and `blur_items` — no caller-side fold needed. Handles enable / disable / refresh / item diff / extension-disabled teardown in one pass. Safe to call from any path — init, storage onChange, shortcut, picker callback, SPA URL change.
- `engage` (boolean) and `blur_items` (array) are included in the resolved settings by `blsi.Model.resolve()`. Engine never reads storage — all data arrives via the settings argument.
- `handleSite` internally calls `handleDocument(settings, document)`; the MO drain calls `handleDocument(settings, sr)` for each newly-attached shadow root. One function, both root types — see `engine.js`. Iframes: same-origin are self-managed via `all_frames:true`; cross-origin iframes are stamped by `handleIframe` in the MO callback when dynamically inserted.
- `handleDocument(settings, root)` — one root (document or shadow root). Active path: injectRules + observeRoot + queue stamp work. When `root === document` it also calls `Obs.initShadowAttachListener()` and replaces the stamp queue. Inactive path: `teardown(root)`.
- `handleIframe(settings, iframeEl)` — cross-origin iframes only. Stamps `data-bl-si-blur='1'` on the `<iframe>` element itself when active (CSS filter blurs the rendered output as an opaque box). Skips same-origin iframes (their own content_script handles blur via `all_frames:true`). Called from the `observeRoot` MO callback when an iframe is dynamically inserted.
- `teardown(root)` — disconnects observer, removes injected style, clears stamps, recurses into shadow roots. Used by `unblurAll()` (alias: `teardown(document)`) and the inactive path of `handleDocument`. The `querySelectorAll('*')` stamp-clearing pass already covers `<iframe>` elements — no separate cleanup needed.
- `injectRules(root, categories, mode)` — injects a `<style id="bl-si-blur-styles">` into `root.head ?? root`. Stateless — no DOM branch on root type. Calls `removeRules(root)` first (replace semantics).
- `removeRules(root)` — removes the injected style from `root.head ?? root`.
- `stampElements(root, categories, thorough, mode)` — single `querySelectorAll('*')` pass; stamps `data-bl-si-blur` on text-check elements, returns discovered `ShadowRoot[]`.
- `observeRoot(root)` — attaches a `MutationObserver` to `root.body ?? root`, keyed in `_observers` (WeakMap, auto-GCs with detached shadow roots). MO callback gated by `_pickerActive || (!_isPageBlurred && !_pickBlurDynamicActive)` — runs whenever blur-all OR any dynamic pick-blur item is active. Idle drain calls `tryBlurTextCheck` + shadow/iframe handling when `blurAllOn`; calls `_tryPickBlurNode` when `pickBlurOn`.
- Private state: `_isPageBlurred`, `_pickBlurDynamicActive` (true when ≥1 active dynamic pick-blur item; drives MO gate for pick-blur-only users), `_observers` (WeakMap), `_handling` (mutex), `_elementCounter`, `_pageAreaCounter`, `_screenAreaCounter`, `_pickerActive`, `_currentSettings`, `_activeItems` (Map of currently-applied items by id). Do not introduce parallel state in callers.
- Internal helpers `applyItem(item)` / `removeItem(item)` are private. `allocateElementName()` / `allocateStickyName(anchor)` / `resetCounters()` remain public — picker callbacks need them for item naming before writing to storage.
- Item reconciliation via `_activeItems` Map (keyed by `selector` for dynamic, `id` for sticky). Items in desired but not tracked → `applyItem`; tracked but not in desired → `removeItem`. Counter seeding happens inside `applyItem` — high-water mark from item names, so callers only need `resetCounters()` once on init.
- MutationObserver reads `_currentSettings.THOROUGH_BLUR` fresh on every callback — never capture settings in a closure.
- `isBlurAllActive()` — stateless DOM check (`document.head.querySelector('#bl-si-blur-styles')`). `get isPageBlurred` is the state-based getter — callers should prefer it.
- `handleSite` is pure w.r.t. storage. Tests call it directly with inline settings — no storage stubs needed. See `tests/unit/blur_engine.test.js`.

#### CSS Specificity Model — invariants (do not break)

Three CSS systems can co-exist on one element: blur-all, pick-blur, PII. Each system **owns its elements exclusively**. Two mechanisms enforce this:

**1. EXCLUDE contract**
`EXCLUDE` is the `:not(...)` chain appended to every tag in `alwaysBlurSelector`. It must include every independently-managed blur attribute so blur-all's tag-based CSS never matches those elements. Current entries relevant to blur ownership:
- `:not([data-bl-si-pick-blur])` — pick-blur owns those elements
- `:not([data-bl-si-pii])` — PII detection owns those elements

Root cause of past bugs: tag selectors (e.g. `p:not(...)`) have specificity `(0,7,1)` while attribute selectors (`[data-bl-si-pick-blur]`) have `(0,3,0)`. Without exclusion, the tag rule wins regardless of source order.

**2. Stamp ownership guard**
Per-element stamping decisions (competing-blur guard, custom-element host, text-check tag with structural / inline-with-slot fallback) live in the private `_evaluateAndStamp` helper inside `core/marker_engine.js`. Both `stampElements` (full-document forEach) and `tryBlurTextCheck` (MO drain single-element entry) delegate to it — the previous divergence between the two paths (custom-element branch only on `stampElements`) is structurally prevented. Current guard at the top of `_evaluateAndStamp`:
```js
if (el.dataset.blSiBlur || el.dataset.blSiPickBlur || el.dataset.blSiPii) return;
```
`<iframe>` is intentionally NOT routed through `_evaluateAndStamp` — `stampElements` has its own inline iframe branch (full-pass only) and the MO drain handles late-loading iframes through `Engine.handleIframe` directly. Adding a third entry-point that should share these decisions: call `_evaluateAndStamp(el, cats, thorough)` rather than re-implementing the gate.

**Cascade priority (high → low)**: reveal > pick-blur / PII > blur-all

**Adding a new blur-all mode** — update `injectRules` + `blurDecl` only. No EXCLUDE changes needed; existing exclusions already cover all competing systems.

**Adding a new competing blur system (new attribute)** — checklist:
1. Add `:not([data-attr])` to `EXCLUDE`
2. Add `el.dataset.blSiNewAttr` guard to `_evaluateAndStamp` (one place — both stamp paths pick it up)
3. Add reveal override for the new attribute in both `injectRules` reveal block and `content.css`

### url_matcher.js
- `matchesPattern(url, pattern, patternType)` — wildcard mode uses parse-then-match (scheme / hostname / port / path) with domain-boundary awareness. Regex mode rejects nested quantifiers (`(a+)+`, `a**`) to prevent ReDoS.
- `resolveSettings(url, globalSettings, rules)` — deep-merge over `blsi.DEFAULT_MODEL`, apply first matching rule. Non-array / null `rules` is tolerated.
- `MAX_PATTERN_LENGTH = 500`. Patterns exceeding this return `false` from `matchesPattern`.
- Pure module — no DOM access, no storage. Safe to load early in the manifest order (position 2, right after constants).

### reveal_controller.js
- `init({ getMode, isPickerActive })` — both are **functions**, not values. Called on every event, so the caller never has to re-init when `settings.REVEAL_MODE` or picker-active state changes.
- `clearAll()` resets every piece of reveal state: click-revealed element, hover-revealed element, ancestor chain, mouseout debounce timer, `_revealedElements` set. Called from `applyState` on `REVEAL_MODE` change and on `!settings.ENABLED`.
- `destroy()` removes all document listeners + `clearAll()`. Only used on disable paths.
- Listeners are registered at capture phase on `document` for mouseover/mouseout, bubble phase for click/keydown. Input / textarea / select / button / contenteditable targets are skipped inside `onRevealClick` — do not move that guard.
- Hover mode has a 50ms mouseout debounce via `setTimeout`; reset on any mouseover to avoid flicker on element boundaries.
- **Reveal is attribute-driven, not inline-style.** `_revealElement` stamps `data-bl-si-reveal="1"` on every element — zone overlays included. CSS rules in `styles/content.css` + injected `<style>` handle all modes: `[data-bl-si-pick-blur][data-bl-si-reveal]` clears filter/background/color; `.bl-si-zone-overlay[data-bl-si-reveal]` additionally clears `backdrop-filter` and `background` (covers blur, frosted, and color zone modes). No inline styles used for reveal. Trade-off: `background-color: transparent` may strip legitimate element backgrounds during reveal; acceptable since reveal is temporary.
- No JS mode branching needed. The CSS overrides are no-ops for properties the active blur mode doesn't set.

### selector_utils.js
- `getSelectors(el)` returns `string[]` ordered structural→semantic (index 0 = most structural). Use for saving — call sites store `item.selectors = getSelectors(el)`.
- `getSelector(el)` is a compat alias → `getSelectors(el)[0] ?? null`. Returns a string or null (never an array).
- `getSelectors(body)` / `getSelectors(documentElement)` / `getSelectors(null)` must return `[]`.
- `restoreSelector(string | string[])` — accepts either. Tries each entry until `querySelectorAll().length === 1`; returns that element. Returns `null` if nothing matches.
- `isSelectorStable(el)` — fast O(1) heuristic: returns `true` if element has id, aria-label, non-bl-si classes, or a stable data-* attr. Does NOT run querySelectorAll. Used by picker hover to show the "may not persist" warning.
- Strategy order in `getSelectors`: 0=full-structural 1=anchored-structural 2=class-combo 3=aria-label 4=data-attrs 5=#id. Only emits a selector if `querySelectorAll().length===1` (uniqueness gate).
- `generateId()` returns an 8-char lowercase hex string.

### storage_model.js
- Accesses `chrome.storage.local` (model) and `chrome.storage.session` (automate_blur) directly — no background relay. Model data lives under the single `blsi_model` key. Automate blur state lives under `blsi_automate_blur` in session storage (auto-cleared on browser close/crash).
- `init_cache()` — must be called once (by content_script/popup init) before any `get()` or `patch_section()` calls. Loads `blsi_model` from local storage into `_cache` AND loads screen-share + suppressed-tabs session keys. Idle + tab_switch caches live in `blsi.Automate.State` and self-hydrate.
- `on_change(listener)` — registers a callback fired whenever the cached model changes (from storage `onChanged`). Single subscriber — calling twice replaces the first. Popup uses this to react to cross-context updates.
- `get()` — returns the full cached model. Never reads storage directly after init; always returns from cache.
- `patch_section(section, delta)` — deep-merges `delta` into the named section, writes the updated model back to storage, and updates cache. Use for deliberate user-triggered saves.
- `debounced_patch(section, delta, delay?)` — same as `patch_section` but batches rapid calls (default **150 ms**). Use from popup inputs to avoid saturating storage writes.
- `save_settings(patch)` — merges a partial settings patch into `model.global_default_settings`. Pass only the keys you want to update; unspecified keys are preserved.
- `resolve_settings(hostname, url, tab_id?)` — **engine surface**. Folded settings + `engage` (= `(enabled !== false) && manual_blur`). Excludes automate decision fields. Used by `content_script._sync` / `handleStorageChange` / `onUrlChange` / init.
- `resolve_automate(hostname, url, tab_id)` — **Manager surface**. Returns `automate_blur_active`, `automate_blur_triggers`, `screen_share_state`, `screen_share_suppressed_*`, `automate_idle/_tab_switch/_screen_share` (gate settings post-rule fold), `_rule_match`, `_rule_overrides_automate`. Used exclusively by `blsi.Automate.Manager`. Each automate trigger fires independently of manual blur — there is no skipped/automate-only classification.
- `resolve(hostname, url, tab_id?)` — backward-compat shim returning `{...resolve_settings, ...resolve_automate}`. Used by popup. Engine never calls this.
- `get_blur_items(host)` / `save_blur_item(item)` / `remove_blur_item(id)` — blur item CRUD.
- `clear_host(host)` — clears items for the host in local storage. Does not touch automate trigger state (per-tab/global, not per-host).
- `clear_all()` — clears `blur_all` + items for all exact rules in local storage + resets session storage (`blsi_automate_blur: {}`) separately.
- `save_blur_state(is_active)` — flips `blur_all.status` globally (no per-host arg). Toggling anywhere reflects across every tab.
- `suppress_idle(scope, ctx)` / `unsuppress_idle(scope, ctx)` — scope: `'tab'|'site_session'|'feature'`. Delegates to `State.add_idle_ignore_tab` / `add_idle_ignore_site` / `patch_section`.
- `suppress_tab_switch(scope, ctx)` / `unsuppress_tab_switch(scope, ctx)` — same pattern for tab_switch.
- (legacy) `get_automate_blur` / `save_automate_blur` / `patch_automate_blur` / `clear_automate_blur` — REMOVED. Idle + tab_switch state moved to `blsi.Automate.State` (sibling module). Use `State.write_idle(phase)` / `write_tab_switch(tab_id, phase)` / `clear_tab_switch(tab_id)` directly.
- `get_rules()` / `save_rules(rules)` — URL rules CRUD. Rules are an array of `{ hostname_value, hostname_type, blur_all, items, snapshot }` where `hostname_type` is `'wildcard'|'regex'` (non-exact entries only).
- `capture_snapshot()` — reads current global settings from cache; returns a nested snapshot object `{ settings, blur_all, pick_and_blur, auto_detect_pii, automate }` mirroring the global model structure. Deep-copies `blur_categories` and `blur_color`. The `automate` section captures only `{ idle, tab_switch, screen_share }.enabled` (idle .value/.unit remain global-only). Excludes: site_rules, shortcuts, enabled, language, idle.value/.unit, pick_and_blur.items.
- `resolve(hostname, url)` also exposes `_rule_overrides: { [flat_key]: true }` (every resolved field that came from a site rule snapshot) and `_rule_match: { hostname_value, hostname_type } | null` (the matching rule). Popup uses these for "Managed by site rule" badges + read-only controls + deep-linking; content_script uses them to append `(site rule)` to toasts.
- `save_site_snapshot(hostname_value, hostname_type, snapshot)` — finds or creates the matching rule entry in `site_rules[]` and sets its `.snapshot` to the provided nested snapshot object `{ settings, blur_all, pick_and_blur }`. Works for all `hostname_type` values (`'exact'|'wildcard'|'regex'`). For wildcard/regex rules, ensure the rule exists via `save_rules()` first. Returns a Promise.
- `clear_site_snapshot(hostname_value, hostname_type)` — resets `.snapshot` to `{}` for the matching rule. No-op if the rule doesn't exist. Returns a Promise.
- `get_site_snapshot(hostname_value, hostname_type)` — returns the `.snapshot` object for the matching rule, or `null` if the rule doesn't exist or snapshot is empty `{}`. Synchronous.
- `_reset_cache()` — test-only helper. Clears `_cache`, `_screen_share_cache`, and `_suppressed_tabs_cache` so tests start from a clean slate. Idle + tab_switch caches live in `blsi.Automate.State` — call `State._reset()` separately.

### action_registry.js
- Single source of truth for every shortcut-driven action. `blsi.Actions`.
- Each entry: `{ id, label, description, defaultBinding, messageType, chromeCommand }`.
- Adding an action: one entry here + one handler in `content_script.shortcutActionMap` + (optional) one entry in `manifest.json > commands`. Nothing else.
- `defaultBindings()` returns a mutable clone keyed by action id (kebab-case, e.g. `'toggle-blur-all'`) in the shape `{ 'action-id': { binding: [{code, mods}] } }`. Consumed by `blsi.build_default_model()`.
- `ACTIONS` is frozen. Do not mutate the registry at runtime.

### shortcut_label.js
- Platform-aware chord label rendering. `blsi.ShortcutLabel`.
- `IS_MAC` is computed once at module load from `navigator.platform`/`navigator.userAgent`.
- Mac renders Unicode glyphs (`⌘⇧⌥⌃`) and concatenates without separators; Win/Linux spells out mods (`Ctrl`, `Shift`, `Alt`, `Win`) joined by `+`.
- `chordKey(chord)` produces the canonical `"<sorted mods>|<code>"` string used for conflict detection. `bindingKey(binding)` joins chord keys with a space for sequence comparison.
- `CODE_TO_LABEL` is the complete letter/digit/symbol/function/numpad map. Unknown codes fall back to the code string itself.
- `isReserved(chord)` / `lookup(chord)` / `RESERVED` — 14-entry browser-reserved chord hint list with per-platform filters (`any`, `mac`, `win`). Not a deny list — capture UI shows a warning but always allows save.

### toast.js
- In-page floating toast surface — `blsi.Toast`. Public: `show(text, duration?, actions?, opts?)`, `dismiss()`, `clearIfTransient()`. Single-slot; persistent toasts block replacement. Renders `.bl-si-toast` (CSS classes in `styles/content.css`).
- Distinct from popup toast (`popup/popup_ui.js` → `.bl-toast`) — different DOM, lifecycle, and CSS prefix. Never cross-reference the two.
- Used by `shortcut_handler` (Blurry Site action toast), `automate/manager` (idle / tab_switch / screen_share transitions), `content_script` (catch-up + PWA hint), `picker` (area-too-small).
- `clearIfTransient()` is the destroy hook for `Shortcuts.destroy()` — preserves persistent toasts so the screen-share live toast survives shortcut teardown.

### shortcut_handler.js
- Toast rendering is delegated to `blsi.Toast` — this module is now a pure matcher. No `showToast` / `dismissToast` exports.
- `init(shortcuts, callbacks)` accepts `{ 'action-id': { binding: [{code, mods}] } }` (kebab-case action ids). Multi-chord bindings (length > 1) are skipped in phase 1 with a logger warning.
- Modifiers are read from `event.altKey/ctrlKey/metaKey/shiftKey` — side-agnostic. Do NOT reintroduce a held-keys Set.
- Key matching uses `event.code` (physical key, layout-independent).
- Early-exit guards: `event.repeat`, `event.isComposing`, `event.key === 'Dead'`, `event.key === 'Process'`, `event.key === 'Unidentified'`, `getModifierState('AltGraph')`, and pure-modifier keydowns (via `blsi.MODIFIER_CODES`).
- Fires `callbacks[actionId]` for any matched shortcut. Uses `blsi.Actions.get(actionId).label` for the toast text.
- Fires `callbacks.onExitPicker` on Escape when `_isPickerActive === true`. Escape never dispatches to a bound shortcut.
- Stamps `globalThis.__blsiShortcutFire[actionId]` with a monotonic timestamp on every match. `content_script.handleMessage` uses this as a fire-token to dedup the JS path against `chrome.commands` relays (500ms window).
- Listeners registered at capture phase (`addEventListener('keydown', fn, true)`).
- `_setPickerActive(v)` and `_getFireToken()` must be in the public return object.

### picker.js
- Three modes: `PM.DYNAMIC`, `PM.STICKY_PAGE`, `PM.STICKY_SCREEN`. `_isSticky(mode)` helper distinguishes the two sticky variants. `setMode` rejects anything else.
- Sticky draw: the preview `<div class="bl-si-zone-drawing">` always uses `position: fixed` with viewport coordinates — it's just a drag visual.
- Sticky commit: the `onStickyBlur` callback passes `{ anchor: 'page' | 'screen', x, y, width, height, scrollWidth, scrollHeight }`. For `STICKY_PAGE`, `x/y` are **document** coordinates (scroll offset added) and `scrollWidth/Height` snapshot the document size for later xPct/yPct re-projection. For `STICKY_SCREEN`, `x/y` are **viewport** coordinates (no scroll offset) and `scrollWidth/Height` is the viewport, not the document.
- Toolbar: `toolbarEl.id = "bl-si-picker-toolbar"` (tests use `getElementById`). It's a floating draggable pill, not a full-width bar. Position persisted at `chrome.storage.local.picker_toolbar_pos = { top, left, right, bottom }`. Drag handle is the `.bl-si-toolbar-drag` element; dragging attaches `mousemove`/`mouseup` at capture phase on `document` so it beats the picker's own mouse handlers.
- Toolbar appended to `document.body`, not `document.documentElement`.
- The `.bl-si-picker-active button` blanket `cursor: crosshair` rule in `styles/content.css` excludes toolbar buttons (`.bl-si-toolbar-btn`, `.bl-si-toolbar-btn--close`, `.bl-si-toolbar-drag`) and toolbar selects. Two explicit higher-specificity rules (`.bl-si-toolbar .bl-si-toolbar-btn`, `.bl-si-toolbar select`) re-assert `cursor: pointer` for the pill's interactive children.
- Blur/unblur decision: use `blsi.Engine.isBlurred(target)` to detect both data-attribute and CSS-tag-rule blurs.
- Do not call `blsi.SelectorUtils` inside picker — it is not picker's responsibility.
- All event listeners at capture phase. `onClick` calls `stopPropagation` + `stopImmediatePropagation`.

### content_script.js
- Thin orchestrator. State: `settings`, `isPickerActive`, `lastContextMenuTarget`, `hostname`, `lastUrl`, `_topHostname`. Per-blur state (counters, observer, `isPageBlurred`, reveal state, active items) lives in `src/engine.js` and the `src/core/*` sub-modules / `reveal_controller.js` — do not re-introduce it here.
- Module aliases: `Engine` (`blsi.Engine`), `Store` (`blsi.Model`), `Selector` (`blsi.SelectorUtils`), `Picker` (`blsi.Picker`), `Shortcuts` (`blsi.Shortcuts`). `Reveal` (`blsi.Reveal`) is aliased at the very top of the IIFE. No `UrlMatcher` alias — settings resolution goes through `Store.resolve()`.
- `_topHostname` — equals `location.hostname` in the main frame; derived from `document.referrer` in cross-origin iframes. Used for `engage` lookup so iframes follow the parent page's blur-all state rather than their own. Updated via `postMessage` from the main frame on every storage change.
- Use the `setPickerActive(active)` helper for every picker state change — it's the single source of truth that updates the local flag, `Shortcuts._setPickerActive`, AND `Engine._setPickerActiveForObserver` together. Do NOT update any of those three directly from call sites (TOGGLE_PICKER handler, pickerCallbacks.onDeactivate, applyState disable path all go through the helper). Skipping the observer gate leaves the MutationObserver silent for new DOM nodes after the picker closes, which silently breaks dynamic content on the page.
- Pass `resolved.shortcuts` directly to `Shortcuts.init()` — no flattening needed. Keys are kebab-case action ids (e.g. `'toggle-blur-all'`).
- `Reveal.init({ getMode: () => settings.reveal_mode, isPickerActive: () => isPickerActive })` — pass functions, not values, so reveal state stays consistent without re-init on every settings change.
- `GET_STATUS` response: `{ isPageBlurred: Engine.isPageBlurred, isPickerActive, blurredCount: Engine.blurredCount }`. `Engine.blurredCount` is an O(1) getter maintained by `blur_engine` — no DOM scan.
- Async message handlers that need `sendResponse` must `return true` from `handleMessage`. `TOGGLE_BLUR_ALL`, `CLEAR_ALL_BLUR`, `CONTEXT_BLUR`, `CONTEXT_UNBLUR` are all async (storage write + `_sync()`), so they return `true`.
- All settings keys are **snake_case** throughout — `resolved.blur_radius`, `resolved.reveal_mode`, `resolved.blur_categories` (object with lowercase sub-keys: `{ text, media, form, table, structure }`), etc.
- **All blur state changes go through `_sync()`.** The pattern is: write to `Store.*`, then `await _sync()`. This applies to toggle, clear-all, context menu, picker callbacks, settings change, and init. `_sync()` calls `Store.resolve(_topHostname, location.href)` — which returns the full resolved snapshot including `engage` and `blur_items` — then passes to `Engine.handleSite(resolved)`. Engine never reads storage. CSS custom properties (`--bl-si-radius`, `--bl-si-highlight-color`, `--bl-si-transition-duration`, `--bl-si-redaction-color`) are set by the engine at the top of `handleSite` via `_applyCssVars` — do NOT set them in `content_script`. `content.css` has per-var fallback values so there is no flash of unstyled state before the first `handleSite` call.
- **Every `_sync()` call site MUST `await`.** Fire-and-forget invocations let concurrent onChange events interleave two reconciles that corrupt the engine's `_activeItems` Map.
- `applyState(resolved, prev)` awaits `_sync()` at the end — no per-field branching on categories/mode/thorough/radius. Engine skips the page-wide nuke when nothing structural changed.
- Settings resolution: `Store.resolve(_topHostname, location.href)` → `applyState(resolved, prev)` — used by `init()`, `handleStorageChange()`, and `onUrlChange()` (SPA).
- `handleStorageChange(newModel, _oldModel)` — receives full model objects (new `blsi_model` shape). Re-resolves via `Store.resolve()` + `applyState()`. Single storage key — no per-key branching on `blurred_items` / `blur_all_hosts` (those keys no longer exist).

---

## Blur Engine Element Handling

All elements (video, img, text containers, generic) blurred via CSS class only (`bl-si-blurred`). CSS `filter: blur()` on parent blurs all descendants — no canvas overlays, no text-node wrapping, no DOM injection. This means:
- No `position: relative` injection on parent elements (was breaking layouts)
- No `requestAnimationFrame` loops for video (CSS blur works on DRM video too)
- No text-node wrapper spans (CSS blur covers text nodes via parent filter)
- Live radius updates propagate instantly via `var(--bl-si-radius)` from `:root`

---

## CSS Class Constants (do not invent new names)

| Constant | Value |
|---|---|
| Blur class | `bl-si-blurred` |
| Frosted glass mode | `bl-si-frosted` |
| Canvas overlay | `bl-si-canvas-overlay` |
| Text wrapper | `bl-si-text-node-wrapper` |
| Hover highlight | `bl-si-hover-highlight` |
| Picker active (on `<html>`) | `bl-si-picker-active` |
| Toolbar | `bl-si-toolbar` (id: `bl-si-picker-toolbar`) |
| Reveal attribute (all modes, click+hover) | `data-bl-si-reveal` (attribute, not class) |
| Sticky zone overlay | `bl-si-zone-overlay` |
| Zone drawing preview | `bl-si-zone-drawing` |
| Zone hover highlight (picker mode) | `bl-si-zone-highlight` |
| Zone name label | `bl-si-zone-label` |
