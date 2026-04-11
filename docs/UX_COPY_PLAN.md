# UX Copy Plan — Layman-Friendly Rewrite

Goal: make Blurry Site understandable to a user who has never heard of "OCR", "regex", "gaussian", or "picker". Keep copy correct for power users without dumbing it down.

All user-facing strings now live in `_locales/en/popup.json` (popup UI) and `_locales/en/messages.json` (manifest + context menus). Nothing in popup HTML/JS is hardcoded — this doc can evolve copy without touching code.

---

## 1. Audience research

Three rough personas we care about, in order of frequency:

| Persona | Needs | Reads like |
|---|---|---|
| **Streamer / screen-sharer** (majority) | Hide email addresses, DMs, notifications before going live | Casual — "hide this thing from the camera" |
| **Privacy-conscious browser** (second) | Blur social feeds, search results, previews to avoid spoilers/distractions | Moderate — comfortable with "blur all", curious about AI-proof mode |
| **Developer / power user** (tail) | Per-URL overrides, regex patterns, custom shortcuts | Technical — wants surface area, not hand-holding |

Design principle: **default copy serves the streamer**. Advanced terms (regex, OCR, AI-resistant) live behind hints/tooltips, not labels.

---

## 2. Copy principles

1. **Verbs over nouns.** "Blur everything" beats "Blur All". "Pick an element" beats "Picker Mode".
2. **Plain English.** No jargon in labels. Jargon allowed in hints with an everyday word first — e.g. `"Frosted (AI-proof)"`, hint: `"Frosted scrambles text so AI and screenshot tools can't read it."`
3. **Describe outcome, not mechanism.** `"Blur Strength"` > `"Blur Radius"`. `"Peek at Blurred Content"` > `"Reveal Mode"`.
4. **Tooltips answer "what happens if I click?"** Single sentence, plain verb, no trailing period if it fits on one line in the popup tooltip.
5. **Errors are apologetic and actionable.** `"Couldn't save settings"` > `"Failed to save settings"`. Next step implied.
6. **Destructive actions warn in the verb.** `"Clear every site"` + confirm dialog with blast radius spelled out.

---

## 3. Label translations (applied in this change)

| Before | After | Why |
|---|---|---|
| Picker | Pick & Blur | Noun → verb-verb; tells you both halves of the interaction |
| Blur Radius | Blur Strength | Nobody knows what a radius is; "strength" maps to the slider direction |
| Reveal Mode | Peek at Blurred Content | "Reveal" implies "forever"; "peek" implies "briefly" |
| Smooth Transition | Smooth Animations | Transition is a CSS term |
| Picker Highlight | Picker Outline Color | "Highlight" is ambiguous; outline is what they see |
| Blur Style | Blur Look | Style sounds configurable; look is the outcome |
| Thorough Blur | Aggressive Blur | Thorough is neutral; aggressive sets expectation |
| Gaussian | Standard | Gaussian is a math term |
| Frosted (AI-resistant) | Frosted (AI-proof) | "Proof" is shorter and stronger |
| Media | Images & Video | Category lists beat category names |
| Form | Inputs & Forms | Same |
| Structure | Containers | "Structure" is a dev term |
| URL Rules | Site Rules | "URL" means nothing to laymen |
| Add Rule | + Add Site Rule | Specify what |
| Wildcard | Simple (wildcards) | Label the lay concept first |
| Regex | Advanced (regex) | Label the lay concept first |
| Dynamic / Sticky (list) | Element / Zone | Streamers know "zone" from OBS |
| Clear all sites | Clear every site | "Every" implies scope; "all" often means "all visible" |
| Failed to save settings | Couldn't save settings | Tone |
| Flow logs ON / OFF | Activity log: on / off | "Flow log" is our word |
| Shortcut > Customize | Shortcut > Change | Shorter; clearer |
| (new) Display Language | Display Language | New row in Settings → Look. Lets users override `navigator.language`. Auto / English / हिन्दी / தமிழ். |
| Shortcut row labels | Blur Everything / Pick an Element / Clear the Page (+ hint lines) | Layman verbs that match the action-bar buttons. Bug fix: keys had been mismatched against `popup_configs.js` and were silently falling back to English `action_registry` labels. See I18N_PLAN §6.5. |
| (new) Picker chip labels | Element / Area on page / Area on screen | Self-contained labels in non-English locales. The "Blur An:" prefix is intentionally empty in Hindi/Tamil so the chip stands on its own — `pickerPrefixLabel` empty-string convention in `messages.json`. |

