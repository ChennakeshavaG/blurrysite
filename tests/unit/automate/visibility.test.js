/**
 * tests/unit/automate/visibility.test.js
 *
 * Unit tests for src/automate/visibility.js
 * Module exposes blsi.Automate.Visibility with:
 *   init, destroy, getCurrentPhase
 */

'use strict';

const path = require('path');
const STATE_PATH = path.resolve(__dirname, '../../../src/automate/state.js');
const MODULE_PATH = path.resolve(__dirname, '../../../src/automate/visibility.js');

function freshLoad() {
  delete globalThis.blsi.Automate;
  jest.resetModules();
  require(STATE_PATH);
  require(MODULE_PATH);
  blsi.Automate.State._reset();
}

function setVisibility(value) {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true,
  });
}

function setHasFocus(returns) {
  Object.defineProperty(document, 'hasFocus', {
    value: () => returns,
    configurable: true,
    writable: true,
  });
}

const KEY = 'blsi_automate_tab_switch_by_tab';

// USER IMPACT: per-tab visibility state writes to the shared map → resolve()
// reads it → blur engages on the tab the user has switched away from.
describe('automate/visibility.js', () => {
  beforeEach(() => {
    setVisibility('visible');
    setHasFocus(true);
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.Visibility.destroy(); } catch (_) {}
  });

  describe('init', () => {
    test('does not write when tab is visible + focused (absence = armed)', () => {
      setVisibility('visible');
      setHasFocus(true);
      blsi.Automate.Visibility.init({ tab_id: 7 });
      // D4: armed is absence — no storage write on a quiet init.
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('armed');
    });

    test('seeds fired phase when tab is hidden on init', () => {
      setVisibility('hidden');
      setHasFocus(true);
      blsi.Automate.Visibility.init({ tab_id: 7 });
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: { '7': 'fired' } });
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('fired');
    });

    test('init without numeric tab_id is a no-op', () => {
      blsi.Automate.Visibility.init({});
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      blsi.Automate.Visibility.init();
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      blsi.Automate.Visibility.init({ tab_id: '7' });
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('re-init with same tab_id is idempotent (no double-write)', () => {
      setVisibility('hidden');
      blsi.Automate.Visibility.init({ tab_id: 7 });
      const beforeCount = chrome.storage.session.set.mock.calls.length;
      blsi.Automate.Visibility.init({ tab_id: 7 });
      expect(chrome.storage.session.set.mock.calls.length).toBe(beforeCount);
    });

    test('re-init with different tab_id destroys prior + re-binds', () => {
      setVisibility('hidden'); // tab 7 starts hidden → writes fired
      blsi.Automate.Visibility.init({ tab_id: 7 });
      expect(chrome.storage.session.set.mock.calls.at(-1)[0]).toEqual({ [KEY]: { '7': 'fired' } });

      setVisibility('visible'); // tab 8 will be armed
      blsi.Automate.Visibility.init({ tab_id: 8 });
      // destroy(7) strips the entry; init(8) is armed = absence → no extra write.
      expect(chrome.storage.session.set.mock.calls.at(-1)[0]).toEqual({ [KEY]: {} });
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('armed');
    });
  });

  describe('phase derivation', () => {
    test('visibilitychange to hidden writes fired', async () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      chrome.storage.session.set.mockClear();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: { '7': 'fired' } });
    });

    test('window.blur writes fired', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      chrome.storage.session.set.mockClear();
      setHasFocus(false);
      window.dispatchEvent(new Event('blur'));
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: { '7': 'fired' } });
    });

    test('window.focus after blur strips the fired entry (back to armed=absent)', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      // blur → fired
      setHasFocus(false);
      window.dispatchEvent(new Event('blur'));
      chrome.storage.session.set.mockClear();
      // focus returns → armed === absence; entry stripped, payload becomes {}.
      setHasFocus(true);
      window.dispatchEvent(new Event('focus'));
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: {} });
    });

    test('same-phase events are absorbed (no extra storage write)', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      chrome.storage.session.set.mockClear();
      // Already armed; firing focus again must not write
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('hidden + focused still derives fired (visibility wins)', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      chrome.storage.session.set.mockClear();
      setVisibility('hidden');
      setHasFocus(true);
      document.dispatchEvent(new Event('visibilitychange'));
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: { '7': 'fired' } });
    });
  });

  describe('destroy', () => {
    test("clears a fired tab's entry from the map", () => {
      setVisibility('hidden'); // forces fired so the entry exists
      blsi.Automate.Visibility.init({ tab_id: 7 });
      chrome.storage.session.set.mockClear();
      blsi.Automate.Visibility.destroy();
      // After destroy: 'off' strips the entry, payload becomes empty map.
      const last = chrome.storage.session.set.mock.calls.at(-1);
      expect(last[0]).toEqual({ [KEY]: {} });
    });

    test('destroy on an armed (absent) tab does not write', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 }); // armed — no write
      chrome.storage.session.set.mockClear();
      blsi.Automate.Visibility.destroy();
      // No entry present → write_tab_switch('off') is a no-op.
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('removes listeners — events after destroy do not write', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      blsi.Automate.Visibility.destroy();
      chrome.storage.session.set.mockClear();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('getCurrentPhase resets to armed default after destroy', () => {
      setVisibility('hidden');
      blsi.Automate.Visibility.init({ tab_id: 7 });
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('fired');
      blsi.Automate.Visibility.destroy();
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('armed');
    });
  });

  describe('getCurrentPhase', () => {
    test('reflects the most recent derivation', () => {
      blsi.Automate.Visibility.init({ tab_id: 7 });
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('armed');
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(blsi.Automate.Visibility.getCurrentPhase()).toBe('fired');
    });
  });
});
