# Internationalization (i18n) — Inventory & Plan

A snapshot of where translatable content lives today, what's still hardcoded, and a prioritized roadmap for getting Blurry Site to a fully translatable state.

---

## 1. Two i18n systems, two purposes

Blurry Site uses **two separate string catalogues** because the extension runs in three contexts (manifest, popup, content scripts) and each context has different constraints.

| File | Loader | Format | Used by | Why this loader |
|---|---|---|---|---|
| `_locales/<lang>/messages.json` | `chrome.i18n.getMessage()` (Chrome MV3 native) | `{ "key": { "message": "..." } }` | manifest fields (`__MSG_appName__`), `background.js`, `content_script.js` (any `src/` module) | Only the native API works inside the manifest and inside content scripts where we can't fetch arbitrary files |
| `_locales/<lang>/popup.json` | `popup_i18n.js` → `blsi.I18n.t(key)` | flat `{ "key": "..." }` | `popup/popup.html`, `popup/popup.js`, `popup/popup_settings_renderer.js` | Lean format, supports `{{placeholder}}` interpolation, no Chrome boilerplate, popup-only |

Both files live under `_locales/<lang>/` so a single language directory holds everything for that locale.

Today only `en` exists.

---

## 2. Current inventory

### 2.1 `_locales/en/messages.json` — 4 keys
- `appName` — manifest `name` field
- `appDescription` — manifest `description` field
- `ctxBlurElement` — context menu "Blur this element"
- `ctxUnblurElement` — context menu "Unblur this element"

### 2.2 `_locales/en/popup.json` — ~145 keys (post-refactor)

Grouped by purpose:

| Group | Count | Examples |
|---|---|---|
| Header / master toggle | 4 | `popup_title`, `toggle_on`, `toggle_off`, `theme_toggle` |
| Action bar buttons | 3 | `btn_blur_all`, `btn_clear_all`, `btn_picker` |
| Section headers | 7 | `section_blurred_elements`, `section_settings_title`, `section_rules_title` … |
| Settings (labels + hints) | 14 | `setting_blur_radius`, `setting_blur_radius_hint`, `setting_reveal_mode` … |
| Setting enum values | 5 | `reveal_hover`, `reveal_click`, `blur_mode_gaussian`, `blur_mode_frosted`, `reveal_none` |
| Group headers | 5 | `group_appearance`, `group_categories`, `group_shortcuts` … |
| Blur category labels + hints | 10 | `cat_text`, `cat_text_hint`, `cat_media`, `cat_form` … |
| Shortcut UI | 13 | `shortcut_modal_*`, `shortcut_reset`, `shortcut_saved`, `shortcut_modal_ctrl_alt` |
| URL / site rules | 22 | `rule_add`, `rule_pattern_required`, `rule_global_default` … |
| Blur list items | 4 | `item_type_dynamic`, `item_type_sticky`, `item_remove_title`, `blur_empty` |
| Toasts (success) | 7 | `toast_enabled`, `toast_blur_all`, `toast_settings_saved` … |
| Toasts (errors) | 7 | `toast_failed_save_settings`, `toast_failed_remove_item` … |
| Toasts (debug) | 2 | `toast_flow_logs_on`, `toast_flow_logs_off` |
| Confirmations / footer | 3 | `confirm_clear_all`, `footer_clear_all`, `help_overlay_title` |
| Modal buttons | 3 | `modal_cancel`, `modal_save`, `modal_close` |
| Tooltips (`tt_*`) | 13 | `tt_master_toggle`, `tt_blur_all`, `tt_picker`, `tt_help`, `tt_debug` … |
| Parameterised | 2 | `site_elements_blurred` (`{{count}}`), `site_rule_active` (`{{name}}`) |

---

## 3. Still hardcoded — what needs to move

These strings are user-visible English literals **inside `src/`**, where `popup_i18n.js` is unavailable. They need `chrome.i18n.getMessage()` and corresponding entries in `messages.json`.

### 3.1 `src/picker.js` — MIGRATED (Phase 2)

Inventory at the time of migration. Every entry below is now resolved via `blsi.ContentI18n.t(key, fallback)` with the English literal as the fallback so a missing helper degrades gracefully.

