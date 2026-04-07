/**
 * tests/unit/storage_manager.test.js
 *
 * Unit tests for src/storage_manager.js
 * Module exposes pb.Storage with:
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
  if (pb.Storage) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    throw new Error('storage_manager.js not found — stub removed, real file required');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mock chrome.runtime.sendMessage for READ operations. */
function mockSendMessageResponse(responseValue) {
  chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
    if (cb) cb(responseValue);
  });
}

function mockSendMessageError(errorMessage) {
  chrome.runtime.sendMessage.mockImplementation((_msg, cb) => {
    const originalLastError = chrome.runtime.lastError;
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: { message: errorMessage },
      configurable: true,
    });
    if (cb) cb(undefined);
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: originalLastError,
      configurable: true,
    });
  });
}

/** Mock chrome.storage.local.get for WRITE operations (read-modify-write). */
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

describe('pb.Storage', () => {
  beforeAll(() => {
    loadStorageManager();
  });

  beforeEach(() => {
    mockStorageSet();
  });

  // ── saveBlurItem (direct storage write) ─────────────────────────────────

  describe('saveBlurItem', () => {
    test('writes item to chrome.storage.local', async () => {
      mockStorageGet({ blurred_items: {} });

      const item = { type: 'dynamic', name: 'Dynamic 1', selector: '#target' };
      await pb.Storage.saveBlurItem('example.com', item);

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
      await pb.Storage.saveBlurItem('example.com', newItem);

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
      await pb.Storage.saveBlurItem('x.com', dupe);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toHaveLength(1);
    });

    test('enforces per-host limit of 10', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        type: 'dynamic', name: 'D' + i, selector: '#el' + i,
      }));
      mockStorageGet({ blurred_items: { 'x.com': items } });

      await pb.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'D11', selector: '#el11' });

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      mockStorageGet({ blurred_items: {} });

      await pb.Storage.saveBlurItem('x.com', { type: 'dynamic', name: 'D1', selector: '#a' });

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

      await pb.Storage.removeBlurItem('x.com', '#a');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toHaveLength(1);
      expect(setCall.blurred_items['x.com'][0].selector).toBe('#b');
    });

    test('deletes hostname key when last item removed', async () => {
      mockStorageGet({ blurred_items: { 'x.com': [{ type: 'dynamic', name: 'D1', selector: '#a' }] } });

      await pb.Storage.removeBlurItem('x.com', '#a');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toBeUndefined();
    });
  });

  // ── getBlurItems (message-based read) ─────────────────────────────────

  describe('getBlurItems', () => {
    test('resolves with items array from background response', async () => {
      const items = [
        { type: 'dynamic', name: 'Dynamic 1', selector: '#foo' },
        { type: 'dynamic', name: 'Dynamic 2', selector: '.bar' },
      ];
      mockSendMessageResponse({ items });

      const result = await pb.Storage.getBlurItems('example.com');
      expect(result).toEqual(items);
    });

    test('resolves with empty array when background returns no items', async () => {
      mockSendMessageResponse({});
      const result = await pb.Storage.getBlurItems('example.com');
      expect(result).toHaveLength(0);
    });

    test('sends GET_BLUR_ITEMS message with correct hostname', async () => {
      mockSendMessageResponse({ items: [] });
      await pb.Storage.getBlurItems('news.example.org');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'GET_BLUR_ITEMS', hostname: 'news.example.org' }),
        expect.any(Function)
      );
    });

    test('resolves with empty array when response is null', async () => {
      mockSendMessageResponse(null);
      expect(await pb.Storage.getBlurItems('x.com')).toEqual([]);
    });
  });

  // ── clearHost (direct storage write) ──────────────────────────────────

  describe('clearHost', () => {
    test('deletes hostname from blurred_items', async () => {
      mockStorageGet({ blurred_items: { 'x.com': [{ type: 'dynamic', name: 'D1', selector: '#a' }], 'y.com': [] } });

      await pb.Storage.clearHost('x.com');

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blurred_items['x.com']).toBeUndefined();
      expect(setCall.blurred_items['y.com']).toBeDefined();
    });
  });

  // ── clearAll (direct storage write) ───────────────────────────────────

  describe('clearAll', () => {
    test('overwrites blurred_items with empty object', async () => {
      await pb.Storage.clearAll();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { blurred_items: {} },
        expect.any(Function)
      );
    });
  });

  // ── getSettings (message-based read) ──────────────────────────────────

  describe('getSettings', () => {
    test('returns settings from background response', async () => {
      mockSendMessageResponse({ settings: { BLUR_RADIUS: 12, ENABLED: true } });
      const settings = await pb.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(12);
    });

    test('falls back to defaults when response has no settings', async () => {
      mockSendMessageResponse({});
      const settings = await pb.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(10);
    });

    test('falls back to defaults when response is null', async () => {
      mockSendMessageResponse(null);
      const settings = await pb.Storage.getSettings();
      expect(settings.BLUR_RADIUS).toBe(10);
    });
  });

  // ── saveSettings (direct storage write) ───────────────────────────────

  describe('saveSettings', () => {
    test('validates and writes settings to storage', async () => {
      const fullSettings = pb.buildDefaultSettings();
      fullSettings.BLUR_RADIUS = 20;
      await pb.Storage.saveSettings(fullSettings);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const saved = chrome.storage.local.set.mock.calls[0][0].settings;
      expect(saved.BLUR_RADIUS).toBe(20);
      expect(saved.ENABLED).toBe(true);
    });

    test('does not use chrome.runtime.sendMessage', async () => {
      await pb.Storage.saveSettings(pb.buildDefaultSettings());
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── getRules / saveRules ──────────────────────────────────────────────

  describe('getRules', () => {
    test('returns rules array from background', async () => {
      mockSendMessageResponse({ rules: [{ id: 'r1', pattern: '*.test.com' }] });
      const rules = await pb.Storage.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe('r1');
    });

    test('returns empty array when no rules saved', async () => {
      mockSendMessageResponse({});
      expect(await pb.Storage.getRules()).toEqual([]);
    });
  });

  describe('saveRules', () => {
    test('sanitizes and writes rules to storage', async () => {
      const rules = [{ id: 'r1', pattern: '*.example.com', patternType: 'wildcard', settings: {} }];
      await pb.Storage.saveRules(rules);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const saved = chrome.storage.local.set.mock.calls[0][0].rules;
      expect(saved).toHaveLength(1);
      expect(saved[0].pattern).toBe('*.example.com');
    });
  });

  // ── getBlurState / saveBlurState ──────────────────────────────────────

  describe('getBlurState', () => {
    test('returns blur state from background', async () => {
      mockSendMessageResponse({ blurAll: true });
      const result = await pb.Storage.getBlurState('example.com');
      expect(result).toBe(true);
    });
  });

  describe('saveBlurState', () => {
    test('writes blur state to storage', async () => {
      mockStorageGet({ blur_all_hosts: {} });
      await pb.Storage.saveBlurState('example.com', true);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      expect(setCall.blur_all_hosts['example.com']).toBe(true);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    test('getBlurItems rejects on sendMessage error', async () => {
      mockSendMessageError('Background not ready');
      await expect(pb.Storage.getBlurItems('x.com')).rejects.toBeTruthy();
    });

    test('getSettings rejects on sendMessage error', async () => {
      mockSendMessageError('SW suspended');
      await expect(pb.Storage.getSettings()).rejects.toBeTruthy();
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────

  describe('guard clauses', () => {
    test('saveBlurItem returns early for empty hostname', async () => {
      await pb.Storage.saveBlurItem('', { type: 'dynamic', name: 'D1', selector: '#el' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveBlurItem returns early for null item', async () => {
      await pb.Storage.saveBlurItem('example.com', null);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveBlurItem returns early for invalid item type', async () => {
      await pb.Storage.saveBlurItem('example.com', { type: 'bad', name: 'X' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('removeBlurItem returns early for empty hostname', async () => {
      await pb.Storage.removeBlurItem('', '#el');
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('getBlurItems returns empty array for empty hostname', async () => {
      expect(await pb.Storage.getBlurItems('')).toEqual([]);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('clearHost returns early for empty hostname', async () => {
      await pb.Storage.clearHost('');
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for null input', async () => {
      await pb.Storage.saveSettings(null);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('saveSettings returns early for non-object input', async () => {
      await pb.Storage.saveSettings('not an object');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('saveBlurItem rejects prototype pollution hostname', async () => {
      await pb.Storage.saveBlurItem('__proto__', { type: 'dynamic', name: 'D1', selector: '#x' });
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });
  });
});
