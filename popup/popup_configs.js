/**
 * popup_configs.js — PrivacyBlur Settings Classification
 *
 * Defines POJO arrays that classify every setting into one of three tiers:
 * General, Advanced, Experimental. The settings renderer consumes these
 * to build UI dynamically — no hardcoded control creation elsewhere.
 *
 * Each config entry describes: what setting key it maps to, its type,
 * its i18n keys, its tier, and any type-specific options.
 *
 * Exposed as window.PrivacyBlurPopupConfigs (IIFE — no ES module syntax).
 */

const PrivacyBlurPopupConfigs = (() => {
  'use strict';

  // ── Config entry types ─────────────────────────────────────────────────────
  // toggle  — boolean checkbox (or mapped non-boolean via falseValue/trueValue)
  // range   — slider with min/max/step/unit
  // select  — dropdown with fixed values
  // color   — color picker
  // number  — numeric input with min/max/step
  // shortcut — keyboard shortcut display + customize button

  // ── General tier ───────────────────────────────────────────────────────────
  // Basic blur/unblur, categories, appearance. Safe, no AI bypass, no perf tuning.

  const GENERAL = Object.freeze([
    // Appearance group
    {
      key: 'BLUR_RADIUS',
      i18nKey: 'setting_blur_radius',
      i18nHintKey: 'setting_blur_radius_hint',
      type: 'range',
      tier: 'general',
      group: 'appearance',
      options: { min: 2, max: 30, step: 1, unit: 'px' },
    },
    {
      key: 'TRANSITION_DURATION',
      i18nKey: 'setting_transition',
      i18nHintKey: 'setting_transition_hint',
      type: 'toggle',
      tier: 'general',
      group: 'appearance',
      options: { falseValue: 0, trueValue: 200 },
    },
    {
      key: 'HIGHLIGHT_COLOR',
      i18nKey: 'setting_highlight_color',
      i18nHintKey: 'setting_highlight_color_hint',
      type: 'color',
      tier: 'general',
      group: 'appearance',
    },

    // Behavior group
    {
      key: 'REVEAL_MODE',
      i18nKey: 'setting_reveal_mode',
      i18nHintKey: 'setting_reveal_mode_hint',
      type: 'select',
      tier: 'general',
      group: 'behavior',
      options: {
        values: [
          { value: 'hover', i18nKey: 'reveal_hover' },
          { value: 'click', i18nKey: 'reveal_click' },
          { value: 'none',  i18nKey: 'reveal_none' },
        ],
      },
    },

    // Categories group
    {
      key: 'BLUR_CATEGORIES.TEXT',
      i18nKey: 'cat_text',
      i18nHintKey: 'cat_text_hint',
      type: 'toggle',
      tier: 'general',
      group: 'categories',
    },
    {
      key: 'BLUR_CATEGORIES.MEDIA',
      i18nKey: 'cat_media',
      i18nHintKey: 'cat_media_hint',
      type: 'toggle',
      tier: 'general',
      group: 'categories',
    },
    {
      key: 'BLUR_CATEGORIES.FORM',
      i18nKey: 'cat_form',
      i18nHintKey: 'cat_form_hint',
      type: 'toggle',
      tier: 'general',
      group: 'categories',
    },
    {
      key: 'BLUR_CATEGORIES.TABLE',
      i18nKey: 'cat_table',
      i18nHintKey: 'cat_table_hint',
      type: 'toggle',
      tier: 'general',
      group: 'categories',
    },
    {
      key: 'BLUR_CATEGORIES.STRUCTURE',
      i18nKey: 'cat_structure',
      i18nHintKey: 'cat_structure_hint',
      type: 'toggle',
      tier: 'general',
      group: 'categories',
    },

    // Shortcuts group (skip i18n for key codes — display raw codes)
    {
      key: 'SHORTCUTS.TOGGLE_BLUR_ALL',
      i18nKey: 'shortcut_blur_all',
      type: 'shortcut',
      tier: 'general',
      group: 'shortcuts',
    },
    {
      key: 'SHORTCUTS.TOGGLE_PICKER',
      i18nKey: 'shortcut_picker',
      type: 'shortcut',
      tier: 'general',
      group: 'shortcuts',
    },
    {
      key: 'SHORTCUTS.CLEAR_ALL',
      i18nKey: 'shortcut_clear',
      type: 'shortcut',
      tier: 'general',
      group: 'shortcuts',
    },
  ]);

  // ── Advanced tier ──────────────────────────────────────────────────────────
  // Frosted/AI bypass, thorough blur, offscreen optimization.
  // Tooltips explain performance implications in layman terms.

  const ADVANCED = Object.freeze([
    {
      key: 'BLUR_MODE',
      i18nKey: 'setting_blur_mode',
      i18nHintKey: 'setting_blur_mode_hint',
      type: 'select',
      tier: 'advanced',
      group: 'appearance',
      options: {
        values: [
          { value: 'gaussian', i18nKey: 'blur_mode_gaussian' },
          { value: 'frosted',  i18nKey: 'blur_mode_frosted' },
        ],
      },
    },
    {
      key: 'THOROUGH_BLUR',
      i18nKey: 'setting_thorough_blur',
      i18nHintKey: 'setting_thorough_hint',
      type: 'toggle',
      tier: 'advanced',
      group: 'behavior',
    },
    {
      key: 'PERFORMANCE.OFFSCREEN_UNBLUR',
      i18nKey: 'setting_offscreen_unblur',
      i18nHintKey: 'setting_offscreen_unblur_hint',
      type: 'toggle',
      tier: 'advanced',
      group: 'performance',
    },
  ]);

  // ── Experimental tier ──────────────────────────────────────────────────────
  // Full power-user exposure. Tuning observer batching, element cap.

  const EXPERIMENTAL = Object.freeze([
    {
      key: 'PERFORMANCE.MAX_BLURRED',
      i18nKey: 'setting_max_blurred',
      i18nHintKey: 'setting_max_blurred_hint',
      type: 'number',
      tier: 'experimental',
      group: 'performance',
      options: { min: 0, max: 5000, step: 50 },
    },
    {
      key: 'PERFORMANCE.CHUNK_SIZE',
      i18nKey: 'setting_chunk_size',
      i18nHintKey: 'setting_chunk_size_hint',
      type: 'number',
      tier: 'experimental',
      group: 'performance',
      options: { min: 10, max: 200, step: 10 },
    },
  ]);

  // ── Combined array ─────────────────────────────────────────────────────────
  const ALL = Object.freeze([...GENERAL, ...ADVANCED, ...EXPERIMENTAL]);

  return Object.freeze({ GENERAL, ADVANCED, EXPERIMENTAL, ALL });
})();

window.PrivacyBlurPopupConfigs = PrivacyBlurPopupConfigs;
