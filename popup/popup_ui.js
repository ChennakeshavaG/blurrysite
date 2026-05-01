const BlurrySitePopupUI = (() => {
  'use strict';

  // ── Theme ────────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    const isDark = theme !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  let _toastTimer = null;

  function _dismissToast() {
    const el = document.getElementById('bl-toast');
    if (!el) return;
    if (_toastTimer) clearTimeout(_toastTimer);
    el.classList.remove('is-visible');
    _toastTimer = setTimeout(() => { el.hidden = true; }, 220);
  }

  function showToast(key, substitutions) {
    const el = document.getElementById('bl-toast');
    if (!el) return;
    const msg = (blsi && blsi.ContentI18n)
      ? blsi.ContentI18n.t(key)
      : (chrome.i18n.getMessage(key, substitutions) || key);
    const msgEl = document.getElementById('bl-toast-msg');
    if (msgEl) msgEl.textContent = msg;
    else el.textContent = msg;
    el.hidden = false;
    el.classList.add('is-visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      _toastTimer = setTimeout(() => { el.hidden = true; }, 220);
    }, 15000);
  }

  // Wire close button once DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    const closeBtn = document.getElementById('bl-toast-close');
    if (closeBtn) closeBtn.addEventListener('click', _dismissToast);
  });

  // ── Host / version / i18n ────────────────────────────────────────────────
  function setHost(hostname) {
    document.querySelectorAll('.bl-header__host, .bl-subpage__host').forEach((el) => {
      el.textContent = hostname || '';
    });
  }

  function setVersion() {
    const el = document.getElementById('bl-version');
    if (el) el.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  function applyI18n() {
    const lookup = (key) => (blsi && blsi.ContentI18n)
      ? blsi.ContentI18n.t(key)
      : (chrome.i18n.getMessage(key) || key);

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = lookup(el.dataset.i18n);
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const msg = lookup(el.dataset.i18nAriaLabel);
      if (msg) el.setAttribute('aria-label', msg);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const msg = lookup(el.dataset.i18nTitle);
      if (msg) el.setAttribute('title', msg);
    });
  }

  // ── Power button ─────────────────────────────────────────────────────────
  function _t(key) {
    return (blsi && blsi.ContentI18n) ? blsi.ContentI18n.t(key) : (chrome.i18n.getMessage(key) || key);
  }

  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (btn) {
      btn.classList.toggle('is-off', !enabled);
      btn.title = enabled ? _t('tt_power_disable') : _t('tt_power_enable');
    }
    const mainView = document.getElementById('bl-view-main');
    if (mainView) mainView.hidden = !enabled;
    const offView = document.getElementById('bl-view-off');
    if (offView) offView.hidden = enabled;
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  const SUB_VIEWS = [
    'bl-view-htb-modify',
    'bl-view-automate-modify',
    'bl-view-shortcuts',
    'bl-view-site-rules',
    'bl-view-general',
  ];

  function showView(viewId, isEnabled) {
    const isMain = viewId === 'bl-view-main';
    // Restricted view is mutually exclusive with everything else; normal nav
    // never targets it (set via showRestrictedView during boot only). Always
    // hide it during ordinary view swaps.
    const restrictedEl = document.getElementById('bl-view-restricted');
    if (restrictedEl) restrictedEl.hidden = true;
    if (isMain) {
      document.getElementById('bl-view-main').hidden = !isEnabled;
      document.getElementById('bl-view-off').hidden  = !!isEnabled;
      document.body.classList.remove('bl-has-subpage');
    } else {
      document.getElementById('bl-view-main').hidden = false;
      document.getElementById('bl-view-off').hidden  = true;
      document.body.classList.add('bl-has-subpage');
    }
    for (const id of SUB_VIEWS) {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== viewId;
    }
  }

  // ── Restricted-page view (Chrome blocks extensions on this URL) ────────
  // One-shot during popup boot when chrome.tabs.query returns a restricted
  // URL. Hides every other view, including header chrome that controls page
  // state (power/theme remain visible — they're global, not page-scoped).
  function showRestrictedView() {
    const main = document.getElementById('bl-view-main');
    const off  = document.getElementById('bl-view-off');
    const restricted = document.getElementById('bl-view-restricted');
    if (main) main.hidden = true;
    if (off)  off.hidden  = true;
    if (restricted) restricted.hidden = false;
    for (const id of SUB_VIEWS) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    document.body.classList.remove('bl-has-subpage');
  }

  // ── Clear All button state ────────────────────────────────────────────────
  function updateClearAll(settings, blurItems, isPageBlurred) {
    const btn = document.getElementById('bl-clear-all');
    if (!btn || !settings) return;
    btn.disabled = !isPageBlurred && blurItems.length === 0;
  }

  return {
    applyTheme, toggleTheme,
    showToast,
    setHost, setVersion, applyI18n,
    renderPowerButton,
    showView,
    showRestrictedView,
    updateClearAll,
  };
})();

window.BlurrySitePopupUI = BlurrySitePopupUI;
