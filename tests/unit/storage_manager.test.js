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

    test('returns empty array when blurred_items is null', async () => {
      mockStorageGet({ blurred_items: null });
      expect(await blsi.Storage.getBlurItems('x.com')).toEqual([]);
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      mockStorageGet({ blurred_items: {} });
      await blsi.Storage.getBlurItems('x.com');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── clearHost (direct storage write) ──────────────────────────────────

  describe('clearHost', () => {
    test('deletes hostname from blurred_items', async () => {
      mockStorageGet({ blurred_items: { 'x.com': [{ type: 'dynamic', name: 'D1', selector: '#a' }], 'y.com': [] } });

      await blsi.Storage.clearHost('x.com');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toBeUndefined();
      expect(setCall.blurred_items['y.com']).toBeDefined();
    });
  });

  // ── clearAll (direct storage write) ───────────────────────────────────

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

  describe('getSettings', () => {
    test('returns merged settings from storage', async () => {
      mockStorageGet({ settings: { BLUR_RADIUS: 12 } });
      const settings = await blsi.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(12);
      expect(settings.ENABLED).toBe(true); // default merged in
    });

    test('returns full defaults when no settings in storage', async () => {
      mockStorageGet({ settings: null });
      const settings = await blsi.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(6);
      expect(settings.HIGHLIGHT_COLOR).toBe('#f59e0b');
    });
  });

  // ── saveSettings (direct storage write) ───────────────────────────────

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
  });

  describe('saveRules', () => {
    test('sanitizes and writes rules to storage', async () => {
      const rules = [{ id: 'r1', pattern: '*.example.com', patternType: 'wildcard', settings: {} }];
      await blsi.Storage.saveRules(rules);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const saved = chrome.storage.local.set.mock.calls[0][0].rules;
      expect(saved).toHaveLength(1);
      expect(saved[0].pattern).toBe('*.example.com');
    });
  });

  // ── getBlurState / saveBlurState ──────────────────────────────────────

  describe('getBlurState', () => {
    test('returns blur state from background', async () => {
      mockStorageGet({ blur_all_hosts: { 'example.com': true } });
      const result = await blsi.Storage.getBlurState('example.com');
      expect(result).toBe(true);
    });
  });

  describe('saveBlurState', () => {
    test('writes blur state to storage', async () => {
      mockStorageGet({ blur_all_hosts: {} });
      await blsi.Storage.saveBlurState('example.com', true);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blur_all_hosts['example.com']).toBe(true);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    test('getBlurItems returns empty array when storage returns null', async () => {
      mockStorageGet({ blurred_items: null });
      const result = await blsi.Storage.getBlurItems('x.com');
      expect(result).toEqual([]);
    });

    test('getSettings returns defaults when storage returns null', async () => {
      mockStorageGet({ settings: null });
      const result = await blsi.Storage.getSettings();
      expect(result.BLUR_RADIUS).toBe(6);
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────

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
  });
});
