# `_locales/` — Translator Guide

Everything a human translator (or future-you) needs to add a new language to Blurry Site.

## One file per locale

Every locale directory holds one JSON file:

| File | Shape | Used by |
|---|---|---|
| `messages.json` | Chrome shape `{ "key": { "message": "string" } }` | Everything — popup UI (`chrome.i18n.getMessage`), `manifest.json` `__MSG_appName__` substitution, `background.js` context menus, and content scripts via `src/content_i18n.js`. |

## Locale folder naming

Chrome `_locales/` directories follow `<language>` or `<language>_<REGION>`. **Underscore**, not hyphen. Example: `hi_IN`, not `hi-IN`. Chrome's manifest validator rejects anything else.

Currently shipped:
- `en` — source of truth
- `hi_IN` — Hindi (India) — machine-drafted, flagged for human review
- `ta_IN` — Tamil (India) — machine-drafted, flagged for human review

## Adding a new locale

Concrete example: adding German (`de`).

### 1. Create the directory

```bash
mkdir -p _locales/de
```

### 2. Seed from English

```bash
cp _locales/en/messages.json _locales/de/messages.json
```

### 3. Translate every value

Open the file. Translate the `"message"` value of each entry. Do **not** rename keys — the linter will fail if you do.

### 4. Preserve placeholders exactly

Any `{{count}}`, `{{name}}`, etc. in an English string must appear in the translation, spelled the same way. Example:

```json
// en/messages.json
"site_elements_blurred": { "message": "{{count}} blurred" },

// de/messages.json
"site_elements_blurred": { "message": "{{count}} unscharf" }   // ✓ {{count}} preserved
```

The linter fails on placeholder drift.

### 5. Add the locale to the `SUPPORTED_LANGUAGES` list

Edit `src/constants.js`:

```js
const SUPPORTED_LANGUAGES = Object.freeze(['auto', 'en', 'hi_IN', 'ta_IN', 'de']);
```

### 6. Add the locale option to the popup's language picker

Edit `popup/popup_configs.js` inside the `LANGUAGE` row's `options.values`:

```js
{ value: 'de', i18nKey: 'lang_de' },
```

### 7. Add `lang_de` to **every** locale's `messages.json`

Every existing locale needs an entry for the new language's endonym so users can find their language in the picker regardless of the current UI language.

```json
// en/messages.json
"lang_de": { "message": "Deutsch (German)" },

// de/messages.json
"lang_de": { "message": "Deutsch" },

// hi_IN/messages.json
"lang_de": { "message": "Deutsch (जर्मन)" },

// ta_IN/messages.json
"lang_de": { "message": "Deutsch (ஜெர்மன்)" }
```

### 8. Run the linters

```bash
npm run i18n:lint    # key parity + placeholder parity + empty values + JSON shape
npm run string:lint  # catches hardcoded English literals sneaking back in
npm run test:unit    # full suite — i18n linter runs first
```

Fix anything the linters flag. The errors are descriptive and point at the offending key.

### 9. Test the popup in the new locale

1. Load the extension unpacked at `chrome://extensions`.
2. Open the popup → Settings → Look → Display Language → **Deutsch**.
3. Verify every surface — header, action bar, settings, blur categories, shortcuts, rules modal, footer, all toasts — renders in German.
4. Open any web page, press the picker shortcut, verify the picker pill is also in German.

### 10. Document in `UX_COPY_PLAN.md`

Add a one-line entry to the locale list so future maintainers know which locales are human-reviewed vs machine-drafted.

## Sentence-fragment grammar and the `EMPTY_ALLOWED` list

The picker pill reads `"Blur An: Element"` / `"Blur An: Area on page"` in English — a single sentence built from a static prefix (`pickerPrefixLabel`) and a dynamic chip label. Non-English locales where this sentence-fragment grammar doesn't carry (Hindi, Tamil) set `pickerPrefixLabel` to an empty string so the prefix span is omitted entirely and the chip label stands on its own.

The i18n linter normally flags empty values as "probably forgotten translation". `pickerPrefixLabel` is exempt via `EMPTY_ALLOWED` in `scripts/i18n_lint.js`. If a new locale needs the empty-prefix treatment, no further action is needed — the key is already in the allow list.

## Key naming conventions (for future keys)

When adding a new key, follow the prefix convention so future translators can scan the file by purpose:

| Prefix | Purpose | Example |
|---|---|---|
| `btn_*` | Action-bar buttons | `btn_blur_all` |
| `section_*` | Section headers | `section_settings_title` |
| `setting_*` | Setting label or hint | `setting_blur_radius`, `setting_blur_radius_hint` |
| `group_*` | Settings group header | `group_appearance` |
| `cat_*` | Blur category label or hint | `cat_text`, `cat_text_hint` |
| `shortcut_*` | Shortcut UI | `shortcut_toggle_blur_all`, `shortcut_toggle_blur_all_hint` |
| `rule_*` | Site rules UI | `rule_pattern_required` |
| `toast_*` | Notification text | `toast_failed_save_settings` |
| `tt_*` | Tooltips via `data-i18n-title` | `tt_picker` |
| `modal_*` | Generic modal buttons | `modal_cancel`, `modal_save`, `modal_close` |
| `item_*` | Blur list item fallbacks | `item_type_dynamic` |
| `confirm_*` | Confirm dialog body text | `confirm_clear_all` |
| `lang_*` | Language picker options | `lang_en`, `lang_hi_IN` |

## Copy principles (from `docs/UX_COPY_PLAN.md`)

Keep non-English translations laymen-friendly. The English source itself has been rewritten to avoid developer jargon — `element` → (dropped), `draw a zone` → `drag a box over an area`, `activity logs` → `see what the extension is doing`. Translations should match the tone, not literally render the jargon-free English into the target language's technical vocabulary.

Tooltips answer "what happens if I click?" in a single sentence, plain verb, no trailing period if it fits on one line.

## Machine-drafted translations

Hindi and Tamil ship today as machine-drafted translations. If you're reviewing one:

1. Read the English source alongside the translation.
2. Focus on flow and naturalness — a literal translation of a laymen-friendly English sentence often reads stilted.

## Files to touch when adding a locale — checklist

- [ ] `_locales/<code>/messages.json` — full translation
- [ ] `src/constants.js` `SUPPORTED_LANGUAGES` — append code
- [ ] `popup/popup_configs.js` LANGUAGE select — append option
- [ ] Every existing `messages.json` — add `lang_<code>` endonym entry
- [ ] `docs/UX_COPY_PLAN.md` — note human-reviewed vs machine-drafted
- [ ] Run `npm run test:unit` — linters pass, Jest green
- [ ] Manual popup smoke test in the new locale
- [ ] Manual picker smoke test in the new locale
