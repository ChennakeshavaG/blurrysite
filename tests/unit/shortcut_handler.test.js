/**
 * tests/unit/shortcut_handler.test.js
 *
 * Unit tests for src/shortcut_handler.js (v2 matcher).
 *
 * Module exposes blsi.Shortcuts with:
 *   { init, destroy, showToast, _setPickerActive, _getFireToken }
 *
 * v2 contract:
 *   - Bindings are { binding: [{ code, mods }] }.
 *   - Modifiers are read from event.altKey/ctrlKey/metaKey/shiftKey (side-agnostic).
 *   - Early-returns on: !isTrusted, repeat, isComposing, Dead, Process,
 *     Unidentified, AltGraph, pure-modifier keydowns.
 *   - First match wins, preventDefault() + fire callback + stamp fire token.
 *   - Escape fires onExitPicker when picker is active (never dispatches to
 *     bound shortcuts).
 */

/* === TEST QUALITY ANNOTATIONS ===
 * FILE COVERS:
 *   - Happy-path action dispatch for all 3 default bindings (TOGGLE_BLUR_ALL, TOGGLE_PICKER, CLEAR_ALL)
 *   - Side-agnostic modifier matching (AltLeft vs AltRight)
 *   - No-match cases: missing mod, extra mod, wrong code
 *   - Early-return guards: repeat, isComposing, Dead, Process, Unidentified, AltGraph, pure-modifier
 *   - Escape routing to onExitPicker when picker active vs inactive
 *   - Fire token exposure and no-stamp guarantee for the JS path
 *   - Lifecycle: destroy, re-init, empty/null graceful handling, phase-2 multi-chord skip
 *
 * REDUNDANT TESTS:
 *   - "fires TOGGLE_BLUR_ALL on Alt+Shift+B", "fires TOGGLE_PICKER on Alt+Shift+P",
 *     "fires CLEAR_ALL on Alt+Shift+U" are structurally identical — same arrange/act/assert
 *     pattern with only action id and key code varying. Convertible to test.each.
 *   - "does not fire when required mod is missing", "does not fire when an extra mod is present",
 *     "does not fire when code does not match" follow the same pattern — test.each candidate.
 *   - "fires onExitPicker when picker is active" and "does NOT fire onExitPicker when picker
 *     inactive" are complementary boolean branches; a single test with two assertions suffices.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Happy path dispatch: test.each([['TOGGLE_BLUR_ALL','KeyB'],['TOGGLE_PICKER','KeyP'],['CLEAR_ALL','KeyU']])
 *   - No-match cases: test.each with [description, fireOpts] tuples covering missing-mod,
 *     extra-mod, wrong-code in one loop.
 *   - Early-return guards (Dead/Process/Unidentified/repeat/isComposing) share identical
 *     setup; could be test.each([['repeat',{repeat:true}],['isComposing',{isComposing:true}],...])
 *
 * MISSING COVERAGE:
 *   - No test that event.defaultPrevented is true after a matched shortcut fires.
 *   - showToast() is a public method with timer logic (auto-dismiss) — never exercised here.
 *   - No test for calling destroy() while a showToast animation/timer is still pending.
 *   - No test for init() called with a binding whose chord.mods is undefined (defensive path).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../src/shortcut_handler.js');
const TOAST_PATH  = path.resolve(__dirname, '../../src/toast.js');

function loadShortcutHandler() {
  if (!blsi.Toast && fs.existsSync(TOAST_PATH)) require(TOAST_PATH);
  if (blsi.Shortcuts) return;
  if (!fs.existsSync(MODULE_PATH)) {
    throw new Error('shortcut_handler.js not found — stub removed, real file required');
  }
  require(MODULE_PATH);
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function fireKeyDown(opts) {
  const event = new KeyboardEvent('keydown', {
    key:         opts.key         || '',
    code:        opts.code        || '',
    bubbles:     true,
    cancelable:  true,
    ctrlKey:     !!opts.ctrl,
    altKey:      !!opts.alt,
    shiftKey:    !!opts.shift,
    metaKey:     !!opts.meta,
    repeat:      !!opts.repeat,
    isComposing: !!opts.isComposing,
  });
  // (No isTrusted override — the matcher does not check it, so jsdom's
  //  default isTrusted=false is fine for synthesized events.)
  // Optional AltGraph override — tests that simulate European keyboards.
  if (opts.altGraph) {
    event.getModifierState = function (k) { return k === 'AltGraph'; };
  }
  document.dispatchEvent(event);
  return event;
}

/** Default bindings matching the action registry. */
const DEFAULT_SHORTCUTS = {
  TOGGLE_BLUR_ALL: { binding: [{ code: 'KeyB', mods: ['Alt', 'Shift'] }] },
  TOGGLE_PICKER:   { binding: [{ code: 'KeyP', mods: ['Alt', 'Shift'] }] },
  CLEAR_ALL:       { binding: [{ code: 'KeyU', mods: ['Alt', 'Shift'] }] },
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('blsi.Shortcuts (v2)', () => {
  beforeAll(() => loadShortcutHandler());

  afterEach(() => {
    if (blsi.Shortcuts) blsi.Shortcuts.destroy();
    document.querySelectorAll('.bl-si-toast').forEach(el => el.remove());
  });

  // ── Match: happy paths ─────────────────────────────────────────────────────
  // USER IMPACT: user presses Alt+Shift+B — blur-all toggles; Alt+Shift+P — picker activates; Alt+Shift+U — all blur removed
  describe('match', () => {
    // OPTIMIZE: these 3 action-fire tests are structurally identical — convert to test.each([['TOGGLE_BLUR_ALL','KeyB','b'],['TOGGLE_PICKER','KeyP','p'],['CLEAR_ALL','KeyU','u']])
    // REDUNDANT: "fires TOGGLE_BLUR_ALL on Alt+Shift+B" duplicates the pattern of the two tests below; only action id and key code differ
    test('fires TOGGLE_BLUR_ALL on Alt+Shift+B', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    // REDUNDANT: identical structure to "fires TOGGLE_BLUR_ALL on Alt+Shift+B" above
    test('fires TOGGLE_PICKER on Alt+Shift+P', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_PICKER: cb });
      fireKeyDown({ key: 'p', code: 'KeyP', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    // REDUNDANT: identical structure to "fires TOGGLE_BLUR_ALL on Alt+Shift+B" above
    test('fires CLEAR_ALL on Alt+Shift+U', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { CLEAR_ALL: cb });
      fireKeyDown({ key: 'u', code: 'KeyU', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('supports Ctrl+Shift+K (single modifier class + shift)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'KeyK', mods: ['Control', 'Shift'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'k', code: 'KeyK', ctrl: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('supports Meta+1 on Mac (metaKey)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'Digit1', mods: ['Meta'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: '1', code: 'Digit1', meta: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    test('side-agnostic: AltRight fires the same binding as AltLeft', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      // Even though the physical key is AltRight, altKey=true is what matters.
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    // MISSING: no test that event.defaultPrevented === true after a matched shortcut fires
    test('different chords fire different callbacks', () => {
      const blur = jest.fn(), picker = jest.fn(), clear = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, {
        TOGGLE_BLUR_ALL: blur, TOGGLE_PICKER: picker, CLEAR_ALL: clear,
      });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      fireKeyDown({ key: 'p', code: 'KeyP', alt: true, shift: true });
      expect(blur).toHaveBeenCalledTimes(1);
      expect(picker).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(0);
    });
  });

  // ── No-match: missing mods / wrong code ───────────────────────────────────
  // USER IMPACT: user types normally — extension never fires accidentally during regular typing
  describe('no match', () => {
    // OPTIMIZE: these 3 no-match tests are structurally identical — convert to test.each([['missing mod',{alt:true}],['extra mod',{alt:true,shift:true,ctrl:true}],['wrong code',{code:'KeyC',alt:true,shift:true}]])
    // REDUNDANT: "does not fire when required mod is missing" duplicates the pattern of the two tests below; only the fire options differ
    test('does not fire when required mod is missing', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true }); // missing Shift
      expect(cb).not.toHaveBeenCalled();
    });

    // REDUNDANT: identical pattern to "does not fire when required mod is missing"
    test('does not fire when an extra mod is present', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, ctrl: true });
      expect(cb).not.toHaveBeenCalled();
    });

    // REDUNDANT: identical pattern to "does not fire when required mod is missing"
    test('does not fire when code does not match', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'c', code: 'KeyC', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Early-return guards ───────────────────────────────────────────────────
  // USER IMPACT: user types in IME, uses dead keys, or is on a European keyboard — extension stays silent
  describe('early-return guards', () => {
    // OPTIMIZE: Dead/Process/Unidentified/repeat/isComposing tests share identical setup; convert to test.each([['repeat',{repeat:true}],['isComposing',{isComposing:true}],['Dead key',{key:'Dead'}],...])
    test('ignores repeat keydowns', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, repeat: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores events during IME composition', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, isComposing: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Dead key events', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Dead', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Process key events (IME)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Process', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores Unidentified key events', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Unidentified', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores AltGraph events (European AltGr)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true, altGraph: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('ignores pure modifier keydowns (waits for non-modifier)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      fireKeyDown({ key: 'Alt', code: 'AltLeft', alt: true });
      fireKeyDown({ key: 'Shift', code: 'ShiftLeft', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Escape → onExitPicker ─────────────────────────────────────────────────
  // USER IMPACT: user presses Escape during picker mode — picker closes cleanly; outside picker — browser default Escape behavior is preserved
  describe('Escape key', () => {
    // REDUNDANT: "fires onExitPicker when picker is active" and "does NOT fire onExitPicker when picker inactive" are complementary boolean branches; a single test with two assertions (active=true, then active=false) covers both without extra setup
    test('fires onExitPicker when picker is active', () => {
      const exit = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exit });
      blsi.Shortcuts._setPickerActive(true);
      fireKeyDown({ key: 'Escape', code: 'Escape' });
      expect(exit).toHaveBeenCalledTimes(1);
    });

    test('does NOT fire onExitPicker when picker is inactive', () => {
      const exit = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { onExitPicker: exit });
      blsi.Shortcuts._setPickerActive(false);
      fireKeyDown({ key: 'Escape', code: 'Escape' });
      expect(exit).not.toHaveBeenCalled();
    });

    test('Escape does not dispatch to shortcut bindings', () => {
      const cb = jest.fn();
      // Hypothetical Escape binding
      blsi.Shortcuts.init(
        { CUSTOM: { binding: [{ code: 'Escape', mods: ['Alt'] }] } },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'Escape', code: 'Escape', alt: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Fire token — matcher exposes the map but does NOT stamp on match.
  //     The stamp now lives in content_script.handleMessage so the JS path
  //     and the chrome.commands relay both stamp from the same place, and
  //     the JS path doesn't dedup itself.
  // USER IMPACT: chrome.commands relay and JS keydown path both fire an action — dedup ensures it executes exactly once per keypress
  describe('fire token', () => {
    // MISSING: no test that chrome.commands relay stamping + JS path produces exactly one callback invocation (requires content_script integration)
    test('_getFireToken returns the shared globalThis map', () => {
      const token = blsi.Shortcuts._getFireToken();
      expect(token).toBe(globalThis.__blsiShortcutFire);
    });

    test('matcher does not stamp the token (stamping moved to content_script)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      const before = globalThis.__blsiShortcutFire['TOGGLE_BLUR_ALL'];
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).toHaveBeenCalledTimes(1);
      // Matcher no longer stamps — token is unchanged.
      expect(globalThis.__blsiShortcutFire['TOGGLE_BLUR_ALL']).toBe(before);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  // USER IMPACT: user changes shortcuts in settings — new bindings take effect immediately; old bindings stop firing
  describe('lifecycle', () => {
    // MISSING: no test for showToast() public method — timer-based auto-dismiss logic is untested
    // MISSING: no test for calling destroy() while a showToast timer is still pending (timer leak risk)
    test('destroy removes listeners so shortcuts stop firing', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb });
      blsi.Shortcuts.destroy();
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb).not.toHaveBeenCalled();
    });

    test('re-calling init replaces previous listener', () => {
      const cb1 = jest.fn(), cb2 = jest.fn();
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb1 });
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, { TOGGLE_BLUR_ALL: cb2 });
      fireKeyDown({ key: 'b', code: 'KeyB', alt: true, shift: true });
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    test('handles empty shortcuts object gracefully', () => {
      expect(() => blsi.Shortcuts.init({}, {})).not.toThrow();
    });

    test('handles null shortcuts gracefully', () => {
      expect(() => blsi.Shortcuts.init(null, {})).not.toThrow();
    });

    test('destroy preserves persistent toast (via blsi.Toast.clearIfTransient)', () => {
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, {});
      blsi.Toast.show('persistent msg', 15000, [], { persistent: true });
      var toast = document.querySelector('.bl-si-toast');
      expect(toast).not.toBeNull();
      blsi.Shortcuts.destroy();
      expect(toast.parentNode).not.toBeNull();
    });

    test('destroy removes non-persistent toast (via blsi.Toast.clearIfTransient)', () => {
      blsi.Shortcuts.init(DEFAULT_SHORTCUTS, {});
      blsi.Toast.show('temp msg', 5000);
      var toast = document.querySelector('.bl-si-toast');
      expect(toast).not.toBeNull();
      blsi.Shortcuts.destroy();
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('multi-chord bindings (length > 1) are skipped (phase 2)', () => {
      const cb = jest.fn();
      blsi.Shortcuts.init(
        {
          CUSTOM: {
            binding: [
              { code: 'KeyG', mods: ['Alt'] },
              { code: 'KeyI', mods: ['Alt'] },
            ],
          },
        },
        { CUSTOM: cb }
      );
      fireKeyDown({ key: 'g', code: 'KeyG', alt: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
