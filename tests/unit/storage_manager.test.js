/**
 * tests/unit/storage_manager.test.js
 *
 * Unit tests for src/storage_manager.js
 * Module exposes blsi.Storage with:
 *   saveBlurItem, removeBlurItem, getBlurItems,
 *   clearHost, clearAll, getSettings, saveSettings
 *
 * WRITE operations use chrome.storage.local directly.
 * READ operations use chrome.runtime.sendMessage → background.js.
 */

/* === TEST QUALITY ANNOTATIONS ===
 *
 * COVERS:
 *   - saveBlurItem: write path, append, dedup by selector, per-host limit, guard clauses
 *   - removeBlurItem: remove by ID, empty-host cleanup
 *   - getBlurItems: read array, missing host, null storage, guard clause
 *   - clearHost / clearAll: partial and full wipe of blurred_items
 *   - getSettings / saveSettings: defaults merge, write validation, guard clauses
 *   - getRules / saveRules: read/write rules array
 *   - getBlurState / saveBlurState: per-host blur-all toggle persistence
 *   - error handling block: null-storage safety for getBlurItems and getSettings
 *   - guard clauses block: invalid hostname, null item, bad type, prototype pollution
 *
 * REDUNDANT:
 *   - "getBlurItems returns empty array when blurred_items is null" appears in
 *     getBlurItems describe (line ~174) AND again in error handling describe (line ~302).
 *     The error handling copy adds no new assertion.
 *   - "getSettings returns defaults when storage returns null" appears in
 *     getSettings describe (line ~223) AND again in error handling describe (line ~308).
 *     Both assert BLUR_RADIUS === 6; the second is a pure duplicate.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Guard clause tests (9 tests across saveBlurItem/removeBlurItem/getBlurItems/
 *     clearHost/saveSettings) all follow the same pattern:
 *     call with invalid input → expect no chrome.storage call.
 *     Candidate for test.each([hostname, item, expectedCalls]) table.
 *
 * MISSING COVERAGE:
 *   - initCache() / cache initialization path — never exercised
 *   - onChange(callback) subscriber pattern — not tested at all
 *   - getCachedBlurState(hostname) synchronous read path — not tested
 *   - saveBlurItem deduplication when item uses a zone name (non-selector key) — not covered
 *   - clearHost when hostname does not exist in storage — no-op behaviour untested
 *   - getRules / saveRules guard clauses (null input, non-array) — not tested
 *   - saveRules sanitization logic detail (which fields are stripped) — single happy path only
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Load module ──────────────────────────────────────────────────────────────

const MODULE_PATH = path.resolve(__dirname, '../../src/storage_manager.js');

function loadStorageManager() {
  if (blsi.Storage) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    throw new Error('storage_manager.js not found — stub removed, real file required');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mock chrome.storage.local.get for read-modify-write operations. */
function mockStorageGet(data) {
  chrome.storage.local.get.mockImplementation((key, cb) => {
    if (typeof key === 'string') {
      cb({ [key]: data[key] || null });
    } else {
      cb(data);
    }
  });
}