| Where (line ≈) | String | Suggested key |
|---|---|---|
| `_modeChipLabel` (104) | "Element" | `pickerChipLabelDynamic` |
| `_modeChipLabel` (105) | "Area on page" | `pickerChipLabelStickyPage` |
| `_modeChipLabel` (106) | "Area on screen" | `pickerChipLabelStickyScreen` |
| `_modeChipDescription` (112) | "Sketch a box over a region of the page. Scrolls with the content. Click to switch mode." | `pickerChipDescStickyPage` |
| `_modeChipDescription` (113) | "Sketch a box fixed to your screen. Stays put when you scroll — great for screen-sharing. Click to switch mode." | `pickerChipDescStickyScreen` |
| `_modeChipDescription` (114) | "Tap an element on the page to blur it. The blur follows that item. Click to switch mode." | `pickerChipDescDynamic` |
| Drag handle aria (210) | "Drag to move picker" | `pickerDragHandleAria` |
| Drag handle title (211) | "Drag to move" | `pickerDragHandleTitle` |
| Prefix label (222) | "Blur An:" | `pickerPrefixLabel` |
| Mode chip aria (237) | "Picker mode — click to cycle" | `pickerChipAria` |
| Clear button text (259) | "Clear" | `pickerClearBtn` |
| Clear button title (260) | "Remove all blur from this page" | `pickerClearBtnTip` |
| Close button title (271) | "Exit picker mode" | `pickerCloseBtnTip` |
| Close button aria (272) | "Close picker" | `pickerCloseBtnAria` |
| `flashElementIndicator` (722) | "Unblurred" | `pickerFlashUnblurred` |
| `flashElementIndicator` (730) | "Blurred" | `pickerFlashBlurred` |
| Min size toast (506) | "Area too small (min 10px)" | `pickerAreaTooSmall` |

**16 strings.** Phase 2 must also add `Picker.rebuildToolbar()` (tear down + rebuild on LANGUAGE change), and `_modeChipLabel` / `_modeChipDescription` need to be re-evaluated whenever the chip text is updated (currently called from `setMode` and `_showChipTooltip`).

**Translation note for "Blur An:"** — the "Blur An: Element / Area on page / Area on screen" sentence-fragment grammar doesn't carry across to non-English locales. Hindi and Tamil should use a single self-contained chip label instead and leave the prefix empty (or render it as a colon-less heading). Phase 2 should make the prefix optional via i18n key returning an empty string.

### 3.2 `src/shortcut_handler.js`
| Where | String | Suggested key |
|---|---|---|
| Toast prefix | `'Blurry Site — '` + action.label | `toastPrefix` (or drop the prefix entirely) |

### 3.3 `src/action_registry.js` — DEFERRED INDEFINITELY

Action `label` and `description` fields stay English by explicit decision. They surface in the in-page shortcut toast (`shortcut_handler.js:207`) and the popup help overlay (`popup.js renderHelpOverlay`). Both surfaces are low-frequency power-user surfaces — the streamer/layman audience documented in `UX_COPY_PLAN.md` lives in the popup body and the picker toolbar, not in the help overlay. Migrating means touching the dedup/lifecycle path documented in `src/CLAUDE.md`, which is risky for ~6 strings nobody complained about.

See `§7 Known Limitations` and `UX_COPY_PLAN.md §5`. Do not promote this back to a tier without re-opening that decision.

### 3.4 `popup/popup.js` — minor remainders
- The shortcut modal title concatenates `'shortcut_modal_title'` + `': '` + label. The `': '` separator is fine (punctuation), but verify in RTL locales.
- Confirm dialog uses `confirm()` which is OS-localized for buttons but English for body — already i18n'd via `confirm_clear_all`. ✅

---

## 4. Improvement roadmap

Ordered by impact / effort.

### Tier 1 — finish the migration (Phase 2 of i18n-ux rollout — SHIPPED)

