/**
 * toast.js — In-page toast surface.
 *
 * Renders the floating `.bl-si-toast` element used by shortcuts, automate
 * triggers, the picker, and the catch-up flow in content_script. Single-slot:
 * a new toast replaces the previous one unless that one was marked persistent
 * (in which case the new toast is dropped).
 *
 * Distinct from the popup toast (popup/popup_ui.js → `.bl-toast`). They share
 * no DOM, no state, and no lifecycle — popup toast lives in the extension's
 * popup window; this one lives in the host page.
 *
 * Exposed as blsi.Toast (IIFE — no ES module syntax).
 *
 * Contract: docs/contracts/toast.md
 */

const BlurrySiteToast = (() => {
  'use strict';

  const _CSS = (typeof blsi !== 'undefined' && blsi.css) || {};

  let _current = null;

  function _dismiss(toast) {
    if (!toast) return;
    if (toast._removeTimer) clearTimeout(toast._removeTimer);
    toast.classList.add(_CSS.toast_exiting || 'bl-si-toast--exiting');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (_current === toast) _current = null;
    }, 250);
  }

  /**
   * @param {string} text
   * @param {number} [duration=10000]                      Auto-dismiss after ms (ignored when persistent).
   * @param {Array<{label:string,onClick:function,variant?:string,tooltip?:string}>} [actions]
   *   Optional action buttons in a second row. variant 'warn' renders amber.
   * @param {{persistent?:boolean, override?:boolean}} [opts]
   *   persistent: skip auto-dismiss; block replacement by non-persistent toasts.
   *   override:   force replacement of any current toast — even a persistent one.
   *               Higher-priority toasts (e.g. screen-share) use this to claim
   *               the slot from a lower-priority persistent toast (e.g. idle).
   */
  function show(text, duration, actions, opts) {
    if (duration === undefined) duration = 10000;
    const _override = !!(opts && opts.override);

    if (_current && _current.parentNode) {
      if (_current._persistent && !_override) return;
      if (_current._removeTimer) clearTimeout(_current._removeTimer);
      _current.parentNode.removeChild(_current);
      _current = null;
    }

    const toast = document.createElement('div');
    toast.className = _CSS.toast || 'bl-si-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const topRow = document.createElement('div');
    topRow.className = 'bl-si-toast__top';

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const logo = document.createElement('img');
      logo.src = chrome.runtime.getURL('icons/icon32.png');
      logo.className = 'bl-si-toast__logo';
      logo.setAttribute('aria-hidden', 'true');
      logo.alt = '';
      topRow.appendChild(logo);
    }

    const msgSpan = document.createElement('span');
    msgSpan.className = _CSS.toast_message || 'bl-si-toast__message';
    msgSpan.textContent = text;
    topRow.appendChild(msgSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bl-si-toast__close';
    closeBtn.textContent = '✕';
    const closeLabel = (typeof chrome !== 'undefined' && chrome.i18n
      && chrome.i18n.getMessage('aria_toast_dismiss')) || 'Dismiss';
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.addEventListener('click', () => _dismiss(toast));
    topRow.appendChild(closeBtn);

    toast.appendChild(topRow);

    const actionList = Array.isArray(actions) ? actions : [];
    if (actionList.length > 0) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'bl-si-toast__actions';
      actionList.forEach(function (action) {
        if (!action || !action.label || typeof action.onClick !== 'function') return;
        const btn = document.createElement('button');
        btn.className = 'bl-si-toast__action' +
          (action.variant === 'warn' ? ' bl-si-toast__action--warn' : '');
        btn.textContent = action.label;
        if (action.tooltip) btn.dataset.tooltip = action.tooltip;
        btn.addEventListener('click', function () {
          _dismiss(toast);
          action.onClick();
        });
        actionsRow.appendChild(btn);
      });
      toast.appendChild(actionsRow);
    }

    document.body.appendChild(toast);
    _current = toast;

    if (opts && opts.persistent) {
      toast._persistent = true;
    } else {
      toast._removeTimer = setTimeout(() => _dismiss(toast), duration);
    }

    return toast;
  }

  function dismiss() {
    if (_current) _dismiss(_current);
  }

  /**
   * Tear-down hook for content_script disable paths. Removes the live toast
   * if it isn't persistent. Persistent toasts (e.g. screen-share) survive
   * teardown so the user can still react.
   */
  function clearIfTransient() {
    if (_current && _current.parentNode && !_current._persistent) {
      if (_current._removeTimer) clearTimeout(_current._removeTimer);
      _current.parentNode.removeChild(_current);
      _current = null;
    }
  }

  return { show, dismiss, clearIfTransient };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.blsi = globalThis.blsi || {};
  globalThis.blsi.Toast = BlurrySiteToast;
}
