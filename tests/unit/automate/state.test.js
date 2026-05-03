/**
 * tests/unit/automate/state.test.js
 *
 * Unit tests for src/automate/state.js
 * Module exposes blsi.Automate.State with:
 *   PHASES, KEYS, read_idle, read_tab_switch, read_all_tab_switch,
 *   write_idle, write_tab_switch, clear_tab_switch, _reset
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/state.js');

// USER IMPACT: shared automate state surface is correct — every trigger writes,
// every reader sees the same values across background + content contexts.
describe('automate/state.js', () => {
  let State;

  beforeEach(() => {
    delete globalThis.blsi.Automate;
    jest.resetModules();
    require(MODULE_PATH);
    State = blsi.Automate.State;
    State._reset();
  });

  describe('PHASES + KEYS shape', () => {
    test('PHASES.idle exposes active/idle/locked', () => {
      expect(State.PHASES.idle).toEqual({ active: 'active', idle: 'idle', locked: 'locked' });
    });

    test('PHASES.tab_switch exposes off/armed/fired', () => {
      expect(State.PHASES.tab_switch).toEqual({ off: 'off', armed: 'armed', fired: 'fired' });
    });

    test('KEYS exposes session storage key constants', () => {
      expect(State.KEYS.idle).toBe('blsi_automate_idle');
      expect(State.KEYS.tab_switch_by_tab).toBe('blsi_automate_tab_switch_by_tab');
      expect(State.KEYS.screen_share).toBe('blsi_screen_share');
      expect(State.KEYS.suppressed_tabs).toBe('blsi_automate_suppressed_tabs');
    });

    test('PHASES + State are frozen', () => {
      expect(Object.isFrozen(State)).toBe(true);
      expect(Object.isFrozen(State.PHASES)).toBe(true);
      expect(Object.isFrozen(State.PHASES.idle)).toBe(true);
      expect(Object.isFrozen(State.PHASES.tab_switch)).toBe(true);
      expect(Object.isFrozen(State.KEYS)).toBe(true);
    });
  });

  describe('read defaults', () => {
    test('read_idle returns active before any write', () => {
      expect(State.read_idle()).toBe('active');
    });

    test('read_tab_switch returns off for unknown tab', () => {
      expect(State.read_tab_switch(42)).toBe('off');
    });

    test('read_tab_switch with non-number returns off', () => {
      expect(State.read_tab_switch('42')).toBe('off');
      expect(State.read_tab_switch(null)).toBe('off');
      expect(State.read_tab_switch(undefined)).toBe('off');
    });

    test('read_all_tab_switch returns empty object', () => {
      expect(State.read_all_tab_switch()).toEqual({});
    });
  });

  describe('write_idle', () => {
    test('writes new value, updates cache synchronously', async () => {
      const ok = await State.write_idle('idle');
      expect(ok).toBe(true);
      expect(State.read_idle()).toBe('idle');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        { blsi_automate_idle: { status: 'idle', ignore_tabs: [], ignore_sites: [] } },
        expect.any(Function)
      );
    });

    test('idempotent — same value resolves false without storage write', async () => {
      await State.write_idle('idle');
      chrome.storage.session.set.mockClear();
      const ok = await State.write_idle('idle');
      expect(ok).toBe(false);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('non-string input is no-op', async () => {
      const ok = await State.write_idle(42);
      expect(ok).toBe(false);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });
  });

  describe('write_tab_switch', () => {
    test('writes per-tab phase', async () => {
      const ok = await State.write_tab_switch(7, 'fired');
      expect(ok).toBe(true);
      expect(State.read_tab_switch(7)).toBe('fired');
      expect(State.read_all_tab_switch()).toEqual({ '7': 'fired' });
    });

    test("'off' strips the entry from the map", async () => {
      await State.write_tab_switch(7, 'fired');
      expect(State.read_all_tab_switch()).toEqual({ '7': 'fired' });
      await State.write_tab_switch(7, 'off');
      expect(State.read_tab_switch(7)).toBe('off');
      expect(State.read_all_tab_switch()).toEqual({});
    });

    test("'off' on absent tab is a no-op (no storage write)", async () => {
      chrome.storage.session.set.mockClear();
      const ok = await State.write_tab_switch(99, 'off');
      expect(ok).toBe(false);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('idempotent — same phase resolves false', async () => {
      await State.write_tab_switch(7, 'armed');
      chrome.storage.session.set.mockClear();
      const ok = await State.write_tab_switch(7, 'armed');
      expect(ok).toBe(false);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('non-number tab id is no-op', async () => {
      const ok = await State.write_tab_switch('7', 'fired');
      expect(ok).toBe(false);
    });

    test('non-string phase is no-op', async () => {
      const ok = await State.write_tab_switch(7, null);
      expect(ok).toBe(false);
    });

    test('multiple tabs maintained independently', async () => {
      await State.write_tab_switch(1, 'armed');
      await State.write_tab_switch(2, 'fired');
      expect(State.read_tab_switch(1)).toBe('armed');
      expect(State.read_tab_switch(2)).toBe('fired');
      expect(State.read_all_tab_switch()).toEqual({ '1': 'armed', '2': 'fired' });
    });

    test('storage payload is full replacement of map', async () => {
      await State.write_tab_switch(1, 'armed');
      await State.write_tab_switch(2, 'fired');
      const lastCall = chrome.storage.session.set.mock.calls.at(-1);
      expect(lastCall[0]).toEqual({
        blsi_automate_tab_switch_by_tab: { status: { '1': 'armed', '2': 'fired' }, ignore_tabs: [], ignore_sites: [] },
      });
    });

    test('clear_tab_switch is alias for write off', async () => {
      await State.write_tab_switch(7, 'fired');
      await State.clear_tab_switch(7);
      expect(State.read_tab_switch(7)).toBe('off');
    });
  });

  describe('onChanged listener', () => {
    test('updates idle cache on cross-context write (new shape)', () => {
      global._fireStorageChanged(
        { blsi_automate_idle: { newValue: { status: 'idle', ignore_tabs: [], ignore_sites: [] } } },
        'session'
      );
      expect(State.read_idle()).toBe('idle');
    });

    test('updates idle cache on cross-context write (legacy string)', () => {
      global._fireStorageChanged(
        { blsi_automate_idle: { newValue: 'idle' } },
        'session'
      );
      expect(State.read_idle()).toBe('idle');
    });

    test('same-value onChanged does not change cache', () => {
      global._fireStorageChanged(
        { blsi_automate_idle: { newValue: { status: 'active', ignore_tabs: [], ignore_sites: [] } } },
        'session'
      );
      expect(State.read_idle()).toBe('active');
    });

    test('updates tab_switch cache on cross-context write (new shape)', () => {
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { status: { '5': 'fired' }, ignore_tabs: [], ignore_sites: [] } } },
        'session'
      );
      expect(State.read_tab_switch(5)).toBe('fired');
    });

    test('updates tab_switch cache on cross-context write (legacy flat map)', () => {
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '5': 'fired' } } },
        'session'
      );
      expect(State.read_tab_switch(5)).toBe('fired');
    });

    test('non-object newValue for tab_switch resets to empty map', () => {
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { status: { '5': 'fired' }, ignore_tabs: [], ignore_sites: [] } } },
        'session'
      );
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: undefined } },
        'session'
      );
      expect(State.read_all_tab_switch()).toEqual({});
    });

    test('ignores non-session areas', () => {
      global._fireStorageChanged(
        { blsi_automate_idle: { newValue: 'idle' } },
        'local'
      );
      expect(State.read_idle()).toBe('active');
    });
  });

  describe('idle ignore helpers', () => {
    test('read_idle_ignore returns empty arrays by default', () => {
      expect(State.read_idle_ignore()).toEqual({ ignore_tabs: [], ignore_sites: [] });
    });

    test('add_idle_ignore_tab appends and persists', async () => {
      await State.add_idle_ignore_tab(42);
      expect(State.read_idle_ignore().ignore_tabs).toEqual([42]);
      await State.add_idle_ignore_tab(99);
      expect(State.read_idle_ignore().ignore_tabs).toEqual([42, 99]);
    });

    test('add_idle_ignore_tab is idempotent', async () => {
      await State.add_idle_ignore_tab(42);
      chrome.storage.session.set.mockClear();
      await State.add_idle_ignore_tab(42);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      expect(State.read_idle_ignore().ignore_tabs).toEqual([42]);
    });

    test('remove_idle_ignore_tab removes entry', async () => {
      await State.add_idle_ignore_tab(42);
      await State.remove_idle_ignore_tab(42);
      expect(State.read_idle_ignore().ignore_tabs).toEqual([]);
    });

    test('add_idle_ignore_site appends and persists', async () => {
      await State.add_idle_ignore_site('gmail.com');
      expect(State.read_idle_ignore().ignore_sites).toEqual(['gmail.com']);
    });

    test('add_idle_ignore_site is idempotent', async () => {
      await State.add_idle_ignore_site('gmail.com');
      chrome.storage.session.set.mockClear();
      await State.add_idle_ignore_site('gmail.com');
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('remove_idle_ignore_site removes entry', async () => {
      await State.add_idle_ignore_site('gmail.com');
      await State.remove_idle_ignore_site('gmail.com');
      expect(State.read_idle_ignore().ignore_sites).toEqual([]);
    });

    test('ignore arrays survive write_idle phase changes', async () => {
      await State.add_idle_ignore_tab(42);
      await State.add_idle_ignore_site('gmail.com');
      await State.write_idle('idle');
      expect(State.read_idle()).toBe('idle');
      expect(State.read_idle_ignore()).toEqual({ ignore_tabs: [42], ignore_sites: ['gmail.com'] });
    });

    test('invalid inputs are no-ops', async () => {
      chrome.storage.session.set.mockClear();
      await State.add_idle_ignore_tab('not-a-number');
      await State.add_idle_ignore_tab(NaN);
      await State.add_idle_ignore_site('');
      await State.add_idle_ignore_site(null);
      await State.remove_idle_ignore_tab('x');
      await State.remove_idle_ignore_site(42);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });
  });

  describe('tab_switch ignore helpers', () => {
    test('read_tab_switch_ignore returns empty arrays by default', () => {
      expect(State.read_tab_switch_ignore()).toEqual({ ignore_tabs: [], ignore_sites: [] });
    });

    test('add_tab_switch_ignore_tab appends and persists', async () => {
      await State.add_tab_switch_ignore_tab(42);
      expect(State.read_tab_switch_ignore().ignore_tabs).toEqual([42]);
    });

    test('add_tab_switch_ignore_tab is idempotent', async () => {
      await State.add_tab_switch_ignore_tab(42);
      chrome.storage.session.set.mockClear();
      await State.add_tab_switch_ignore_tab(42);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('remove_tab_switch_ignore_tab removes entry', async () => {
      await State.add_tab_switch_ignore_tab(42);
      await State.remove_tab_switch_ignore_tab(42);
      expect(State.read_tab_switch_ignore().ignore_tabs).toEqual([]);
    });

    test('add_tab_switch_ignore_site appends and persists', async () => {
      await State.add_tab_switch_ignore_site('meet.google.com');
      expect(State.read_tab_switch_ignore().ignore_sites).toEqual(['meet.google.com']);
    });

    test('remove_tab_switch_ignore_site removes entry', async () => {
      await State.add_tab_switch_ignore_site('meet.google.com');
      await State.remove_tab_switch_ignore_site('meet.google.com');
      expect(State.read_tab_switch_ignore().ignore_sites).toEqual([]);
    });

    test('ignore arrays survive write_tab_switch phase changes', async () => {
      await State.add_tab_switch_ignore_tab(42);
      await State.add_tab_switch_ignore_site('meet.google.com');
      await State.write_tab_switch(7, 'fired');
      expect(State.read_tab_switch(7)).toBe('fired');
      expect(State.read_tab_switch_ignore()).toEqual({ ignore_tabs: [42], ignore_sites: ['meet.google.com'] });
    });
  });

  describe('_reset', () => {
    test('clears caches without writing storage', async () => {
      await State.write_idle('idle');
      await State.write_tab_switch(1, 'fired');

      chrome.storage.session.set.mockClear();
      State._reset();

      expect(State.read_idle()).toBe('active');
      expect(State.read_all_tab_switch()).toEqual({});
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });
  });
});
