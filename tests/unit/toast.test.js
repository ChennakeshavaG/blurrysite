/**
 * tests/unit/toast.test.js
 *
 * Unit tests for src/toast.js. Module exposes blsi.Toast with: show, dismiss,
 * clearIfTransient.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TOAST_PATH = path.resolve(__dirname, '../../src/toast.js');

function loadToast() {
  if (blsi.Toast) return;
  if (!fs.existsSync(TOAST_PATH)) {
    throw new Error('toast.js not found — required for these tests');
  }
  require(TOAST_PATH);
}

describe('blsi.Toast', () => {
  beforeAll(() => loadToast());

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.querySelectorAll('.bl-si-toast').forEach((el) => el.remove());
  });

  describe('show', () => {
    test('appends a .bl-si-toast to document.body with a11y attrs', () => {
      blsi.Toast.show('hello');
      const el = document.querySelector('.bl-si-toast');
      expect(el).not.toBeNull();
      expect(el.getAttribute('role')).toBe('status');
      expect(el.getAttribute('aria-live')).toBe('polite');
    });

    test('renders message text into .bl-si-toast__message', () => {
      blsi.Toast.show('the message');
      const msg = document.querySelector('.bl-si-toast__message');
      expect(msg.textContent).toBe('the message');
    });

    test('renders close button with aria-label fallback Dismiss', () => {
      blsi.Toast.show('msg');
      const close = document.querySelector('.bl-si-toast__close');
      expect(close).not.toBeNull();
      expect(close.getAttribute('aria-label')).toBeTruthy();
    });

    test('default duration auto-dismisses after 15000ms', () => {
      blsi.Toast.show('msg');
      expect(document.querySelector('.bl-si-toast')).not.toBeNull();
      jest.advanceTimersByTime(15000);
      jest.advanceTimersByTime(260); // exit animation
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('custom duration honored', () => {
      blsi.Toast.show('msg', 3000);
      jest.advanceTimersByTime(3000);
      jest.advanceTimersByTime(260);
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('actions row appended when actions array non-empty', () => {
      blsi.Toast.show('msg', 5000, [
        { label: 'A', onClick: () => {} },
        { label: 'B', onClick: () => {}, variant: 'warn' },
      ]);
      const buttons = document.querySelectorAll('.bl-si-toast__action');
      expect(buttons.length).toBe(2);
      expect(buttons[1].classList.contains('bl-si-toast__action--warn')).toBe(true);
    });

    test('actions with missing label or non-function onClick are skipped', () => {
      blsi.Toast.show('msg', 5000, [
        { label: '', onClick: () => {} },
        { label: 'good', onClick: 'not a function' },
        { label: 'kept', onClick: () => {} },
      ]);
      const buttons = document.querySelectorAll('.bl-si-toast__action');
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toBe('kept');
    });

    test('clicking an action dismisses then invokes onClick', () => {
      const cb = jest.fn();
      blsi.Toast.show('msg', 5000, [{ label: 'X', onClick: cb }]);
      const btn = document.querySelector('.bl-si-toast__action');
      btn.click();
      expect(cb).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(260);
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('persistent flag skips auto-dismiss', () => {
      blsi.Toast.show('persistent', 1000, undefined, { persistent: true });
      jest.advanceTimersByTime(60000);
      expect(document.querySelector('.bl-si-toast')).not.toBeNull();
    });

    test('persistent toast blocks replacement by non-persistent show', () => {
      blsi.Toast.show('first', 1000, undefined, { persistent: true });
      const result = blsi.Toast.show('second', 1000);
      expect(result).toBeUndefined();
      const msg = document.querySelector('.bl-si-toast__message');
      expect(msg.textContent).toBe('first');
    });

    test('override:true forces replacement of an existing persistent toast', () => {
      blsi.Toast.show('idle persistent', undefined, undefined, { persistent: true });
      // Higher-priority caller (e.g. screen-share) overrides:
      blsi.Toast.show('ss persistent', undefined, undefined, { persistent: true, override: true });
      const els = document.querySelectorAll('.bl-si-toast');
      expect(els.length).toBe(1);
      expect(els[0].querySelector('.bl-si-toast__message').textContent).toBe('ss persistent');
    });

    test('override:true also replaces a non-persistent live toast (no-op vs default)', () => {
      blsi.Toast.show('first', 5000);
      blsi.Toast.show('second', 5000, undefined, { override: true });
      const els = document.querySelectorAll('.bl-si-toast');
      expect(els.length).toBe(1);
      expect(els[0].querySelector('.bl-si-toast__message').textContent).toBe('second');
    });

    test('non-persistent show replaces existing non-persistent toast synchronously', () => {
      blsi.Toast.show('first', 5000);
      blsi.Toast.show('second', 5000);
      const els = document.querySelectorAll('.bl-si-toast');
      expect(els.length).toBe(1);
      expect(els[0].querySelector('.bl-si-toast__message').textContent).toBe('second');
    });
  });

  describe('dismiss', () => {
    test('dismisses persistent toast', () => {
      blsi.Toast.show('persistent', 1000, undefined, { persistent: true });
      blsi.Toast.dismiss();
      jest.advanceTimersByTime(260);
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('no-op when nothing showing', () => {
      expect(() => blsi.Toast.dismiss()).not.toThrow();
    });
  });

  describe('clearIfTransient', () => {
    test('removes non-persistent toast synchronously (no exit animation needed)', () => {
      blsi.Toast.show('temp', 5000);
      blsi.Toast.clearIfTransient();
      expect(document.querySelector('.bl-si-toast')).toBeNull();
    });

    test('leaves persistent toast in place', () => {
      blsi.Toast.show('persistent', 1000, undefined, { persistent: true });
      blsi.Toast.clearIfTransient();
      expect(document.querySelector('.bl-si-toast')).not.toBeNull();
    });
  });
});