Kept as-is because they already serve the audience:
- Blur All, Clear All (action bar) — short, familiar from paint tools
- Keyboard Shortcuts
- Cancel / Save / Close
- On / Off

---

## 4. Tooltips — single source of truth

Every interactive element without body text now has a `data-i18n-title` / `data-i18n-aria-label` pointing to a `tt_*` key in `popup.json`. Wiring lives in `popup_i18n.js` → `applyI18nToDOM()`:

```
[data-i18n]             → textContent
[data-i18n-title]       → title attr
[data-i18n-aria-label]  → aria-label attr
[data-i18n-placeholder] → placeholder attr
```

Current tooltip coverage (keys under `tt_*` in popup.json):

| Key | Attached to |
|---|---|
| tt_master_toggle | Header on/off switch |
| tt_theme | Theme toggle button |
| tt_blur_all | Action bar "Blur All" |
| tt_clear_all | Action bar "Clear All" |
| tt_picker | Action bar "Pick & Blur" |
| tt_help | Footer help button |
| tt_debug | Footer debug button |
| tt_clear_all_sites | Footer "Clear every site" |
| tt_add_rule | "+ Add Site Rule" button |
| tt_remove_blur_item | × button on each blur list item |
| tt_rule_edit | Edit button per rule |
| tt_rule_delete | Remove button per rule |
| tt_customize_shortcut | Shortcut "Change" button (reserved for future) |

Accessibility: every button that uses an icon alone still has a visible `aria-label` driven from the same `tt_*` key, so screen readers and the tooltip stay in sync.

---

## 5. What's deliberately NOT in this pass

- **Translation to other locales beyond Hindi.** The i18n machinery is wired and `_locales/hi/popup.json` ships as the smoke-test locale (machine-drafted, marked for human review). Adding `es/`, `de/`, `ja/` is now a copy-and-translate of `popup.json` plus a new entry in `SUPPORTED_LANGUAGES` in `src/constants.js` and a new option in `popup_configs.js`. No deeper code change needed for popup-only locales; content-script (picker) translation lands when `src/content_i18n.js` ships in Phase 2.
- **Help / onboarding tour.** First-run tour would carry more weight than tooltips for brand-new users; tracked separately.
- **Changing `blsi.Actions` labels.** Action labels stay English by design — see `I18N_PLAN.md §7 Known Limitations`. They surface in the in-page shortcut toast and the popup help overlay; both are low-frequency power-user surfaces, and the streamer/layman audience this doc serves lives in the popup body and the picker toolbar.
- **Context-menu copy beyond blur/unblur.** Two items only; already translated via `chrome.i18n.getMessage`.

---

## 6. Process for adding new copy

1. Add the key to `_locales/en/popup.json` (popup) or `_locales/en/messages.json` (manifest/context).
2. In HTML, use `data-i18n="key"` for text, `data-i18n-title="key"` for tooltips, `data-i18n-aria-label="key"` for screen readers, `data-i18n-placeholder="key"` for inputs.
3. In JS, call `I18n.t('key')` — never inline strings.
4. If the string is parameterised, use `{{placeholder}}` and pass `I18n.t('key', { placeholder: value })`.
5. Update this doc's translation table if the English copy changed.

Linter idea (not implemented): a repo-level script that greps popup/*.{js,html} for `textContent = '`, `title = '`, `showToast('`, `alert('` and fails CI if matches are outside an `I18n.t(...)` call.