1. ✅ **`src/content_i18n.js` helper** — IIFE in `manifest.json content_scripts` slot 1 (after `constants.js`, before `logger.js`). Fetches `_locales/<lang>/messages.json` via `chrome.runtime.getURL` + caches en as fallback. `blsi.ContentI18n.t(key, fallback)` — falls back through primary → en → fallback literal → key.
2. ✅ **`picker.js` migration** — 16 strings replaced with `_t(key, fallback)` shim. New `Picker.rebuildToolbar()` for live language switching. `pickerPrefixLabel` may be empty (Hindi/Tamil), in which case the prefix span is omitted entirely.
3. ✅ **`content_script.js` wiring** — `await ContentI18n.init(globalSettings.LANGUAGE)` on init; `onSettingsChanged` detects LANGUAGE flips, re-inits the helper, and calls `Picker.rebuildToolbar()` if active.
4. **`shortcut_handler.js` toast prefix** stays English. Action labels stay English. See §3.3 — deferred indefinitely.

After Phase 2: popup AND picker toolbar both honor LANGUAGE. Action toast and help overlay action rows remain English by design.

### Tier 2 — translation workflow (1 day)

4. **Hindi as the smoke-test locale (Phase 1 of i18n-ux rollout — shipped).** `_locales/hi/popup.json` carries every popup key in machine-drafted Hindi. Surfaces:
   - Devanagari width pressure on the action-bar buttons and picker pill (devanagari is ~1.3-1.5× wider than Latin for the same word count).
   - Placeholder survival (`{{count}}`, `{{name}}`).
   - Re-render correctness when the user switches LANGUAGE live in the popup (verified by `tests/unit/popup_i18n.test.js`).
   Replace machine-drafted strings with human review before shipping to real users.
5. **Translation file linter.** A small Node script that:
   - Loads `_locales/en/popup.json` as the source of truth.
   - For every other locale, asserts: same key set, same `{{placeholder}}` set per key, no empty values.
   - Runs in CI; fails on drift.
6. **Hardcoded-string linter.** Greps `popup/*.{js,html}` and `src/*.js` for `textContent = '`, `\.title = '`, `showToast('`, `alert('`, `confirm('`, `placeholder="` outside of `data-i18n*` attrs or `I18n.t(...)` / `chrome.i18n.getMessage(...)` calls. Allow-list for known false positives.

### Tier 3 — quality of life (2–3 days)

7. **Pluralization.** `site_elements_blurred: "{{count}} blurred"` is broken in languages with plural forms (Russian has 3, Arabic has 6). Two options:
   - Adopt ICU MessageFormat (`intl-messageformat` is ~14kB minified — borderline acceptable).
   - Hand-roll a `{count, plural, one {...} other {...}}` mini-parser. ~50 lines, no dep, sufficient for our 2 parameterised keys today.
