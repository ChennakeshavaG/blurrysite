/**
 * popup.js — Blurry Site Popup Orchestrator
 *
 * From-scratch rewrite. Manages the extension popup UI:
 * settings sync via POJO-driven renderer, action buttons,
 * per-tab messaging, URL rules CRUD, dark/light theme,
 * storage.onChanged listener, and shortcut capture modal.
 *
 * No window global — this is the entry point IIFE.
 */

(() => {
  'use strict';

  // ── Module aliases ─────────────────────────────────────────────────────────
  const MSG = blsi;
  const I18n = blsi.I18n;
  const Configs = blsi.PopupConfigs;
  const Renderer = blsi.SettingsRenderer;
  const Store = blsi.Storage;

  const DEBOUNCE_MS   = 300;
  const TOAST_MS      = 2000;

  // ── State ──────────────────────────────────────────────────────────────────
  let settings      = MSG.buildDefaultSettings();
  let currentTab    = null;
  let currentHost   = '';
  let isPageBlurred = false;
  let isPickerActive = false;
  let urlRules      = [];
  let blurredItems  = [];
  let toastTimer    = null;
  let editingRuleId = null;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const ui = {};

  function bindUI() {
    ui.enableToggle      = $('enableToggle');
    ui.enableLabel       = $('enableLabel');
    ui.themeToggle       = $('themeToggle');
    ui.blurAllBtn        = $('blurAllBtn');
    ui.clearAllBtn       = $('clearAllBtn');
    ui.pickerBtn         = $('pickerBtn');
    ui.hostname          = $('hostname');
    ui.activeRule        = $('activeRule');
    ui.toast             = $('toast');
    // Sections
    ui.bodyShortcuts     = $('bodyShortcuts');
    ui.settingsToggle    = $('settingsToggle');
    ui.bodySettings      = $('bodySettings');
    // Rules
    ui.rulesToggle       = $('rulesToggle');
    ui.bodyRules         = $('bodyRules');
    ui.rulesList         = $('rulesList');
    ui.rulesEmpty        = $('rulesEmpty');
    ui.addRuleBtn        = $('addRuleBtn');
    // Blur list
    ui.blurList          = $('blurList');
    ui.blurEmpty         = $('blurEmpty');
    ui.blurListCount     = $('blurListCount');
    // Footer
    ui.clearAllSitesBtn  = $('clearAllSitesBtn');
    ui.extVersion        = $('extVersion');
    // Shortcut modal
    ui.shortcutModal     = $('shortcutModal');
    ui.captureDisplay    = $('captureDisplay');
    ui.scModalSave       = $('scModalSave');
    ui.scModalCancel     = $('scModalCancel');
    ui.scModalReset      = $('scModalReset');
    // Rule modal
    ui.ruleModal         = $('ruleModal');
    ui.ruleModalTitle    = $('ruleModalTitle');
    ui.ruleName          = $('ruleName');
    ui.rulePattern       = $('rulePattern');
    ui.rulePatternType   = $('rulePatternType');
    ui.ruleOverrides     = $('ruleOverridesContainer');
    ui.ruleModalSave     = $('ruleModalSave');
    ui.ruleModalCancel   = $('ruleModalCancel');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  async function tabMessage(tabId, msg) {
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, msg),
        new Promise(r => setTimeout(() => r(null), 3000)),
      ]);
    } catch { return null; }
  }

  function debounce(fn, delay) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.classList.add('bl-si-toast--visible');
    toastTimer = setTimeout(() => ui.toast.classList.remove('bl-si-toast--visible'), TOAST_MS);
  }

  function extractHostname(url) {
    try { return new URL(url).hostname || url; }
    catch { return url || '--'; }
  }

  // ── Settings persistence ───────────────────────────────────────────────────

  // Settings persistence — pure storage write. Content script picks up the
  // change via Store.onChange (cross-context) — no tabMessage needed.
  const _debouncedSave = debounce(async () => {
    try {
      await Store.saveSettings(settings);
    } catch (err) {
      console.error('[BlurrySite popup] saveSettings:', err);
      showToast('Failed to save settings');
    }
  }, DEBOUNCE_MS);

  async function saveSettings(immediate) {
    if (immediate) {
      try {
        await Store.saveSettings(settings);
      } catch (err) {
        console.error('[BlurrySite popup] saveSettings:', err);
        showToast('Failed to save settings');
      }
    } else {
      _debouncedSave();
    }
  }

  // ── Setting changed callback (from Renderer) ──────────────────────────────

  function onSettingChanged(key, value) {
    // Shortcut capture signal
    if (value && typeof value === 'object' && value._openCapture) {
      openShortcutModal(value.action);
      return;
    }

    Renderer.setByPath(settings, key, value);

    // Update dynamic background when BLUR_RADIUS changes
    if (key === 'BLUR_RADIUS') {
      document.documentElement.style.setProperty('--bl-si-bg-blur-radius', value + 'px');
    }

    // Debounce sliders/colors, immediate for toggles/selects
    const isSliderOrColor = key === 'BLUR_RADIUS' || key === 'HIGHLIGHT_COLOR';
    saveSettings(!isSliderOrColor);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderHeader() {
    ui.enableToggle.checked = settings.ENABLED;
    ui.enableLabel.textContent = settings.ENABLED ? I18n.t('toggle_on') : I18n.t('toggle_off');
  }

  function renderBlurCount() {
    ui.blurAllBtn.dataset.active = String(isPageBlurred);
  }

  function renderBlurList() {
    const count = blurredItems.length;
    ui.blurListCount.textContent = count;
    // Hide entire section when no blurred elements
    const sectionEl = document.getElementById('sectionBlurred');
    if (sectionEl) sectionEl.style.display = count > 0 ? '' : 'none';
    ui.blurEmpty.classList.toggle('is-visible', count === 0);
    ui.blurList.textContent = '';

    for (const item of blurredItems) {
      const li = document.createElement('li');
      li.className = 'bl-si-blur-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'bl-si-blur-item__name';
      nameSpan.textContent = item.name || (item.type === 'dynamic' ? 'Dynamic' : 'Sticky');

      const detailSpan = document.createElement('span');
      detailSpan.className = 'bl-si-blur-item__selector';
      if (item.type === 'dynamic') {
        detailSpan.textContent = item.selector;
      } else {
        const coords = item.x + ',' + item.y + ' \u2014 ' + item.width + '\u00d7' + item.height;
        detailSpan.textContent = coords + (item.path ? '  ' + item.path : '');
      }
      detailSpan.title = detailSpan.textContent;

      const btn = document.createElement('button');
      btn.className = 'bl-si-blur-item__remove';
      btn.textContent = '\u00d7';
      btn.title = 'Remove blur';
      btn.dataset.itemId = item.type === 'dynamic' ? item.selector : item.id;
      btn.dataset.itemType = item.type;

      li.append(nameSpan, detailSpan, btn);
      ui.blurList.appendChild(li);
    }
  }

  function renderRulesList() {
    const count = urlRules.length;
    ui.rulesEmpty.classList.toggle('is-visible', count === 0);
    ui.rulesList.style.display = count > 0 ? '' : 'none';
    ui.rulesList.textContent = '';

    for (const rule of urlRules) {
      const li = document.createElement('li');
      li.className = 'bl-si-rule-item';

      const name = document.createElement('span');
      name.className = 'bl-si-rule-item__name';
      name.textContent = rule.name || 'Untitled';

      const pattern = document.createElement('span');
      pattern.className = 'bl-si-rule-item__pattern';
      pattern.textContent = rule.pattern || '';
      pattern.title = `${rule.patternType || 'wildcard'}: ${rule.pattern || ''}`;

      const editBtn = document.createElement('button');
      editBtn.className = 'bl-si-rule-item__btn';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', () => openRuleModal(rule));

      const delBtn = document.createElement('button');
      delBtn.className = 'bl-si-rule-item__btn bl-si-rule-item__btn--delete';
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', async () => {
        urlRules = urlRules.filter(r => r.id !== rule.id);
        try {
          await Store.saveRules(urlRules);
        } catch (err) {
          console.error('[BlurrySite popup] saveRules:', err);
          showToast('Failed to delete rule');
          return;
        }
        renderRulesList();
        showToast(I18n.t('rule_deleted'));
      });

      li.append(name, pattern, editBtn, delBtn);
      ui.rulesList.appendChild(li);
    }
  }

  // ── i18n DOM update ────────────────────────────────────────────────────────

  function applyI18nToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) el.textContent = I18n.t(key);
    });
  }

  // ── Theme ──────────────────────────────────────────────────────────────────

  let currentTheme = 'dark';

  async function initTheme() {
    try {
      const result = await chrome.storage.local.get('popupTheme');
      const stored = result.popupTheme || 'auto';
      if (stored === 'auto') {
        currentTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } else {
        currentTheme = stored;
      }
    } catch {
      currentTheme = 'dark';
    }
    document.documentElement.setAttribute('data-theme', currentTheme);
  }

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    chrome.storage.local.set({ popupTheme: currentTheme });
  }

  // ── Control wiring ─────────────────────────────────────────────────────────

  function wireControls() {
    // Enable toggle
    ui.enableToggle.addEventListener('change', async () => {
      settings.ENABLED = ui.enableToggle.checked;
      ui.enableLabel.textContent = settings.ENABLED ? I18n.t('toggle_on') : I18n.t('toggle_off');
      await saveSettings(true);
      showToast(settings.ENABLED ? I18n.t('toast_enabled') : I18n.t('toast_disabled'));
    });

    // Theme toggle
    ui.themeToggle.addEventListener('click', toggleTheme);

    // Blur All — flip blur_all_hosts; content_script reacts via Store.onChange.
    // Local UI state will be updated via the popup's own Store.onChange subscriber.
    ui.blurAllBtn.addEventListener('click', async () => {
      if (!currentHost) return;
      ui.blurAllBtn.disabled = true;
      try {
        const newState = !Store.getCachedBlurState(currentHost);
        await Store.saveBlurState(currentHost, newState);
        isPageBlurred = newState;
        renderBlurCount();
      } catch (err) {
        console.error('[BlurrySite popup] saveBlurState:', err);
        showToast('Failed to toggle blur');
      }
      ui.blurAllBtn.disabled = false;
      showToast(I18n.t('toast_blur_all'));
    });

    // Clear All — clear current host's items + blur-all state. Storage writes
    // trigger Store.onChange in content_script (cross-tab) and in popup itself.
    ui.clearAllBtn.addEventListener('click', async () => {
      if (!currentHost) return;
      ui.clearAllBtn.disabled = true;
      try {
        await Store.clearHost(currentHost);
        await Store.saveBlurState(currentHost, false);
      } catch (err) {
        console.error('[BlurrySite popup] clear host:', err);
        showToast('Failed to clear blur items');
        ui.clearAllBtn.disabled = false;
        return;
      }
      isPageBlurred = false;
      renderBlurCount();
      ui.clearAllBtn.disabled = false;
      showToast(I18n.t('toast_cleared'));
    });

    // Picker — fire-and-forget since popup may close before response arrives
    ui.pickerBtn.addEventListener('click', () => {
      if (!currentTab) return;
      chrome.tabs.sendMessage(currentTab.id, { type: MSG.TOGGLE_PICKER }).catch(() => {});
      isPickerActive = !isPickerActive;
      ui.pickerBtn.dataset.active = String(isPickerActive);
    });

    // Accordion toggles
    wireAccordion(ui.settingsToggle, ui.bodySettings);
    wireAccordion(ui.rulesToggle, ui.bodyRules);

    // Rules
    ui.addRuleBtn.addEventListener('click', () => openRuleModal(null));

    // Blur list remove (event delegation) — storage write only.
    ui.blurList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.bl-si-blur-item__remove');
      if (!btn) return;
      const itemId = btn.dataset.itemId;
      if (!itemId) return;
      try {
        await Store.removeBlurItem(currentHost, itemId);
      } catch (err) {
        console.error('[BlurrySite popup] removeBlurItem:', err);
        showToast('Failed to remove blur item');
        return;
      }
      // Optimistic local update; Store.onChange will reconcile if cross-tab race.
      blurredItems = blurredItems.filter(i => (i.type === 'dynamic' ? i.selector : i.id) !== itemId);
      renderBlurList();
      showToast(I18n.t('toast_blur_removed'));
    });

    // Clear all sites — wipes blurred_items map across all hostnames.
    ui.clearAllSitesBtn.addEventListener('click', async () => {
      if (!confirm(I18n.t('confirm_clear_all'))) return;
      try {
        await Store.clearAll();
      } catch (err) {
        console.error('[BlurrySite popup] clearAll:', err);
        showToast('Failed to clear all sites');
        return;
      }
      blurredItems = [];
      renderBlurList();
      showToast(I18n.t('toast_all_sites_cleared'));
    });
  }

  function wireAccordion(toggle, body) {
    toggle.addEventListener('click', () => {
      const isOpen = body.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // ── Storage change subscriber ──────────────────────────────────────────────
  // Receives non-self-echo changes from Store. Self-echo (popup's own writes)
  // is filtered by storage_manager via cache comparison.

  function handleStorageChange(key, _newValue, _oldValue) {
    if (key === 'settings') {
      // Re-read via Store so we get merged + validated settings.
      Store.getSettings().then((s) => {
        settings = s;
        renderHeader();
        Renderer.updateAll(settings);
        document.documentElement.style.setProperty('--bl-si-bg-blur-radius', settings.BLUR_RADIUS + 'px');
      });
    } else if (key === 'rules') {
      Store.getRules().then((r) => {
        urlRules = r;
        renderRulesList();
      });
    } else if (key === 'blurred_items') {
      Store.getBlurItems(currentHost).then((items) => {
        blurredItems = items;
        renderBlurList();
      });
    } else if (key === 'blur_all_hosts') {
      isPageBlurred = Store.getCachedBlurState(currentHost);
      renderBlurCount();
    }
  }

  // ── Shortcut capture modal ─────────────────────────────────────────────────

  const MODIFIER_CODES = new Set([
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn',
  ]);

  let scAction          = null;
  let scPrimaryMod      = null;
  let scKeys            = [];
  let scKeyCodes        = new Set();
  let scKeydownHandler  = null;
  let scCleanup         = null;

  function openShortcutModal(actionName) {
    scAction = actionName;
    scPrimaryMod = null;
    scKeys = [];
    scKeyCodes = new Set();
    ui.scModalSave.disabled = true;
    ui.captureDisplay.textContent = I18n.t('shortcut_modal_placeholder');
    ui.captureDisplay.className = 'bl-si-capture bl-si-capture--listening';
    ui.shortcutModal.hidden = false;

    if (scKeydownHandler) document.removeEventListener('keydown', scKeydownHandler, true);

    function updateDisplay() {
      const parts = [];
      if (scPrimaryMod) parts.push(Renderer.codeLabel(scPrimaryMod));
      for (const k of scKeys) parts.push(Renderer.CODE_LABELS[k.code] || k.key.toUpperCase());
      ui.captureDisplay.textContent = parts.length > 0 ? parts.join(' + ') : I18n.t('shortcut_modal_placeholder');
    }

    scKeydownHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { closeShortcutModal(); return; }

      if (!scPrimaryMod && MODIFIER_CODES.has(e.code)) {
        scPrimaryMod = e.code;
        updateDisplay();
        return;
      }
      if (MODIFIER_CODES.has(e.code) && scPrimaryMod && !scKeyCodes.has(e.code)) {
        scKeys.push({ key: e.key, code: e.code });
        scKeyCodes.add(e.code);
        updateDisplay();
        return;
      }
      if (!MODIFIER_CODES.has(e.code) && !scKeyCodes.has(e.code)) {
        if (!scPrimaryMod) {
          ui.captureDisplay.textContent = I18n.t('shortcut_modal_no_modifier');
          return;
        }
        scKeys.push({ key: e.key, code: e.code });
        scKeyCodes.add(e.code);
        ui.captureDisplay.className = 'bl-si-capture bl-si-capture--done';
        ui.scModalSave.disabled = false;
        updateDisplay();
      }
    };

    document.addEventListener('keydown', scKeydownHandler, true);

    const onSave = async () => {
      try {
        if (!scPrimaryMod || scKeys.length === 0) return;
        const shortcutKey = 'SHORTCUTS.' + scAction;
        Renderer.setByPath(settings, shortcutKey, {
          primaryModifier: scPrimaryMod,
          keys: scKeys.map(k => ({ key: k.key, code: k.code })),
        });
        await saveSettings(true);
        Renderer.updateAll(settings);
        closeShortcutModal();
        showToast(I18n.t('shortcut_saved'));
      } finally {
        cleanup();
      }
    };

    const onReset = async () => {
      try {
        const defaults = MSG.DEFAULT_SETTINGS.SHORTCUTS[scAction];
        if (defaults) {
          Renderer.setByPath(settings, 'SHORTCUTS.' + scAction, JSON.parse(JSON.stringify(defaults)));
          await saveSettings(true);
          Renderer.updateAll(settings);
        }
        closeShortcutModal();
        showToast(I18n.t('shortcut_reset_done'));
      } finally {
        cleanup();
      }
    };

    const onCancel = () => { closeShortcutModal(); cleanup(); };

    function cleanup() {
      ui.scModalSave.removeEventListener('click', onSave);
      ui.scModalCancel.removeEventListener('click', onCancel);
      ui.scModalReset.removeEventListener('click', onReset);
    }

    scCleanup = cleanup;
    ui.scModalSave.addEventListener('click', onSave);
    ui.scModalCancel.addEventListener('click', onCancel);
    ui.scModalReset.addEventListener('click', onReset);
  }

  function closeShortcutModal() {
    ui.shortcutModal.hidden = true;
    if (scKeydownHandler) {
      document.removeEventListener('keydown', scKeydownHandler, true);
      scKeydownHandler = null;
    }
    if (scCleanup) { scCleanup(); scCleanup = null; }
  }

  // ── Rule editor modal ──────────────────────────────────────────────────────

  let ruleSettings = {};
  let _ruleModalOnSave = null;
  let _ruleModalOnCancel = null;

  function openRuleModal(existingRule) {
    // Remove stale listeners from any previous open
    if (_ruleModalOnSave) {
      ui.ruleModalSave.removeEventListener('click', _ruleModalOnSave);
      _ruleModalOnSave = null;
    }
    if (_ruleModalOnCancel) {
      ui.ruleModalCancel.removeEventListener('click', _ruleModalOnCancel);
      _ruleModalOnCancel = null;
    }

    editingRuleId = existingRule ? existingRule.id : null;
    ui.ruleModalTitle.textContent = existingRule ? I18n.t('rule_edit') : I18n.t('rule_add_title');
    ui.ruleName.value = existingRule ? (existingRule.name || '') : '';
    ui.rulePattern.value = existingRule ? (existingRule.pattern || '') : '';
    ui.rulePatternType.value = existingRule ? (existingRule.patternType || 'wildcard') : 'wildcard';

    // Build rule settings for overrides panel
    ruleSettings = existingRule ? JSON.parse(JSON.stringify(existingRule.settings || {})) : {};

    // Render overrides using the renderer in ruleMode
    ui.ruleOverrides.textContent = '';
    // Filter out shortcut configs — shortcuts aren't overridable per rule
    const overridableConfigs = Configs.ALL.filter(c => c.type !== 'shortcut');
    Renderer.renderSection(ui.ruleOverrides, overridableConfigs, ruleSettings, onRuleSettingChanged, { ruleMode: true, globalSettings: settings });

    ui.ruleModal.hidden = false;

    const onSave = async () => {
      const name = ui.ruleName.value.trim();
      const pattern = ui.rulePattern.value.trim();
      if (!pattern) { showToast(I18n.t('rule_pattern_required')); return; }
      if (pattern.length > 500) { showToast(I18n.t('rule_pattern_too_long')); return; }
      if (name.length > 100) { showToast(I18n.t('rule_name_too_long')); return; }

      // Clean null values from ruleSettings
      const cleanSettings = {};
      for (const [k, v] of Object.entries(ruleSettings)) {
        if (v !== null && v !== undefined) {
          if (typeof v === 'object' && !Array.isArray(v)) {
            const sub = {};
            let hasValue = false;
            for (const [sk, sv] of Object.entries(v)) {
              if (sv !== null && sv !== undefined) { sub[sk] = sv; hasValue = true; }
            }
            if (hasValue) cleanSettings[k] = sub;
          } else {
            cleanSettings[k] = v;
          }
        }
      }

      if (editingRuleId) {
        const idx = urlRules.findIndex(r => r.id === editingRuleId);
        if (idx >= 0) {
          urlRules[idx] = { ...urlRules[idx], name, pattern, patternType: ui.rulePatternType.value, settings: cleanSettings };
        }
      } else {
        urlRules.push({
          id: 'r_' + Math.random().toString(36).slice(2, 10),
          name, pattern,
          patternType: ui.rulePatternType.value,
          settings: cleanSettings,
        });
      }

      try {
        await Store.saveRules(urlRules);
      } catch (err) {
        console.error('[BlurrySite popup] saveRules:', err);
        showToast('Failed to save rule');
        return;
      }
      renderRulesList();
      closeRuleModal();
      showToast(I18n.t('rule_saved'));
      cleanup();
    };

    const onCancel = () => { closeRuleModal(); cleanup(); };

    function cleanup() {
      ui.ruleModalSave.removeEventListener('click', onSave);
      ui.ruleModalCancel.removeEventListener('click', onCancel);
      _ruleModalOnSave = null;
      _ruleModalOnCancel = null;
    }

    _ruleModalOnSave = onSave;
    _ruleModalOnCancel = onCancel;
    ui.ruleModalSave.addEventListener('click', onSave);
    ui.ruleModalCancel.addEventListener('click', onCancel);
  }

  function onRuleSettingChanged(key, value) {
    Renderer.setByPath(ruleSettings, key, value);
  }

  function closeRuleModal() {
    ui.ruleModal.hidden = true;
    editingRuleId = null;
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    bindUI();

    // Theme
    await initTheme();

    // i18n
    await I18n.init();
    applyI18nToDOM();

    // Version
    const manifest = chrome.runtime.getManifest();
    ui.extVersion.textContent = 'v' + manifest.version;

    // Active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      currentTab = activeTab;
    }
    currentHost = currentTab ? extractHostname(currentTab.url) : '';
    ui.hostname.textContent = currentHost || '--';
    ui.hostname.title = currentHost;

    // Populate storage cache (single read of all tracked keys).
    try { await Store.initCache(); } catch (_e) {}

    // Fetch settings, rules, blur items, blur-all state (all from cache).
    settings = await Store.getSettings();
    urlRules = await Store.getRules();
    blurredItems = currentHost ? await Store.getBlurItems(currentHost) : [];
    isPageBlurred = currentHost ? Store.getCachedBlurState(currentHost) : false;

    // Wire controls FIRST
    wireControls();

    // Render header
    renderHeader();

    // Set dynamic background blur
    document.documentElement.style.setProperty('--bl-si-bg-blur-radius', settings.BLUR_RADIUS + 'px');

    // Render settings sections via POJO renderer
    Renderer.renderSection(ui.bodyShortcuts, Configs.SHORTCUTS, settings, onSettingChanged);
    Renderer.renderSection(ui.bodySettings, Configs.SETTINGS, settings, onSettingChanged);

    // Render lists
    try { renderRulesList(); } catch (e) { console.warn('[PB] renderRulesList:', e); }
    try { renderBlurList(); } catch (e) { console.warn('[PB] renderBlurList:', e); }
    renderBlurCount();

    // Query picker state from content script (in-memory, not in storage)
    if (currentTab) {
      try {
        const status = await tabMessage(currentTab.id, { type: MSG.GET_STATUS });
        if (status) {
          isPickerActive = status.isPickerActive || false;
          ui.pickerBtn.dataset.active = String(isPickerActive);
        }
      } catch (e) { console.warn('[PB] GET_STATUS:', e); }
    }

    // Subscribe to storage changes from other contexts (content_script, other tabs).
    Store.onChange(handleStorageChange);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => console.error('[PB popup] Init error:', err));
  });
})();
