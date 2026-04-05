/**
 * popup.js — PrivacyBlur Popup Orchestrator
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
  const MSG      = window.PrivacyBlur;
  const I18n     = window.PrivacyBlurI18n;
  const Configs  = window.PrivacyBlurPopupConfigs;
  const Renderer = window.PrivacyBlurSettingsRenderer;

  const DEBOUNCE_MS   = 300;
  const TOAST_MS      = 2000;

  // ── State ──────────────────────────────────────────────────────────────────
  let settings      = MSG.buildDefaultSettings();
  let currentTab    = null;
  let currentHost   = '';
  let blurredCount  = 0;
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
    ui.blurCount         = $('blurCount');
    ui.activeRule        = $('activeRule');
    ui.toast             = $('toast');
    // Sections
    ui.generalToggle     = $('generalToggle');
    ui.bodyGeneral       = $('bodyGeneral');
    ui.advancedToggle    = $('advancedToggle');
    ui.bodyAdvanced      = $('bodyAdvanced');
    ui.experimentalToggle = $('experimentalToggle');
    ui.bodyExperimental  = $('bodyExperimental');
    // Rules
    ui.rulesToggle       = $('rulesToggle');
    ui.bodyRules         = $('bodyRules');
    ui.rulesCount        = $('rulesCount');
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

  async function bgMessage(msg) {
    try { return await chrome.runtime.sendMessage(msg); }
    catch (err) { console.warn('[PB popup] bgMessage:', err.message); return null; }
  }

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
    ui.toast.classList.add('pb-toast--visible');
    toastTimer = setTimeout(() => ui.toast.classList.remove('pb-toast--visible'), TOAST_MS);
  }

  function extractHostname(url) {
    try { return new URL(url).hostname || url; }
    catch { return url || '--'; }
  }

  // ── Settings persistence ───────────────────────────────────────────────────

  const _debouncedSave = debounce(async (notifyTab) => {
    await bgMessage({ type: MSG.SAVE_SETTINGS, settings });
    if (notifyTab && currentTab) {
      await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
    }
  }, DEBOUNCE_MS);

  async function saveSettings(notifyTab, immediate) {
    if (immediate) {
      await bgMessage({ type: MSG.SAVE_SETTINGS, settings });
      if (notifyTab && currentTab) {
        await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
      }
    } else {
      _debouncedSave(notifyTab);
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
      document.documentElement.style.setProperty('--pb-bg-blur-radius', value + 'px');
    }

    // Debounce sliders/colors, immediate for toggles/selects
    const isSliderOrColor = key === 'BLUR_RADIUS' || key === 'HIGHLIGHT_COLOR';
    saveSettings(true, !isSliderOrColor);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderHeader() {
    ui.enableToggle.checked = settings.ENABLED;
    ui.enableLabel.textContent = settings.ENABLED ? I18n.t('toggle_on') : I18n.t('toggle_off');
  }

  function renderBlurCount() {
    ui.blurCount.textContent = blurredCount;
    ui.blurCount.classList.toggle('pb-site-info__count--zero', blurredCount === 0);
    ui.blurAllBtn.dataset.active = String(isPageBlurred);
  }

  function renderBlurList() {
    const count = blurredItems.length;
    ui.blurListCount.textContent = count;
    ui.blurEmpty.classList.toggle('is-visible', count === 0);
    ui.blurList.textContent = '';

    for (const selector of blurredItems) {
      const li = document.createElement('li');
      li.className = 'pb-blur-item';

      const span = document.createElement('span');
      span.className = 'pb-blur-item__selector';
      span.textContent = selector;
      span.title = selector;

      const btn = document.createElement('button');
      btn.className = 'pb-blur-item__remove';
      btn.textContent = '\u00d7';
      btn.title = 'Remove blur';
      btn.dataset.selector = selector;

      li.append(span, btn);
      ui.blurList.appendChild(li);
    }
  }

  function renderRulesList() {
    const count = urlRules.length;
    ui.rulesCount.textContent = String(count);
    ui.rulesEmpty.classList.toggle('is-visible', count === 0);
    ui.rulesList.style.display = count > 0 ? '' : 'none';
    ui.rulesList.textContent = '';

    for (const rule of urlRules) {
      const li = document.createElement('li');
      li.className = 'pb-rule-item';

      const name = document.createElement('span');
      name.className = 'pb-rule-item__name';
      name.textContent = rule.name || 'Untitled';

      const pattern = document.createElement('span');
      pattern.className = 'pb-rule-item__pattern';
      pattern.textContent = rule.pattern || '';
      pattern.title = `${rule.patternType || 'wildcard'}: ${rule.pattern || ''}`;

      const editBtn = document.createElement('button');
      editBtn.className = 'pb-rule-item__btn';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', () => openRuleModal(rule));

      const delBtn = document.createElement('button');
      delBtn.className = 'pb-rule-item__btn pb-rule-item__btn--delete';
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', async () => {
        urlRules = urlRules.filter(r => r.id !== rule.id);
        await bgMessage({ type: MSG.SAVE_RULES, rules: urlRules });
        if (currentTab) await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
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
      await saveSettings(true, true);
      showToast(settings.ENABLED ? I18n.t('toast_enabled') : I18n.t('toast_disabled'));
    });

    // Theme toggle
    ui.themeToggle.addEventListener('click', toggleTheme);

    // Blur All
    ui.blurAllBtn.addEventListener('click', async () => {
      if (!currentTab) return;
      ui.blurAllBtn.disabled = true;
      await tabMessage(currentTab.id, { type: MSG.TOGGLE_BLUR_ALL });
      // Query fresh status
      const status = await tabMessage(currentTab.id, { type: MSG.GET_STATUS });
      if (status) {
        blurredCount = status.count || 0;
        isPageBlurred = status.isBlurAll || false;
      }
      blurredItems = await fetchBlurredSelectors();
      renderBlurCount();
      renderBlurList();
      ui.blurAllBtn.disabled = false;
      showToast(I18n.t('toast_blur_all'));
    });

    // Clear All
    ui.clearAllBtn.addEventListener('click', async () => {
      if (!currentTab) return;
      ui.clearAllBtn.disabled = true;
      await bgMessage({ type: MSG.CLEAR_HOST, hostname: currentHost });
      await tabMessage(currentTab.id, { type: MSG.CLEAR_ALL_BLUR });
      blurredItems = [];
      blurredCount = 0;
      isPageBlurred = false;
      renderBlurCount();
      renderBlurList();
      ui.clearAllBtn.disabled = false;
      showToast(I18n.t('toast_cleared'));
    });

    // Picker
    ui.pickerBtn.addEventListener('click', async () => {
      if (!currentTab) return;
      await tabMessage(currentTab.id, { type: MSG.TOGGLE_PICKER });
      isPickerActive = !isPickerActive;
      ui.pickerBtn.dataset.active = String(isPickerActive);
    });

    // Accordion toggles
    wireAccordion(ui.generalToggle, ui.bodyGeneral);
    wireAccordion(ui.advancedToggle, ui.bodyAdvanced);
    wireAccordion(ui.experimentalToggle, ui.bodyExperimental);
    wireAccordion(ui.rulesToggle, ui.bodyRules);

    // Rules
    ui.addRuleBtn.addEventListener('click', () => openRuleModal(null));

    // Blur list remove (event delegation)
    ui.blurList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.pb-blur-item__remove');
      if (!btn) return;
      const selector = btn.dataset.selector;
      if (!selector) return;
      await bgMessage({ type: MSG.REMOVE_SELECTOR, hostname: currentHost, selector });
      if (currentTab) await tabMessage(currentTab.id, { type: MSG.UNBLUR_SELECTOR, selector });
      blurredItems = blurredItems.filter(s => s !== selector);
      blurredCount = Math.max(0, blurredCount - 1);
      renderBlurCount();
      renderBlurList();
      showToast(I18n.t('toast_blur_removed'));
    });

    // Clear all sites
    ui.clearAllSitesBtn.addEventListener('click', async () => {
      if (!confirm(I18n.t('confirm_clear_all'))) return;
      await bgMessage({ type: MSG.CLEAR_ALL });
      blurredItems = [];
      blurredCount = 0;
      isPageBlurred = false;
      renderBlurCount();
      renderBlurList();
      if (currentTab) await tabMessage(currentTab.id, { type: MSG.CLEAR_ALL_BLUR });
      showToast(I18n.t('toast_all_sites_cleared'));
    });
  }

  function wireAccordion(toggle, body) {
    toggle.addEventListener('click', () => {
      const isOpen = body.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  async function fetchBlurredSelectors() {
    if (!currentHost) return [];
    const resp = await bgMessage({ type: MSG.GET_SELECTORS, hostname: currentHost });
    return (resp && Array.isArray(resp.selectors)) ? resp.selectors : [];
  }

  // ── Storage change listener ────────────────────────────────────────────────

  function setupStorageListener() {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;

      if (changes.settings) {
        const resp = await bgMessage({ type: MSG.GET_SETTINGS });
        if (resp && resp.settings) {
          settings = resp.settings;
          renderHeader();
          Renderer.updateAll(settings);
          document.documentElement.style.setProperty('--pb-bg-blur-radius', settings.BLUR_RADIUS + 'px');
        }
      }

      if (changes.rules) {
        const resp = await bgMessage({ type: MSG.GET_RULES });
        if (resp && Array.isArray(resp.rules)) {
          urlRules = resp.rules;
          renderRulesList();
        }
      }

      if (changes.blurred_selectors) {
        blurredItems = await fetchBlurredSelectors();
        blurredCount = blurredItems.length;
        renderBlurCount();
        renderBlurList();
      }
    });
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
    ui.captureDisplay.className = 'pb-capture pb-capture--listening';
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
        ui.captureDisplay.className = 'pb-capture pb-capture--done';
        ui.scModalSave.disabled = false;
        updateDisplay();
      }
    };

    document.addEventListener('keydown', scKeydownHandler, true);

    const onSave = async () => {
      if (!scPrimaryMod || scKeys.length === 0) return;
      const shortcutKey = 'SHORTCUTS.' + scAction;
      Renderer.setByPath(settings, shortcutKey, {
        primaryModifier: scPrimaryMod,
        keys: scKeys.map(k => ({ key: k.key, code: k.code })),
      });
      await saveSettings(true, true);
      Renderer.updateAll(settings);
      closeShortcutModal();
      showToast(I18n.t('shortcut_saved'));
      cleanup();
    };

    const onReset = async () => {
      const defaults = MSG.DEFAULT_SETTINGS.SHORTCUTS[scAction];
      if (defaults) {
        Renderer.setByPath(settings, 'SHORTCUTS.' + scAction, JSON.parse(JSON.stringify(defaults)));
        await saveSettings(true, true);
        Renderer.updateAll(settings);
      }
      closeShortcutModal();
      showToast(I18n.t('shortcut_reset_done'));
      cleanup();
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

  function openRuleModal(existingRule) {
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
    Renderer.renderSection(ui.ruleOverrides, overridableConfigs, ruleSettings, onRuleSettingChanged, { ruleMode: true });

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

      await bgMessage({ type: MSG.SAVE_RULES, rules: urlRules });
      if (currentTab) await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
      renderRulesList();
      closeRuleModal();
      showToast(I18n.t('rule_saved'));
      cleanup();
    };

    const onCancel = () => { closeRuleModal(); cleanup(); };

    function cleanup() {
      ui.ruleModalSave.removeEventListener('click', onSave);
      ui.ruleModalCancel.removeEventListener('click', onCancel);
    }

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
    const allTabs = await chrome.tabs.query({ url: ['*://*/*'] });
    if (allTabs && allTabs.length > 0) {
      allTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      currentTab = allTabs[0];
    }
    currentHost = currentTab ? extractHostname(currentTab.url) : '';
    ui.hostname.textContent = currentHost || '--';
    ui.hostname.title = currentHost;

    // Fetch settings
    const resp = await bgMessage({ type: MSG.GET_SETTINGS });
    if (resp && resp.settings) settings = resp.settings;

    // Fetch rules
    const rulesResp = await bgMessage({ type: MSG.GET_RULES });
    if (rulesResp && Array.isArray(rulesResp.rules)) urlRules = rulesResp.rules;

    // Fetch blurred selectors
    blurredItems = await fetchBlurredSelectors();

    // Wire controls FIRST
    wireControls();

    // Render header
    renderHeader();

    // Set dynamic background blur
    document.documentElement.style.setProperty('--pb-bg-blur-radius', settings.BLUR_RADIUS + 'px');

    // Render settings sections via POJO renderer
    Renderer.renderSection(ui.bodyGeneral, Configs.GENERAL, settings, onSettingChanged);
    Renderer.renderSection(ui.bodyAdvanced, Configs.ADVANCED, settings, onSettingChanged);
    Renderer.renderSection(ui.bodyExperimental, Configs.EXPERIMENTAL, settings, onSettingChanged);

    // Render lists
    try { renderRulesList(); } catch (e) { console.warn('[PB] renderRulesList:', e); }
    try { renderBlurList(); } catch (e) { console.warn('[PB] renderBlurList:', e); }

    // Query actual status from tab
    if (currentTab) {
      try {
        const status = await tabMessage(currentTab.id, { type: MSG.GET_STATUS });
        if (status) {
          blurredCount = status.count || 0;
          isPageBlurred = status.isBlurAll || false;
          isPickerActive = status.isPickerActive || false;
          renderBlurCount();
          ui.pickerBtn.dataset.active = String(isPickerActive);
        }
      } catch (e) { console.warn('[PB] GET_STATUS:', e); }
    }

    // Storage change listener
    setupStorageListener();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => console.error('[PB popup] Init error:', err));
  });
})();