8. **RTL support.** Add `<html dir="rtl">` flip when `chrome.i18n.getUILanguage()` returns an RTL language (`ar`, `he`, `fa`, `ur`). Audit `popup.css` for hardcoded `left` / `right` / `margin-left` and mirror via logical properties (`inset-inline-start`, `margin-inline-start`). Rough estimate: 30 CSS properties to convert.
9. **In-extension language picker — SHIPPED (Phase 1 of i18n-ux rollout).** `LANGUAGE` setting in `src/constants.js` DEFAULT_SETTINGS, validated against `SUPPORTED_LANGUAGES = ['auto','en','hi']`. Popup row in `popup_configs.js` (group `appearance`). `popup_i18n.js init(lang)` reads it. `popup.js` re-renders all popup surfaces on change. Content-script propagation lands in Phase 2 via `src/content_i18n.js` (Tier 1 #1).

### Tier 4 — polish

10. **Type-safe keys.** Generate a `popup_i18n_keys.d.ts` (or just a frozen JS array of keys) from `popup.json` so the editor flags typos in `I18n.t('toas_enabled')`. Even a runtime warning when `t()` returns the key unchanged would catch most typos in dev.
11. **Translator handoff doc.** A short `_locales/README.md` explaining: which file maps to which UI surface, what `{{placeholder}}` means, what the `tt_*` prefix convention means, how to test translations locally (`navigator.language` override via DevTools sensors).
12. **Consolidate toast prefix conventions.** Today error toasts say `"Couldn't save settings"`, success toasts say `"Settings saved"`. Decide on a single convention (sentence case, no period) and document it in `UX_COPY_PLAN.md` § Copy principles.

---

## 5. Key naming conventions (current)

Settled by precedent in `popup.json`. Document them so future keys stay consistent:

| Prefix | Meaning | Example |
|---|---|---|
| `btn_*` | Action-bar buttons (icon + text) | `btn_blur_all` |
| `section_*` | Top-level section headers | `section_settings_title` |
| `setting_*` | Setting label or hint | `setting_blur_radius`, `setting_blur_radius_hint` |
| `group_*` | Settings group header inside the renderer | `group_appearance` |
| `cat_*` | Blur category label or hint | `cat_text`, `cat_text_hint` |
| `shortcut_*` | Anything in the shortcut UI / capture modal | `shortcut_modal_title` |
| `rule_*` | URL / site rules UI | `rule_pattern_required` |
| `toast_*` | Notification text (success or error) | `toast_failed_save_settings` |
| `tt_*` | Tooltips driven via `data-i18n-title` | `tt_picker` |
| `modal_*` | Generic modal buttons reused across modals | `modal_cancel`, `modal_save` |
| `item_*` | Blur list item fallbacks | `item_type_dynamic` |
| `confirm_*` | Confirm dialog body text | `confirm_clear_all` |

For `messages.json`, follow Chrome convention: camelCase, no underscores. Rationale: `chrome.i18n.getMessage('appName')` reads naturally, and the manifest substitution syntax (`__MSG_appName__`) doesn't tolerate underscores well.

---

## 6.5. Bug fixes shipped alongside Phase 2

**Keyboard Shortcuts section showed English even when LANGUAGE=Hindi/Tamil.** Root cause: `popup_configs.js` SHORTCUTS builder generated i18n keys as `'shortcut_' + action.id.toLowerCase()` (→ `shortcut_toggle_blur_all`, `shortcut_toggle_picker`, `shortcut_clear_all`), but `popup.json` had been authored with shorter names (`shortcut_blur_all`, `shortcut_picker`, `shortcut_clear`). The keys never matched, so `popup_settings_renderer.js` always fell back to `config.label` (= `action.label` = English literal from `action_registry.js`). Hindi/Tamil never had a chance.

Fix: renamed the keys in `_locales/{en,hi_IN,ta_IN}/popup.json` to match the builder. Also added `shortcut_*_hint` keys + wired `i18nHintKey` in `popup_configs.js` so the descriptions translate too. Now the Keyboard Shortcuts section is fully translated without touching `action_registry.js` (the deferred-indefinitely surface still applies to the shortcut TOAST and help overlay rows that read `action.label` directly).

---

## 7. Known Limitations

These surfaces stay English regardless of LANGUAGE setting, by explicit decision:

| Surface | File | Why |
|---|---|---|
| In-page shortcut toast (e.g. `Blurry Site — Blur All`) | `src/shortcut_handler.js:207` | Reads `action.label` from `blsi.Actions`, which is English-only. Migrating would touch the dedup/fire-token path documented in `src/CLAUDE.md`. |
| Popup help overlay action rows | `popup/popup.js renderHelpOverlay` (~line 430) | Same root cause — reads `blsi.Actions.list()` directly. Low-frequency surface (footer ? button). |
| `appName` in chrome://extensions | `_locales/<OS-locale>/messages.json` `appName` | Brand decision: stays "Blurry Site" even on non-English locales. |
| `appDescription` in chrome://extensions | Same | Chrome reads from OS locale on install, not popup LANGUAGE — no runtime override possible without re-installing the extension. |
| Right-click context menus | `background.js` via `chrome.i18n.getMessage` | Service worker can fetch but adding the pattern for two strings is more cost than benefit. Follows OS locale. |

If a user reports any of these as a bug, link them here. The decision is documented; reversing it requires re-opening §3.3.

---

## 6. Open questions for future me

- **Do we need `messages.json` at all for context menus?** Two strings is barely worth maintaining a second loader. We could collapse the context menus into the popup's i18n by storing them in `chrome.storage.local` and reading them in background.js. But background.js is a service worker and can't `fetch` reliably during install — `chrome.i18n.getMessage` is safer. Keep both.
- **Should the action registry own its own translations?** Answered: no. Deferred indefinitely — see §3.3 and §7.
- **Locale selection at install time.** Chrome reads the OS language by default. We don't currently let users override this in the popup. Add to Tier 3 only if there's user demand — `navigator.language` is the right default for >95% of users.
