# Code Review: Edge Cases & Design Issues

## 1. cssEscape fallback is incomplete
**File:** `src/selector_utils.js:28-35`
Numbers at start of ID, whitespace in IDs not handled correctly by fallback regex.

## 2. Class names with dots produce malformed selectors
**File:** `src/selector_utils.js:75-91`
If element has `class="item.active"`, generated selector `div.item\.active` is malformed.

## 3. hasMeaningfulTextContent doesn't check visibility
**File:** `src/blur_engine.js:97-104`
Invisible elements (display:none) with text return true → blurred uselessly.

## 4. ensureSvgFilter doesn't check document.body exists
**File:** `src/blur_engine.js:121-154`
If called before body exists, appendChild throws.

## 5. EXCLUDE selector not escaped for special characters
**File:** `src/blur_engine.js:161-163`
Hardcoded IDs/classes in EXCLUDE could conflict with sites using same patterns.

## 6. deepMerge passes unknown keys through
**File:** `src/constants.js:186-209`
Malformed settings with typo keys (e.g., `TYPO_BLUR_RADIUS`) pass through unchecked.

## 7. Theme persistence doesn't validate stored value
**File:** `popup/popup.js:252-264`
Corrupted `popupTheme` value (e.g., 'DARK' in caps) not caught.

## 8. bindUI fails silently if DOM elements missing
**File:** `popup/popup.js:41-83`
`$('missingId')` returns null → crash on first `addEventListener` call.

## 9. Light mode CSS missing token overrides
**File:** `popup/popup.css:76-89`
`--bl-si-accent-hover`, `--bl-si-danger`, `--bl-si-success`, `--bl-si-btn-blur-active` not overridden in light mode.

## 10. GET_STATUS misses CSS-blurred elements in count
**File:** `src/content_script.js:588`
Counts only `[data-bl-si-blur]` elements. Always-blur tags (p, h1, img) blurred by CSS rules are not counted.

## 11. Unused i18n keys
**File:** `_locales/en/popup.json`
`section_general`, `section_advanced`, `section_experimental` defined but never used.
