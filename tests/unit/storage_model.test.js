/**
 * tests/unit/storage_model.test.js
 *
 * Unit tests for src/storage_model.js
 * Module exposes blsi.Model with:
 *   init_cache, on_change, get,
 *   patch_section, save_settings,
 *   get_all_site_rules, get_site_entry, set_site_entry,
 *   capture_snapshot, save_site_snapshot, get_site_snapshot,
 *   resolve,
 *   get_blur_items, get_cached_blur_state,
 *   save_blur_state, save_blur_item, remove_blur_item,
 *   clear_host,
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
      save_settings:          jest.fn(),
      get_all_site_rules:     jest.fn(() => []),
      get_site_entry:         jest.fn(() => null),
      set_site_entry:         jest.fn(),
      capture_snapshot:       jest.fn(() => ({})),
      save_site_snapshot:     jest.fn(),
      get_site_snapshot:      jest.fn(() => null),
      resolve:                jest.fn(() => ({})),
      get_blur_items:         jest.fn(() => []),
      get_cached_blur_state:  jest.fn(() => false),
      save_blur_state:        jest.fn(),
      save_blur_item:         jest.fn(),
      remove_blur_item:       jest.fn(),
      clear_host:             jest.fn(),
      get_rules:              jest.fn(() => []),
      save_rules:             jest.fn(),
      save_automate_blur:     jest.fn(),
      patch_automate_blur:    jest.fn(),
      clear_automate_blur:    jest.fn(),
      get_automate_blur:      jest.fn(() => ({ idle: false, tab_switch: false, screen_share: false })),
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
      expect.objectContaining({ blsi_model: expect.objectContaining({ global_default_settings: expect.any(Object) }) }),
      expect.any(Function)
    );
    const saved = chrome.storage.local.set.mock.calls[0][0].blsi_model;
    expect(saved.global_default_settings.blur_radius).toBe(8);
  });

  test('loads and validates existing model from storage', async () => {
    const stored = blsi.build_default_model();
    stored.global_default_settings.blur_radius = 12;
    mockGet(stored);

    await blsi.Model.init_cache();
    const m = blsi.Model.get();
    expect(m.global_default_settings.blur_radius).toBe(12);
    // No second write needed when storage already had a valid model
    // (may write once to seed shortcuts if they were missing — just check get() is populated)
    expect(m).toBeDefined();
  });

  test('_reset_cache sets cache to null so next get() returns default', () => {
    // After _reset_cache, get() returns build_default_model() (cache is null)
    blsi.Model._reset_cache();
    const m = blsi.Model.get();
    expect(m.global_default_settings.blur_radius).toBe(8);
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

// USER IMPACT: content_script calls get() synchronously after init; must never return undefined.
describe('get', () => {
  test('returns default model when cache is null (not yet init_cached)', () => {
    const m = blsi.Model.get();
    expect(m).toBeDefined();
    expect(m.global_default_settings).toBeDefined();
    expect(m.global_default_settings.blur_radius).toBe(8);
  });

  test('returns cached model after init_cache', async () => {
    const stored = blsi.build_default_model();
    stored.global_default_settings.blur_radius = 18;
    mockGet(stored);

    await blsi.Model.init_cache();
    const m = blsi.Model.get();
    expect(m.global_default_settings.blur_radius).toBe(18);
  });
});

// ── patch_section ─────────────────────────────────────────────────────────────

// USER IMPACT: popup sliders call patch_section('global_default_settings', { blur_radius: N }); other sections
// must be left untouched.
describe('patch_section', () => {
  test('deep-merges patch into specified section', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.patch_section('global_default_settings', { blur_radius: 20 });
    const m = blsi.Model.get();
    expect(m.global_default_settings.blur_radius).toBe(20);
  });

  test('does not mutate other sections', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.patch_section('global_default_settings', { blur_radius: 20 });
    const m = blsi.Model.get();
    // blur_all untouched
    expect(m.blur_all.status).toBe(false);
    expect(m.blur_all.settings.blur_mode).toBe('blur');
  });

  test('calls validate_model (invalid value is coerced to default)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    // blur_radius=999 is out of range — validate_model should coerce to 8
    await blsi.Model.patch_section('global_default_settings', { blur_radius: 999 });
    const m = blsi.Model.get();
    expect(m.global_default_settings.blur_radius).toBe(8);
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
    expect(m.global_default_settings.reveal_mode).toBe('click');
    // Other settings preserved
    expect(m.global_default_settings.blur_radius).toBe(8);
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

// ── get_site_entry / set_site_entry ───────────────────────────────────────────

// USER IMPACT: per-host blur state is stored in exact site_rules entries;
// blur items are stored in pick_and_blur.items (hostname-keyed map).
describe('get_site_entry / set_site_entry', () => {
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
    await blsi.Model.set_site_entry('example.com', { snapshot: { settings: { blur_radius: 15 } } });
    const entry = blsi.Model.get_site_entry('example.com');
    expect(entry.blur_all).toBe(true);
    expect(entry.snapshot.settings.blur_radius).toBe(15);
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

  test('get_cached_blur_state returns per-host boolean after save', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    const result = blsi.Model.get_cached_blur_state('example.com');
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

  test('save_blur_state writes per-host blur_all=false explicitly (turns off)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    await blsi.Model.save_blur_state('example.com', false);
    const entry = blsi.Model.get_site_entry('example.com');
    expect(entry.blur_all).toBe(false);
  });

  test('save_blur_state false is persisted to storage (write is not skipped)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state('example.com', true);
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_state('example.com', false);
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const writtenModel = chrome.storage.local.set.mock.calls[0][0].blsi_model;
    const rule = writtenModel.site_rules.find(r => r.hostname_value === 'example.com');
    expect(rule.blur_all).toBe(false);
  });

  test('save_blur_state false: existing items survive the write (validate_model must not strip them)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#foo', name: 'Foo' });
    // Toggling blur-all off must not strip items as a side-effect of the storage write
    await blsi.Model.save_blur_state('example.com', false);
    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
    expect(items[0].selector).toBe('#foo');
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

  test('accepts dynamic item with new selectors[] array shape', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selectors: ['body > div:nth-of-type(1)', '#foo'], name: 'Sel Array' };
    await blsi.Model.save_blur_item('example.com', item);
    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
    expect(items[0].selectors[0]).toBe('body > div:nth-of-type(1)');
  });

  test('deduplicates new-shape selectors[] items by selectors[0]', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selectors: ['body > div:nth-of-type(1)', '#foo'], name: 'Dup1' };
    await blsi.Model.save_blur_item('example.com', item);
    await blsi.Model.save_blur_item('example.com', { ...item, name: 'Dup2' });
    const items = await blsi.Model.get_blur_items('example.com');
    expect(items).toHaveLength(1);
  });

  test('rejects dynamic item with empty selectors array', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selectors: [], name: 'Bad' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
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
      snapshot: {},
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
      { hostname_value: '*.a.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} },
      { hostname_value: 'b.com/.*', hostname_type: blsi.pattern_types.regex, snapshot: {} },
    ]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(2);
  });

  test('save_rules clears previous wildcard/regex entries', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([{ hostname_value: '*.old.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} }]);
    await blsi.Model.save_rules([{ hostname_value: '*.new.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} }]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.new.com');
  });

  test('save_rules preserves exact entries when replacing wildcard rules', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.set_site_entry('exact.com', { blur_all: true });
    await blsi.Model.save_rules([{ hostname_value: '*.new.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} }]);

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
      { hostname_value: '  ', hostname_type: blsi.pattern_types.wildcard, snapshot: {} },
      { hostname_value: '*.valid.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} },
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
    expect(resolved.blur_radius).toBe(8);
    expect(resolved.enabled).toBe(true);
    expect(resolved.reveal_mode).toBe('hover');
    expect(resolved.blur_categories).toBeDefined();
    // Feature settings
    expect(resolved.blur_mode).toBe('blur');
    expect(resolved.blur_all_active).toBe(false);
    expect(Array.isArray(resolved.blur_items)).toBe(true);
    expect(resolved.pick_blur_enabled).toBeDefined();
    expect(resolved.picker_mode).toBeDefined();
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

    await blsi.Model.set_site_entry('example.com', { snapshot: { settings: { blur_radius: 25 } } });
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
      snapshot: { settings: { blur_radius: 18 } },
    }]);

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_radius).toBe(18);
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
    newModel.global_default_settings.blur_radius = 20;
    _fireStorageChanged({ blsi_model: { newValue: newModel, oldValue: stored } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].global_default_settings.blur_radius).toBe(20);
  });

  test('subscriber receives the validated new model as the first argument', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    const newModel = blsi.build_default_model();
    newModel.global_default_settings.blur_radius = 15;
    _fireStorageChanged({ blsi_model: { newValue: newModel } });

    expect(cb.mock.calls[0][0].global_default_settings.blur_radius).toBe(15);
    expect(typeof cb.mock.calls[0][0]).toBe('object');
  });

  test('self-echo suppressed — subscriber NOT called when newValue equals cache', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const cb = jest.fn();
    blsi.Model.on_change(cb);

    // Our own write updates _cache synchronously; simulate storage.onChanged echo
    await blsi.Model.patch_section('global_default_settings', { blur_radius: 18 });
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

// ── automate_blur CRUD (session storage) ─────────────────────────────────────
// automate_blur now lives in chrome.storage.session (blsi_automate_blur key)
// rather than inside blsi_model. Cleared on browser close — no stale triggers.
// Access via blsi.Model.get_automate_blur(hostname) instead of model.automate_blur.

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
    const entry = blsi.Model.get_automate_blur('example.com');
    expect(entry.idle).toBe(true);
    expect(entry.tab_switch).toBe(false);
    expect(entry.screen_share).toBe(false);
  });

  test('save_automate_blur rejects unknown trigger', async () => {
    await blsi.Model.save_automate_blur('example.com', 'bad_trigger', true);
    const entry = blsi.Model.get_automate_blur('example.com');
    expect(entry.idle).toBe(false);
    expect(entry.tab_switch).toBe(false);
    expect(entry.screen_share).toBe(false);
  });

  test('save_automate_blur rejects invalid hostname', async () => {
    const before = JSON.stringify(blsi.Model.get_automate_blur('__proto__'));
    await blsi.Model.save_automate_blur('__proto__', 'idle', true);
    expect(JSON.stringify(blsi.Model.get_automate_blur('__proto__'))).toBe(before);
  });

  test('patch_automate_blur updates multiple triggers atomically', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.patch_automate_blur('example.com', { idle: false, screen_share: true });
    const entry = blsi.Model.get_automate_blur('example.com');
    expect(entry.idle).toBe(false);
    expect(entry.screen_share).toBe(true);
    expect(entry.tab_switch).toBe(false);
  });

  test('clear_automate_blur removes the hostname entry', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    await blsi.Model.clear_automate_blur('example.com');
    const entry = blsi.Model.get_automate_blur('example.com');
    expect(entry.idle).toBe(false);
    expect(entry.tab_switch).toBe(false);
    expect(entry.screen_share).toBe(false);
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
    expect(resolved.automate_blur_only).toBe(true);
    expect(resolved.automate_blur_skipped).toBe(false);
  });

  test('resolve: automate_blur_only resets all blur-relevant keys to defaults from global settings', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    // Set user custom global settings that automate should NOT inherit
    await blsi.Model.save_settings({ blur_radius: 30, thorough_blur: true, reveal_mode: 'none', transition_duration: 50, redaction_color: '#ff0000', highlight_color: '#0000ff' });
    await blsi.Model.patch_section('blur_all', { settings: { blur_mode: 'frosted', blur_categories: { text: false, media: false, form: true, table: false, structure: false } } });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_only).toBe(true);
    const ds  = blsi.DEFAULT_MODEL.global_default_settings;
    const dbs = blsi.DEFAULT_MODEL.blur_all.settings;
    expect(resolved.blur_mode).toBe(dbs.blur_mode);
    expect(resolved.blur_categories).toEqual(dbs.blur_categories);
    expect(resolved.blur_radius).toBe(ds.blur_radius);
    expect(resolved.thorough_blur).toBe(ds.thorough_blur);
    expect(resolved.reveal_mode).toBe(ds.reveal_mode);
    expect(resolved.transition_duration).toBe(ds.transition_duration);
    expect(resolved.redaction_color).toBe(ds.redaction_color);
    expect(resolved.highlight_color).toBe(ds.highlight_color);
  });

  test('resolve: automate_blur_only resets all blur-relevant keys to defaults even when exact site_rule overrides them', async () => {
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    // Per-site exact rule override — the bug: these leaked into automate blur
    await blsi.Model.set_site_entry('example.com', {
      blur_all: null,
      settings: {
        blur_categories: { text: false, media: false, form: true, table: false, structure: true },
        thorough_blur: true,
        blur_mode: 'redacted',
        blur_radius: 30,
        reveal_mode: 'none',
      },
    });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_only).toBe(true);
    const ds  = blsi.DEFAULT_MODEL.global_default_settings;
    const dbs = blsi.DEFAULT_MODEL.blur_all.settings;
    expect(resolved.blur_mode).toBe(dbs.blur_mode);
    expect(resolved.blur_categories).toEqual(dbs.blur_categories);
    expect(resolved.blur_radius).toBe(ds.blur_radius);
    expect(resolved.thorough_blur).toBe(ds.thorough_blur);
    expect(resolved.reveal_mode).toBe(ds.reveal_mode);
    expect(resolved.transition_duration).toBe(ds.transition_duration);
  });

  test('resolve: automate_blur_skipped = true when blur_all is already enabled', async () => {
    await blsi.Model.save_blur_state('example.com', true); // manual blur on
    await blsi.Model.save_automate_blur('example.com', 'idle', true);
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_skipped).toBe(true);
    expect(resolved.automate_blur_only).toBe(false);
    // blur_all_active stays true from manual blur, not from automate
    expect(resolved.blur_all_active).toBe(true);
  });

  test('resolve: automate_blur_skipped = true when pick_and_blur is enabled', async () => {
    const m = blsi.build_default_model();
    m.pick_and_blur.status = true;
    blsi.Model._reset_cache();
    mockGet(m);
    await blsi.Model.init_cache();

    await blsi.Model.save_automate_blur('example.com', 'screen_share', true);
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_skipped).toBe(true);
    expect(resolved.automate_blur_only).toBe(false);
    expect(resolved.blur_all_active).toBe(false); // blur-all stays off; pick-blur handles it
  });

  test('resolve: automate_blur_only and automate_blur_skipped are false when automate not firing', async () => {
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.automate_blur_only).toBe(false);
    expect(resolved.automate_blur_skipped).toBe(false);
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
    const entry = blsi.Model.get_automate_blur('example.com');
    expect(entry.idle).toBe(false);
  });

});

// ── capture_snapshot ──────────────────────────────────────────────────────────

// USER IMPACT: popup "Save as site rule" form calls capture_snapshot() to freeze the
// current global settings into a site rule. Must return all SNAPSHOT_KEYS with correct
// types so the rule exactly reproduces the user's current configuration on next visit.
describe('capture_snapshot', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    const m = blsi.build_default_model();
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('returns an object with nested sections present', () => {
    const snap = blsi.Model.capture_snapshot();
    expect(snap).toHaveProperty('settings');
    expect(snap).toHaveProperty('blur_all');
    expect(snap).toHaveProperty('blur_all.settings');
    expect(snap).toHaveProperty('pick_and_blur');
    expect(snap).toHaveProperty('pick_and_blur.settings');
    expect(snap).toHaveProperty('auto_detect_pii.settings');
    expect(snap).toHaveProperty('automate.settings');
  });

  test('returns exactly 5 top-level sections — no extra keys', () => {
    const snap = blsi.Model.capture_snapshot();
    const TOP_KEYS = new Set(['settings', 'blur_all', 'pick_and_blur', 'auto_detect_pii', 'automate']);
    for (const k of Object.keys(snap)) {
      expect(TOP_KEYS.has(k)).toBe(true);
    }
    expect(Object.keys(snap).length).toBe(TOP_KEYS.size);
  });

  test('PII section captures email/numeric/pii_mode/pii_redaction_color', () => {
    const snap = blsi.Model.capture_snapshot();
    const d = blsi.build_default_model();
    expect(snap.auto_detect_pii.settings.email).toBe(d.auto_detect_pii.settings.email);
    expect(snap.auto_detect_pii.settings.numeric).toBe(d.auto_detect_pii.settings.numeric);
    expect(snap.auto_detect_pii.settings.pii_mode).toBe(d.auto_detect_pii.settings.pii_mode);
    expect(snap.auto_detect_pii.settings.pii_redaction_color).toBe(d.auto_detect_pii.settings.pii_redaction_color);
  });

  test('automate section captures only trigger.enabled (no value/unit)', () => {
    const snap = blsi.Model.capture_snapshot();
    const d = blsi.build_default_model();
    expect(snap.automate.settings.idle).toEqual({ enabled: d.automate.settings.idle.enabled });
    expect(snap.automate.settings.tab_switch).toEqual({ enabled: d.automate.settings.tab_switch.enabled });
    expect(snap.automate.settings.screen_share).toEqual({ enabled: d.automate.settings.screen_share.enabled });
  });

  test('snapshot values match default model values', async () => {
    const snap = blsi.Model.capture_snapshot();
    const d = blsi.build_default_model();
    expect(snap.settings.blur_radius).toBe(d.global_default_settings.blur_radius);
    expect(snap.blur_all.settings.blur_mode).toBe(d.blur_all.settings.blur_mode);
    expect(snap.settings.reveal_mode).toBe(d.global_default_settings.reveal_mode);
    expect(snap.settings.thorough_blur).toBe(d.global_default_settings.thorough_blur);
    expect(snap.blur_all.settings.blur_categories).toEqual(d.blur_all.settings.blur_categories);
    expect(snap.pick_and_blur.settings.blur_type).toBe(d.pick_and_blur.settings.blur_type);
    expect(snap.pick_and_blur.settings.blur_color).toEqual(d.pick_and_blur.settings.blur_color);
    expect(snap.pick_and_blur.status).toBe(d.pick_and_blur.status);
  });

  test('capture reflects in-flight settings changes', async () => {
    await blsi.Model.patch_section('global_default_settings', { blur_radius: 24, reveal_mode: 'click' });
    await blsi.Model.patch_section('blur_all', { settings: { blur_mode: 'frosted' } });
    const snap = blsi.Model.capture_snapshot();
    expect(snap.settings.blur_radius).toBe(24);
    expect(snap.settings.reveal_mode).toBe('click');
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');
  });

  test('blur_categories is a deep copy — mutating snapshot does not affect cache', () => {
    const snap = blsi.Model.capture_snapshot();
    snap.blur_all.settings.blur_categories.text = !snap.blur_all.settings.blur_categories.text;
    const snap2 = blsi.Model.capture_snapshot();
    expect(snap2.blur_all.settings.blur_categories.text).toBe(blsi.build_default_model().blur_all.settings.blur_categories.text);
  });

  test('pick_blur_color is a deep copy — mutating snapshot does not affect cache', () => {
    const snap = blsi.Model.capture_snapshot();
    snap.pick_and_blur.settings.blur_color.hex = '#ffffff';
    const snap2 = blsi.Model.capture_snapshot();
    expect(snap2.pick_and_blur.settings.blur_color.hex).toBe(blsi.build_default_model().pick_and_blur.settings.blur_color.hex);
  });
});

// ── save_site_snapshot ────────────────────────────────────────────────────────

// USER IMPACT: after editing settings and entering a URL pattern, user clicks Save.
// The snapshot must be stored in the matching rule's .settings field so future visits
// auto-apply the saved configuration.
describe('save_site_snapshot', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    const m = blsi.build_default_model();
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('creates a new exact rule with the snapshot in .snapshot', async () => {
    const snap = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap);
    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    expect(stored).not.toBeNull();
    expect(stored.settings.blur_radius).toBe(snap.settings.blur_radius);
    expect(stored.blur_all.settings.blur_mode).toBe(snap.blur_all.settings.blur_mode);
  });

  test('updates .snapshot on an existing exact rule', async () => {
    await blsi.Model.set_site_entry('github.com', { blur_all: true });
    const snap = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap);
    const rule = blsi.Model.get_site_entry('github.com');
    expect(rule.blur_all).toBe(true);                        // other fields preserved
    expect(rule.snapshot.settings.blur_radius).toBeDefined(); // snapshot applied
  });

  test('replaces previous snapshot on a second save', async () => {
    const snap1 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap1);

    await blsi.Model.patch_section('global_default_settings', { blur_radius: 20 });
    const snap2 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap2);

    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    expect(stored.settings.blur_radius).toBe(20);
  });

  test('works for wildcard rules created via save_rules', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.example.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       {},
    }]);
    const snap = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('*.example.com', blsi.pattern_types.wildcard, snap);
    const stored = blsi.Model.get_site_snapshot('*.example.com', blsi.pattern_types.wildcard);
    expect(stored).not.toBeNull();
    expect(stored.settings.blur_radius).toBeDefined();
  });

  test('is a no-op for invalid hostname_value', async () => {
    jest.clearAllMocks();
    mockSet();
    await blsi.Model.save_site_snapshot('', blsi.pattern_types.exact, {});
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('is a no-op for invalid (null) snapshot', async () => {
    jest.clearAllMocks();
    mockSet();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, null);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── get_site_snapshot ─────────────────────────────────────────────────────────

// USER IMPACT: popup site-rules list renders each rule's snapshot summary.
// Must return the stored snapshot or null (never a partial).
describe('get_site_snapshot', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    const m = blsi.build_default_model();
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('returns null when rule does not exist', () => {
    expect(blsi.Model.get_site_snapshot('nobody.com', blsi.pattern_types.exact)).toBeNull();
  });

  test('returns null when rule exists but settings is empty', async () => {
    await blsi.Model.set_site_entry('github.com', { blur_all: true });
    expect(blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact)).toBeNull();
  });

  test('returns snapshot object after save_site_snapshot', async () => {
    const snap = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap);
    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    expect(stored).not.toBeNull();
    expect(stored.settings.blur_radius).toBe(snap.settings.blur_radius);
    expect(stored.blur_all.settings.blur_categories).toEqual(snap.blur_all.settings.blur_categories);
  });

});

// ── validate_model — snapshot passthrough ─────────────────────────────────────

// USER IMPACT: when the extension updates and re-validates stored model, a site rule
// with a full snapshot must not be stripped or corrupted — users would lose their
// per-site configurations silently.
describe('validate_model snapshot passthrough', () => {
  test('passes through all snapshot sections in site_rules[i].snapshot', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        settings: {
          blur_radius:  12,
          reveal_mode:  'click',
          thorough_blur: true,
        },
        blur_all: {
          settings: {
            blur_mode:       'frosted',
            blur_categories: { text: true, media: false, form: false, table: false, structure: false },
          },
        },
        pick_and_blur: {
          status: true,
          settings: {
            blur_type:  'blur',
            blur_color: { hex: '#ff0000', opacity: 0.5 },
          },
        },
      },
    }];
    const validated = blsi.validate_model(model);
    const snap = validated.site_rules[0].snapshot;
    expect(snap.settings.blur_radius).toBe(12);
    expect(snap.settings.reveal_mode).toBe('click');
    expect(snap.settings.thorough_blur).toBe(true);
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');
    expect(snap.blur_all.settings.blur_categories).toEqual({ text: true, media: false, form: false, table: false, structure: false });
    expect(snap.pick_and_blur.status).toBe(true);
    expect(snap.pick_and_blur.settings.blur_type).toBe('blur');
    expect(snap.pick_and_blur.settings.blur_color).toEqual({ hex: '#ff0000', opacity: 0.5 });
  });

  test('validate_model strips unknown keys from site_rules[i].snapshot.settings', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        settings: {
          blur_radius: 10,
          some_unknown_key: 'bad',
          another_bad_key:  42,
        },
      },
    }];
    const validated = blsi.validate_model(model);
    const s = validated.site_rules[0].snapshot.settings;
    expect(s.blur_radius).toBe(10);
    expect(s.some_unknown_key).toBeUndefined();
    expect(s.another_bad_key).toBeUndefined();
  });

  test('validate_model repairs invalid blur_categories values with defaults', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        blur_all: {
          settings: {
            blur_categories: { text: 'yes', media: null, form: false, table: true, structure: true },
          },
        },
      },
    }];
    const validated = blsi.validate_model(model);
    const cats = validated.site_rules[0].snapshot.blur_all.settings.blur_categories;
    const d = blsi.build_default_model();
    // 'yes' and null are not booleans — repaired to defaults
    expect(cats.text).toBe(d.blur_all.settings.blur_categories.text);
    expect(cats.media).toBe(d.blur_all.settings.blur_categories.media);
    // valid booleans preserved
    expect(cats.form).toBe(false);
    expect(cats.table).toBe(true);
    expect(cats.structure).toBe(true);
  });

  test('validate_model repairs invalid pick_blur_color values with defaults', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        pick_and_blur: {
          settings: {
            blur_color: { hex: 'not-a-hex', opacity: 5.0 },
          },
        },
      },
    }];
    const validated = blsi.validate_model(model);
    const pbc = validated.site_rules[0].snapshot.pick_and_blur.settings.blur_color;
    const d = blsi.build_default_model();
    expect(pbc.hex).toBe(d.pick_and_blur.settings.blur_color.hex);
    expect(pbc.opacity).toBe(d.pick_and_blur.settings.blur_color.opacity);
  });

  test('empty snapshot {} survives validate_model as empty {}', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot:       {},
    }];
    const validated = blsi.validate_model(model);
    expect(validated.site_rules[0].snapshot).toEqual({});
  });
});

// ── resolve with full snapshot ────────────────────────────────────────────────

// USER IMPACT: when a user visits a site with a saved snapshot, resolve() must apply
// ALL snapshot keys — the exact saved configuration must override global settings.
describe('resolve with full snapshot overrides', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    const m = blsi.build_default_model();
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('snapshot in exact site_rule overrides all snapshot sections in resolved output', async () => {
    const snapshot = {
      settings: {
        blur_radius:  20,
        reveal_mode:  'click',
        thorough_blur: true,
      },
      blur_all: {
        settings: {
          blur_mode:       'frosted',
          blur_categories: { text: false, media: false, form: false, table: false, structure: false },
        },
      },
      pick_and_blur: {
        status: true,
        settings: {
          blur_type:   'color',
          blur_color:  { hex: '#123456', opacity: 0.7 },
          picker_mode: 'dynamic',
        },
      },
    };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.blur_radius).toBe(20);
    expect(resolved.blur_mode).toBe('frosted');
    expect(resolved.reveal_mode).toBe('click');
    expect(resolved.thorough_blur).toBe(true);
    expect(resolved.blur_categories).toEqual({ text: false, media: false, form: false, table: false, structure: false });
    expect(resolved.pick_blur_type).toBe('color');
    expect(resolved.pick_blur_color).toEqual({ hex: '#123456', opacity: 0.7 });
    expect(resolved.pick_blur_enabled).toBe(true);
  });

  test('snapshot in wildcard site_rule overrides global snapshot keys', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       {},
    }]);
    const snapshot = {
      settings:  { blur_radius: 18 },
      blur_all:  { settings: { blur_mode: 'redacted' } },
    };
    await blsi.Model.save_site_snapshot('*.github.com', blsi.pattern_types.wildcard, snapshot);

    const resolved = blsi.Model.resolve('sub.github.com', 'https://sub.github.com/page');
    expect(resolved.blur_radius).toBe(18);
    expect(resolved.blur_mode).toBe('redacted');
  });

  test('exact rule snapshot wins over wildcard snapshot (exact has higher priority)', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       { settings: { blur_radius: 10 } },
    }]);
    const exactSnap = { settings: { blur_radius: 30 } };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, exactSnap);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.blur_radius).toBe(30);
  });

  test('non-snapshot keys in resolved output come from global/feature settings when no override', async () => {
    const snapshot = { settings: { blur_radius: 20 } };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    // blur_all_active comes from global (not snapshot)
    expect(typeof resolved.blur_all_active).toBe('boolean');
    // blur_items comes from pick_and_blur.status gating (not snapshot)
    expect(Array.isArray(resolved.blur_items)).toBe(true);
  });

  test('PII fields in snapshot override global PII settings', async () => {
    const snapshot = {
      auto_detect_pii: {
        settings: {
          email: false,
          numeric: true,
          pii_mode: 'starred',
          pii_redaction_color: '#ff00ff',
        },
      },
    };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.pii_email).toBe(false);
    expect(resolved.pii_numeric).toBe(true);
    expect(resolved.pii_mode).toBe('starred');
    expect(resolved.pii_redaction_color).toBe('#ff00ff');
    expect(resolved._rule_overrides.pii_email).toBe(true);
    expect(resolved._rule_overrides.pii_numeric).toBe(true);
    expect(resolved._rule_overrides.pii_mode).toBe(true);
    expect(resolved._rule_overrides.pii_redaction_color).toBe(true);
  });

  test('automate trigger.enabled in snapshot overrides global, preserves idle.value/unit', async () => {
    const snapshot = {
      automate: {
        settings: {
          idle: { enabled: true },
          tab_switch: { enabled: true },
          screen_share: { enabled: true },
        },
      },
    };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.automate_idle.enabled).toBe(true);
    expect(resolved.automate_tab_switch.enabled).toBe(true);
    expect(resolved.automate_screen_share.enabled).toBe(true);
    // idle.value/unit untouched (global default — value=5, unit='min')
    expect(resolved.automate_idle.value).toBe(5);
    expect(resolved.automate_idle.unit).toBe('min');
    expect(resolved._rule_overrides.automate_idle).toBe(true);
    expect(resolved._rule_overrides.automate_tab_switch).toBe(true);
    expect(resolved._rule_overrides.automate_screen_share).toBe(true);
  });

  test('_rule_match exposes the matching rule for popup deep-link', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       { settings: { blur_radius: 12 } },
    }]);
    const resolved = blsi.Model.resolve('a.github.com', 'https://a.github.com/x');
    expect(resolved._rule_match).toEqual({
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
    });
  });

  test('exact rule snapshot wins over wildcard for _rule_match', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       { settings: { blur_radius: 12 } },
    }]);
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, { settings: { blur_radius: 30 } });
    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved._rule_match).toEqual({
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
    });
  });

  test('_rule_overrides empty when no rule matches', () => {
    const resolved = blsi.Model.resolve('nope.test', 'https://nope.test/');
    expect(resolved._rule_overrides).toEqual({});
    expect(resolved._rule_match).toBe(null);
  });
});