/** Mock chrome.storage.local.set to resolve immediately. */
function mockStorageSet() {
  chrome.storage.local.set.mockImplementation((_data, cb) => {
    if (cb) cb();
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('blsi.Storage', () => {
  beforeAll(() => {
    loadStorageManager();
  });

  beforeEach(() => {
    mockStorageSet();
    // Reset internal cache so each test re-reads from the (mocked) storage.
    if (blsi.Storage._resetCache) blsi.Storage._resetCache();
  });

  // ── saveBlurItem (direct storage write) ─────────────────────────────────

  // USER IMPACT: user blurs an element — item persists across page reload; duplicate selector rejected; per-host cap enforced
  describe('saveBlurItem', () => {
    test('writes item to chrome.storage.local', async () => {
      mockStorageGet({ blurred_items: {} });

      const item = { type: 'dynamic', name: 'Dynamic 1', selector: '#target' };
      await blsi.Storage.saveBlurItem('example.com', item);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          blurred_items: { 'example.com': [item] },
        }),
        expect.any(Function)
      );
    });

    test('appends to existing items for hostname', async () => {
      const existing = { type: 'dynamic', name: 'Dynamic 1', selector: '#a' };
      mockStorageGet({ blurred_items: { 'example.com': [existing] } });

      const newItem = { type: 'dynamic', name: 'Dynamic 2', selector: '#b' };
      await blsi.Storage.saveBlurItem('example.com', newItem);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          blurred_items: { 'example.com': [existing, newItem] },
        }),
        expect.any(Function)
      );
    });

    test('deduplicates by item ID (selector for dynamic)', async () => {
      const existing = { type: 'dynamic', name: 'Dynamic 1', selector: '#target' };
      mockStorageGet({ blurred_items: { 'x.com': [existing] } });

      const dupe = { type: 'dynamic', name: 'Dynamic 2', selector: '#target' };
      await blsi.Storage.saveBlurItem('x.com', dupe);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toHaveLength(1);
    });

    test('enforces per-host limit of 10', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        type: 'dynamic', name: 'D' + i, selector: '#el' + i,
      }));
      mockStorageGet({ blurred_items: { 'x.com': items } });

      await blsi.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'D11', selector: '#el11' });

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      mockStorageGet({ blurred_items: {} });

      await blsi.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'D1', selector: '#a' });

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── removeBlurItem (direct storage write) ─────────────────────────────

  // USER IMPACT: user clicks unblur on an element — item removed from storage; empty host key cleaned up so storage stays lean
  describe('removeBlurItem', () => {
    test('removes item by ID from storage', async () => {
      const items = [
        { type: 'dynamic', name: 'D1', selector: '#a' },
        { type: 'dynamic', name: 'D2', selector: '#b' },
      ];
      mockStorageGet({ blurred_items: { 'x.com': items } });

      await blsi.Storage.removeBlurItem('x.com', '#a');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toHaveLength(1);
      expect(setCall.blurred_items['x.com'][0].selector).toBe('#b');
    });

    test('deletes hostname key when last item removed', async () => {
      mockStorageGet({ blurred_items: { 'x.com': [{ type: 'dynamic', name: 'D1', selector: '#a' }] } });

      await blsi.Storage.removeBlurItem('x.com', '#a');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toBeUndefined();
    });
  });

  // ── getBlurItems (direct storage read) ────────────────────────────────

  // USER IMPACT: page load — all previously blurred elements are restored from storage
  describe('getBlurItems', () => {
    test('returns items array from storage', async () => {
      const items = [
        { type: 'dynamic', name: 'Dynamic 1', selector: '#foo' },
        { type: 'dynamic', name: 'Dynamic 2', selector: '.bar' },
      ];
      mockStorageGet({ blurred_items: { 'example.com': items } });

      const result = await blsi.Storage.getBlurItems('example.com');
      expect(result).toEqual(items);
    });

    test('returns empty array when no items for hostname', async () => {
      mockStorageGet({ blurred_items: {} });
      const result = await blsi.Storage.getBlurItems('example.com');
      expect(result).toHaveLength(0);
    });

    // REDUNDANT: same null-blurred_items assertion repeated in the 'error handling' describe below
    test('returns empty array when blurred_items is null', async () => {
      mockStorageGet({ blurred_items: null });
      expect(await blsi.Storage.getBlurItems('x.com')).toEqual([]);
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      mockStorageGet({ blurred_items: {} });
      await blsi.Storage.getBlurItems('x.com');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
    // MISSING: no test for getBlurItems with a hostname whose value is undefined (key present, value undefined)
    // MISSING: no test for getBlurItems returning a frozen/immutable copy vs. a live reference
  });

  // ── clearHost (direct storage write) ──────────────────────────────────

  // USER IMPACT: user clicks "clear this site" button — all blurs for that host removed; other sites unaffected
  describe('clearHost', () => {
    test('deletes hostname from blurred_items', async () => {
      mockStorageGet({ blurred_items: { 'x.com': [{ type: 'dynamic', name: 'D1', selector: '#a' }], 'y.com': [] } });

      await blsi.Storage.clearHost('x.com');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toBeUndefined();
      expect(setCall.blurred_items['y.com']).toBeDefined();
    });
    // MISSING: no test for clearHost when hostname is not present in storage (no-op case)
    // MISSING: no test verifying clearHost does not touch the blur_all_hosts or settings keys
  });

  // ── clearAll (direct storage write) ───────────────────────────────────

  // USER IMPACT: user clicks "clear all sites" button — entire blurred_items map wiped; clean slate without reinstalling
  describe('clearAll', () => {
    test('overwrites blurred_items with empty object', async () => {
      await blsi.Storage.clearAll();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { blurred_items: {} },
        expect.any(Function)
      );
    });
  });

  // ── getSettings (direct storage read + merge defaults) ─────────────────

  // USER IMPACT: user changes blur radius in popup — setting survives reload; corrupt storage falls back to safe defaults
  describe('getSettings', () => {
    test('returns merged settings from storage', async () => {
      mockStorageGet({ settings: { BLUR_RADIUS: 12 } });
      const settings = await blsi.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(12);
      expect(settings.ENABLED).toBe(true); // default merged in
    });

    // REDUNDANT: same null-settings → defaults assertion repeated in the 'error handling' describe below
    test('returns full defaults when no settings in storage', async () => {
      mockStorageGet({ settings: null });
      const settings = await blsi.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(6);
      expect(settings.HIGHLIGHT_COLOR).toBe('#f59e0b');
    });
    // MISSING: no test for getSettings running validateSettings on stale/corrupt stored data
    // MISSING: no test that getSettings result contains SHORTCUTS from action registry
  });

  // ── saveSettings (direct storage write) ───────────────────────────────

  // USER IMPACT: user saves settings in popup — changes written atomically; invalid shapes rejected before they corrupt storage
  describe('saveSettings', () => {
    test('validates and writes settings to storage', async () => {
      const fullSettings = blsi.buildDefaultSettings();
      fullSettings.BLUR_RADIUS = 20;
      await blsi.Storage.saveSettings(fullSettings);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const saved = chrome.storage.local.set.mock.calls[0][0].settings;
      expect(saved.BLUR_RADIUS).toBe(20);
      expect(saved.ENABLED).toBe(true);
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      await blsi.Storage.saveSettings(blsi.buildDefaultSettings());
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── getRules / saveRules ──────────────────────────────────────────────

  // USER IMPACT: user creates a URL-specific rule — rule persisted and loaded on next page visit matching the pattern
  describe('getRules', () => {
    test('returns rules array from storage', async () => {
      mockStorageGet({ rules: [{ id: 'r1', pattern: '*.test.com' }] });
      const rules = await blsi.Storage.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('r1');
    });

    test('returns empty array when no rules saved', async () => {
      mockStorageGet({ rules: null });
      expect(await blsi.Storage.getRules()).toEqual([]);
    });
    // MISSING: no test for getRules when stored value is not an array (corrupt data)
  });

  // USER IMPACT: user saves URL rules — rules written to storage so resolveSettings can apply per-URL overrides
  describe('saveRules', () => {
    test('sanitizes and writes rules to storage', async () => {
      const rules = [{ id: 'r1', pattern: '*.example.com', patternType: 'wildcard', settings: {} }];
      await blsi.Storage.saveRules(rules);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const saved = chrome.storage.local.set.mock.calls[0][0].rules;
      expect(saved).toHaveLength(1);
      expect(saved[0].pattern).toBe('*.example.com');
    });
    // MISSING: no test for saveRules with null or non-array input (guard clause)
    // MISSING: no test for saveRules stripping unknown fields from each rule object
    // OPTIMIZE: saveRules + getRules happy paths could be combined into a round-trip test
  });

  // ── getBlurState / saveBlurState ──────────────────────────────────────

  // USER IMPACT: blur-all toggle state persists between page navigations within the same hostname
  describe('getBlurState', () => {
    test('returns blur state from background', async () => {
      mockStorageGet({ blur_all_hosts: { 'example.com': true } });
      const result = await blsi.Storage.getBlurState('example.com');
      expect(result).toBe(true);
    });
    // MISSING: no test for getBlurState returning false/undefined when hostname not in map
    // MISSING: no test for getBlurState when blur_all_hosts key is null in storage
  });

  // USER IMPACT: blur-all toggle written immediately so next page load restores correct blur state
  describe('saveBlurState', () => {
    test('writes blur state to storage', async () => {
      mockStorageGet({ blur_all_hosts: {} });
      await blsi.Storage.saveBlurState('example.com', true);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blur_all_hosts['example.com']).toBe(true);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  // USER IMPACT: corrupt or missing storage does not crash the extension on page load
  describe('error handling', () => {
    // REDUNDANT: identical to "returns empty array when blurred_items is null" in the getBlurItems describe above
    test('getBlurItems returns empty array when storage returns null', async () => {
      mockStorageGet({ blurred_items: null });
      const result = await blsi.Storage.getBlurItems('x.com');
      expect(result).toEqual([]);
    });

    // REDUNDANT: identical to "returns full defaults when no settings in storage" in the getSettings describe above
    test('getSettings returns defaults when storage returns null', async () => {
      mockStorageGet({ settings: null });
      const result = await blsi.Storage.getSettings();
      expect(result.BLUR_RADIUS).toBe(6);
    });
    // MISSING: no test for chrome.storage.local.get throwing (runtime error path)
    // MISSING: no test for chrome.runtime.lastError set during a storage callback
  });

  // ── Guard clauses ─────────────────────────────────────────────────────

  // USER IMPACT: malformed calls from content_script bugs or popup race conditions do not corrupt storage
  // OPTIMIZE: all 9 tests below follow the same "invalid input → no chrome.storage call" pattern; refactor with test.each([description, fn]) to eliminate boilerplate
  describe('guard clauses', () => {
    test('saveBlurItem returns early for empty hostname', async () => {
      await blsi.Storage.saveBlurItem('', { type: 'dynamic', name: 'D1', selector: '#el' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveBlurItem returns early for null item', async () => {
      await blsi.Storage.saveBlurItem('example.com', null);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveBlurItem returns early for invalid item type', async () => {
      await blsi.Storage.saveBlurItem('example.com', { type: 'bad', name: 'X' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('removeBlurItem returns early for empty hostname', async () => {
      await blsi.Storage.removeBlurItem('', '#el');
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('getBlurItems returns empty array for empty hostname', async () => {
      expect(await blsi.Storage.getBlurItems('')).toEqual([]);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('clearHost returns early for empty hostname', async () => {
      await blsi.Storage.clearHost('');
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for null input', async () => {
      await blsi.Storage.saveSettings(null);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for non-object input', async () => {
      await blsi.Storage.saveSettings('not an object');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('saveBlurItem rejects prototype pollution hostname', async () => {
      await blsi.Storage.saveBlurItem('__proto__', { type: 'dynamic', name: 'D1', selector: '#x' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });
    // MISSING: no test for saveBlurItem rejecting 'constructor' or 'toString' as hostname (other pollution vectors)
    // MISSING: no test for removeBlurItem with a null or missing selector argument
  });
});
