/**
 * tests/unit/automate/manager.test.js
 *
 * Unit tests for src/automate/manager.js
 * Module exposes blsi.Automate.Manager with: init, destroy, on_url_change,
 * _evaluate, _isActive.
 */

'use strict';

const path = require('path');

const STATE_PATH    = path.resolve(__dirname, '../../../src/automate/state.js');
const OVERLAY_PATH  = path.resolve(__dirname, '../../../src/automate/overlay.js');
const STORAGE_PATH  = path.resolve(__dirname, '../../../src/storage_model.js');
const URL_MATCHER   = path.resolve(__dirname, '../../../src/url_matcher.js');
const MODULE_PATH   = path.resolve(__dirname, '../../../src/automate/manager.js');

function freshLoad() {
  delete globalThis.blsi.Automate;
  delete globalThis.blsi.Model;
  jest.resetModules();
  // Constants must reload too — Model expects them on globalThis.blsi.
  // (setup.js loads constants once; ensure model + state see them.)
  if (!globalThis.blsi.DEFAULT_MODEL) {
    require(path.resolve(__dirname, '../../../src/constants.js'));
  }
  require(URL_MATCHER);
  require(STATE_PATH);
  require(OVERLAY_PATH);
  require(STORAGE_PATH);
  require(MODULE_PATH);
}

function setMockedModel(m) {
  chrome.storage.local.get.mockImplementation((_keys, cb) => {
    if (cb) cb({ blsi_model: m });
  });
  chrome.storage.session.get.mockImplementation((_keys, cb) => {
    if (cb) cb({});
  });
  chrome.storage.local.set.mockImplementation((_payload, cb) => { if (cb) cb(); });
  chrome.storage.session.set.mockImplementation((_payload, cb) => { if (cb) cb(); });
}

function getOverlayEl() {
  return document.getElementById('bl-si-automate-overlay');
}

