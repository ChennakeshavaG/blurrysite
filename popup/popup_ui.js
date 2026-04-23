const BlurrySitePopupUI = (() => {
  'use strict';

  // ── Theme ────────────────────────────────────────────────────────────────
  const LOGO_DARK     = '../icons/logo-dark.png';
  const LOGO_LIGHT    = '../icons/logo-light.png';
  const LOGO_FALLBACK = '../icons/icon48.png';

  const _SVG_SUN  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  const _SVG_MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

  function _setLogoSrc(img, isDark) {
    if (!img) return;
    img.src = isDark ? LOGO_DARK : LOGO_LIGHT;
    img.onerror = () => { img.onerror = null; img.src = LOGO_FALLBACK; };
  }

  function applyTheme(theme) {
    const isDark = theme !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
    const btn = document.getElementById('bl-theme-toggle');
    if (btn) btn.innerHTML = isDark ? _SVG_SUN : _SVG_MOON;
    _setLogoSrc(document.getElementById('bl-logo'), isDark);
    _setLogoSrc(document.getElementById('bl-logo-off'), isDark);
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  let _toastTimer = null;

  function showToast(key, substitutions) {
    const el = document.getElementById('bl-toast');
    if (!el) return;
    const msg = chrome.i18n.getMessage(key, substitutions) || key;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('is-visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      _toastTimer = setTimeout(() => { el.hidden = true; }, 220);
    }, 2200);
  }

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
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = chrome.i18n.getMessage(el.dataset.i18n);
      if (msg) el.textContent = msg;
    });
  }

  // ── Power button ─────────────────────────────────────────────────────────
  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (btn) {
      btn.classList.toggle('is-off', !enabled);
      btn.title = enabled ? 'Disable Blurry Site' : 'Enable Blurry Site';
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
  ];

  function showView(viewId, isEnabled) {
    const isMain = viewId === 'bl-view-main';
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
    updateClearAll,
  };
})();

window.BlurrySitePopupUI = BlurrySitePopupUI;
