# popup/renders/shared.js — Contract

Global: `BlurrySitePopupShared` (also `window.BlurrySitePopupShared`).

Stateless DOM/i18n helpers shared across popup render files. No storage, no state.

## Public API

### `t(key) → string`
i18n shim. Prefers `blsi.ContentI18n.t(key)` when available, else `chrome.i18n.getMessage(key)`. Falls back to `key` if neither produces a string.

### `makeToggle(id, checked, ariaLabel?) → { label, input }`
Builds a `<label class="bl-toggle">` containing a checkbox `<input>` (with given `id` and `checked`) and a `<span class="bl-toggle__track">`. Returns the wrapper label + the inner input. `ariaLabel` (optional) is set on the label.

### `updateFill(input, min?, max?) → void`
Sets CSS custom property `--bl-slider-pct` on the slider input as `((value-min)/(max-min))*100%`. When `min`/`max` omitted, reads from `input.min` / `input.max`. Used to drive the gradient track fill.

### `makeDivider() → HTMLElement`
Returns a fresh `<hr class="bl-divider">`.

### `isRuleManaged(settings) → boolean`
True when the resolved settings object indicates the current host is governed by a site rule with a non-empty snapshot.

Inputs:
- `settings._rule_match` truthy (rule matched the host)
- `settings._rule_overrides` non-empty (snapshot contributed at least one override)

Empty `{}` snapshot sentinel rules (which only pin `blur_all` toggle, no settings overrides) return `false` — user can still edit global settings on those hosts.

### `makeBanner({ hostname_value, hostname_type, onEdit }) → HTMLElement`
Builds a `<div class="bl-rule-banner">` for the rule-managed UX:
- Lock icon, title (`site_rule_managed_banner_title` i18n key)
- Description with `$HOSTNAME$` + `$TYPE$` substitutions (`site_rule_managed_banner_body`)
- CTA button (`site_rule_managed_edit_cta`) — invokes `onEdit({ hostname_value, hostname_type })` on click

`onEdit` is the deep-link callback wired from `popup.js` to navigate to the Site Rules sub-page with a focused rule.

## Edge cases

- `isRuleManaged(null)` / `isRuleManaged(undefined)` return `false` — safe to call before settings load.
- `makeBanner` falls back to `"<hostname> (<type>)"` plain text when the i18n entry is missing.
- All builders return fresh DOM nodes — callers append to their own containers; no internal caching.