// USER IMPACT: automate Manager flips the privacy curtain on/off in lock-step
// with idle / tab_switch / screen_share state — independently of the engine.
describe('automate/manager.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    setMockedModel(null);  // forces default model
    freshLoad();
  });

  afterEach(() => {
    try { blsi.Automate.Manager.destroy(); } catch (_) {}
    try { blsi.Automate.State._reset(); } catch (_) {}
  });

  describe('init / destroy', () => {
    test('init without get_host_url is a no-op', async () => {
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({ tab_id: 1 });
      expect(blsi.Automate.Manager._isActive()).toBe(false);
      expect(getOverlayEl()).toBeNull();
    });

    test('init wires the storage subscriber', async () => {
      await blsi.Model.init_cache();
      const get_host_url = () => ({ host: 'example.com', url: 'https://example.com/' });
      blsi.Automate.Manager.init({ tab_id: 1, get_host_url });
      // Default model — no automate triggers active. Overlay stays hidden.
      expect(getOverlayEl()).toBeNull();
    });

    test('destroy hides Overlay + idempotent on uninit', async () => {
      await blsi.Model.init_cache();
      blsi.Automate.Manager.destroy(); // before init
      blsi.Automate.Manager.init({
        tab_id: 1,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      blsi.Automate.Manager.destroy();
      expect(getOverlayEl()).toBeNull();
      // Subsequent storage events should not flip Overlay back on.
      blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: 'idle' } }, 'session');
      expect(getOverlayEl()).toBeNull();
    });

    test('init twice rebinds cleanly', async () => {
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 1,
        get_host_url: () => ({ host: 'a.com', url: 'https://a.com/' }),
      });
      blsi.Automate.Manager.init({
        tab_id: 2,
        get_host_url: () => ({ host: 'b.com', url: 'https://b.com/' }),
      });
      expect(blsi.Automate.Manager._isActive()).toBe(false);
    });
  });

  describe('Overlay control', () => {
    test('shows Overlay when automate_blur_active becomes true', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      // Tab switched away → write_tab_switch fires → Manager re-evaluates
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '7': 'fired' } } },
        'session'
      );
      expect(getOverlayEl()).not.toBeNull();
      expect(blsi.Automate.Manager._isActive()).toBe(true);
    });

    test('hides Overlay when automate_blur_active flips to false', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '7': 'fired' } } },
        'session'
      );
      expect(getOverlayEl()).not.toBeNull();
      // Tab focus regained
      await blsi.Automate.State.write_tab_switch(7, 'off');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: {} } },
        'session'
      );
      expect(getOverlayEl()).toBeNull();
      expect(blsi.Automate.Manager._isActive()).toBe(false);
    });

    test('master switch off keeps Overlay hidden even with automate firing', async () => {
      const m = blsi.build_default_model();
      m.global_default_settings.enabled = false;
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '7': 'fired' } } },
        'session'
      );
      expect(getOverlayEl()).toBeNull();
    });

    test('idle phase change fires Manager re-evaluation', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged(
        { blsi_automate_idle: { newValue: 'idle' } },
        'session'
      );
      expect(getOverlayEl()).not.toBeNull();
    });
  });

  describe('on_url_change', () => {
    test('re-evaluates after URL changes (path-rule activation)', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;  // global ON
      // Wildcard rule that disables tab_switch under /admin/* path
      m.site_rules = [{
        hostname_value: 'example.com/admin/*',
        hostname_type:  'wildcard',
        blur_all:       null,
        items:          [],
        snapshot:       { automate: { settings: { tab_switch: { enabled: false } } } },
      }];
      setMockedModel(m);
      await blsi.Model.init_cache();

      let url = 'https://example.com/dashboard';
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url }),
      });
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '7': 'fired' } } },
        'session'
      );
      expect(getOverlayEl()).not.toBeNull();  // dashboard path: rule does not match → tab_switch enabled

      // SPA navigation — content_script notifies Manager
      url = 'https://example.com/admin/users';
      blsi.Automate.Manager.on_url_change('example.com', url);
      expect(getOverlayEl()).toBeNull();  // /admin/* path: rule disables tab_switch
    });

    test('on_url_change before init is a no-op', () => {
      blsi.Automate.Manager.on_url_change('example.com', 'https://example.com/');
      expect(getOverlayEl()).toBeNull();
    });
  });

  describe('transition toasts', () => {
    let toastSpy;
    beforeEach(() => {
      toastSpy = jest.fn();
      blsi.Toast = { show: toastSpy, dismiss: jest.fn(), clearIfTransient: jest.fn() };
    });

    test('seeds tracking on init without firing toasts', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      // Tab is already in a fired state at boot (rare but possible).
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      // First _evaluate seeded tracking; no toast fires for state that already existed.
      expect(toastSpy).not.toHaveBeenCalled();
    });

    test('fires idle toast on transition to idle phase', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      // User goes idle.
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: 'idle' } }, 'session');
      // Manager fires the idle toast.
      expect(toastSpy).toHaveBeenCalled();
    });

    test('fires tab_switch toast on transition to fired phase', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { '7': 'fired' } } },
        'session'
      );
      expect(toastSpy).toHaveBeenCalled();
    });

    test('idle toast fires independently when manual blur already on', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      m.blur_all.status = true;  // manual blur on — automate is independent
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: 'idle' } }, 'session');
      // Manual blur and automate are independent — idle toast still fires.
      expect(toastSpy).toHaveBeenCalled();
    });

    test('master switch off suppresses all toasts', async () => {
      const m = blsi.build_default_model();
      m.global_default_settings.enabled = false;
      m.automate.settings.idle.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: 'idle' } }, 'session');
      expect(toastSpy).not.toHaveBeenCalled();
    });

    test('idle toast is persistent info-only (no actions, no duration)', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: { status: 'idle', ignore_tabs: [], ignore_sites: [] } } }, 'session');
      expect(toastSpy).toHaveBeenCalled();
      const lastCall = toastSpy.mock.calls.at(-1);
      // Persistent: no auto-dismiss timer, no actions row.
      expect(lastCall[1]).toBeUndefined();
      expect(lastCall[2]).toBeUndefined();
      expect(lastCall[3]).toEqual({ persistent: true });
    });

    test('tab_switch toast is short 3s info notification (no actions)', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.tab_switch.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      await blsi.Automate.State.write_tab_switch(7, 'fired');
      global._fireStorageChanged(
        { blsi_automate_tab_switch_by_tab: { newValue: { status: { '7': 'fired' }, ignore_tabs: [], ignore_sites: [] } } },
        'session'
      );
      expect(toastSpy).toHaveBeenCalled();
      const lastCall = toastSpy.mock.calls.at(-1);
      expect(lastCall[1]).toBe(3000);
      // No actions, no opts.
      expect(lastCall[2]).toBeUndefined();
      expect(lastCall[3]).toBeUndefined();
    });

    test('idle toast honors blsi.idle_toast_duration_seconds when > 0', async () => {
      // Save and override the constant for this test.
      const originalDur = blsi.idle_toast_duration_seconds;
      // jsdom doesn't allow direct re-assignment to frozen modules; the
      // constants module exposes the value as a regular property on blsi.
      Object.defineProperty(blsi, 'idle_toast_duration_seconds', { value: 5, configurable: true });

      try {
        const m = blsi.build_default_model();
        m.automate.settings.idle.enabled = true;
        setMockedModel(m);
        await blsi.Model.init_cache();
        blsi.Automate.Manager.init({
          tab_id: 7,
          get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
        });
        await blsi.Automate.State.write_idle('idle');
        global._fireStorageChanged({ blsi_automate_idle: { newValue: { status: 'idle', ignore_tabs: [], ignore_sites: [] } } }, 'session');
        expect(toastSpy).toHaveBeenCalled();
        const lastCall = toastSpy.mock.calls.at(-1);
        // Transient: duration in ms, no actions, no opts.
        expect(lastCall[1]).toBe(5000);
        expect(lastCall[2]).toBeUndefined();
        expect(lastCall[3]).toBeUndefined();
      } finally {
        Object.defineProperty(blsi, 'idle_toast_duration_seconds', { value: originalDur, configurable: true });
      }
    });

    test('idle toast skipped while screen-share is active (priority gate)', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      m.automate.settings.screen_share.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      // Seed an active screen-share record from another tab.
      await blsi.Automate.State.set_screen_share_active(99);
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      // First _evaluate seeds tracking. Reset spy so we only count post-seed fires.
      toastSpy.mockClear();
      // Idle fires while ss is already up.
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: { status: 'idle', ignore_tabs: [], ignore_sites: [] } } }, 'session');
      // No idle toast should fire — ss has priority.
      const idleMessage = chrome.i18n.getMessage('automate_toast_idle');
      const fired = toastSpy.mock.calls.some(c => c[0] === idleMessage);
      expect(fired).toBe(false);
    });

    test('idle persistent toast auto-dismisses on falling edge (idle → active)', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.idle.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      // Rising edge: idle fires.
      await blsi.Automate.State.write_idle('idle');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: { status: 'idle', ignore_tabs: [], ignore_sites: [] } } }, 'session');
      expect(toastSpy).toHaveBeenCalled();
      // Falling edge: user becomes active again.
      await blsi.Automate.State.write_idle('active');
      global._fireStorageChanged({ blsi_automate_idle: { newValue: { status: 'active', ignore_tabs: [], ignore_sites: [] } } }, 'session');
      expect(blsi.Toast.dismiss).toHaveBeenCalled();
    });

    test('master switch off mid-share dismisses persistent screen-share toast', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.screen_share.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
        ss_stop_actions: () => Promise.resolve([]),
      });

      // 1. Screen share starts → persistent toast fires + Manager seeds
      //    `_last_ss_blurring = true`.
      const ssRecord = { active: true, sharing_tab_id: 99, started_at: 1000, suppressed_sites: [] };
      global._fireStorageChanged({ blsi_screen_share: { newValue: ssRecord } }, 'session');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(toastSpy).toHaveBeenCalled();
      expect(blsi.Toast.dismiss).not.toHaveBeenCalled();

      // 2. User flips global enabled off mid-share. Manager re-evaluates via
      //    Model.on_automate_change with master_off=true. The persistent toast
      //    must be dismissed — _fire_toasts is unreachable on this path.
      const m2 = blsi.build_default_model();
      m2.global_default_settings.enabled = false;
      m2.automate.settings.screen_share.enabled = true;
      setMockedModel(m2);
      global._fireStorageChanged({ blsi_model: { newValue: m2 } }, 'local');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(blsi.Toast.dismiss).toHaveBeenCalled();
    });

    test('ss_stop_actions invoked on screen-share toast', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.screen_share.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      const ssActions = jest.fn(() => Promise.resolve([
        { label: 'Stop for tab', onClick: () => {} },
      ]));
      blsi.Automate.Manager.init({
        tab_id: 7,
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
        ss_stop_actions: ssActions,
      });
      // Simulate a screen-share start: write the session record + onChanged.
      const ssRecord = { active: true, sharing_tab_id: 99, started_at: 1000, suppressed_sites: [] };
      global._fireStorageChanged({ blsi_screen_share: { newValue: ssRecord } }, 'session');
      // Allow the Promise.resolve in _fire_toasts to settle.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ssActions).toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalled();
    });
  });

  describe('init bootstrap evaluation', () => {
    test('init evaluates immediately so a tab opened mid-share paints correctly', async () => {
      const m = blsi.build_default_model();
      m.automate.settings.screen_share.enabled = true;
      setMockedModel(m);
      await blsi.Model.init_cache();
      // Seed screen-share as active via State API (simulates background
      // having written the record before this tab opened).
      await blsi.Automate.State.set_screen_share_active(99);
      blsi.Automate.Manager.init({
        tab_id: 7,                 // not the sharing tab
        get_host_url: () => ({ host: 'example.com', url: 'https://example.com/' }),
      });
      expect(getOverlayEl()).not.toBeNull();
    });
  });
});
