/**
 * core/categories.js — blur category data + ordering.
 *
 * Pure-data module. Defines which HTML tags / ARIA roles belong to each
 * blur category (text / media / form / table / structure). Consumers:
 *
 *   - css_manager.js  → buildSelectors() reads CATEGORY_SELECTORS to compose
 *                       the always-blur CSS selector list for one mode.
 *   - marker_engine.js → reads tag lists for stamp gating + match queries.
 *   - engine.js       → reads CATEGORY_ORDER / DEFAULT_CATS for reconcile keys.
 *
 * Element lists sourced from docs/BLUR_CATEGORIES.md. Adding a new category =
 * one frozen entry here + (optionally) a `roles` array for ARIA matches.
 *
 * Exposed as blsi.Categories (IIFE — no ES module syntax).
 */

const BlurrySiteCategories = (() => {
  'use strict';

  const CATEGORY_SELECTORS = Object.freeze({
    text: Object.freeze({
      alwaysBlur: Object.freeze([
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hgroup",
        "p",
        "blockquote",
        "pre",
        "figcaption",
        "summary",
      ]),
      textCheck: Object.freeze([
        "span",
        "a",
        "label",
        "em",
        "strong",
        "b",
        "i",
        "u",
        "cite",
        "q",
        "mark",
        "abbr",
        "time",
        "address",
        "small",
        "code",
        "kbd",
        "samp",
        "var",
        "dfn",
        "data",
        "del",
        "ins",
        "s",
        "sub",
        "sup",
        "bdo",
        "bdi",
        "ruby",
        "rt",
        "rp",
      ]),
    }),
    media: Object.freeze({
      alwaysBlur: Object.freeze(["img", "video", "audio", "canvas", "svg"]),
      textCheck: Object.freeze([]),
    }),
    form: Object.freeze({
      alwaysBlur: Object.freeze([
        "input",
        "textarea",
        "select",
        "progress",
        "meter",
      ]),
      textCheck: Object.freeze(["button", "output", "fieldset", "legend"]),
      // ARIA role coverage — SPA sites (GitHub, Figma, Notion) use role-based
      // interactivity extensively. Matched via CSS attribute selectors in
      // buildSelectors so a <div role="button"> gets blurred alongside native
      // <button>. Keep in sync with WAI-ARIA widget roles list.
      roles: Object.freeze([
        "button",
        "checkbox",
        "radio",
        "switch",
        "textbox",
        "searchbox",
        "combobox",
        "listbox",
        "spinbutton",
        "slider",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "tab",
      ]),
    }),
    table: Object.freeze({
      alwaysBlur: Object.freeze(["caption"]),
      textCheck: Object.freeze(["td", "th"]),
    }),
    structure: Object.freeze({
      // li/dt/dd moved to alwaysBlur so CSS injection covers ::marker pseudo-elements
      // unconditionally — JS text-gate on li was leaving ordinal markers visible.
      alwaysBlur: Object.freeze(["li", "dt", "dd"]),
      textCheck: Object.freeze([
        "div",
        "section",
        "article",
        "aside",
        "header",
        "footer",
        "figure",
        "details",
        "dialog",
      ]),
    }),
  });

  const CATEGORY_ORDER = Object.freeze([
    "text",
    "media",
    "structure",
    "form",
    "table",
  ]);

  const DEFAULT_CATS = blsi.DEFAULT_MODEL.blur_all.settings.blur_categories;

  return {
    CATEGORY_SELECTORS,
    CATEGORY_ORDER,
    DEFAULT_CATS,
  };
})();

blsi.Categories = BlurrySiteCategories;
