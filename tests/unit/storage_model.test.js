/**
 * tests/unit/storage_model.test.js
 *
 * Unit tests for src/storage_model.js
 * Module exposes blsi.Model with:
 *   init_cache, on_change, get,
 *   patch_section, save_settings,
 *   capture_snapshot, save_site_snapshot, get_site_snapshot,
 *   resolve,
 *   get_blur_items,
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
const STATE_PATH       = path.resolve(__dirname, '../../src/automate/state.js');

function loadStorageModel() {
  if (blsi.Model) return;
  // storage_model.js depends on blsi.UrlMatcher for resolve(); load it first.
  if (!blsi.UrlMatcher && fs.existsSync(URL_MATCHER_PATH)) {
    require(URL_MATCHER_PATH);
  }
  // resolve() reads idle + tab_switch via blsi.Automate.State at runtime.
  if (fs.existsSync(STATE_PATH)) require(STATE_PATH);
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
      capture_snapshot:       jest.fn(() => ({})),
      save_site_snapshot:     jest.fn(),
      get_site_snapshot:      jest.fn(() => null),
      resolve:                jest.fn(() => ({})),
      get_blur_items:         jest.fn(() => []),
      save_blur_state:        jest.fn(),
      save_blur_item:         jest.fn(),
      remove_blur_item:       jest.fn(),
      clear_host:             jest.fn(),
      get_rules:              jest.fn(() => []),
      save_rules:             jest.fn(),
      get_screen_share_state:    jest.fn(() => ({ active: false, sharing_tab_id: null, started_at: null, suppressed_sites: [], _sharing_tab_ids: [] })),
      set_screen_share_active:   jest.fn(),
      set_screen_share_inactive: jest.fn(),
      suppress_screen_share:     jest.fn(),
      unsuppress_screen_share:   jest.fn(),
      get_suppressed_tabs:       jest.fn(() => []),
      add_suppressed_tab:        jest.fn(),
      remove_suppressed_tab:     jest.fn(),
      clear_suppressed_tabs:     jest.fn(),
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

function _makeModel(overrides) {
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

// ── save_blur_state ───────────────────────────────────────────────────────────

// USER IMPACT: toggling blur-all anywhere flips the global blur_all.status —
// every tab reflects the same state. No per-host overrides from the toggle.
describe('save_blur_state', () => {
  test('writes blur_all.status globally', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = false;
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_state(true);
    expect(blsi.Model.get().blur_all.status).toBe(true);
  });

  test('false flip is persisted to storage', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = true;
    mockGet(stored);
    await blsi.Model.init_cache();
    jest.clearAllMocks();
    mockSet();

    await blsi.Model.save_blur_state(false);
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const writtenModel = chrome.storage.local.set.mock.calls[0][0].blsi_model;
    expect(writtenModel.blur_all.status).toBe(false);
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

  test('enforces per-host limit of 10 (constant from blsi.max_pick_blur_items_per_host)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    expect(blsi.max_pick_blur_items_per_host).toBe(10);
    for (let i = 0; i < blsi.max_pick_blur_items_per_host; i++) {
      const ok = await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: `#el${i}`, name: `D${i}` });
      expect(ok).toEqual({ ok: true });
    }
    jest.clearAllMocks();
    mockSet();

    const result = await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#el10', name: 'D10' });
    expect(result).toEqual({ ok: false, reason: 'cap' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('returns reason "duplicate" when item with same id already saved', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const item = { type: 'dynamic', selector: '#foo', name: 'Foo' };
    const first = await blsi.Model.save_blur_item('example.com', item);
    expect(first).toEqual({ ok: true });
    const second = await blsi.Model.save_blur_item('example.com', { ...item, name: 'Foo2' });
    expect(second).toEqual({ ok: false, reason: 'duplicate' });
  });

  test('returns reason "invalid" when item shape is bad', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    const result = await blsi.Model.save_blur_item('example.com', { type: 'bad', name: 'X' });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
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
  test('wipes pick-blur items for hostname, leaves other hosts intact', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_blur_item('example.com', { type: 'dynamic', selector: '#a', name: 'A' });
    await blsi.Model.save_blur_item('other.com', { type: 'dynamic', selector: '#b', name: 'B' });

    await blsi.Model.clear_host('example.com');

    expect(await blsi.Model.get_blur_items('example.com')).toHaveLength(0);
    expect(await blsi.Model.get_blur_items('other.com')).toHaveLength(1);
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
  test('get_rules returns every site rule (exact, wildcard, regex)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([
      { hostname_value: 'exact.com',     hostname_type: blsi.pattern_types.exact,    snapshot: {} },
      { hostname_value: '*.wildcard.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} },
    ]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(2);
  });

  test('save_rules writes mixed entries', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([
      { hostname_value: 'exact.com',     hostname_type: blsi.pattern_types.exact,    snapshot: {} },
      { hostname_value: '*.a.com',       hostname_type: blsi.pattern_types.wildcard, snapshot: {} },
      { hostname_value: 'b.com/.*',      hostname_type: blsi.pattern_types.regex,    snapshot: {} },
    ]);

    expect((await blsi.Model.get_rules())).toHaveLength(3);
  });

  test('save_rules clears previous entries (full replace)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([{ hostname_value: '*.old.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} }]);
    await blsi.Model.save_rules([{ hostname_value: '*.new.com', hostname_type: blsi.pattern_types.wildcard, snapshot: {} }]);

    const rules = await blsi.Model.get_rules();
    expect(rules).toHaveLength(1);
    expect(rules[0].hostname_value).toBe('*.new.com');
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
    expect(resolved.engage).toBe(false);
    expect(Array.isArray(resolved.blur_items)).toBe(true);
    expect(resolved.pick_blur_enabled).toBeDefined();
    expect(resolved.picker_mode).toBeDefined();
    expect(resolved.shortcuts).toBeDefined();
  });

  test('global engage used when no rule matches', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = true;
    mockGet(stored);
    await blsi.Model.init_cache();

    const resolved = blsi.Model.resolve('noentry.com', 'https://noentry.com/');
    expect(resolved.engage).toBe(true);
  });

  test('exact hostname site_rule snapshot overrides global blur_mode', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_site_snapshot('example.com', blsi.pattern_types.exact,
      { blur_all: { settings: { blur_mode: 'frosted' } } });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_mode).toBe('frosted');
  });

  test('snapshot blur_all.status=true forces engage even when global is off', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = false;
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_site_snapshot('example.com', blsi.pattern_types.exact,
      { blur_all: { status: true } });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.engage).toBe(true);
  });

  test('snapshot blur_all.status=false suppresses engage even when global is on', async () => {
    const stored = blsi.build_default_model();
    stored.blur_all.status = true;
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_site_snapshot('example.com', blsi.pattern_types.exact,
      { blur_all: { status: false } });
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.engage).toBe(false);
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

  test('wildcard site_rule snapshot overrides global blur_mode (first match wins)', async () => {
    const stored = blsi.build_default_model();
    mockGet(stored);
    await blsi.Model.init_cache();

    await blsi.Model.save_rules([{
      hostname_value: 'example.com',
      hostname_type: blsi.pattern_types.wildcard,
      snapshot: { blur_all: { settings: { blur_mode: 'redacted' } } },
    }]);

    const resolved = blsi.Model.resolve('example.com', 'https://example.com/');
    expect(resolved.blur_mode).toBe('redacted');
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

// ── automate_blur (resolve fold via blsi.Automate.State) ────────────────────
// Idle + tab_switch state lives in chrome.storage.session under keys owned by
// blsi.Automate.State. resolve() reads them at call time. Per-trigger CRUD
// belongs to State + the observer modules — see tests/unit/automate/*.

describe('automate_blur', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    if (blsi.Automate && blsi.Automate.State) blsi.Automate.State._reset();
    const m = blsi.build_default_model();
    // Both triggers feature-on so resolve fires when phase reports a fired state.
    m.automate.settings.idle.enabled = true;
    m.automate.settings.tab_switch.enabled = true;
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('idle phase "idle" + feature-on → automate_blur_active + idle trigger', async () => {
    await blsi.Automate.State.write_idle('idle');
    const resolved = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(resolved.automate_blur_active).toBe(true);
    expect(resolved.automate_blur_triggers.idle).toBe(true);
    expect(resolved.automate_blur_triggers.tab_switch).toBe(false);
    expect(resolved.automate_blur_triggers.screen_share).toBe(false);
  });

  test('idle phase "locked" also flips active', async () => {
    await blsi.Automate.State.write_idle('locked');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.automate_blur_active).toBe(true);
    expect(r.automate_blur_triggers.idle).toBe(true);
  });

  test('idle phase "active" → no automate firing', async () => {
    await blsi.Automate.State.write_idle('active');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.automate_blur_active).toBe(false);
    expect(r.automate_blur_triggers.idle).toBe(false);
  });

  test('idle feature OFF: phase "idle" does NOT flip active', async () => {
    await blsi.Model.patch_section('automate', { settings: { idle: { enabled: false } } });
    await blsi.Automate.State.write_idle('idle');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.automate_blur_active).toBe(false);
  });

  test('tab_switch fired (per-tab) + feature-on → tab_switch trigger', async () => {
    await blsi.Automate.State.write_tab_switch(7, 'fired');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 7);
    expect(r.automate_blur_active).toBe(true);
    expect(r.automate_blur_triggers.tab_switch).toBe(true);
    expect(r.automate_blur_triggers.idle).toBe(false);
  });

  test('tab_switch fired on a different tab does NOT affect this tab', async () => {
    await blsi.Automate.State.write_tab_switch(7, 'fired');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 99);
    expect(r.automate_blur_active).toBe(false);
  });

  test('tab_switch feature OFF: fired phase does NOT flip active', async () => {
    await blsi.Model.patch_section('automate', { settings: { tab_switch: { enabled: false } } });
    await blsi.Automate.State.write_tab_switch(7, 'fired');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 7);
    expect(r.automate_blur_active).toBe(false);
  });

  test('per-tab suppression via idle ignore_tabs silences idle for that tab', async () => {
    await blsi.Automate.State.write_idle('idle');
    await blsi.Automate.State.add_idle_ignore_tab(7);
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 7);
    expect(r.automate_blur_active).toBe(false);
    expect(r.idle_suppressed_for_tab).toBe(true);
    // Other tabs still affected.
    const other = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    expect(other.automate_blur_active).toBe(true);
    expect(other.idle_suppressed_for_tab).toBe(false);
  });

  test('per-site suppression via idle ignore_sites silences idle for that site', async () => {
    await blsi.Automate.State.write_idle('idle');
    await blsi.Automate.State.add_idle_ignore_site('example.com');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 7);
    expect(r.automate_blur_active).toBe(false);
    expect(r.idle_suppressed_for_site).toBe(true);
    // Other sites still affected.
    const other = blsi.Model.resolve('github.com', 'https://github.com/', 7);
    expect(other.automate_blur_active).toBe(true);
    expect(other.idle_suppressed_for_site).toBe(false);
  });

  test('engage is FALSE when only automate fires (engine no longer activates for automate)', async () => {
    await blsi.Automate.State.write_idle('idle');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    // Post-split: engage tracks blur-all only. Automate fires the Overlay
    // via blsi.Automate.Manager, not the engine.
    expect(r.engage).toBe(false);
    expect(r.automate_blur_active).toBe(true);
  });

  test('automate fires independently when blur_all already on', async () => {
    await blsi.Model.save_blur_state(true);
    await blsi.Automate.State.write_idle('idle');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    // Each automate trigger fires regardless of manual blur — Overlay layers on top.
    expect(r.automate_blur_active).toBe(true);
    expect(r.automate_blur_triggers.idle).toBe(true);
    expect(r.engage).toBe(true);
  });

  test('automate fires independently when pick_and_blur enabled', async () => {
    const m = blsi.build_default_model();
    m.pick_and_blur.status = true;
    m.automate.settings.screen_share.enabled = true;
    blsi.Model._reset_cache();
    mockGet(m);
    await blsi.Model.init_cache();

    await blsi.Automate.State.set_screen_share_active(99);
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.automate_blur_active).toBe(true);
    expect(r.automate_blur_triggers.screen_share).toBe(true);
    // Pick-blur reconcile runs unconditionally inside engine.handleSite —
    // engage tracks blur-all only.
    expect(r.engage).toBe(false);
  });

  test('automate_blur_active is false when nothing firing', () => {
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.automate_blur_active).toBe(false);
  });

  test('manual blur preserved after automate clears', async () => {
    await blsi.Model.save_blur_state(true);
    await blsi.Automate.State.write_idle('idle');
    await blsi.Automate.State.write_idle('active');
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    expect(r.engage).toBe(true);
  });
});

// ── screen_share session record + suppression ───────────────────────────────
//
// USER IMPACT: when a user starts a screen share, all *other* tabs blur. The
// sharing tab and per-scope suppressed tabs/sites must NOT blur. The popup
// notif card and content-script toast both read from the same global session
// record so user actions stay coherent across UI surfaces.
describe('screen_share session record', () => {
  beforeEach(async () => {
    mockSet();
    blsi.Model._reset_cache();
    if (blsi.Automate && blsi.Automate.State) blsi.Automate.State._reset();
    const m = blsi.build_default_model();
    m.automate.settings.screen_share.enabled = true;
    mockGet(m);
    await blsi.Model.init_cache();
  });

  test('set_screen_share_active stamps active flag, sharing tab id, and started_at', async () => {
    const before = Date.now() - 1;
    await blsi.Automate.State.set_screen_share_active(42);
    const ss = blsi.Model.get_screen_share_state();
    expect(ss.active).toBe(true);
    expect(ss.sharing_tab_id).toBe(42);
    expect(ss.started_at).toBeGreaterThanOrEqual(before);
    expect(ss.suppressed_sites).toEqual([]);
  });

  test('set_screen_share_inactive clears the record', async () => {
    await blsi.Automate.State.set_screen_share_active(42);
    await blsi.Automate.State.set_screen_share_inactive();
    const ss = blsi.Model.get_screen_share_state();
    expect(ss.active).toBe(false);
    expect(ss.sharing_tab_id).toBeNull();
    expect(ss.started_at).toBeNull();
  });

  test('resolve: sharing tab itself does NOT receive screen-share blur', async () => {
    await blsi.Automate.State.set_screen_share_active(7);
    const sharing = blsi.Model.resolve('example.com', 'https://example.com/', 7);
    expect(sharing.automate_blur_triggers.screen_share).toBe(false);
    const other = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    expect(other.automate_blur_triggers.screen_share).toBe(true);
  });

  test('resolve: feature disabled silences screen-share blur even when record is active', async () => {
    await blsi.Model.patch_section('automate', { settings: { screen_share: { enabled: false } } });
    await blsi.Automate.State.set_screen_share_active(7);
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    expect(r.automate_blur_triggers.screen_share).toBe(false);
    expect(r.automate_blur_active).toBe(false);
  });

  test('suppress_screen_share("site_session") silences screen-share for that hostname only', async () => {
    await blsi.Automate.State.set_screen_share_active(7);
    await blsi.Model.suppress_screen_share('site_session', { hostname: 'example.com' });
    const a = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    const b = blsi.Model.resolve('other.test',  'https://other.test/',   8);
    expect(a.automate_blur_triggers.screen_share).toBe(false);
    expect(a.screen_share_suppressed_for_host).toBe(true);
    expect(b.automate_blur_triggers.screen_share).toBe(true);
  });

  test('suppress_screen_share("tab") silences screen_share for that tab (idle has own ignore)', async () => {
    await blsi.Model.patch_section('automate', { settings: { idle: { enabled: true } } });
    await blsi.Automate.State.set_screen_share_active(7);
    if (blsi.Automate && blsi.Automate.State) await blsi.Automate.State.write_idle('idle');
    await blsi.Model.suppress_screen_share('tab', { tab_id: 8 });
    const me = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    expect(me.automate_blur_triggers.screen_share).toBe(false);
    expect(me.automate_blur_triggers.idle).toBe(true);
    expect(me.screen_share_suppressed_for_tab).toBe(true);
    // Other tab still affected for screen_share.
    const other = blsi.Model.resolve('example.com', 'https://example.com/', 9);
    expect(other.automate_blur_triggers.screen_share).toBe(true);
    expect(other.automate_blur_triggers.idle).toBe(true);
  });

  test('suppress_screen_share("feature") suspends the trigger but preserves the live share record', async () => {
    await blsi.Automate.State.set_screen_share_active(7);
    await blsi.Model.suppress_screen_share('feature', {});
    const m = blsi.Model.get();
    expect(m.automate.settings.screen_share.enabled).toBe(true);
    const suspended = blsi.Automate.State.read_suspended();
    expect(suspended.screen_share).toBe(true);
    // Live share record must stay — receiver tabs read it on Resume to
    // re-blur automatically without requiring the user to restart sharing.
    const ss = blsi.Model.get_screen_share_state();
    expect(ss.active).toBe(true);
    expect(ss._sharing_tab_ids).toContain(7);
  });

  test('unsuppress_screen_share reverses tab + site_session suppressions', async () => {
    await blsi.Automate.State.set_screen_share_active(7);
    await blsi.Model.suppress_screen_share('site_session', { hostname: 'example.com' });
    await blsi.Model.suppress_screen_share('tab', { tab_id: 8 });
    await blsi.Model.unsuppress_screen_share('site_session', { hostname: 'example.com' });
    await blsi.Model.unsuppress_screen_share('tab', { tab_id: 8 });
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    expect(r.automate_blur_triggers.screen_share).toBe(true);
    expect(r.screen_share_suppressed_for_host).toBe(false);
    expect(r.screen_share_suppressed_for_tab).toBe(false);
  });

  test('set_screen_share_active resets per-tab suppression list (mitigates tab-id reuse)', async () => {
    await blsi.Automate.State.set_screen_share_active(7);
    await blsi.Model.suppress_screen_share('tab', { tab_id: 8 });
    expect(blsi.Model.get_suppressed_tabs()).toContain(8);
    // New share starts — stale entries cleared so a recycled tab id can't carry over.
    await blsi.Automate.State.set_screen_share_active(99);
    expect(blsi.Model.get_suppressed_tabs()).toEqual([]);
  });

  test('resolve: screen_share fires independently when an exact rule blurs and ss is also live', async () => {
    // Snapshot pins blur_all on for the host; auto-fill carries global screen_share.enabled too.
    await blsi.Model.save_site_snapshot('example.com', 'exact',
      { blur_all: { status: true, settings: { blur_mode: 'redacted' } } });
    await blsi.Automate.State.set_screen_share_active(7);
    const r = blsi.Model.resolve('example.com', 'https://example.com/', 8);
    // Manual blur and screen-share automate are independent — both engage.
    expect(r.engage).toBe(true);
    expect(r.automate_blur_triggers.screen_share).toBe(true);
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
    expect(snap).not.toHaveProperty('settings');
    expect(snap).toHaveProperty('blur_all');
    expect(snap).toHaveProperty('blur_all.settings');
    expect(snap).toHaveProperty('pick_and_blur');
    expect(snap).toHaveProperty('pick_and_blur.settings');
    expect(snap).toHaveProperty('pick_and_blur.items');
    expect(snap).toHaveProperty('auto_detect_pii.settings');
    expect(snap).toHaveProperty('automate.settings');
  });

  test('returns exactly 4 top-level sections — no extra keys', () => {
    const snap = blsi.Model.capture_snapshot();
    const TOP_KEYS = new Set(['blur_all', 'pick_and_blur', 'auto_detect_pii', 'automate']);
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

  test('automate idle captures full shape (value + unit + enabled); tab_switch/screen_share enabled only', () => {
    const snap = blsi.Model.capture_snapshot();
    const d = blsi.build_default_model();
    expect(snap.automate.settings.idle).toEqual({
      value: d.automate.settings.idle.value,
      unit: d.automate.settings.idle.unit,
      enabled: d.automate.settings.idle.enabled,
    });
    expect(snap.automate.settings.tab_switch).toEqual({ enabled: d.automate.settings.tab_switch.enabled });
    expect(snap.automate.settings.screen_share).toEqual({ enabled: d.automate.settings.screen_share.enabled });
  });

  test('snapshot values match default model values', async () => {
    const snap = blsi.Model.capture_snapshot();
    const d = blsi.build_default_model();
    expect(snap.blur_all.settings.blur_mode).toBe(d.blur_all.settings.blur_mode);
    expect(snap.blur_all.settings.blur_categories).toEqual(d.blur_all.settings.blur_categories);
    expect(snap.pick_and_blur.settings.blur_type).toBe(d.pick_and_blur.settings.blur_type);
    expect(snap.pick_and_blur.settings.blur_color).toEqual(d.pick_and_blur.settings.blur_color);
    expect(snap.pick_and_blur.status).toBe(d.pick_and_blur.status);
    expect(snap.pick_and_blur.items).toEqual([]);
  });

  test('capture reflects in-flight settings changes', async () => {
    await blsi.Model.patch_section('blur_all', { settings: { blur_mode: 'frosted' } });
    await blsi.Model.patch_section('automate', { settings: { idle: { value: 24, unit: 'min', enabled: true } } });
    const snap = blsi.Model.capture_snapshot();
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');
    expect(snap.automate.settings.idle.value).toBe(24);
    expect(snap.automate.settings.idle.unit).toBe('min');
    expect(snap.automate.settings.idle.enabled).toBe(true);
  });

  test('captures pick_and_blur.items for the supplied hostname', async () => {
    await blsi.Model.save_blur_item('example.com', { type: 'sticky', id: 'z1', name: 'Box', x: 1, y: 2, width: 10, height: 10 });
    const snap = blsi.Model.capture_snapshot('example.com');
    expect(snap.pick_and_blur.items).toEqual([
      { type: 'sticky', id: 'z1', name: 'Box', x: 1, y: 2, width: 10, height: 10 },
    ]);
    // No hostname → empty items.
    expect(blsi.Model.capture_snapshot().pick_and_blur.items).toEqual([]);
    // Unknown hostname → empty items.
    expect(blsi.Model.capture_snapshot('nobody.com').pick_and_blur.items).toEqual([]);
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
    expect(stored.blur_all.settings.blur_mode).toBe(snap.blur_all.settings.blur_mode);
    expect(stored.pick_and_blur.items).toEqual([]);
  });

  test('updates .snapshot on an existing rule (does not duplicate)', async () => {
    const snap1 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap1);
    await blsi.Model.patch_section('blur_all', { settings: { blur_mode: 'frosted' } });
    const snap2 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap2);

    const rules = blsi.Model.get_rules().filter(r => r.hostname_value === 'github.com');
    expect(rules).toHaveLength(1);
    expect(rules[0].snapshot.blur_all.settings.blur_mode).toBe('frosted');
  });

  test('replaces previous snapshot on a second save', async () => {
    const snap1 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap1);

    await blsi.Model.patch_section('blur_all', { settings: { blur_mode: 'redacted' } });
    const snap2 = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap2);

    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    expect(stored.blur_all.settings.blur_mode).toBe('redacted');
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
    expect(stored.blur_all.settings.blur_mode).toBeDefined();
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

  test('partial snapshot is auto-filled from current global before write', async () => {
    // Custom global so we can detect fill-from-current-global vs DEFAULT_MODEL.
    await blsi.Model.patch_section('automate', { settings: { idle: { value: 17, unit: 'sec' } } });
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, {
      blur_all: { settings: { blur_mode: 'redacted' } },
    });
    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    // Caller-provided field preserved.
    expect(stored.blur_all.settings.blur_mode).toBe('redacted');
    // Missing fields filled from current global, not DEFAULT_MODEL.
    expect(stored.automate.settings.idle.value).toBe(17);
    expect(stored.automate.settings.idle.unit).toBe('sec');
    // All capture_snapshot() top-level sections present (no `settings`).
    expect(stored).not.toHaveProperty('settings');
    expect(stored.blur_all).toBeDefined();
    expect(stored.pick_and_blur).toBeDefined();
    expect(stored.pick_and_blur.items).toEqual([]);
    expect(stored.auto_detect_pii).toBeDefined();
    expect(stored.automate).toBeDefined();
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

  test('returns null when rule exists but snapshot is empty', async () => {
    await blsi.Model.save_rules([{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      snapshot:       {},
    }]);
    expect(blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact)).toBeNull();
  });

  test('returns snapshot object after save_site_snapshot', async () => {
    const snap = blsi.Model.capture_snapshot();
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snap);
    const stored = blsi.Model.get_site_snapshot('github.com', blsi.pattern_types.exact);
    expect(stored).not.toBeNull();
    expect(stored.blur_all.settings.blur_mode).toBe(snap.blur_all.settings.blur_mode);
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
          items: [{ type: 'sticky', id: 'z1', name: 'Box', x: 0, y: 0, width: 5, height: 5 }],
        },
        automate: {
          settings: {
            idle: { value: 17, unit: 'sec', enabled: true },
            tab_switch: { enabled: true },
            screen_share: { enabled: false },
          },
        },
      },
    }];
    const validated = blsi.validate_model(model);
    const snap = validated.site_rules[0].snapshot;
    expect(snap).not.toHaveProperty('settings');
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');
    expect(snap.blur_all.settings.blur_categories).toEqual({ text: true, media: false, form: false, table: false, structure: false });
    expect(snap.pick_and_blur.status).toBe(true);
    expect(snap.pick_and_blur.settings.blur_type).toBe('blur');
    expect(snap.pick_and_blur.settings.blur_color).toEqual({ hex: '#ff0000', opacity: 0.5 });
    expect(snap.pick_and_blur.items).toEqual([{ type: 'sticky', id: 'z1', name: 'Box', x: 0, y: 0, width: 5, height: 5 }]);
    expect(snap.automate.settings.idle).toEqual({ value: 17, unit: 'sec', enabled: true });
  });

  test('validate_model fills partial snapshots to capture_snapshot full shape (DEFAULT_MODEL values)', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        // Caller only supplied blur_mode — every other field must be filled
        // from DEFAULT_MODEL so resolve() never sees a partial.
        blur_all: { settings: { blur_mode: 'frosted' } },
      },
    }];
    const validated = blsi.validate_model(model);
    const snap = validated.site_rules[0].snapshot;
    const d = blsi.build_default_model();

    // Caller-provided field preserved
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');

    // No `settings` block in the new snapshot shape
    expect(snap).not.toHaveProperty('settings');

    // blur_all.settings.blur_categories filled
    expect(snap.blur_all.settings.blur_categories).toEqual(d.blur_all.settings.blur_categories);

    // pick_and_blur fully populated; items default to []
    expect(snap.pick_and_blur.status).toBe(d.pick_and_blur.status);
    expect(snap.pick_and_blur.settings.blur_type).toBe(d.pick_and_blur.settings.blur_type);
    expect(snap.pick_and_blur.settings.picker_mode).toBe(d.pick_and_blur.settings.picker_mode);
    expect(snap.pick_and_blur.settings.blur_color).toEqual(d.pick_and_blur.settings.blur_color);
    expect(snap.pick_and_blur.items).toEqual([]);

    // auto_detect_pii fully populated
    expect(snap.auto_detect_pii.settings.email).toBe(d.auto_detect_pii.settings.email);
    expect(snap.auto_detect_pii.settings.numeric).toBe(d.auto_detect_pii.settings.numeric);
    expect(snap.auto_detect_pii.settings.pii_mode).toBe(d.auto_detect_pii.settings.pii_mode);

    // automate fully populated — idle is full shape (value + unit + enabled);
    // tab_switch / screen_share are .enabled only.
    expect(snap.automate.settings.idle).toEqual({
      value: d.automate.settings.idle.value,
      unit: d.automate.settings.idle.unit,
      enabled: d.automate.settings.idle.enabled,
    });
    expect(snap.automate.settings.tab_switch).toEqual({ enabled: d.automate.settings.tab_switch.enabled });
    expect(snap.automate.settings.screen_share).toEqual({ enabled: d.automate.settings.screen_share.enabled });
  });

  test('validate_model preserves empty {} snapshot as empty', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'newtab',
      hostname_type:  blsi.pattern_types.exact,
      snapshot:       {},
    }];
    const validated = blsi.validate_model(model);
    expect(validated.site_rules[0].snapshot).toEqual({});
  });

  test('validate_model drops legacy snapshot.settings block entirely', () => {
    const model = blsi.build_default_model();
    model.site_rules = [{
      hostname_value: 'github.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot: {
        // Legacy settings block from previous schema — must be silently dropped.
        settings: { blur_radius: 10, some_unknown_key: 'bad' },
        blur_all: { settings: { blur_mode: 'frosted' } },
      },
    }];
    const validated = blsi.validate_model(model);
    const snap = validated.site_rules[0].snapshot;
    expect(snap).not.toHaveProperty('settings');
    expect(snap.blur_all.settings.blur_mode).toBe('frosted');
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
    expect(resolved.blur_mode).toBe('frosted');
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
      blur_all:  { settings: { blur_mode: 'redacted' } },
    };
    await blsi.Model.save_site_snapshot('*.github.com', blsi.pattern_types.wildcard, snapshot);

    const resolved = blsi.Model.resolve('sub.github.com', 'https://sub.github.com/page');
    expect(resolved.blur_mode).toBe('redacted');
  });

  test('exact rule snapshot wins over wildcard snapshot (exact has higher priority)', async () => {
    await blsi.Model.save_rules([{
      hostname_value: '*.github.com',
      hostname_type:  blsi.pattern_types.wildcard,
      snapshot:       { blur_all: { settings: { blur_mode: 'frosted' } } },
    }]);
    const exactSnap = { blur_all: { settings: { blur_mode: 'redacted' } } };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, exactSnap);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.blur_mode).toBe('redacted');
  });

  test('non-snapshot keys in resolved output come from global/feature settings when no override', async () => {
    const snapshot = { blur_all: { settings: { blur_mode: 'frosted' } } };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    // engage comes from global (not snapshot)
    expect(typeof resolved.engage).toBe('boolean');
    // blur_items comes from pick_and_blur.status gating (not snapshot, since
    // this snapshot has no items array — host-keyed items lookup kicks in)
    expect(Array.isArray(resolved.blur_items)).toBe(true);
  });

  test('snapshot.pick_and_blur.items REPLACE host-keyed items at resolve', async () => {
    // Seed one item into the host-keyed map.
    await blsi.Model.patch_section('pick_and_blur', { status: true });
    await blsi.Model.save_blur_item('github.com', { type: 'dynamic', selector: '#host', name: 'host' });
    // Snapshot pins a different items array.
    const snapshot = {
      pick_and_blur: {
        status: true,
        items: [{ type: 'sticky', id: 'r1', name: 'rule', x: 1, y: 2, width: 5, height: 5 }],
      },
    };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.blur_items).toHaveLength(1);
    expect(resolved.blur_items[0].id).toBe('r1');
    expect(resolved._rule_overrides.blur_items).toBe(true);
  });

  test('snapshot.automate.idle.value/unit override global at resolve', async () => {
    const snapshot = {
      automate: { settings: { idle: { value: 30, unit: 'sec', enabled: true } } },
    };
    await blsi.Model.save_site_snapshot('github.com', blsi.pattern_types.exact, snapshot);

    const resolved = blsi.Model.resolve('github.com', 'https://github.com/');
    expect(resolved.automate_idle.value).toBe(30);
    expect(resolved.automate_idle.unit).toBe('sec');
    expect(resolved.automate_idle.enabled).toBe(true);
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

// ── resolve_automate (slim slice for the automate Manager) ────────────────────
describe('resolve_automate', () => {
  beforeEach(async () => {
    mockGet(null);
    await blsi.Model.init_cache();
  });

  test('returns only the automate-decision fields', () => {
    const r = blsi.Model.resolve_automate('example.com', 'https://example.com/', 1);
    // Automate decision keys present
    expect(r).toHaveProperty('automate_blur_active');
    expect(r).toHaveProperty('automate_blur_triggers');
    expect(r).toHaveProperty('screen_share_state');
    expect(r).toHaveProperty('screen_share_suppressed_for_host');
    expect(r).toHaveProperty('screen_share_suppressed_for_tab');
    expect(r).toHaveProperty('automate_idle');
    expect(r).toHaveProperty('automate_tab_switch');
    expect(r).toHaveProperty('automate_screen_share');
    expect(r).toHaveProperty('_rule_match');
    // Manual-blur / settings-tree fields absent
    expect(r).not.toHaveProperty('engage');
    expect(r).not.toHaveProperty('blur_mode');
    expect(r).not.toHaveProperty('blur_radius');
    expect(r).not.toHaveProperty('blur_categories');
    expect(r).not.toHaveProperty('blur_items');
    expect(r).not.toHaveProperty('shortcuts');
    expect(r).not.toHaveProperty('pii_email');
  });

  test('values match resolve() output for automate keys', () => {
    const full = blsi.Model.resolve('example.com', 'https://example.com/', 1);
    const slim = blsi.Model.resolve_automate('example.com', 'https://example.com/', 1);
    expect(slim.automate_blur_active).toBe(full.automate_blur_active);
    expect(slim.automate_blur_triggers).toEqual(full.automate_blur_triggers);
    expect(slim.screen_share_state).toEqual(full.screen_share_state);
    expect(slim.screen_share_suppressed_for_host).toBe(full.screen_share_suppressed_for_host);
    expect(slim.screen_share_suppressed_for_tab).toBe(full.screen_share_suppressed_for_tab);
    expect(slim._rule_match).toEqual(full._rule_match);
  });

  test('reflects per-host site-rule fold of automate gates', async () => {
    await blsi.Model.save_rules([{
      hostname_value: 'gmail.com',
      hostname_type:  blsi.pattern_types.exact,
      blur_all:       null,
      items:          [],
      snapshot:       {},
    }]);
    await blsi.Model.save_site_snapshot('gmail.com', blsi.pattern_types.exact,
      { automate: { settings: { idle: { enabled: false } } } });
    const r = blsi.Model.resolve_automate('gmail.com', 'https://gmail.com/', 1);
    expect(r.automate_idle.enabled).toBe(false);
  });

  test('omits tab_id → screen_share self-skip cannot apply', () => {
    const r = blsi.Model.resolve_automate('example.com', 'https://example.com/', null);
    expect(r.screen_share_state.is_sharing_tab).toBe(false);
  });
});
