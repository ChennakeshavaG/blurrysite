/**
 * tests/unit/storage_model.test.js
 *
 * Unit tests for src/storage_model.js
 * Module exposes blsi.Model with:
 *   init_cache, on_change, get,
 *   patch_section, debounced_patch, save_settings,
 *   get_all_site_rules, get_site_entry, set_site_entry, remove_site_entry,
 *   resolve,
 *   get_blur_items, get_cached_blur_state, get_blur_state,
 *   save_blur_state, save_blur_item, remove_blur_item,
 *   clear_host, clear_all,
 *   get_rules, save_rules,
 *   _reset_cache
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MODULE_PATH     = path.resolve(__dirname, '../../src/storage_model.js');
const URL_MATCHER_PATH = path.resolve(__dirname, '../../src/url_matcher.js');

function loadStorageModel() {
  if (blsi.Model) return;
  // storage_model.js depends on blsi.UrlMatcher for resolve(); load it first.
  if (!blsi.UrlMatcher && fs.existsSync(URL_MATCHER_PATH)) {
    require(URL_MATCHER_PATH);
  }
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `(function() {
    'use strict';
    blsi.Model = {
      init_cache:             jest.fn(),
      on_change:              jest.fn(),
      get:                    jest.fn(() => blsi.build_default_model()),
      patch_section:          jest.fn(),
      debounced_patch:        jest.fn(),
      save_settings:          jest.fn(),
      get_all_site_rules:     jest.fn(() => []),
      get_site_entry:         jest.fn(() => null),
      set_site_entry:         jest.fn(),
      remove_site_entry:      jest.fn(),
      resolve:                jest.fn(() => ({})),
      get_blur_items:         jest.fn(() => Promise.resolve([])),
      get_cached_blur_state:  jest.fn(() => false),
      get_blur_state:         jest.fn(() => Promise.resolve(false)),
      save_blur_state:        jest.fn(),
      save_blur_item:         jest.fn(),
      remove_blur_item:       jest.fn(),
      clear_host:             jest.fn(),
      clear_all:              jest.fn(),
      get_rules:              jest.fn(() => Promise.resolve([])),
      save_rules:             jest.fn(),
      save_automate_blur:     jest.fn(),
      patch_automate_blur:    jest.fn(),
      clear_automate_blur:    jest.fn(),
      _reset_cache:           jest.fn(),
    };
  })();`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockGet(modelData) {
  chrome.storage.local.get.mockImplementation((key, cb) => {
    cb(modelData ? { blsi_model: modelData } : {});
  });
}

function mockSet() {
  chrome.storage.local.set.mockImplementation((data, cb) => { if (cb) cb(); });
}

function makeModel(overrides) {
  const m = blsi.build_default_model();
  return Object.assign(m, overrides);
}

// ── Test suite ────────────────────────────────────────────────────────────────

beforeAll(() => loadStorageModel());
beforeEach(() => {
  mockSet();
  blsi.Model._reset_cache();
});

// ── init_cache ────────────────────────────────────────────────────────────────

// USER IMPACT: on first install storage is empty — extension seeds a full default model so
// all features work without user configuration.
describe('init_cache', () => {
  test('seeds default model when storage is empty', async () => {
    mockGet(null);
    await blsi.Model.init_cache();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ blsi_model: expect.objectContaining({ settings: expect.any(Object) }) }),
      expect.any(Function)
    );
    const saved = chrome.storage.local.set.mock.calls[0][0].blsi_model;
    expect(saved.settings.blur_radius).toBe(6);
  });

  test('loads and validates existing model from storage', async () => {
    const stored = blsi.build_default_model();
    stored.settings.blur_radius = 12;
    mockGet(stored);

    await blsi.Model.init_cache();
    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(12);
    // No second write needed when storage already had a valid model
    // (may write once to seed shortcuts if they were missing — just check get() is populated)
    expect(m).toBeDefined();
  });

  test('_reset_cache sets cache to null so next get() returns default', () => {
    // After _reset_cache, get() returns build_default_model() (cache is null)
    blsi.Model._reset_cache();
    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(6);
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

// USER IMPACT: content_script calls get() synchronously after init; must never return undefined.
describe('get', () => {
  test('returns default model when cache is null (not yet init_cached)', () => {
    const m = blsi.Model.get();
    expect(m).toBeDefined();
    expect(m.settings).toBeDefined();
    expect(m.settings.blur_radius).toBe(6);
  });

  test('returns cached model after init_cache', async () => {
    const stored = blsi.build_default_model();
    stored.settings.blur_radius = 18;
    mockGet(stored);

    await blsi.Model.init_cache();
    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(18);
  });
});

// ── patch_section ─────────────────────────────────────────────────────────────

// USER IMPACT: popup sliders call patch_section('settings', { blur_radius: N }); other sections
// must be left untouched.
describe('patch_section', () => {
  test('deep-merges patch into specified section', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.patch_section('settings', { blur_radius: 20 });
    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(20);
  });

  test('does not mutate other sections', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.patch_section('settings', { blur_radius: 20 });
    const m = blsi.Model.get();
    // blur_all untouched
    expect(m.blur_all.status).toBe(false);
    expect(m.blur_all.settings.blur_mode).toBe('gaussian');
  });

  test('calls validate_model (invalid value is coerced to default)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    // blur_radius=999 is out of range — validate_model should coerce to 6
    await blsi.Model.patch_section('settings', { blur_radius: 999 });
    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(6);
  });
});

// ── save_settings ─────────────────────────────────────────────────────────────

// USER IMPACT: popup calls save_settings with partial settings object; null/non-object input
// must not corrupt storage.
describe('save_settings', () => {
  test('merges patch into model.settings', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_settings({ reveal_mode: 'click' });
    const m = blsi.Model.get();
    expect(m.settings.reveal_mode).toBe('click');
    // Other settings preserved
    expect(m.settings.blur_radius).toBe(6);
  });

  test('rejects null input — no storage write', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_settings(null);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects non-object input — no storage write', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_settings('bad string');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── get_site_entry / set_site_entry / remove_site_entry ───────────────────────

// USER IMPACT: per-host blur state and blur items are stored in exact site_rules entries;
// CRUD operations must work correctly.
describe('get_site_entry / set_site_entry / remove_site_entry', () => {
  test('get_site_entry returns null when hostname not in site_rules', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    expect(blsi.Model.get_site_entry('example.com')).toBeNull();
  });

  test('set_site_entry creates new exact entry', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('example.com', { blur_all: true });
    const entry = blsi.Model.get_site_entry('example.com');
    expect(entry).not.toBeNull();
    expect(entry.hostname_value).toBe('example.com');
    expect(entry.hostname_type).toBe(blsi.pattern_types.exact);
    expect(entry.blur_all).toBe(true);
  });

  test('set_site_entry upserts (second call merges)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('example.com', { blur_all: true });
    await blsi.Model.set_site_entry('example.com', { settings: { blur_radius: 15 } });
    const entry = blsi.Model.get_site_entry('example.com');
    expect(entry.blur_all).toBe(true);
    expect(entry.settings.blur_radius).toBe(15);
  });

  test('remove_site_entry deletes the entry', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('example.com', { blur_all: true });
    expect(blsi.Model.get_site_entry('example.com')).not.toBeNull();

    await blsi.Model.remove_site_entry('example.com');
    expect(blsi.Model.get_site_entry('example.com')).toBeNull();
  });

  test('remove_site_entry is a no-op when hostname not present', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    // hostname not in rules — should complete without error
    await expect(blsi.Model.remove_site_entry('nothere.com')).resolves.not.toThrow();
  });
});

// ── save_blur_state / get_blur_state / get_cached_blur_state ─────────────────

// USER IMPACT: blur-all state persists across page navigations; null means inherit global default.
describe('save_blur_state / get_blur_state / get_cached_blur_state', () => {
  test('save_blur_state writes per-host blur_all flag', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    const entry = blsi.Model.get_site_entry('example.com');
    expect(entry.blur_all).toBe(true);
  });

  test('get_blur_state returns per-host boolean', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    const result = await blsi.Model.get_blur_state('example.com');
    expect(result).toBe(true);
  });

  test('get_cached_blur_state inherits global blur_all.status when no per-host entry', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = false;
    mockGet(stored);
    await blsi.Model.init_cache();

    // No entry for 'noentry.com' — should inherit global
    const result = blsi.Model.get_cached_blur_state('noentry.com');
    expect(result).toBe(false);
  });

  test('get_cached_blur_state returns per-host value when entry exists', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = false;
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    expect(blsi.Model.get_cached_blur_state('example.com')).toBe(true);
  });

  test('save_blur_state rejects empty hostname', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_state('', true);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── save_blur_item ────────────────────────────────────────────────────────────

// USER IMPACT: user blurs an element — item persists; duplicate and over-limit items are rejected
// to prevent storage bloat.
describe('save_blur_item', () => {
  test('appends a dynamic item to the host entry', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selector: '#foo', name: 'Foo' };
    await blsi.Model.save_blur_item('example.com', item);
    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
    expect(items[0].selector).toBe('#foo');
  });

  test('deduplicates dynamic items by selector', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selector: '#foo', name: 'Foo' };
    await blsi.Model.save_blur_item('example.com', item);
    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#foo', name: 'Foo2' });

    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
  });

  test('deduplicates sticky items by id', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'sticky', id: 'zone-1', name: 'Zone 1', x: 0, y: 0, width: 100, height: 50 };
    await blsi.Model.save_blur_item('example.com', item);
    await blsi.Model.save_blur_item('example.com', { ...item, name: 'Zone 1 Updated' });

    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
  });

  test('enforces per-host limit of 10', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    for (let i = 0; i < 10; i++) {
      await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: `#el${i}`, name: `D${i}` });
    }
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#el10', name: 'D10' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects invalid item type', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('example.com', { type: 'bad', name: 'X' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects null item', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('example.com', null);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects empty hostname', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('', { type: 'dynamic', selector: '#x', name: 'X' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects __proto__ hostname (prototype pollution guard)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('__proto__', { type: 'dynamic', selector: '#x', name: 'X' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('rejects constructor hostname (prototype pollution guard)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('constructor', { type: 'dynamic', selector: '#x', name: 'X' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── remove_blur_item ──────────────────────────────────────────────────────────

// USER IMPACT: user clicks unblur — specific item removed without affecting other items.
describe('remove_blur_item', () => {
  test('removes dynamic item by selector', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#a', name: 'A' });
    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#b', name: 'B' });

    await blsi.Model.remove_blur_item('example.com', '#a');
    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
    expect(items[0].selector).toBe('#b');
  });

  test('is a no-op when hostname not found', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    // No entry for nothere.com
    await blsi.Model.remove_blur_item('nothere.com', '#x');
    // set should not be called because there's nothing to remove
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── clear_host ────────────────────────────────────────────────────────────────

// USER IMPACT: user clicks "clear this site" — all blurs and blur-all for that host wiped;
// other hosts unaffected.
describe('clear_host', () => {
  test('wipes items and blur_all for hostname, leaves other hosts intact', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#a', name: 'A' });
    await blsi.Model.save_blur_state('example.com', true);
    await blsi.Model.save_blur_item('other.com', { type: 'dynamic', selector: '#b', name: 'B' });

    await blsi.Model.clear_host('example.com');

    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(0);
    expect(blsi.Model.get_cached_blur_state('example.com')).toBe(false); // null inherits global false

    const otherItems = await blsi.Model.get_blur_items('other.com');
    expect(otherItems).toHaveLength(1);
  });

  test('returns early for invalid hostname', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.clear_host('');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── clear_all ─────────────────────────────────────────────────────────────────

// USER IMPACT: user clicks "clear all sites" — all exact host blur data wiped; wildcard/regex
// rules preserved so per-URL settings are not lost.
describe('clear_all', () => {
  test('wipes items and blur_all for all exact entries', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_item('a.com', { type: 'dynamic', selector: '#a', name: 'A' });
    await blsi.Model.save_blur_state('a.com', true);
    await blsi.Model.save_blur_item('b.com', { type: 'dynamic', selector: '#b', name: 'B' });

    await blsi.Model.clear_all();

    expect(await blsi.Model.get_blur_items('a.com')).toHaveLength(0);
    expect(await blsi.Model.get_blur_items('b.com')).toHaveLength(0);
    expect(blsi.Model.get_cached_blur_state('a.com')).toBe(false);
  });

  test('leaves wildcard/regex entries intact', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const wildcardRule = [{
      hostname_value: '*.example.com',
      hostname_type: blsi.pattern_types.wildcard,
      blur_all: null,
      items: [],
      settings: { blur_radius: 12 },
    }];
    await blsi.Model.save_rules(wildcardRule);

    await blsi.Model.clear_all();

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.example.com');
    expect(rules[0].settings.blur_radius).toBe(12);
  });
});

// ── get_rules / save_rules ────────────────────────────────────────────────────

// USER IMPACT: user creates URL-specific rules — they persist and apply on matching pages.
describe('get_rules / save_rules', () => {
  test('get_rules returns only wildcard/regex entries (not exact)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('exact.com', { blur_all: true }); // exact — should not appear
    await blsi.Model.save_rules([{
      hostname_value: '*.wildcard.com',
      hostname_type: blsi.pattern_types.wildcard,
      settings: {},
    }]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.wildcard.com');
  });

  test('save_rules writes wildcard entries', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([
      { hostname_value: '*.a.com', hostname_type: blsi.pattern_types.wildcard, settings: {} },
      { hostname_value: 'b.com/.*', hostname_type: blsi.pattern_types.regex, settings: {} },
    ]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(2);
  });

  test('save_rules clears previous wildcard/regex entries', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([{ hostname_value: '*.old.com', hostname_type: blsi.pattern_types.wildcard, settings: {} }]);
    await blsi.Model.save_rules([{ hostname_value: '*.new.com', hostname_type: blsi.pattern_types.wildcard, settings: {} }]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.new.com');
  });

  test('save_rules preserves exact entries when replacing wildcard rules', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('exact.com', { blur_all: true });
    await blsi.Model.save_rules([{ hostname_value: '*.new.com', hostname_type: blsi.pattern_types.wildcard, settings: {} }]);

    const entry = blsi.Model.get_site_entry('exact.com');
    expect(entry).not.toBeNull();
    expect(entry.blur_all).toBe(true);
  });

  test('save_rules ignores non-array input', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_rules(null);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await blsi.Model.save_rules('bad');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('save_rules sanitizes entries — filters out items with empty hostname_value', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([
      { hostname_value: '  ', hostname_type: blsi.pattern_types.wildcard, settings: {} },
      { hostname_value: '*.valid.com', hostname_type: blsi.pattern_types.wildcard, settings: {} },
    ]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.valid.com');
  });
});

// ── resolve ───────────────────────────────────────────────────────────────────

// USER IMPACT: content_script calls resolve(hostname, url) to get a flat settings object that
// drives the blur engine; the object must contain all expected keys.
describe('resolve', () => {
  test('returns flat object with all expected keys', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    // Core settings
    expect(resolved.blur_radius).toBe(6);
    expect(resolved.enabled).toBe(true);
    expect(resolved.reveal_mode).toBe('hover');
    expect(resolved.blur_categories).toBeDefined();
    // Feature settings
    expect(resolved.blur_mode).toBe('gaussian');
    expect(resolved.blur_all_active).toBe(false);
    expect(Array.isArray(resolved.blur_items)).toBe(true);
    expect(resolved.pick_blur_enabled).toBeDefined();
    expect(resolved.picker_mode).toBeDefined();
    expect(resolved.pii_enabled).toBeDefined();
    expect(resolved.shortcuts).toBeDefined();
  });

  test('exact site_rule overrides global blur_all_active', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = false; // global off
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true); // per-host on

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_all_active).toBe(true);
  });

  test('global blur_all_active used when no per-host entry', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = true; // global on
    mockGet(stored);
    await blsi.Model.init_cache();

    const resolved = blsi.Model.resolve('noentry.com', 'https://noentry.com/');
    expect(resolved.blur_all_active).toBe(true);
  });

  test('exact hostname site_rule settings override global', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('example.com', { settings: { blur_radius: 25 } });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_radius).toBe(25);
  });

  test('blur_items returns items for the exact hostname', async () => {
    const stored = blsi.build_default_model();
    stored.pick_and_blur.status = true;
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selector: '#foo', name: 'Foo' };
    await blsi.Model.save_blur_item('example.com', item);

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_items).toHaveLength(1);
    expect(resolved.blur_items[0].selector).toBe('#foo');
  });

  test('blur_items is empty when pick_and_blur.status is false', async () => {
    const stored = blsi.build_default_model();
    stored.pick_and_blur.status = false;
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selector: '#foo', name: 'Foo' };
    await blsi.Model.save_blur_item('example.com', item);

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_items).toHaveLength(0);
    expect(resolved.pick_blur_enabled).toBe(false);
  });

  test('wildcard site_rule settings override global (first match wins)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([{
      hostname_value: 'example.com',
      hostname_type: blsi.pattern_types.wildcard,
      settings: { blur_radius: 18 },
    }]);

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_radius).toBe(18);
  });
});

// ── debounced_patch ───────────────────────────────────────────────────────────

// USER IMPACT: popup sliders fire debounced_patch on every drag tick; only the
// final settled value must reach storage to avoid write storms and data races.
describe('debounced_patch', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('does not write before the timer fires', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    blsi.Model.debounced_patch('settings', { blur_radius: 14 });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('writes after the default 150 ms delay', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    blsi.Model.debounced_patch('settings', { blur_radius: 14 });
    jest.runAllTimers();

    expect(chrome.storage.local.set).toHaveBeenCalled();
    expect(blsi.Model.get().settings.blur_radius).toBe(14);
  });

  test('coalesces rapid calls — only the last value is written', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    blsi.Model.debounced_patch('settings', { blur_radius: 10 });
    blsi.Model.debounced_patch('settings', { blur_radius: 20 });
    blsi.Model.debounced_patch('settings', { blur_radius: 30 });
    jest.runAllTimers();

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(blsi.Model.get().settings.blur_radius).toBe(30);
  });

  test('snapshots patch at schedule time — caller mutation after call has no effect', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    const patch = { blur_radius: 14 };
    blsi.Model.debounced_patch('settings', patch);
    patch.blur_radius = 99; // mutate object after scheduling
    jest.runAllTimers();

    expect(blsi.Model.get().settings.blur_radius).toBe(14); // snapshot preserved
  });

  test('different sections debounce independently', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    blsi.Model.debounced_patch('settings', { blur_radius: 14 });
    blsi.Model.debounced_patch('blur_all', { status: true });
    jest.runAllTimers();

    const m = blsi.Model.get();
    expect(m.settings.blur_radius).toBe(14);
    expect(m.blur_all.status).toBe(true);
  });
});

// ── on_change ─────────────────────────────────────────────────────────────────

// USER IMPACT: popup registers on_change so UI updates when another context
// (e.g. content_script shortcut) changes storage.  Self-writes must not cause
// a feedback loop.
describe('on_change', () => {
  test('subscriber is called when storage changes from an external context', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    const newModel = blsi.build_default_model();
    newModel.settings.blur_radius = 20;
    _fireStorageChanged({ blsi_model: { newValue: newModel, oldValue: stored } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].settings.blur_radius).toBe(20);
  });

  test('subscriber receives the validated new model as the first argument', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    const newModel = blsi.build_default_model();
    newModel.settings.blur_radius = 15;
    _fireStorageChanged({ blsi_model: { newValue: newModel } });

    expect(cb.mock.calls[0][0].settings.blur_radius).toBe(15);
    expect(typeof cb.mock.calls[0][0]).toBe('object');
  });

  test('self-echo suppressed — subscriber NOT called when newValue equals cache', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    // Our own write updates _cache synchronously; simulate storage.onChanged echo
    await blsi.Model.patch_section('settings', { blur_radius: 18 });
    const currentModel = blsi.Model.get();

    _fireStorageChanged({ blsi_model: { newValue: currentModel } });

    expect(cb).not.toHaveBeenCalled();
  });

  test('subscriber not called for non-local storage areas', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    _fireStorageChanged(
      { blsi_model: { newValue: blsi.build_default_model() } },
      'sync'
    );

    expect(cb).not.toHaveBeenCalled();
  });

  test('subscriber not called for unrelated storage key changes', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    _fireStorageChanged({ some_other_key: { newValue: 'x' } });

    expect(cb).not.toHaveBeenCalled();
  });
});

// ── automate_blur CRUD ────────────────────────────────────────────────────────

describe('automate_blur', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    const m = blsi.build_default_model();
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('save_automate_blur sets a trigger for a hostname', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    const m = blsi.Model.get();
    expect(m.automate_blur['example.com'].idle).toBe(true);
    expect(m.automate_blur['example.com'].tab_switch).toBe(false);
    expect(m.automate_blur['example.com'].screen_share).toBe(false);
  });

  test('save_automate_blur rejects unknown trigger', async () => {
    await blsi.Model.save_automate_blur('example.com', 'bad_trigger', true);
    const m = blsi.Model.get();
    expect(m.automate_blur['example.com']).toBeUndefined();
  });

  test('save_automate_blur rejects invalid hostname', async () => {
    const before = JSON.stringify(blsi.Model.get().automate_blur);
    await blsi.Model.save_automate_blur('__proto__', 'idle', true);
    expect(JSON.stringify(blsi.Model.get().automate_blur)).toBe(before);
  });

  test('patch_automate_blur updates multiple triggers atomically', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.patch_automate_blur('example.com', { idle: false, screen_share: true });
    const entry = blsi.Model.get().automate_blur['example.com'];
    expect(entry.idle).toBe(false);
    expect(entry.screen_share).toBe(true);
    expect(entry.tab_switch).toBe(false);
  });

  test('clear_automate_blur removes the hostname entry', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.clear_automate_blur('example.com');
    expect(blsi.Model.get().automate_blur['example.com']).toBeUndefined();
  });

  test('resolve includes automate_blur_active and automate_blur_triggers', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_active).toBe(true);
    expect(resolved.automate_blur_triggers.idle).toBe(true);
    expect(resolved.automate_blur_triggers.tab_switch).toBe(false);
    expect(resolved.automate_blur_triggers.screen_share).toBe(false);
  });

  test('resolve: blur_all_active is true when only automate fires (manual = false)', async () => {
    await blsi.Model.save_blur_state('example.com', false);
    await blsi.Model.save_automate_blur('example.com', 'screen_share', true);
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_all_active).toBe(true);
  });

  test('resolve: manual blur preserved after automate cleared', async () => {
    await blsi.Model.save_blur_state('example.com', true);
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.patch_automate_blur('example.com', { idle: false });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_all_active).toBe(true); // manual blur survives
  });

  test('clear_host also clears automate_blur for that hostname', async () => {
    await blsi.Model.save_blur_state('example.com', true);
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.clear_host('example.com');
    const m = blsi.Model.get();
    expect(m.automate_blur['example.com']).toBeUndefined();
  });

  test('clear_all resets automate_blur to empty', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.save_automate_blur('other.com', 'tab_switch', true);
    await blsi.Model.clear_all();
    expect(blsi.Model.get().automate_blur).toEqual({});
  });
});
