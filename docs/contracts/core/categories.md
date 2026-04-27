# core/categories.js — contract

Pure-data module. Defines which HTML tags and ARIA roles belong to each blur category, plus the canonical category iteration order. No state, no DOM access, no chrome.* access.

## Module identity

- File: `src/core/categories.js`
- Global: `blsi.Categories`
- Load order: after `engine_state.js`, before `blur_engine.js` / `core/css_manager.js` / `core/marker_engine.js`.

## Public API

| Export | Type | Notes |
|---|---|---|
| `CATEGORY_SELECTORS` | frozen `{ text, media, form, table, structure }` | Each value is `{ alwaysBlur: string[], textCheck: string[], roles?: string[] }`. All arrays are `Object.freeze`d. Adding a tag: edit the relevant `alwaysBlur` / `textCheck` array; in sync with `docs/BLUR_CATEGORIES.md`. |
| `CATEGORY_ORDER` | frozen `string[]` | Canonical iteration order: `['text','media','structure','form','table']`. Used to compose the category-toggle fingerprint key for `selectorCache` and `_lastReconcileKey`. |
| `DEFAULT_CATS` | object | Shorthand for `blsi.DEFAULT_MODEL.blur_all.settings.blur_categories`. Mutable defaults — read-only by convention, do not mutate from anywhere. |

## Edge cases

- `CATEGORY_SELECTORS.media.textCheck` is empty by design — media elements are always blur-all candidates, never gated by text content.
- `CATEGORY_SELECTORS.form.roles` is the only non-empty `roles` array today. Adding a `roles` array to other categories propagates automatically through `buildSelectors` (in `css_manager.js`).
- `structure.alwaysBlur` includes `li`, `dt`, `dd` so CSS injection covers `::marker` pseudo-elements unconditionally — keep them out of `_structuralTags` (which is derived in `marker_engine.js`).

## Why this module exists (Why)

`buildSelectors`, `getSelectors`, marker-engine match queries, and orchestrator reconcile keys all consume the same frozen tag data. Pulling it into a leaf module loaded first means every consumer reads from a single source of truth and there is no risk of stale category lists in any one site of the engine after the multi-file split.

## How to apply (How)

- Adding a category: append to `CATEGORY_SELECTORS` AND to `CATEGORY_ORDER` (order matters for fingerprint stability), update `DEFAULT_MODEL` in `constants.js`, and document the new sub-keys in `CLAUDE.md` Settings Shape section.
- Adding a tag to an existing category: append to the relevant `alwaysBlur` or `textCheck` array. No code change needed elsewhere — caches are derived from this data.
- Adding a role: append to the relevant category's `roles` array. The CSS attribute selector and the JS role match are both data-driven.
