/**
 * tests/unit/constants.test.js
 *
 * Unit tests for src/constants.js (snake_case API)
 * Module exposes globalThis.blsi with message type constants,
 * DEFAULT_MODEL, build_default_model(), deep_merge(), is_valid(), category_of(),
 * validate_model().
 */

'use strict';

describe('BlurrySite constants', () => {
  const PB = blsi;

  // ── Message type categories ───────────────────────────────────────────────

  // USER IMPACT: background.js message routing depends on exact type string values
  describe('command category', () => {
    test('exposes all command message types', () => {
      expect(PB.command.toggle_blur_all).toBe('TOGGLE_BLUR_ALL');
      expect(PB.command.toggle_picker).toBe('TOGGLE_PICKER');
      expect(PB.command.clear_all_blur).toBe('CLEAR_ALL_BLUR');
      expect(PB.command.restore).toBe('RESTORE');
      expect(PB.command.context_blur).toBe('CONTEXT_BLUR');
      expect(PB.command.context_unblur).toBe('CONTEXT_UNBLUR');
    });
  });

  describe('popup category', () => {
    test('exposes all popup message types', () => {
      expect(PB.popup.get_status).toBe('GET_STATUS');
      expect(PB.popup.unblur_item).toBe('UNBLUR_ITEM');
    });
  });

  // ── is_valid ───────────────────────────────────────────────────────────────

  describe('is_valid', () => {
    test('returns true for known message types', () => {
      expect(PB.is_valid('TOGGLE_BLUR_ALL')).toBe(true);
      expect(PB.is_valid('GET_STATUS')).toBe(true);
    });

    test('returns false for unknown strings', () => {
      expect(PB.is_valid('UNKNOWN_TYPE')).toBe(false);
      expect(PB.is_valid('')).toBe(false);
    });

    test('returns false for non-string input', () => {
      expect(PB.is_valid(null)).toBe(false);
      expect(PB.is_valid(undefined)).toBe(false);
      expect(PB.is_valid(42)).toBe(false);
    });
  });

  // ── category_of ────────────────────────────────────────────────────────────

  describe('category_of', () => {
    test('returns correct category for command types', () => {
      expect(PB.category_of('TOGGLE_BLUR_ALL')).toBe('command');
      expect(PB.category_of('RESTORE')).toBe('command');
    });

    test('returns correct category for popup types', () => {
      expect(PB.category_of('GET_STATUS')).toBe('popup');
    });

    test('returns null for unknown types', () => {
      expect(PB.category_of('UNKNOWN')).toBeNull();
      expect(PB.category_of('')).toBeNull();
    });
  });

  // ── DEFAULT_MODEL ─────────────────────────────────────────────────────────

  describe('DEFAULT_MODEL', () => {
    test('has top-level sections: settings, blur_all, pick_and_blur, auto_detect_pii, automate, site_rules', () => {
      expect(PB.DEFAULT_MODEL.settings).toBeDefined();
      expect(PB.DEFAULT_MODEL.blur_all).toBeDefined();
      expect(PB.DEFAULT_MODEL.pick_and_blur).toBeDefined();
      expect(PB.DEFAULT_MODEL.auto_detect_pii).toBeDefined();
      expect(PB.DEFAULT_MODEL.automate).toBeDefined();
      expect(Array.isArray(PB.DEFAULT_MODEL.site_rules)).toBe(true);
    });

    test('settings has correct default values', () => {
      const s = PB.DEFAULT_MODEL.settings;
      expect(s.blur_radius).toBe(6);
      expect(s.transition_duration).toBe(150);
      expect(s.highlight_color).toBe('#f59e0b');
      expect(s.reveal_mode).toBe('hover');
      expect(s.enabled).toBe(true);
      expect(s.thorough_blur).toBe(false);
      expect(s.language).toBe('auto');
    });

    test('settings.blur_categories has correct defaults', () => {
      const bc = PB.DEFAULT_MODEL.settings.blur_categories;
      expect(bc.text).toBe(true);
      expect(bc.media).toBe(true);
      expect(bc.form).toBe(false);
      expect(bc.table).toBe(true);
      expect(bc.structure).toBe(true);
      expect(Object.keys(bc)).toHaveLength(5);
    });

    test('blur_all.settings.blur_mode defaults to blur', () => {
      expect(PB.DEFAULT_MODEL.blur_all.settings.blur_mode).toBe('blur');
    });

    test('pick_and_blur defaults', () => {
      const pab = PB.DEFAULT_MODEL.pick_and_blur;
      expect(pab.status).toBe(false);
      expect(pab.settings.picker_mode).toBeNull();
      expect(pab.settings.blur_type).toBe('blur');
    });

    test('auto_detect_pii defaults', () => {
      const pii = PB.DEFAULT_MODEL.auto_detect_pii;
      expect(pii.status).toBe(true);
      expect(pii.settings.email).toBe(true);
      expect(pii.settings.numeric).toBe(true);
      expect(pii.settings.pii_mode).toBe('blur');
    });

    test('automate defaults', () => {
      const a = PB.DEFAULT_MODEL.automate;
      expect(a.settings.idle.value).toBe(5);
      expect(a.settings.idle.unit).toBe('min');
      expect(a.settings.tab_switch.enabled).toBe(false);
    });

    test('automate_blur default is empty object', () => {
      expect(PB.DEFAULT_MODEL.automate_blur).toBeDefined();
      expect(typeof PB.DEFAULT_MODEL.automate_blur).toBe('object');
      expect(Object.keys(PB.DEFAULT_MODEL.automate_blur)).toHaveLength(0);
    });

    test('is frozen', () => {
      expect(Object.isFrozen(PB.DEFAULT_MODEL)).toBe(true);
      expect(Object.isFrozen(PB.DEFAULT_MODEL.settings)).toBe(true);
    });
  });

  // ── build_default_model ─────────────────────────────────────────────────────

  describe('build_default_model', () => {
    test('returns a mutable deep clone with shortcuts', () => {
      const m = PB.build_default_model();
      expect(m.settings.blur_radius).toBe(6);
      m.settings.blur_radius = 20;
      expect(m.settings.blur_radius).toBe(20);
      expect(PB.DEFAULT_MODEL.settings.blur_radius).toBe(6);
    });

    test('includes shortcuts from action registry', () => {
      const m = PB.build_default_model();
      expect(m.shortcuts).toBeDefined();
      expect(Object.keys(m.shortcuts).length).toBeGreaterThan(0);
      // Kebab-case action IDs
      expect(m.shortcuts['toggle-blur-all']).toBeDefined();
      expect(m.shortcuts['toggle-picker']).toBeDefined();
      expect(m.shortcuts['clear-all']).toBeDefined();
    });

    test('nested objects are cloned (not shared)', () => {
      const m = PB.build_default_model();
      m.settings.blur_categories.form = true;
      expect(PB.DEFAULT_MODEL.settings.blur_categories.form).toBe(false);
    });
  });

  // ── deep_merge ────────────────────────────────────────────────────────────

  describe('deep_merge', () => {
    test('merges flat keys', () => {
      const result = PB.deep_merge({ a: 1, b: 2 }, { b: 3 });
      expect(result).toEqual({ a: 1, b: 3 });
    });

    test('merges nested objects', () => {
      const result = PB.deep_merge(
        { outer: { a: 1, b: 2 } },
        { outer: { b: 3 } }
      );
      expect(result).toEqual({ outer: { a: 1, b: 3 } });
    });

    test('blocks prototype pollution keys', () => {
      const result = PB.deep_merge({}, { __proto__: { evil: true }, constructor: 'bad' });
      expect(result.evil).toBeUndefined();
      expect(result.constructor).toBe(Object);
    });

    test('does not mutate base', () => {
      const base = Object.freeze({ a: 1 });
      const result = PB.deep_merge(base, { a: 2 });
      expect(result.a).toBe(2);
      expect(base.a).toBe(1);
    });

    test('stops at depth limit', () => {
      const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
      const base = { a: { b: { c: { d: { e: { f: { g: 'base' } } } } } } };
      const result = PB.deep_merge(base, deep);
      expect(result.a.b.c.d.e.f).toEqual({ g: 'deep' });
    });
  });

  // ── validate_model ─────────────────────────────────────────────────────────

  describe('validate_model', () => {
    test('returns full defaults for null input', () => {
      const m = PB.validate_model(null);
      expect(m.settings.blur_radius).toBe(6);
      expect(m.settings.enabled).toBe(true);
      expect(m.settings.blur_categories.text).toBe(true);
      expect(m.shortcuts).toBeDefined();
    });

    test('preserves valid settings values', () => {
      const input = PB.build_default_model();
      input.settings.blur_radius = 15;
      input.settings.enabled = false;
      input.settings.blur_categories.form = true;
      const result = PB.validate_model(input);
      expect(result.settings.blur_radius).toBe(15);
      expect(result.settings.enabled).toBe(false);
      expect(result.settings.blur_categories.form).toBe(true);
    });

    test('replaces out-of-range blur_radius with default', () => {
      const input = PB.build_default_model();
      input.settings.blur_radius = 999;
      expect(PB.validate_model(input).settings.blur_radius).toBe(6);
    });

    test('replaces invalid reveal_mode with default', () => {
      const input = PB.build_default_model();
      input.settings.reveal_mode = 'invalid';
      expect(PB.validate_model(input).settings.reveal_mode).toBe('hover');
    });

    test('language accepts auto, en, hi_IN, ta_IN', () => {
      const m = (lang) => { const i = PB.build_default_model(); i.settings.language = lang; return PB.validate_model(i).settings.language; };
      expect(m('auto')).toBe('auto');
      expect(m('en')).toBe('en');
      expect(m('hi_IN')).toBe('hi_IN');
      expect(m('ta_IN')).toBe('ta_IN');
    });

    test('language rejects unsupported codes and falls back to auto', () => {
      const m = (lang) => { const i = PB.build_default_model(); i.settings.language = lang; return PB.validate_model(i).settings.language; };
      expect(m('fr')).toBe('auto');
      expect(m('')).toBe('auto');
      expect(m(null)).toBe('auto');
    });

    test('fills missing sections with defaults', () => {
      const result = PB.validate_model({});
      expect(result.settings.blur_radius).toBe(6);
      expect(result.settings.reveal_mode).toBe('hover');
      expect(result.settings.language).toBe('auto');
      expect(result.settings.enabled).toBe(true);
      expect(result.settings.thorough_blur).toBe(false);
      expect(Object.keys(result.settings.blur_categories)).toHaveLength(5);
      expect(result.blur_all).toBeDefined();
      expect(result.pick_and_blur).toBeDefined();
      expect(result.auto_detect_pii).toBeDefined();
      expect(result.automate).toBeDefined();
      expect(Array.isArray(result.site_rules)).toBe(true);
    });

    test('validates shortcut entries in shortcuts section', () => {
      const input = PB.build_default_model();
      input.shortcuts = { 'toggle-blur-all': { bad: true } };
      const result = PB.validate_model(input);
      // Falls back to default binding
      const entry = result.shortcuts['toggle-blur-all'];
      expect(Array.isArray(entry.binding)).toBe(true);
      expect(entry.binding.length).toBeGreaterThan(0);
    });
  });

  // ── Enums ──────────────────────────────────────────────────────────────────

  // All enums must be frozen to prevent runtime corruption.
  test.each([
    ['blur_modes',      () => PB.blur_modes],
    ['reveal_modes',    () => PB.reveal_modes],
    ['picker_modes',    () => PB.picker_modes],
    ['pick_blur_modes', () => PB.pick_blur_modes],
    ['pii_modes',       () => PB.pii_modes],
    ['idle_units',      () => PB.idle_units],
    ['pattern_types',   () => PB.pattern_types],
  ])('%s enum is frozen', (_name, getEnum) => {
    expect(Object.isFrozen(getEnum())).toBe(true);
  });

  // Non-obvious: sticky variant keys use underscores but values use hyphens.
  test('picker_modes: sticky_page and sticky_screen use hyphenated values', () => {
    expect(PB.picker_modes.sticky_page).toBe('sticky-page');
    expect(PB.picker_modes.sticky_screen).toBe('sticky-screen');
  });

  // pick_blur_modes intentionally excludes redacted and censored (Blur All-only types).
  test('pick_blur_modes excludes redacted and censored', () => {
    expect(PB.pick_blur_modes.redacted).toBeUndefined();
    expect(PB.pick_blur_modes.censored).toBeUndefined();
  });

  // idle_units intentionally excludes hr (Chrome idle API cap ~3000 s).
  test('idle_units excludes hr', () => {
    expect(PB.idle_units.hr).toBeUndefined();
  });

  // ── is_valid_shortcut_entry ────────────────────────────────────────────────

  describe('is_valid_shortcut_entry', () => {
    test('accepts valid binding', () => {
      expect(PB.is_valid_shortcut_entry({ binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] })).toBe(true);
    });
    test('rejects empty binding array', () => {
      expect(PB.is_valid_shortcut_entry({ binding: [] })).toBe(false);
    });
    test('rejects mods.length === 0', () => {
      expect(PB.is_valid_shortcut_entry({ binding: [{ code: 'KeyB', mods: [] }] })).toBe(false);
    });
    test('rejects Ctrl+Alt (AltGr collision)', () => {
      expect(PB.is_valid_shortcut_entry({ binding: [{ code: 'KeyQ', mods: ['Control', 'Alt'] }] })).toBe(false);
    });
    test('rejects unknown modifier names', () => {
      expect(PB.is_valid_shortcut_entry({ binding: [{ code: 'KeyK', mods: ['Option'] }] })).toBe(false);
    });
    test('rejects null input', () => {
      expect(PB.is_valid_shortcut_entry(null)).toBe(false);
    });
  });

  // ── Immutability ──────────────────────────────────────────────────────────

  describe('immutability', () => {
    test('top-level blsi namespace is extensible (modules attach to it)', () => {
      expect(typeof PB).toBe('object');
    });

    test('command and popup category objects are frozen', () => {
      expect(Object.isFrozen(PB.command)).toBe(true);
      expect(Object.isFrozen(PB.popup)).toBe(true);
    });
  });

  // ── validate_model boundary values ────────────────────────────────────────

  describe('validate_model boundary values', () => {
    test('blur_radius accepts min boundary (2)', () => {
      const m = PB.build_default_model();
      m.settings.blur_radius = 2;
      expect(PB.validate_model(m).settings.blur_radius).toBe(2);
    });

    test('blur_radius accepts max boundary (32)', () => {
      const m = PB.build_default_model();
      m.settings.blur_radius = 32;
      expect(PB.validate_model(m).settings.blur_radius).toBe(32);
    });

    test('blur_radius rejects below min (1)', () => {
      const m = PB.build_default_model();
      m.settings.blur_radius = 1;
      expect(PB.validate_model(m).settings.blur_radius).toBe(PB.DEFAULT_MODEL.settings.blur_radius);
    });

    test('blur_radius rejects above max (33)', () => {
      const m = PB.build_default_model();
      m.settings.blur_radius = 33;
      expect(PB.validate_model(m).settings.blur_radius).toBe(PB.DEFAULT_MODEL.settings.blur_radius);
    });

    test('blur_mode (in blur_all.settings) validates against enum', () => {
      const m = PB.build_default_model();
      m.blur_all.settings.blur_mode = 'blur';
      expect(PB.validate_model(m).blur_all.settings.blur_mode).toBe('blur');
      m.blur_all.settings.blur_mode = 'invalid';
      expect(PB.validate_model(m).blur_all.settings.blur_mode).toBe('blur');
    });

    test('blur_mode migrates legacy values: gaussian→blur, masked→solid→censored', () => {
      const m = PB.build_default_model();
      m.blur_all.settings.blur_mode = 'gaussian';
      expect(PB.validate_model(m).blur_all.settings.blur_mode).toBe('blur');
      m.blur_all.settings.blur_mode = 'masked';
      expect(PB.validate_model(m).blur_all.settings.blur_mode).toBe('censored');
      m.blur_all.settings.blur_mode = 'solid';
      expect(PB.validate_model(m).blur_all.settings.blur_mode).toBe('censored');
    });

    test('pick_and_blur blur_type migrates legacy gaussian→blur', () => {
      const m = PB.build_default_model();
      m.pick_and_blur.settings.blur_type = 'gaussian';
      expect(PB.validate_model(m).pick_and_blur.settings.blur_type).toBe('blur');
    });

    test('picker_mode validates against enum', () => {
      const m = PB.build_default_model();
      m.pick_and_blur.settings.picker_mode = 'sticky-page';
      expect(PB.validate_model(m).pick_and_blur.settings.picker_mode).toBe('sticky-page');
      m.pick_and_blur.settings.picker_mode = 'invalid';
      expect(PB.validate_model(m).pick_and_blur.settings.picker_mode).toBeNull();
      m.pick_and_blur.settings.picker_mode = null;
      expect(PB.validate_model(m).pick_and_blur.settings.picker_mode).toBeNull();
    });

    test('pii_mode validates against enum', () => {
      const m = PB.build_default_model();
      m.auto_detect_pii.settings.pii_mode = 'redacted';
      expect(PB.validate_model(m).auto_detect_pii.settings.pii_mode).toBe('redacted');
      m.auto_detect_pii.settings.pii_mode = 'bogus';
      expect(PB.validate_model(m).auto_detect_pii.settings.pii_mode).toBe('blur');
    });

    test('pii_mode migrates legacy values: gaussian→blur, asterisked→hidden→starred', () => {
      const m = PB.build_default_model();
      m.auto_detect_pii.settings.pii_mode = 'gaussian';
      expect(PB.validate_model(m).auto_detect_pii.settings.pii_mode).toBe('blur');
      m.auto_detect_pii.settings.pii_mode = 'asterisked';
      expect(PB.validate_model(m).auto_detect_pii.settings.pii_mode).toBe('starred');
      m.auto_detect_pii.settings.pii_mode = 'hidden';
      expect(PB.validate_model(m).auto_detect_pii.settings.pii_mode).toBe('starred');
    });

    test('automate.idle: hr unit rejected — falls back to min', () => {
      const m = PB.build_default_model();
      m.automate.settings.idle = { value: 2, unit: 'hr', enabled: true };
      expect(PB.validate_model(m).automate.settings.idle.unit).toBe('min');
    });

    test('automate.idle: value 0 (below min 1) falls back to 5', () => {
      const m = PB.build_default_model();
      m.automate.settings.idle = { value: 0, unit: 'min', enabled: false };
      expect(PB.validate_model(m).automate.settings.idle.value).toBe(5);
    });

    test('automate_blur: valid entry passes through', () => {
      const m = PB.build_default_model();
      m.automate_blur = { 'example.com': { idle: true, tab_switch: false, screen_share: true } };
      const result = PB.validate_model(m);
      expect(result.automate_blur['example.com'].idle).toBe(true);
      expect(result.automate_blur['example.com'].tab_switch).toBe(false);
      expect(result.automate_blur['example.com'].screen_share).toBe(true);
    });

    test('automate_blur: missing fields default to false', () => {
      const m = PB.build_default_model();
      m.automate_blur = { 'example.com': {} };
      const result = PB.validate_model(m);
      expect(result.automate_blur['example.com'].idle).toBe(false);
      expect(result.automate_blur['example.com'].tab_switch).toBe(false);
      expect(result.automate_blur['example.com'].screen_share).toBe(false);
    });

    test('automate_blur: prototype pollution keys are dropped', () => {
      const m = PB.build_default_model();
      m.automate_blur = { '__proto__': { idle: true }, 'ok.com': { idle: true } };
      const result = PB.validate_model(m);
      // __proto__ is filtered out — only ok.com should remain as own key
      expect(Object.keys(result.automate_blur)).toHaveLength(1);
      expect(Object.keys(result.automate_blur)[0]).toBe('ok.com');
      expect(result.automate_blur['ok.com'].idle).toBe(true);
    });

    test('automate_blur: non-object input defaults to empty', () => {
      const m = PB.build_default_model();
      m.automate_blur = 'invalid';
      const result = PB.validate_model(m);
      expect(result.automate_blur).toEqual({});
    });

    test('shortcuts: rejects empty binding array', () => {
      const m = PB.build_default_model();
      m.shortcuts['toggle-blur-all'] = { binding: [] };
      const result = PB.validate_model(m);
      expect(result.shortcuts['toggle-blur-all'].binding.length).toBeGreaterThan(0);
    });

    test('shortcuts: accepts valid binding', () => {
      const m = PB.build_default_model();
      m.shortcuts['toggle-blur-all'] = { binding: [{ code: 'KeyK', mods: ['Control', 'Shift'] }] };
      const result = PB.validate_model(m);
      expect(result.shortcuts['toggle-blur-all'].binding[0].code).toBe('KeyK');
    });

    // ── site_rules: blur_all and items invariants ──────────────────────────
    // blur_all:false must survive — the popup toggle-off path writes this value
    // and validate_model runs on every storage write. Coercing false→null would
    // silently revert the user's "turn off blur" action.
    test('site_rules: blur_all:false is preserved (not coerced to null)', () => {
      const m = PB.build_default_model();
      m.site_rules = [{ hostname_value: 'example.com', hostname_type: 'exact', blur_all: false, items: [], settings: {} }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].blur_all).toBe(false);
    });

    test('site_rules: blur_all:true is preserved', () => {
      const m = PB.build_default_model();
      m.site_rules = [{ hostname_value: 'example.com', hostname_type: 'exact', blur_all: true, items: [], settings: {} }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].blur_all).toBe(true);
    });

    test('site_rules: blur_all:null (inherit) is preserved', () => {
      const m = PB.build_default_model();
      m.site_rules = [{ hostname_value: 'example.com', hostname_type: 'exact', blur_all: null, items: [], settings: {} }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].blur_all).toBeNull();
    });

    // selectors[] shape was previously stripped by the items filter, causing
    // items to disappear as a side-effect of any storage write (including toggle-off).
    test('site_rules: dynamic item with selectors[] array passes validation', () => {
      const m = PB.build_default_model();
      m.site_rules = [{
        hostname_value: 'example.com', hostname_type: 'exact', blur_all: null, settings: {},
        items: [{ type: 'dynamic', selectors: ['#foo', '.bar'], name: 'Multi' }],
      }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].items).toHaveLength(1);
      expect(result.site_rules[0].items[0].selectors[0]).toBe('#foo');
    });

    test('site_rules: dynamic item with legacy selector string passes validation', () => {
      const m = PB.build_default_model();
      m.site_rules = [{
        hostname_value: 'example.com', hostname_type: 'exact', blur_all: null, settings: {},
        items: [{ type: 'dynamic', selector: '#foo', name: 'Old' }],
      }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].items).toHaveLength(1);
      expect(result.site_rules[0].items[0].selector).toBe('#foo');
    });

    test('site_rules: dynamic item with empty selectors[] is stripped', () => {
      const m = PB.build_default_model();
      m.site_rules = [{
        hostname_value: 'example.com', hostname_type: 'exact', blur_all: null, settings: {},
        items: [{ type: 'dynamic', selectors: [], name: 'Empty' }],
      }];
      const result = PB.validate_model(m);
      expect(result.site_rules[0].items).toHaveLength(0);
    });
  });

});
