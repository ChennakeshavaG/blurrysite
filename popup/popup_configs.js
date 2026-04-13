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

  // ── Shortcuts (derived from blsi.Actions registry) ─────────────────────────
  // Every entry in the action registry becomes a row. Adding a new action to
  // src/action_registry.js automatically adds a row here — no changes needed.
  // The `label` from the registry is the primary display text; i18n keys are
  // derived from the action id so existing translations continue to work.

  const SHORTCUTS = (() => {
    if (!(blsi && blsi.Actions && blsi.Actions.list)) return Object.freeze([]);
    return Object.freeze(
      blsi.Actions.list().map((action) => ({
        key: 'SHORTCUTS.' + action.id,
        i18nKey: 'shortcut_' + action.id.toLowerCase(),
        i18nHintKey: 'shortcut_' + action.id.toLowerCase() + '_hint',
        label: action.label,
        description: action.description,
        type: 'shortcut',
      }))
    );
  })();

  // ── Settings (single section: Appearance → Behavior → Categories → Advanced)

  const SETTINGS = Object.freeze([
    // Appearance
    {
      key: 'LANGUAGE', i18nKey: 'setting_language', i18nHintKey: 'setting_language_hint',
      type: 'select', group: 'appearance',
      options: { values: [
        { value: 'auto',  i18nKey: 'lang_auto'  },
        { value: 'en',    i18nKey: 'lang_en'    },
        { value: 'hi_IN', i18nKey: 'lang_hi_IN' },
        { value: 'ta_IN', i18nKey: 'lang_ta_IN' },
      ]},
    },
    {
      key: 'BLUR_RADIUS', i18nKey: 'setting_blur_radius', i18nHintKey: 'setting_blur_radius_hint',
      type: 'range', group: 'appearance', options: { min: 2, max: 30, step: 1, unit: 'px' },
    },
    {
      key: 'TRANSITION_DURATION', i18nKey: 'setting_transition', i18nHintKey: 'setting_transition_hint',
      type: 'toggle', group: 'appearance', options: { falseValue: 0, trueValue: 150 },
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
    {
      key: 'TAB_PRIVACY', i18nKey: 'setting_tab_privacy', i18nHintKey: 'setting_tab_privacy_hint',
      type: 'toggle', group: 'behavior',
    },

    // Blur Categories
    { key: 'BLUR_CATEGORIES.TEXT',      i18nKey: 'cat_text',      i18nHintKey: 'cat_text_hint',      type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.MEDIA',     i18nKey: 'cat_media',     i18nHintKey: 'cat_media_hint',     type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.FORM',      i18nKey: 'cat_form',      i18nHintKey: 'cat_form_hint',      type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.TABLE',     i18nKey: 'cat_table',     i18nHintKey: 'cat_table_hint',     type: 'toggle', group: 'categories' },
    { key: 'BLUR_CATEGORIES.STRUCTURE', i18nKey: 'cat_structure', i18nHintKey: 'cat_structure_hint', type: 'toggle', group: 'categories' },

    // Auto-protection
    {
      key: 'AUTO_BLUR_TAB_SWITCH', i18nKey: 'setting_auto_blur_tab', i18nHintKey: 'setting_auto_blur_tab_hint',
      type: 'toggle', group: 'behavior',
    },
    {
      key: 'AUTO_BLUR_IDLE', i18nKey: 'setting_auto_blur_idle', i18nHintKey: 'setting_auto_blur_idle_hint',
      type: 'toggle', group: 'behavior',
    },
    {
      key: 'IDLE_TIMEOUT_SECONDS', i18nKey: 'setting_idle_timeout', i18nHintKey: 'setting_idle_timeout_hint',
      type: 'range', group: 'behavior', options: { min: 30, max: 3600, step: 30, unit: 's' },
    },
    {
      key: 'BLUR_TIMER_MINUTES', i18nKey: 'setting_blur_timer', i18nHintKey: 'setting_blur_timer_hint',
      type: 'range', group: 'behavior', options: { min: 0, max: 480, step: 5, unit: 'min' },
    },

    // Auto-Detect (PII scanning)
    { key: 'AUTO_DETECT.EMAIL',       i18nKey: 'detect_email',       i18nHintKey: 'detect_email_hint',       type: 'toggle', group: 'autodetect' },
    { key: 'AUTO_DETECT.PHONE',       i18nKey: 'detect_phone',       i18nHintKey: 'detect_phone_hint',       type: 'toggle', group: 'autodetect' },
    { key: 'AUTO_DETECT.SSN',         i18nKey: 'detect_ssn',         i18nHintKey: 'detect_ssn_hint',         type: 'toggle', group: 'autodetect' },
    { key: 'AUTO_DETECT.CREDIT_CARD', i18nKey: 'detect_credit_card', i18nHintKey: 'detect_credit_card_hint', type: 'toggle', group: 'autodetect' },
    { key: 'AUTO_DETECT.FINANCIAL',   i18nKey: 'detect_financial',   i18nHintKey: 'detect_financial_hint',   type: 'toggle', group: 'autodetect' },

    // Advanced (Frosted / AI-resistant)
    {
      key: 'BLUR_MODE', i18nKey: 'setting_blur_mode', i18nHintKey: 'setting_blur_mode_hint',
      type: 'select', group: 'advanced',
      options: { values: [
        { value: 'gaussian', i18nKey: 'blur_mode_gaussian' },
        { value: 'frosted',  i18nKey: 'blur_mode_frosted' },
        { value: 'redacted', i18nKey: 'blur_mode_redacted' },
        { value: 'masked',   i18nKey: 'blur_mode_masked' },
      ]},
    },
    {
      key: 'REDACTION_COLOR', i18nKey: 'setting_redaction_color', i18nHintKey: 'setting_redaction_color_hint',
      type: 'color', group: 'advanced',
    },
  ]);

  const ALL = Object.freeze([...SHORTCUTS, ...SETTINGS]);

  return Object.freeze({ SHORTCUTS, SETTINGS, ALL });
})();

blsi.PopupConfigs = PopupConfigs;
