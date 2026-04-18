const BlurrySitePopup = (() => {
  'use strict';

  let _settings = null;

  // ── Theme ──────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    const btn = document.getElementById('bl-theme-toggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀';
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
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

  // ── Power button ────────────────────────────────────────────────────────
  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (!btn) return;
    btn.classList.toggle('is-off', !enabled);
    btn.title = enabled ? 'Disable Blurry Site' : 'Enable Blurry Site';
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
    document.getElementById('bl-view-main').hidden = !isMain;
    for (const id of SUB_VIEWS) {
      document.getElementById(id).hidden = id !== viewId;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    // Theme persisted separately so it survives settings resets
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      applyTheme(data.blsi_popup_theme || 'dark');
    });

    setVersion();

    // Hostname from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url) {
        try { setHost(new URL(tab.url).hostname); } catch (_) {}
      }
    });

    // Load settings
    _settings = await blsi.Storage.getSettings();
    renderPowerButton(_settings.ENABLED);

    // ── Event listeners ───────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      const next = { ..._settings, ENABLED: !_settings.ENABLED };
      await blsi.Storage.saveSettings(next);
      _settings = next;
      renderPowerButton(_settings.ENABLED);
      // Notify active tab to apply or tear down (no-op on chrome:// pages)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: blsi.POPUP.UPDATE_SETTINGS,
            settings: _settings,
          }).catch(() => {});
        }
      });
    });

    // Sub-page navigation
    document.getElementById('bl-htb-modify').addEventListener('click', () => showView('bl-view-htb-modify'));
    document.getElementById('bl-automate-modify').addEventListener('click', () => showView('bl-view-automate-modify'));
    document.getElementById('bl-nav-shortcuts').addEventListener('click', () => showView('bl-view-shortcuts'));
    document.getElementById('bl-nav-site-rules').addEventListener('click', () => showView('bl-view-site-rules'));

    // Back buttons
    document.querySelectorAll('.bl-back-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView('bl-view-main'));
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showView };
})();
