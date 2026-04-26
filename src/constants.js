/**
 * constants.js — Blurry Site Constants & Settings
 *
 * Single source of truth for message types, default model, enums, and utility
 * functions used across the extension (background worker, content scripts, popup).
 *
 * Usage:
 *   blsi.command.toggle_blur_all   // namespaced message type
 *   blsi.blur_modes.gaussian       // enum value
 *   blsi.DEFAULT_MODEL             // frozen model shape
 *   blsi.build_default_model()     // mutable deep clone + lazy shortcuts
 *   blsi.validate_model(raw)       // validate/repair a stored model
 *
 * Exposed as globalThis.blsi (IIFE — no ES module syntax).
 * Uses globalThis so it works in both window (content scripts) and
 * self (service worker) contexts. Other modules attach to blsi:
 *   blsi.BlurEngine, blsi.Model, blsi.SelectorUtils, blsi.Shortcuts, blsi.Picker
 */

const Constants = (() => {
  'use strict';

  // ── Message categories ─────────────────────────────────────────────────────
  // STORAGE messages removed — storage_model.js accesses chrome.storage directly.
  // UPDATE_SETTINGS removed (D1) — popup writes to storage; content script reacts via onChange.

  /** Background → content script (command relay, context menu) */
  const command = Object.freeze({
    toggle_blur_all:       'TOGGLE_BLUR_ALL',
    toggle_picker:         'TOGGLE_PICKER',
    clear_all_blur:        'CLEAR_ALL_BLUR',
    restore:               'RESTORE',
    context_blur:          'CONTEXT_BLUR',
    context_unblur:        'CONTEXT_UNBLUR',
    blur_selection:        'BLUR_SELECTION',
    capture_viewport:      'CAPTURE_VIEWPORT',
    toggle_panel:          'TOGGLE_PANEL',           // background → content (PWA settings panel)
    screen_share_started:  'SCREEN_SHARE_STARTED',  // content → background
    screen_share_ended:    'SCREEN_SHARE_ENDED',    // content → background
    screen_share_notify:   'SCREEN_SHARE_NOTIFY',   // background → content (broadcast — toast trigger; tabs re-resolve from session storage)
    who_am_i:              'WHO_AM_I',              // content → background (returns sender.tab.id)
  });

  /** Popup → content script */
  const popup = Object.freeze({
    get_status:     'GET_STATUS',
    unblur_item:    'UNBLUR_ITEM',
    highlight_item: 'HIGHLIGHT_ITEM',
    clear_highlight: 'CLEAR_HIGHLIGHT',
  });

  // ── Derived helpers ────────────────────────────────────────────────────────
  const _all_types = new Set();
  const _type_to_category = Object.create(null);
  for (const [cat_name, cat_obj] of Object.entries({ command, popup })) {
    for (const val of Object.values(cat_obj)) {
      _all_types.add(val);
      _type_to_category[val] = cat_name;
    }
  }

  function is_valid(type) { return _all_types.has(type); }
  function category_of(type) { return _type_to_category[type] || null; }

  // ── Enums ──────────────────────────────────────────────────────────────────

  const reveal_modes = Object.freeze({
    none:  'none',
    click: 'click',
    hover: 'hover',
  });

  const blur_modes = Object.freeze({
    blur:     'blur',
    frosted:  'frosted',
    redacted: 'redacted',
    censored: 'censored',
  });

  // picker_modes — what happens when user clicks / sketches in the picker.
  //   dynamic       — tap element to blur (selector-based, follows element).
  //   sticky_page   — sketch box anchored to document; scrolls with page.
  //   sticky_screen — sketch box anchored to viewport; stays fixed on screen.
  const picker_modes = Object.freeze({
    dynamic:       'dynamic',
    sticky_page:   'sticky-page',
    sticky_screen: 'sticky-screen',
  });

  // pick_blur_modes — blur types for Pick & Blur (no redacted/censored).
  const pick_blur_modes = Object.freeze({
    blur:    'blur',
    frosted: 'frosted',
    color:   'color',
  });

  // pii_modes — blur types for auto-detect PII rendering.
  const pii_modes = Object.freeze({
    blur:     'blur',
    frosted:  'frosted',
    redacted: 'redacted',
    starred:  'starred',
  });

  // idle_units — hr excluded: Chrome idle API hard cap ~3000 s (50 min).
  const idle_units = Object.freeze({ sec: 'sec', min: 'min' });

  const pattern_types = Object.freeze({
    wildcard: 'wildcard',
    regex:    'regex',
    exact:    'exact',   // per-host blur state entry in site_rules
  });

  const supported_languages = Object.freeze(['auto', 'en', 'hi_IN', 'ta_IN']);

  // ── CSS class and ID constants ─────────────────────────────────────────────
  // Shared across blur_engine, content_script, picker, shortcut_handler.
  // Must match class names in styles/content.css exactly.

  const css = Object.freeze({
    canvas_overlay:    'bl-si-canvas-overlay',
    hover_highlight:   'bl-si-hover-highlight',
    picker_active:     'bl-si-picker-active',
    toast:             'bl-si-toast',
    toast_message:     'bl-si-toast__message',
    toast_exiting:     'bl-si-toast--exiting',
    toolbar:           'bl-si-toolbar',
    toolbar_label:     'bl-si-toolbar-label',
    toolbar_btn:       'bl-si-toolbar-btn',
    toolbar_btn_clear: 'bl-si-toolbar-btn--clear',
    toolbar_btn_close: 'bl-si-toolbar-btn--close',
    zone_overlay:      'bl-si-zone-overlay',
    zone_drawing:      'bl-si-zone-drawing',
    zone_highlight:    'bl-si-zone-highlight',
    zone_label:        'bl-si-zone-label',
  });

  const ids = Object.freeze({
    picker_toolbar: 'bl-si-picker-toolbar',
    svg_filters:    'bl-si-svg-filters',
  });

  // ── Reveal constants ───────────────────────────────────────────────────────
  const reveal_dfs_max_depth = 2;

  // ── Modifier codes ─────────────────────────────────────────────────────────
  // KeyboardEvent.code strings for every modifier key. Used by shortcut_handler
  // to short-circuit on modifier-only keydowns, and by the capture UI to
  // distinguish "holding modifiers" from "chord committed". Left/right kept
  // separate because the browser reports them that way; we fold at match time
  // (event.altKey / ctrlKey / metaKey / shiftKey are side-agnostic).
  const modifier_codes = Object.freeze(new Set([
    'AltLeft', 'AltRight',
    'ControlLeft', 'ControlRight',
    'ShiftLeft', 'ShiftRight',
    'MetaLeft', 'MetaRight',
    'OSLeft', 'OSRight',  // older Chrome / Firefox alias for Meta
    'CapsLock', 'Fn', 'FnLock',
  ]));

  // ── Default model ──────────────────────────────────────────────────────────
  // Single source of truth for the blsi_model storage shape.
  // Feature-grouped: global settings at top, then each feature { status, settings }.
  // Shortcuts are intentionally omitted — built lazily in build_default_model()
  // from blsi.Actions.defaultBindings() (loaded by action_registry.js after this module).

  const DEFAULT_MODEL = Object.freeze({
    global_default_settings: Object.freeze({
      blur_radius:         8,
      transition_duration: 300,
      highlight_color:     '#f59e0b',
      redaction_color:     '#000000',
      reveal_mode:         'hover',
      enabled:             true,
      thorough_blur:       false,
      language:            'auto',
      tab_privacy:         false,
    }),

    blur_all: Object.freeze({
      status: false,   // global default; per-site state lives in site_rules[i].blur_all
      settings: Object.freeze({
        blur_mode: 'blur',
        blur_categories: Object.freeze({
          text:      true,
          media:     true,
          form:      false,
          table:     true,
          structure: true,
        }),
      }),
    }),

    pick_and_blur: Object.freeze({
      status: false,
      settings: Object.freeze({
        picker_mode: null,
        blur_type:   'blur',
        blur_color:  Object.freeze({ hex: '#000000', opacity: 1.0 }),
      }),
      items: Object.freeze({}),
    }),

    auto_detect_pii: Object.freeze({
      settings: Object.freeze({
        email:              true,
        numeric:            true,
        pii_mode:           'blur',
        pii_redaction_color: '#000000',
      }),
    }),

    automate: Object.freeze({
      settings: Object.freeze({
        screen_share: Object.freeze({ enabled: false }),
        idle:         Object.freeze({ value: 5, unit: 'min', enabled: false }),
        tab_switch:   Object.freeze({ enabled: false }),
      }),
    }),

    site_rules: Object.freeze([]),
    // shortcuts: built lazily — not frozen here
  });

  // ── Deep merge ─────────────────────────────────────────────────────────────
  // Recursive merge with prototype-pollution protection and depth limit.
  // Arrays are replaced, not merged. Used by all files for model/settings merging.

  function deep_merge(base, override, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 5) return override;
    const result = Object.assign({}, base);
    for (const key of Object.keys(override)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (
        override[key] !== null &&
        typeof override[key] === 'object' && !Array.isArray(override[key]) &&
        typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])
      ) {
        result[key] = deep_merge(base[key], override[key], depth + 1);
      } else {
        result[key] = override[key];
      }
    }
    return result;
  }

  // ── Build mutable model clone ──────────────────────────────────────────────
  // Returns a deep-mutable copy of DEFAULT_MODEL with shortcuts lazily resolved
  // from blsi.Actions (available after action_registry.js loads).

  function build_default_model() {
    const m = JSON.parse(JSON.stringify(DEFAULT_MODEL));
    m.shortcuts = (globalThis.blsi && globalThis.blsi.Actions)
      ? globalThis.blsi.Actions.defaultBindings()
      : {};
    return m;
  }

  // ── Validate shortcut entry ────────────────────────────────────────────────
  // Validates the v2 shape: { binding: [{code: string, mods: string[]}] }
  // - binding: non-empty array, length ≤ 4
  // - each chord: non-empty code, mods subset of {Alt,Control,Meta,Shift}, len ≥ 1
  // - rejects bare Ctrl+Alt (AltGr collision on European layouts)

  const _valid_mods = new Set(['Alt', 'Control', 'Meta', 'Shift']);

  function is_valid_shortcut_entry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (!Array.isArray(entry.binding)) return false;
    if (entry.binding.length < 1 || entry.binding.length > 4) return false;
    for (const chord of entry.binding) {
      if (!chord || typeof chord !== 'object') return false;
      if (typeof chord.code !== 'string' || chord.code.length === 0) return false;
      if (!Array.isArray(chord.mods)) return false;
      for (const mod of chord.mods) {
        if (!_valid_mods.has(mod)) return false;
      }
      const mod_set = new Set(chord.mods);
      if (mod_set.size < 1) return false;
      // Bare Ctrl+Alt+X collides with AltGr on European layouts — reject.
      if (mod_set.has('Control') && mod_set.has('Alt') && !mod_set.has('Shift') && !mod_set.has('Meta')) {
        return false;
      }
    }
    return true;
  }

  // Snapshot item shape check — mirrors storage_model._is_valid_item but kept
  // here so validate_model can scrub site_rule snapshot items without a
  // cross-module call. Accepts both the new (selectors[]) and legacy (selector)
  // dynamic shape, plus the sticky shape.
  function _is_valid_snapshot_item(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.type === 'dynamic') {
      const name_ok = typeof item.name === 'string' && item.name.length <= 100;
      if (Array.isArray(item.selectors)) {
        return name_ok && item.selectors.length > 0 && item.selectors.length <= 6 &&
          item.selectors.every(s => typeof s === 'string' && s.length > 0 && s.length <= 2000);
      }
      return name_ok &&
        typeof item.selector === 'string' && item.selector.length > 0 && item.selector.length <= 2000;
    }
    if (item.type === 'sticky') {
      return typeof item.id === 'string' && item.id.length > 0 &&
        typeof item.name === 'string' && item.name.length <= 100 &&
        typeof item.x === 'number' && typeof item.y === 'number' &&
        typeof item.width === 'number' && typeof item.height === 'number';
    }
    return false;
  }

  // ── Validate model ─────────────────────────────────────────────────────────
  // Validates and repairs every section of a stored blsi_model object.
  // Missing or invalid values fall back to build_default_model() defaults.
  // Returns a clean, complete model object.

  function validate_model(model) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      return build_default_model();
    }

    const d = build_default_model();
    const r = {};

    // ── global_default_settings ────────────────────────────────────────────
    {
      // Migration: old storage key was 'settings'; read either for backwards compat.
      const raw = model.global_default_settings || model.settings;
      const s = (raw && typeof raw === 'object') ? raw : {};

      r.global_default_settings = {
        blur_radius: (typeof s.blur_radius === 'number' && s.blur_radius >= 2 && s.blur_radius <= 32)
          ? s.blur_radius : d.global_default_settings.blur_radius,

        transition_duration: (typeof s.transition_duration === 'number' && s.transition_duration >= 0 && s.transition_duration <= 2000)
          ? s.transition_duration : d.global_default_settings.transition_duration,

        highlight_color: (typeof s.highlight_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.highlight_color))
          ? s.highlight_color : d.global_default_settings.highlight_color,

        redaction_color: (typeof s.redaction_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.redaction_color))
          ? s.redaction_color : d.global_default_settings.redaction_color,

        reveal_mode: Object.values(reveal_modes).includes(s.reveal_mode)
          ? s.reveal_mode : d.global_default_settings.reveal_mode,

        enabled: (typeof s.enabled === 'boolean') ? s.enabled : d.global_default_settings.enabled,

        thorough_blur: (typeof s.thorough_blur === 'boolean') ? s.thorough_blur : d.global_default_settings.thorough_blur,

        language: (typeof s.language === 'string' && supported_languages.includes(s.language))
          ? s.language : d.global_default_settings.language,

        tab_privacy: (typeof s.tab_privacy === 'boolean') ? s.tab_privacy : d.global_default_settings.tab_privacy,
      };
    }

    // ── blur_all ───────────────────────────────────────────────────────────
    {
      const ba   = (model.blur_all && typeof model.blur_all === 'object') ? model.blur_all : {};
      const ba_s = (ba.settings && typeof ba.settings === 'object') ? ba.settings : {};
      // Migrate old enum values: gaussian→blur, masked→censored, solid→censored
      const migrated_blur_mode = ({ gaussian: 'blur', masked: 'censored', solid: 'censored' })[ba_s.blur_mode] ?? ba_s.blur_mode;
      r.blur_all = {
        status: (typeof ba.status === 'boolean') ? ba.status : d.blur_all.status,
        settings: {
          blur_mode: Object.values(blur_modes).includes(migrated_blur_mode)
            ? migrated_blur_mode : d.blur_all.settings.blur_mode,
          blur_categories: (() => {
            // Prefer new location (blur_all.settings.blur_categories).
            // Fall back to global_default_settings.blur_categories (or legacy 'settings' key)
            // for one-time migration of existing users whose data still lives under the old key.
            const _old_s = (model.global_default_settings || model.settings || {});
            const cats = (ba_s.blur_categories && typeof ba_s.blur_categories === 'object')
              ? ba_s.blur_categories
              : ((_old_s.blur_categories && typeof _old_s.blur_categories === 'object') ? _old_s.blur_categories : {});
            const out = {};
            for (const key of Object.keys(d.blur_all.settings.blur_categories)) {
              out[key] = (typeof cats[key] === 'boolean') ? cats[key] : d.blur_all.settings.blur_categories[key];
            }
            return out;
          })(),
        },
      };
    }

    // ── pick_and_blur ──────────────────────────────────────────────────────
    {
      const pb   = (model.pick_and_blur && typeof model.pick_and_blur === 'object') ? model.pick_and_blur : {};
      const pb_s = (pb.settings && typeof pb.settings === 'object') ? pb.settings : {};
      const pbc  = (pb_s.blur_color && typeof pb_s.blur_color === 'object') ? pb_s.blur_color : {};
      // Legacy 'sticky' → sticky-page migration
      const raw_picker = pb_s.picker_mode === 'sticky' ? picker_modes.sticky_page : pb_s.picker_mode;
      // Migrate old enum value: gaussian→blur
      const migrated_blur_type = pb_s.blur_type === 'gaussian' ? 'blur' : pb_s.blur_type;
      r.pick_and_blur = {
        status: (typeof pb.status === 'boolean') ? pb.status : d.pick_and_blur.status,
        settings: {
          picker_mode: (raw_picker === null || raw_picker === undefined)
            ? null
            : (Object.values(picker_modes).includes(raw_picker) ? raw_picker : null),
          blur_type: Object.values(pick_blur_modes).includes(migrated_blur_type)
            ? migrated_blur_type : d.pick_and_blur.settings.blur_type,
          blur_color: {
            hex: (typeof pbc.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(pbc.hex))
              ? pbc.hex : d.pick_and_blur.settings.blur_color.hex,
            opacity: (typeof pbc.opacity === 'number' && pbc.opacity >= 0 && pbc.opacity <= 1)
              ? pbc.opacity : d.pick_and_blur.settings.blur_color.opacity,
          },
        },
        items: (() => {
          const raw_items = (pb.items && typeof pb.items === 'object' && !Array.isArray(pb.items))
            ? pb.items : {};
          const out = {};
          for (const hn of Object.keys(raw_items)) {
            if (!hn || hn === '__proto__' || hn === 'constructor') continue;
            const arr = raw_items[hn];
            if (!Array.isArray(arr)) continue;
            const validated = arr.filter(function(item) {
              if (!item || typeof item !== 'object') return false;
              if (item.type === 'dynamic') {
                if (Array.isArray(item.selectors)) {
                  return item.selectors.length > 0 &&
                    item.selectors.every(function(s) { return typeof s === 'string' && s.length > 0; });
                }
                return typeof item.selector === 'string' && item.selector.length > 0;
              }
              if (item.type === 'sticky') {
                return typeof item.id === 'string' && item.id.length > 0 &&
                  typeof item.x === 'number' && typeof item.y === 'number' &&
                  typeof item.width === 'number' && typeof item.height === 'number';
              }
              return false;
            }).slice(0, 10);
            if (validated.length > 0) out[hn] = validated;
          }
          return out;
        })(),
      };
    }

    // ── auto_detect_pii ────────────────────────────────────────────────────
    {
      const ap   = (model.auto_detect_pii && typeof model.auto_detect_pii === 'object') ? model.auto_detect_pii : {};
      const ap_s = (ap.settings && typeof ap.settings === 'object') ? ap.settings : {};
      // Migrate old enum values: gaussian→blur, asterisked→starred, hidden→starred
      const migrated_pii_mode = ({ gaussian: 'blur', asterisked: 'starred', hidden: 'starred' })[ap_s.pii_mode] ?? ap_s.pii_mode;
      r.auto_detect_pii = {
        settings: {
          email:    (typeof ap_s.email === 'boolean')   ? ap_s.email   : d.auto_detect_pii.settings.email,
          numeric:  (typeof ap_s.numeric === 'boolean') ? ap_s.numeric : d.auto_detect_pii.settings.numeric,
          pii_mode: Object.values(pii_modes).includes(migrated_pii_mode)
            ? migrated_pii_mode : d.auto_detect_pii.settings.pii_mode,
          pii_redaction_color: (typeof ap_s.pii_redaction_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(ap_s.pii_redaction_color))
            ? ap_s.pii_redaction_color : d.auto_detect_pii.settings.pii_redaction_color,
        },
      };
    }

    // ── automate ───────────────────────────────────────────────────────────
    {
      const am   = (model.automate && typeof model.automate === 'object') ? model.automate : {};
      const am_s = (am.settings && typeof am.settings === 'object') ? am.settings : {};
      const ss   = (am_s.screen_share && typeof am_s.screen_share === 'object') ? am_s.screen_share : {};
      const id   = (am_s.idle  && typeof am_s.idle  === 'object') ? am_s.idle  : {};
      const ts   = (am_s.tab_switch && typeof am_s.tab_switch === 'object') ? am_s.tab_switch : {};
      r.automate = {
        settings: {
          screen_share: {
            enabled: (typeof ss.enabled === 'boolean') ? ss.enabled : d.automate.settings.screen_share.enabled,
          },
          idle: {
            value: (typeof id.value === 'number' && id.value >= 1 && id.value <= 99)
              ? id.value : d.automate.settings.idle.value,
            unit: Object.values(idle_units).includes(id.unit)
              ? id.unit : d.automate.settings.idle.unit,
            enabled: (typeof id.enabled === 'boolean') ? id.enabled : d.automate.settings.idle.enabled,
          },
          tab_switch: {
            enabled: (typeof ts.enabled === 'boolean') ? ts.enabled : d.automate.settings.tab_switch.enabled,
          },
        },
      };
    }

    // ── shortcuts ──────────────────────────────────────────────────────────
    {
      const sc = (model.shortcuts && typeof model.shortcuts === 'object') ? model.shortcuts : {};
      r.shortcuts = {};
      for (const action_id of Object.keys(d.shortcuts)) {
        const entry = sc[action_id];
        if (is_valid_shortcut_entry(entry)) {
          r.shortcuts[action_id] = {
            binding: entry.binding.map(chord => ({
              code: chord.code,
              mods: [...chord.mods].sort(),
            })),
          };
        } else {
          r.shortcuts[action_id] = JSON.parse(JSON.stringify(d.shortcuts[action_id]));
        }
      }
    }

    // ── site_rules ─────────────────────────────────────────────────────────
    {
      const rules_in = Array.isArray(model.site_rules) ? model.site_rules : [];
      r.site_rules = rules_in
        .filter(rule =>
          rule && typeof rule === 'object' &&
          typeof rule.hostname_value === 'string' && rule.hostname_value.length > 0 &&
          rule.hostname_value !== '__proto__' && rule.hostname_value !== 'constructor'
        )
        .slice(0, 200)
        .map(rule => ({
          hostname_value: rule.hostname_value.trim().slice(0, 500),
          hostname_type: Object.values(pattern_types).includes(rule.hostname_type)
            ? rule.hostname_type : pattern_types.exact,
          blur_all: (rule.blur_all === null || typeof rule.blur_all === 'boolean')
            ? rule.blur_all : null,
          snapshot: (() => {
            const raw = (rule.snapshot && typeof rule.snapshot === 'object' && !Array.isArray(rule.snapshot))
              ? rule.snapshot : {};
            // Empty {} stays empty — sentinel for "rule pins blur_all toggle only".
            if (Object.keys(raw).length === 0) return {};
            const out = {};

            // blur_all section
            if (raw.blur_all && typeof raw.blur_all === 'object') {
              const ba = raw.blur_all;
              const ba_out = {};
              if (ba.settings && typeof ba.settings === 'object') {
                const ba_s = ba.settings;
                const ba_s_out = {};
                if ('blur_mode' in ba_s) ba_s_out.blur_mode = ba_s.blur_mode;
                if ('blur_categories' in ba_s) {
                  const cats = (ba_s.blur_categories && typeof ba_s.blur_categories === 'object')
                    ? ba_s.blur_categories : null;
                  if (cats) {
                    const cats_out = {};
                    for (const ck of Object.keys(d.blur_all.settings.blur_categories)) {
                      cats_out[ck] = (typeof cats[ck] === 'boolean') ? cats[ck] : d.blur_all.settings.blur_categories[ck];
                    }
                    ba_s_out.blur_categories = cats_out;
                  }
                }
                if (Object.keys(ba_s_out).length) ba_out.settings = ba_s_out;
              }
              if (Object.keys(ba_out).length) out.blur_all = ba_out;
            }

            // auto_detect_pii section
            if (raw.auto_detect_pii && typeof raw.auto_detect_pii === 'object') {
              const ap = raw.auto_detect_pii;
              const ap_out = {};
              if (ap.settings && typeof ap.settings === 'object') {
                const ap_s = ap.settings;
                const ap_s_out = {};
                if (typeof ap_s.email === 'boolean')   ap_s_out.email   = ap_s.email;
                if (typeof ap_s.numeric === 'boolean') ap_s_out.numeric = ap_s.numeric;
                if (Object.values(pii_modes).includes(ap_s.pii_mode))
                  ap_s_out.pii_mode = ap_s.pii_mode;
                if (typeof ap_s.pii_redaction_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(ap_s.pii_redaction_color))
                  ap_s_out.pii_redaction_color = ap_s.pii_redaction_color;
                if (Object.keys(ap_s_out).length) ap_out.settings = ap_s_out;
              }
              if (Object.keys(ap_out).length) out.auto_detect_pii = ap_out;
            }

            // automate section — trigger.enabled for all three triggers,
            // plus idle.value / idle.unit (full idle shape is snapshot-overridable).
            if (raw.automate && typeof raw.automate === 'object') {
              const am = raw.automate;
              const am_out = {};
              if (am.settings && typeof am.settings === 'object') {
                const am_s = am.settings;
                const am_s_out = {};
                if (am_s.idle && typeof am_s.idle === 'object') {
                  const idle_out = {};
                  if (typeof am_s.idle.enabled === 'boolean') idle_out.enabled = am_s.idle.enabled;
                  if (typeof am_s.idle.value === 'number' && am_s.idle.value >= 1 && am_s.idle.value <= 99) {
                    idle_out.value = am_s.idle.value;
                  }
                  if (Object.values(idle_units).includes(am_s.idle.unit)) {
                    idle_out.unit = am_s.idle.unit;
                  }
                  if (Object.keys(idle_out).length) am_s_out.idle = idle_out;
                }
                for (const trig of ['tab_switch', 'screen_share']) {
                  const t = am_s[trig];
                  if (t && typeof t === 'object' && typeof t.enabled === 'boolean') {
                    am_s_out[trig] = { enabled: t.enabled };
                  }
                }
                if (Object.keys(am_s_out).length) am_out.settings = am_s_out;
              }
              if (Object.keys(am_out).length) out.automate = am_out;
            }

            // pick_and_blur section — settings + items array (host-bound items
            // pinned by the rule; replace host-keyed items at resolve time).
            if (raw.pick_and_blur && typeof raw.pick_and_blur === 'object') {
              const pb = raw.pick_and_blur;
              const pb_out = {};
              if (typeof pb.status === 'boolean') pb_out.status = pb.status;
              if (pb.settings && typeof pb.settings === 'object') {
                const pb_s = pb.settings;
                const pb_s_out = {};
                if ('blur_type'   in pb_s) pb_s_out.blur_type   = pb_s.blur_type;
                if ('picker_mode' in pb_s) pb_s_out.picker_mode = pb_s.picker_mode;
                if ('blur_color'  in pb_s) {
                  const pbc = (pb_s.blur_color && typeof pb_s.blur_color === 'object') ? pb_s.blur_color : {};
                  pb_s_out.blur_color = {
                    hex: (typeof pbc.hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(pbc.hex))
                      ? pbc.hex : d.pick_and_blur.settings.blur_color.hex,
                    opacity: (typeof pbc.opacity === 'number' && pbc.opacity >= 0 && pbc.opacity <= 1)
                      ? pbc.opacity : d.pick_and_blur.settings.blur_color.opacity,
                  };
                }
                if (Object.keys(pb_s_out).length) pb_out.settings = pb_s_out;
              }
              if (Array.isArray(pb.items)) {
                pb_out.items = pb.items
                  .filter(_is_valid_snapshot_item)
                  .slice(0, 10);
              }
              if (Object.keys(pb_out).length) out.pick_and_blur = pb_out;
            }

            // Full-snapshot enforcement: a non-empty snapshot must mirror
            // capture_snapshot()'s full shape. Fill any missing keys/sections
            // from DEFAULT_MODEL so resolve() never sees a partial.
            // Empty {} would have already returned above.
            if (!out.blur_all) out.blur_all = {};
            if (!out.blur_all.settings) out.blur_all.settings = {};
            if (!('blur_mode' in out.blur_all.settings))
              out.blur_all.settings.blur_mode = d.blur_all.settings.blur_mode;
            if (!('blur_categories' in out.blur_all.settings)) {
              const cats_full = {};
              for (const ck of Object.keys(d.blur_all.settings.blur_categories)) {
                cats_full[ck] = d.blur_all.settings.blur_categories[ck];
              }
              out.blur_all.settings.blur_categories = cats_full;
            }
            if (!out.pick_and_blur) out.pick_and_blur = {};
            if (typeof out.pick_and_blur.status !== 'boolean')
              out.pick_and_blur.status = d.pick_and_blur.status;
            if (!out.pick_and_blur.settings) out.pick_and_blur.settings = {};
            if (!('blur_type' in out.pick_and_blur.settings))
              out.pick_and_blur.settings.blur_type = d.pick_and_blur.settings.blur_type;
            if (!('picker_mode' in out.pick_and_blur.settings))
              out.pick_and_blur.settings.picker_mode = d.pick_and_blur.settings.picker_mode;
            if (!('blur_color' in out.pick_and_blur.settings)) {
              out.pick_and_blur.settings.blur_color = {
                hex: d.pick_and_blur.settings.blur_color.hex,
                opacity: d.pick_and_blur.settings.blur_color.opacity,
              };
            }
            if (!Array.isArray(out.pick_and_blur.items)) out.pick_and_blur.items = [];
            if (!out.auto_detect_pii) out.auto_detect_pii = {};
            if (!out.auto_detect_pii.settings) out.auto_detect_pii.settings = {};
            for (const k of ['email', 'numeric', 'pii_mode', 'pii_redaction_color']) {
              if (!(k in out.auto_detect_pii.settings))
                out.auto_detect_pii.settings[k] = d.auto_detect_pii.settings[k];
            }
            if (!out.automate) out.automate = {};
            if (!out.automate.settings) out.automate.settings = {};
            // idle: full shape (value + unit + enabled). tab_switch / screen_share: enabled only.
            if (!out.automate.settings.idle) out.automate.settings.idle = {};
            if (typeof out.automate.settings.idle.value !== 'number')
              out.automate.settings.idle.value = d.automate.settings.idle.value;
            if (!Object.values(idle_units).includes(out.automate.settings.idle.unit))
              out.automate.settings.idle.unit = d.automate.settings.idle.unit;
            if (typeof out.automate.settings.idle.enabled !== 'boolean')
              out.automate.settings.idle.enabled = d.automate.settings.idle.enabled;
            for (const trig of ['tab_switch', 'screen_share']) {
              if (!out.automate.settings[trig])
                out.automate.settings[trig] = { enabled: d.automate.settings[trig].enabled };
            }

            return out;
          })(),
        }));
    }

    return r;
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  return {
    // message categories
    command,
    popup,
    is_valid,
    category_of,
    // enums
    reveal_modes,
    blur_modes,
    picker_modes,
    pick_blur_modes,
    pii_modes,
    idle_units,
    pattern_types,
    supported_languages,
    // css/ids
    css,
    ids,
    // model
    DEFAULT_MODEL,
    reveal_dfs_max_depth,
    modifier_codes,
    // utilities
    deep_merge,
    build_default_model,
    validate_model,
    is_valid_shortcut_entry,
  };
})();

// Extend (don't replace) any pre-existing blsi — action_registry.js may have
// been loaded first in some contexts.
globalThis.blsi = Object.assign(globalThis.blsi || {}, Constants);
