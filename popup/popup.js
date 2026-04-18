const BlurrySitePopup = (() => {
  'use strict';

  let _settings = null;
  let _toastTimer = null;

  // ── Theme ──────────────────────────────────────────────────────────────
  const LOGO_DARK     = '../icons/icon-dark.png';
  const LOGO_LIGHT    = '../icons/icon-light.png';
  const LOGO_FALLBACK = '../icons/icon48.png';

  function _setLogoSrc(img, isDark) {
    if (!img) return;
    img.src = isDark ? LOGO_DARK : LOGO_LIGHT;
    img.onerror = () => { img.onerror = null; img.src = LOGO_FALLBACK; };
  }

  function applyTheme(theme) {
    const isDark = theme !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
    const btn = document.getElementById('bl-theme-toggle');
    if (btn) btn.textContent = isDark ? '☀' : '🌙';
    _setLogoSrc(document.getElementById('bl-logo'), isDark);
    _setLogoSrc(document.getElementById('bl-logo-off'), isDark);
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
  }

  // ── Toast ──────────────────────────────────────────────────────────────
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

  // ── Host display ────────────────────────────────────────────────────────
  function setHost(hostname) {
    document.querySelectorAll('.bl-header__host, .bl-subpage__host').forEach((el) => {
      el.textContent = hostname || '';
    });
  }

  // ── Version ─────────────────────────────────────────────────────────────
  function setVersion() {
    const el = document.getElementById('bl-version');
    if (el) el.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // ── Apply data-i18n attributes ───────────────────────────────────────────
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = chrome.i18n.getMessage(el.dataset.i18n);
      if (msg) el.textContent = msg;
    });
  }

  // ── Save settings + re-render + notify tab ────────────────────────────────
  async function _saveAndApply(patch) {
    const next = { ..._settings, ...patch };
    await blsi.Storage.saveSettings(next);
    _settings = next;
    BlurrySitePopupRender.renderAll(_settings);
  }

  function _notifyTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: blsi.POPUP.UPDATE_SETTINGS,
          settings: _settings,
        }).catch(() => {});
      }
    });
  }

  // ── Power button + off-state ─────────────────────────────────────────────
  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (btn) {
      btn.classList.toggle('is-off', !enabled);
      btn.title = enabled ? 'Disable Blurry Site' : 'Enable Blurry Site';
    }
    document.getElementById('bl-view-main').hidden = !enabled;
    const offView = document.getElementById('bl-view-off');
    if (offView) offView.hidden = enabled;
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  const SUB_VIEWS = [
    'bl-view-htb-modify',
    'bl-view-automate-modify',
    'bl-view-shortcuts',
    'bl-view-site-rules',
  ];

  function showView(viewId) {
    const isMain = viewId === 'bl-view-main';
    document.getElementById('bl-view-main').hidden = !isMain || !_settings.ENABLED;
    document.getElementById('bl-view-off').hidden   = isMain ? _settings.ENABLED : true;
    for (const id of SUB_VIEWS) {
      document.getElementById(id).hidden = id !== viewId;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      applyTheme(data.blsi_popup_theme || 'dark');
    });

    applyI18n();
    setVersion();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url) {
        try { setHost(new URL(tab.url).hostname); } catch (_) {}
      }
    });

    _settings = await blsi.Storage.getSettings();
    renderPowerButton(_settings.ENABLED);
    BlurrySitePopupRender.renderAll(_settings);

    // ── Header ───────────────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      await _saveAndApply({ ENABLED: !_settings.ENABLED });
      renderPowerButton(_settings.ENABLED);
      showToast(_settings.ENABLED ? 'toast_enabled' : 'toast_disabled');
      _notifyTab();
    });

    // ── Off-state turn-on ─────────────────────────────────────────────────
    document.getElementById('bl-turn-on').addEventListener('click', async () => {
      await _saveAndApply({ ENABLED: true });
      renderPowerButton(true);
      showToast('toast_enabled');
      _notifyTab();
    });

    // ── Blur All toggle inside mode block (event delegation on #bl-modes) ─
    document.getElementById('bl-modes').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-blur-all-toggle') return;
      await _saveAndApply({ ENABLED: e.target.checked });
      renderPowerButton(_settings.ENABLED);
      showToast(_settings.ENABLED ? 'toast_enabled' : 'toast_disabled');
      _notifyTab();
    });

    // ── PII master toggle ─────────────────────────────────────────────────
    document.getElementById('bl-pii').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-pii-master') return;
      const on = e.target.checked;
      await _saveAndApply({
        AUTO_DETECT: { ...(_settings.AUTO_DETECT), EMAIL: on, NUMERIC: on },
      });
      _notifyTab();
    });

    // ── PII mode chip click ───────────────────────────────────────────────
    document.getElementById('bl-pii-chips').addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-pii-mode]');
      if (!chip) return;
      await _saveAndApply({ PII_MODE: chip.dataset.piiMode });
      _notifyTab();
    });

    // ── HTB chip click → navigate to modify sub-page ──────────────────────
    document.getElementById('bl-htb-chips').addEventListener('click', (e) => {
      if (e.target.closest('.bl-chip')) showView('bl-view-htb-modify');
    });

    // ── Sub-page navigation ───────────────────────────────────────────────
    document.getElementById('bl-htb-modify').addEventListener('click', () => showView('bl-view-htb-modify'));
    document.getElementById('bl-automate-modify').addEventListener('click', () => showView('bl-view-automate-modify'));
    document.getElementById('bl-nav-shortcuts').addEventListener('click', () => showView('bl-view-shortcuts'));
    document.getElementById('bl-nav-site-rules').addEventListener('click', () => showView('bl-view-site-rules'));

    // ── Back buttons ──────────────────────────────────────────────────────
    document.querySelectorAll('.bl-back-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView('bl-view-main'));
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showView, showToast };
})();
