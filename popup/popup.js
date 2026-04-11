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
  //
  // The popup is storage-first. Every render reads from blsi.Storage on
  // demand (see renderAll). Module-level state is reserved for things that
  // are NOT in storage: the current tab/host, the toast timer, the
  // currently-editing rule id, picker-active (queried from content script
  // once), and a debounced write buffer for sliders/colors.
  //
  // No mirrors of settings / rules / blurred_items / blur_all_hosts live
  // here — those are read fresh from storage every render.
  let currentTab     = null;
  let currentHost    = '';
  let isPickerActive = false;
  let toastTimer     = null;
  let editingRuleId  = null;

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
    ui.helpOverlayBtn    = $('helpOverlayBtn');
    ui.debugToggle       = $('debugToggle');
    ui.extVersion        = $('extVersion');
    // Help overlay modal
    ui.helpOverlayModal  = $('helpOverlayModal');
    ui.helpOverlayList   = $('helpOverlayList');
    ui.helpOverlayClose  = $('helpOverlayClose');
    // Shortcut modal
    ui.shortcutModal     = $('shortcutModal');
    ui.scModalTitle      = $('scModalTitle');
    ui.captureDisplay    = $('captureDisplay');
    ui.captureWarning    = $('captureWarning');
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

  // ── Settings write path (debounced, write-through to storage) ─────────────
  //
  // patchSettings is the ONE place the popup mutates settings. It reads the
  // current settings from storage, applies the patch, and writes them back.
  // For sliders and the color picker we debounce the write so a drag doesn't
  // produce 100 storage writes. The pending-write buffer is NEVER read by the
  // renderer — it's strictly write-side scratch space that represents
  // "changes the user has made that haven't hit storage yet".
  //
  // After the write flushes, storage.onChange fires renderAll which re-reads
  // storage and updates every view.

  let _pendingWrite = null;
  // Tracks the LANGUAGE we last initialized I18n with, so handleStorageChange
  // can detect cross-context language switches and trigger applyLanguage()
  // instead of just calling renderAll() (which won't rebuild option labels).
  let _lastKnownLanguage = null;
  let _writeTimer = null;

  async function _flushPendingWrite() {
    clearTimeout(_writeTimer);
    _writeTimer = null;
    if (!_pendingWrite) return;
    const toWrite = _pendingWrite;
    _pendingWrite = null;
    try {
      await Store.saveSettings(toWrite);
    } catch (err) {
      console.error('[BlurrySite popup] saveSettings:', err);
      showToast(I18n.t('toast_failed_save_settings'));
    }
  }

  async function patchSettings(key, value, immediate) {
    // Start from the latest stored settings the first time through, so we
    // never stomp on concurrent writes from another context.
    if (!_pendingWrite) _pendingWrite = await Store.getSettings();
    Renderer.setByPath(_pendingWrite, key, value);

    clearTimeout(_writeTimer);
    if (immediate) {
      await _flushPendingWrite();
    } else {
      _writeTimer = setTimeout(() => { _flushPendingWrite(); }, DEBOUNCE_MS);
    }
  }

  // ── Setting changed callback (from Renderer) ──────────────────────────────

  function onSettingChanged(key, value) {
    // Shortcut capture signal — a magic object tells the popup to open the
    // capture modal instead of writing to storage.
    if (value && typeof value === 'object' && value._openCapture) {
      openShortcutModal(value.action);
      return;
    }

    // Immediate display update for live-preview fields. The actual storage
    // write + renderAll happens below. For BLUR_RADIUS we also update the
    // dynamic background CSS var so the user sees the change without waiting
    // for the debounce to flush.
    if (key === 'BLUR_RADIUS') {
      document.documentElement.style.setProperty('--bl-si-bg-blur-radius', value + 'px');
    }

    // Language change: persist immediately, then re-init i18n and rebuild
    // every translated surface. queueMicrotask defers the rebuild past the
    // current change event so the live <select> isn't destroyed mid-dispatch.
    if (key === 'LANGUAGE') {
      patchSettings(key, value, true).then(() => queueMicrotask(applyLanguage));
      return;
    }

    // Debounce sliders/colors, immediate for toggles/selects.
    const isSliderOrColor = key === 'BLUR_RADIUS' || key === 'HIGHLIGHT_COLOR';
    patchSettings(key, value, !isSliderOrColor);
  }

  // ── Language switch — re-init i18n + rebuild every translated surface ────
  //
  // Renderer.updateAll only syncs values, not labels — so a language change
  // requires destroying the renderer registry and re-running renderSection
  // for both panels. After that, renderAll() refills the values from storage.
  // _lastKnownLanguage is also updated so handleStorageChange's reconciler
  // can detect cross-context language changes (popup re-opened with a new
  // LANGUAGE applied from another tab).
  async function applyLanguage() {
    const fresh = await Store.getSettings();
    _lastKnownLanguage = fresh.LANGUAGE;
    await I18n.init(fresh.LANGUAGE);
    applyI18nToDOM();
    Renderer.destroy();
    ui.bodyShortcuts.textContent = '';
    ui.bodySettings.textContent = '';
    Renderer.renderSection(ui.bodyShortcuts, Configs.SHORTCUTS, fresh, onSettingChanged);
    Renderer.renderSection(ui.bodySettings,  Configs.SETTINGS,  fresh, onSettingChanged);
    await renderAll();
  }

  // ── Render helpers — pure functions of the state they're given ───────────
  //
  // None of these read module-level state. They take the piece of state
  // they render as a parameter. They're called from renderAll (which reads
  // storage) and sometimes directly with a fresh snapshot — never with a
  // mirror.

  function renderHeader(settings) {
    ui.enableToggle.checked = settings.ENABLED;
    ui.enableLabel.textContent = settings.ENABLED ? I18n.t('toggle_on') : I18n.t('toggle_off');
  }

  function renderBlurCount(isPageBlurred) {
    ui.blurAllBtn.dataset.active = String(!!isPageBlurred);
  }

  function renderBlurList(items) {
    const list = Array.isArray(items) ? items : [];
    const count = list.length;
    ui.blurListCount.textContent = count;
    const sectionEl = document.getElementById('sectionBlurred');
    if (sectionEl) sectionEl.style.display = count > 0 ? '' : 'none';
    ui.blurEmpty.classList.toggle('is-visible', count === 0);
    ui.blurList.textContent = '';

    for (const item of list) {
      const li = document.createElement('li');
      li.className = 'bl-si-blur-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'bl-si-blur-item__name';
      nameSpan.textContent = item.name || I18n.t(item.type === 'dynamic' ? 'item_type_dynamic' : 'item_type_sticky');

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
      btn.title = I18n.t('tt_remove_blur_item');
      btn.dataset.itemId = item.type === 'dynamic' ? item.selector : item.id;
      btn.dataset.itemType = item.type;

      li.append(nameSpan, detailSpan, btn);
      ui.blurList.appendChild(li);
    }
  }

  function renderRulesList(rules) {
    const list = Array.isArray(rules) ? rules : [];
    const count = list.length;
    ui.rulesEmpty.classList.toggle('is-visible', count === 0);
    ui.rulesList.style.display = count > 0 ? '' : 'none';
    ui.rulesList.textContent = '';

    for (const rule of list) {
      const li = document.createElement('li');
      li.className = 'bl-si-rule-item';

      const name = document.createElement('span');
      name.className = 'bl-si-rule-item__name';
      name.textContent = rule.name || I18n.t('rule_untitled');

      const pattern = document.createElement('span');
      pattern.className = 'bl-si-rule-item__pattern';
      pattern.textContent = rule.pattern || '';
      pattern.title = `${rule.patternType || 'wildcard'}: ${rule.pattern || ''}`;

      const editBtn = document.createElement('button');
      editBtn.className = 'bl-si-rule-item__btn';
      editBtn.textContent = I18n.t('rule_edit_btn');
      editBtn.title = I18n.t('tt_rule_edit');
      editBtn.addEventListener('click', () => openRuleModal(rule));

      const delBtn = document.createElement('button');
      delBtn.className = 'bl-si-rule-item__btn bl-si-rule-item__btn--delete';
      delBtn.textContent = I18n.t('rule_delete_btn');
      delBtn.title = I18n.t('tt_rule_delete');
      delBtn.addEventListener('click', async () => {
        try {
          const fresh = await Store.getRules();
          const next = fresh.filter(r => r.id !== rule.id);
          await Store.saveRules(next);
          await renderAll();
          showToast(I18n.t('rule_deleted'));
        } catch (err) {
          console.error('[BlurrySite popup] saveRules:', err);
          showToast(I18n.t('toast_failed_delete_rule'));
        }
      });

      li.append(name, pattern, editBtn, delBtn);
      ui.rulesList.appendChild(li);
    }
  }

  // ── renderAll: the reconciler ─────────────────────────────────────────────
  //
  // Reads every piece of state the popup cares about directly from storage
  // and updates every view. Idempotent; safe to call any number of times.
  // This is the popup equivalent of blur_engine.blurAll() — a reconciler
  // that treats storage as the single source of truth and recomputes the
  // UI on every invocation.
  //
  // Called from:
  //   - init() after bootstrap
  //   - Store.onChange (cross-context storage writes)
  //   - every user action after its storage write resolves
  async function renderAll() {
    const popupLog = (blsi && blsi.Logger) ? blsi.Logger.scope('popup') : null;
    if (popupLog) popupLog.flow('renderAll');

    let settings, rules, items, pageBlurred;
    try {
      [settings, rules] = await Promise.all([Store.getSettings(), Store.getRules()]);
      items = currentHost ? await Store.getBlurItems(currentHost) : [];
      pageBlurred = currentHost ? Store.getCachedBlurState(currentHost) : false;
    } catch (err) {
      console.error('[BlurrySite popup] renderAll read failed:', err);
      return;
    }

    // Update every view with fresh state.
    Renderer.updateAll(settings);
    renderHeader(settings);
    renderBlurCount(pageBlurred);
    renderBlurList(items);
    renderRulesList(rules);

    // Derived display (dynamic background blur radius).
    document.documentElement.style.setProperty('--bl-si-bg-blur-radius', settings.BLUR_RADIUS + 'px');
  }

  // ── i18n DOM update ────────────────────────────────────────────────────────

  function applyI18nToDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) el.textContent = I18n.t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (key) el.setAttribute('title', I18n.t(key));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.dataset.i18nAriaLabel;
      if (key) el.setAttribute('aria-label', I18n.t(key));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (key) el.setAttribute('placeholder', I18n.t(key));
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
    // Enable toggle — write ENABLED to storage, reconcile.
    ui.enableToggle.addEventListener('change', async () => {
      const nextEnabled = ui.enableToggle.checked;
      // Optimistic label update so the toast text matches user intent even
      // if the reconcile is still in-flight.
      ui.enableLabel.textContent = nextEnabled ? I18n.t('toggle_on') : I18n.t('toggle_off');
      await patchSettings('ENABLED', nextEnabled, true);
      await renderAll();
      showToast(nextEnabled ? I18n.t('toast_enabled') : I18n.t('toast_disabled'));
    });

    // Theme toggle
    ui.themeToggle.addEventListener('click', toggleTheme);

    // Blur All — flip blur_all_hosts. Content_script reacts via Store.onChange.
    ui.blurAllBtn.addEventListener('click', async () => {
      if (!currentHost) return;
      ui.blurAllBtn.disabled = true;
      try {
        const newState = !Store.getCachedBlurState(currentHost);
        await Store.saveBlurState(currentHost, newState);
        await renderAll();
      } catch (err) {
        console.error('[BlurrySite popup] saveBlurState:', err);
        showToast(I18n.t('toast_failed_toggle_blur'));
      }
      ui.blurAllBtn.disabled = false;
      showToast(I18n.t('toast_blur_all'));
    });

    // Clear All — clear current host's items + blur-all state.
    ui.clearAllBtn.addEventListener('click', async () => {
      if (!currentHost) return;
      ui.clearAllBtn.disabled = true;
      try {
        await Store.clearHost(currentHost);
        await Store.saveBlurState(currentHost, false);
        await renderAll();
      } catch (err) {
        console.error('[BlurrySite popup] clear host:', err);
        showToast(I18n.t('toast_failed_clear_host'));
        ui.clearAllBtn.disabled = false;
        return;
      }
      ui.clearAllBtn.disabled = false;
      showToast(I18n.t('toast_cleared'));
    });

    // Picker — fire-and-forget and then close the popup. Focus should be on
    // the picker pill in the page, not on the popup panel. Closing the
    // popup avoids the user having to click away from it after activating
    // the picker.
    ui.pickerBtn.addEventListener('click', () => {
      if (!currentTab) return;
      chrome.tabs.sendMessage(currentTab.id, { type: MSG.TOGGLE_PICKER }).catch(() => {});
      // Close the popup — the send-message has already been dispatched.
      try { window.close(); } catch (_) {}
    });

    // Accordion toggles
    wireAccordion(ui.settingsToggle, ui.bodySettings);
    wireAccordion(ui.rulesToggle, ui.bodyRules);

    // Rules
    ui.addRuleBtn.addEventListener('click', () => openRuleModal(null));

    // Blur list remove (event delegation) — write, reconcile.
    ui.blurList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.bl-si-blur-item__remove');
      if (!btn) return;
      const itemId = btn.dataset.itemId;
      if (!itemId) return;
      try {
        await Store.removeBlurItem(currentHost, itemId);
        await renderAll();
        showToast(I18n.t('toast_blur_removed'));
      } catch (err) {
        console.error('[BlurrySite popup] removeBlurItem:', err);
        showToast(I18n.t('toast_failed_remove_item'));
      }
    });

    // Clear all sites — wipes blurred_items map across all hostnames.
    ui.clearAllSitesBtn.addEventListener('click', async () => {
      if (!confirm(I18n.t('confirm_clear_all'))) return;
      try {
        await Store.clearAll();
        await renderAll();
        showToast(I18n.t('toast_all_sites_cleared'));
      } catch (err) {
        console.error('[BlurrySite popup] clearAll:', err);
        showToast(I18n.t('toast_failed_clear_all'));
      }
    });

    // Debug flow-log toggle.
    ui.debugToggle.addEventListener('click', () => {
      const Logger = blsi && blsi.Logger;
      if (!Logger) return;
      const next = !Logger.enabled;
      if (next) Logger.enable(); else Logger.disable();
      ui.debugToggle.dataset.active = String(next);
      ui.debugToggle.setAttribute('aria-pressed', String(next));
      showToast(I18n.t(next ? 'toast_flow_logs_on' : 'toast_flow_logs_off'));
    });

    // Help overlay: list every action + its current binding.
    if (ui.helpOverlayBtn) {
      ui.helpOverlayBtn.addEventListener('click', openHelpOverlay);
    }
    if (ui.helpOverlayClose) {
      ui.helpOverlayClose.addEventListener('click', closeHelpOverlay);
    }
  }

  async function renderHelpOverlay() {
    if (!ui.helpOverlayList || !blsi.Actions || !blsi.ShortcutLabel) return;
    ui.helpOverlayList.textContent = '';
    // Pull shortcuts fresh from storage so the help list always reflects
    // the latest bindings — no mirror required.
    let shortcuts = {};
    try {
      const fresh = await Store.getSettings();
      shortcuts = fresh.SHORTCUTS || {};
    } catch (_) {}
    for (const action of blsi.Actions.list()) {
      const li = document.createElement('li');
      li.className = 'bl-si-help-list__item';

      const textBox = document.createElement('div');
      textBox.className = 'bl-si-help-list__text';
      const labelDiv = document.createElement('div');
      labelDiv.className = 'bl-si-help-list__label';
      labelDiv.textContent = action.label;
      const descDiv = document.createElement('div');
      descDiv.className = 'bl-si-help-list__desc';
      descDiv.textContent = action.description || '';
      textBox.appendChild(labelDiv);
      if (action.description) textBox.appendChild(descDiv);

      const kbd = document.createElement('kbd');
      kbd.className = 'bl-si-help-list__kbd';
      const entry = shortcuts[action.id];
      kbd.textContent = (entry && Array.isArray(entry.binding))
        ? blsi.ShortcutLabel.bindingLabel(entry.binding)
        : blsi.ShortcutLabel.bindingLabel(action.defaultBinding);

      li.appendChild(textBox);
      li.appendChild(kbd);
      ui.helpOverlayList.appendChild(li);
    }
  }

  function openHelpOverlay() {
    renderHelpOverlay();
    if (ui.helpOverlayModal) ui.helpOverlayModal.hidden = false;
  }

  function closeHelpOverlay() {
    if (ui.helpOverlayModal) ui.helpOverlayModal.hidden = true;
  }

  async function syncDebugToggleState() {
    try {
      const result = await new Promise((resolve) =>
        chrome.storage.local.get('blsi_debug', resolve)
      );
      const on = result && result.blsi_debug === true;
      if (ui.debugToggle) {
        ui.debugToggle.dataset.active = String(on);
        ui.debugToggle.setAttribute('aria-pressed', String(on));
      }
    } catch (_) {}
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

  // Any storage change (self-echo is already filtered by storage_manager
  // via cache comparison) triggers a full reconcile. Matches how
  // content_script's handleStorageChange collapses blurred_items and
  // blur_all_hosts changes to Engine.blurAll().
  //
  // Special case: a 'settings' change that flips LANGUAGE needs more than
  // renderAll() — it must re-init i18n and rebuild renderer DOM (option
  // labels are baked at renderSection time, not at updateAll time). Detect
  // by reading settings and comparing to _lastKnownLanguage.
  function handleStorageChange(key, _newValue, _oldValue) {
    if (key === 'settings') {
      Store.getSettings().then((s) => {
        if (s.LANGUAGE !== _lastKnownLanguage) {
          applyLanguage();
        } else {
          renderAll();
        }
      });
      return;
    }
    renderAll();
  }

  // ── Shortcut capture modal (v2) ────────────────────────────────────────────
  //
  // Captures a single chord {code, mods} using the new data model. The user
  // holds modifiers (displayed live) and presses one non-modifier key to
  // commit. Guards against Dead/Process/Unidentified/AltGr/composition.
  // Shows inline warnings for collisions with other actions or known
  // browser-reserved chords, but always allows save (last-write-wins).

  let scAction            = null;   // action id being edited
  let scCandidate         = null;   // { code, mods } once the user commits
  let scKeydownHandler    = null;
  let scCleanup           = null;

  async function openShortcutModal(actionId) {
    scAction = actionId;
    scCandidate = null;

    // Snapshot the stored SHORTCUTS so the collision-detection logic below
    // can compare against a stable copy. Refreshed on save; any concurrent
    // write from another context is caught by the save path reading fresh
    // settings before patching.
    let storedShortcuts = {};
    try {
      const fresh = await Store.getSettings();
      storedShortcuts = fresh.SHORTCUTS || {};
    } catch (_) {}

    const title = (blsi.Actions && blsi.Actions.get(actionId))
      ? I18n.t('shortcut_modal_title') + ': ' + blsi.Actions.get(actionId).label
      : I18n.t('shortcut_modal_title');
    if (ui.scModalTitle) ui.scModalTitle.textContent = title;

    ui.scModalSave.disabled = true;
    ui.captureDisplay.textContent = I18n.t('shortcut_modal_placeholder');
    ui.captureDisplay.className = 'bl-si-capture bl-si-capture--listening';
    if (ui.captureWarning) {
      ui.captureWarning.hidden = true;
      ui.captureWarning.textContent = '';
    }
    ui.shortcutModal.hidden = false;

    // Focus the capture surface so the user doesn't have to click.
    try { ui.captureDisplay.focus(); } catch (_) {}

    if (scKeydownHandler) document.removeEventListener('keydown', scKeydownHandler, true);

    const Label = blsi.ShortcutLabel;
    const MODIFIER_CODES = blsi.MODIFIER_CODES;

    function readMods(e) {
      const mods = [];
      if (e.altKey)   mods.push('Alt');
      if (e.ctrlKey)  mods.push('Control');
      if (e.metaKey)  mods.push('Meta');
      if (e.shiftKey) mods.push('Shift');
      return mods;
    }

    function renderPending(mods, code) {
      if (!code && mods.length === 0) {
        ui.captureDisplay.textContent = I18n.t('shortcut_modal_placeholder');
        return;
      }
      const chord = { code: code || '', mods };
      // When no code is set yet, render just the mods + an ellipsis-style hint.
      if (!code) {
        const modPart = mods.map(Label.modLabel).join(Label.IS_MAC ? '' : '+');
        ui.captureDisplay.textContent = modPart + (Label.IS_MAC ? '…' : ' + …');
        return;
      }
      ui.captureDisplay.textContent = Label.chordLabel(chord);
    }

    function refreshWarnings(candidate) {
      if (!ui.captureWarning) return;
      if (!candidate) {
        ui.captureWarning.hidden = true;
        ui.captureWarning.textContent = '';
        return;
      }

      const notes = [];

      // Conflict with another action in the stored shortcuts snapshot.
      const myKey = Label.chordKey(candidate);
      for (const [otherId, other] of Object.entries(storedShortcuts || {})) {
        if (otherId === scAction) continue;
        if (!other || !Array.isArray(other.binding) || other.binding.length !== 1) continue;
        if (Label.chordKey(other.binding[0]) === myKey) {
          const meta = blsi.Actions && blsi.Actions.get(otherId);
          notes.push('Conflicts with ' + (meta ? meta.label : otherId) + ' — only the first match will fire.');
        }
      }

      // Known browser-reserved chord.
      const reserved = blsi.ShortcutReserved && blsi.ShortcutReserved.lookup(candidate);
      if (reserved) {
        notes.push('Overrides a browser shortcut: ' + reserved.label + '. The browser key will no longer work on pages where this extension is active.');
      }

      if (notes.length === 0) {
        ui.captureWarning.hidden = true;
        ui.captureWarning.textContent = '';
      } else {
        ui.captureWarning.hidden = false;
        ui.captureWarning.textContent = notes.join(' ');
      }
    }

    scKeydownHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Guards — same as shortcut_handler matcher.
      if (e.isComposing) return;
      if (e.key === 'Process' || e.key === 'Dead' || e.key === 'Unidentified') return;
      if (e.getModifierState && e.getModifierState('AltGraph')) return;

      // Escape cancels (even if a candidate exists).
      if (e.code === 'Escape') { closeShortcutModal(); return; }

      const mods = readMods(e);

      // Pure modifier keydown: preview, don't commit.
      if (MODIFIER_CODES.has(e.code)) {
        renderPending(mods, null);
        return;
      }

      // Non-modifier keydown: commit the chord (requires at least one modifier).
      if (mods.length === 0) {
        ui.captureDisplay.textContent = I18n.t('shortcut_modal_no_modifier');
        return;
      }

      // Ctrl+Alt without another modifier collides with AltGr — reject.
      const modSet = new Set(mods);
      if (modSet.has('Control') && modSet.has('Alt') && !modSet.has('Shift') && !modSet.has('Meta')) {
        ui.captureDisplay.textContent = I18n.t('shortcut_modal_ctrl_alt');
        return;
      }

      scCandidate = { code: e.code, mods: [...mods].sort() };
      ui.captureDisplay.className = 'bl-si-capture bl-si-capture--done';
      ui.captureDisplay.textContent = Label.chordLabel(scCandidate);
      ui.scModalSave.disabled = false;
      refreshWarnings(scCandidate);
    };

    document.addEventListener('keydown', scKeydownHandler, true);

    const onSave = async () => {
      try {
        if (!scCandidate) return;
        // Read-modify-write against fresh storage so a concurrent write
        // from another context isn't clobbered.
        const fresh = await Store.getSettings();
        Renderer.setByPath(fresh, 'SHORTCUTS.' + scAction, {
          binding: [{ code: scCandidate.code, mods: [...scCandidate.mods] }],
        });
        await Store.saveSettings(fresh);
        await renderAll();
        closeShortcutModal();
        showToast(I18n.t('shortcut_saved'));
      } finally {
        cleanup();
      }
    };

    const onReset = async () => {
      try {
        const action = blsi.Actions && blsi.Actions.get(scAction);
        if (action) {
          const fresh = await Store.getSettings();
          Renderer.setByPath(fresh, 'SHORTCUTS.' + scAction, {
            binding: action.defaultBinding.map((c) => ({ code: c.code, mods: [...c.mods] })),
          });
          await Store.saveSettings(fresh);
          await renderAll();
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
    scCandidate = null;
  }

  // ── Rule editor modal ──────────────────────────────────────────────────────

  let ruleSettings = {};
  let _ruleModalOnSave = null;
  let _ruleModalOnCancel = null;

  async function openRuleModal(existingRule) {
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

    // Pull the global settings fresh from storage — the overrides panel
    // shows each row's "Global default" next to the override control, and
    // we want those defaults to be current.
    let globalSettingsSnapshot = {};
    try {
      globalSettingsSnapshot = await Store.getSettings();
    } catch (_) {}

    // Render overrides using the renderer in ruleMode
    ui.ruleOverrides.textContent = '';
    // Filter out shortcut configs — shortcuts aren't overridable per rule
    const overridableConfigs = Configs.ALL.filter(c => c.type !== 'shortcut');
    Renderer.renderSection(ui.ruleOverrides, overridableConfigs, ruleSettings, onRuleSettingChanged, { ruleMode: true, globalSettings: globalSettingsSnapshot });

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

      // Read-modify-write against fresh storage so a concurrent rule edit
      // from another context isn't clobbered.
      let rules;
      try {
        rules = await Store.getRules();
      } catch (err) {
        console.error('[BlurrySite popup] getRules:', err);
        showToast(I18n.t('toast_failed_save_rule'));
        return;
      }
      rules = Array.isArray(rules) ? rules.slice() : [];

      if (editingRuleId) {
        const idx = rules.findIndex(r => r.id === editingRuleId);
        if (idx >= 0) {
          rules[idx] = { ...rules[idx], name, pattern, patternType: ui.rulePatternType.value, settings: cleanSettings };
        }
      } else {
        rules.push({
          id: 'r_' + Math.random().toString(36).slice(2, 10),
          name, pattern,
          patternType: ui.rulePatternType.value,
          settings: cleanSettings,
        });
      }

      try {
        await Store.saveRules(rules);
      } catch (err) {
        console.error('[BlurrySite popup] saveRules:', err);
        showToast(I18n.t('toast_failed_save_rule'));
        return;
      }
      await renderAll();
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
    syncDebugToggleState();
    const popupLog = (blsi && blsi.Logger) ? blsi.Logger.scope('popup') : null;
    if (popupLog) popupLog.flow('init');

    // Theme
    await initTheme();

    // Storage cache + settings must load before I18n.init so we can honor
    // the user's chosen LANGUAGE on first paint instead of flashing the
    // browser default. The bootstrapSettings snapshot is reused below by
    // Renderer.renderSection — no second Store.getSettings call.
    try { await Store.initCache(); } catch (_e) {}
    const bootstrapSettings = await Store.getSettings();
    _lastKnownLanguage = bootstrapSettings.LANGUAGE;

    // i18n — initialised with the persisted LANGUAGE preference.
    await I18n.init(bootstrapSettings.LANGUAGE);
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

    // One-time scaffolding: render the settings/shortcut section DOM once
    // with the bootstrap settings (already fetched above for I18n.init).
    // Row values are filled in by renderAll() → Renderer.updateAll() next.
    Renderer.renderSection(ui.bodyShortcuts, Configs.SHORTCUTS, bootstrapSettings, onSettingChanged);
    Renderer.renderSection(ui.bodySettings, Configs.SETTINGS, bootstrapSettings, onSettingChanged);

    // First full reconcile — reads storage and populates every view.
    await renderAll();

    // Wire controls after the initial render so handlers aren't attached
    // to stale DOM nodes from the renderSection pass.
    wireControls();

    // Query picker state from content script (in-memory, not in storage).
    // This is the one piece of state the popup can't read from Store.
    if (currentTab) {
      try {
        const status = await tabMessage(currentTab.id, { type: MSG.GET_STATUS });
        if (status) {
          isPickerActive = status.isPickerActive || false;
          ui.pickerBtn.dataset.active = String(isPickerActive);
        }
      } catch (e) { console.warn('[PB] GET_STATUS:', e); }
    }

    // Subscribe to storage changes from other contexts (content_script,
    // other tabs). Every change triggers a full renderAll reconcile.
    Store.onChange(handleStorageChange);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => console.error('[PB popup] Init error:', err));
  });
})();
