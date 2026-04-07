/**
 * popup_configs.js — Blurry Site Settings Classification
 *
 * Two arrays: SHORTCUTS (own section) and SETTINGS (single collapsible section).
 * Settings groups: Appearance → Behavior → Categories → Advanced.
 *
 * Exposed as blsi.PopupConfigs (IIFE — no ES module syntax).
 */

const PopupConfigs = (() => {
  'use strict';

  // ── Shortcuts (displayed in own always-visible section) ────────────────────

  const SHORTCUTS = Object.freeze([
    { key: 'SHORTCUTS.TOGGLE_BLUR_ALL', i18nKey: 'shortcut_blur_all', type: 'shortcut' },
    { key: 'SHORTCUTS.TOGGLE_PICKER',   i18nKey: 'shortcut_picker',   type: 'shortcut' },
    { key: 'SHORTCUTS.CLEAR_ALL',       i18nKey: 'shortcut_clear',    type: 'shortcut' },
  ]);

  // ── Settings (single section: Appearance → Behavior → Categories → Advanced)

  const SETTINGS = Object.freeze([
    // Appearance
    {
      key: 'BLUR_RADIUS', i18nKey: 'setting_blur_radius', i18nHintKey: 'setting_blur_radius_hint',
      type: 'range', group: 'appearance', options: { min: 2, max: 30, step: 1, unit: 'px' },
    },
    {
      key: 'TRANSITION_DURATION', i18nKey: 'setting_transition', i18nHintKey: 'setting_transition_hint',
      type: 'toggle', group: 'appearance', options: { falseValue: 0, trueValue: 200 },
    },
    {
      key: 'HIGHLIGHT_COLOR', i18nKey: 'setting_highlight_color', i18nHintKey: 'setting_highlight_color_hint',
      type: 'color', group: 'appearance',
    },

    // Behavior
    {
      key: 'REVEAL_MODE', i18nKey: 'setting_reveal_mode', i18nHintKey: 'setting_reveal_mode_hint',
      type: 'select', group: 'behavior',
      options: { values: [
        { value: 'hover', i18nKey: 'reveal_hover' },
        { value: 'click', i18nKey: 'reveal_click' },
        { value: 'none',  i18nKey: 'reveal_none' },
      ]},
    },
    {
      key: 'THOROUGH_BLUR', i18nKey: 'setting_thorough_blur', i18nHintKey: 'setting_thorough_hint',
      type: 'toggle', group: 'behavior',
    },

    // Blur Categories
    { key: 'BLUR_CATEGORIES.TEXT',      i18nKey: 'cat_text',      i18nHintKey: 'cat_text_hint',      type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.MEDIA',     i18nKey: 'cat_media',     i18nHintKey: 'cat_media_hint',     type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.FORM',      i18nKey: 'cat_form',      i18nHintKey: 'cat_form_hint',      type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.TABLE',     i18nKey: 'cat_table',     i18nHintKey: 'cat_table_hint',     type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.STRUCTURE', i18nKey: 'cat_structure', i18nHintKey: 'cat_structure_hint', type: 'toggle', group: 'categories' },

    // Advanced (Frosted / AI-resistant)
    {
      key: 'BLUR_MODE', i18nKey: 'setting_blur_mode', i18nHintKey: 'setting_blur_mode_hint',
      type: 'select', group: 'advanced',
      options: { values: [
        { value: 'gaussian', i18nKey: 'blur_mode_gaussian' },
        { value: 'frosted',  i18nKey: 'blur_mode_frosted' },
      ]},
    },
  ]);

  const ALL = Object.freeze([...SHORTCUTS, ...SETTINGS]);

  return Object.freeze({ SHORTCUTS, SETTINGS, ALL });
})();

blsi.PopupConfigs = PopupConfigs;
