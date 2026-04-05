/**
 * PrivacyBlur — Popup Controller
 * Manages the extension popup UI: settings sync, blurred-element list,
 * per-tab messaging, and control wiring.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

// Message type constants — loaded from src/constants.js via manifest.
// popup.html must include <script src="../src/constants.js"></script> before this file.
const MSG = window.PrivacyBlur;

// Settings sourced from constants.js — no local DEFAULT_SETTINGS copy.
const DEBOUNCE_DELAY_MS = 300;
const TOAST_DURATION_MS = 1800;

// ─── State ────────────────────────────────────────────────────────────────────

let currentTab    = null;
let currentHost   = '';
let settings      = MSG.buildDefaultSettings();
let blurredItems  = [];   // string[] of CSS selectors
let urlRules      = [];   // URL rules array from storage
let toastTimer    = null;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const ui = {
  enableToggle:      $('enableToggle'),
  enableLabel:       $('enableLabel'),
  hostname:          $('hostname'),
  blurCount:         $('blurCount'),
  blurAllBtn:        $('blurAllBtn'),
  clearPageBtn:      $('clearPageBtn'),
  settingsToggle:    $('settingsToggle'),
  settingsBody:      $('settingsBody'),
  blurRadius:        $('blurRadius'),
  blurRadiusValue:   $('blurRadiusValue'),
  transitionToggle:  $('transitionToggle'),
  revealModeSelect:  $('revealModeSelect'),
  highlightColor:    $('highlightColor'),
  blurList:          $('blurList'),
  blurListEmpty:     $('blurListEmpty'),
  listCount:         $('listCount'),
  clearAllSitesBtn:  $('clearAllSitesBtn'),
  extVersion:        $('extVersion'),
  toast:             $('toast'),
  // Category toggles
  thoroughBlur:      $('thoroughBlur'),
  categoriesToggle:  $('categoriesToggle'),
  categoriesBody:    $('categoriesBody'),
  catText:           $('catText'),
  catMedia:          $('catMedia'),
  catForm:           $('catForm'),
  catTable:          $('catTable'),
  catStructure:      $('catStructure'),
  // URL Rules
  rulesToggle:       $('rulesToggle'),
  rulesBody:         $('rulesBody'),
  rulesCount:        $('rulesCount'),
  rulesList:         $('rulesList'),
  rulesListEmpty:    $('rulesListEmpty'),
  addRuleBtn:        $('addRuleBtn'),
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Send a Chrome runtime message to the background service worker.
 * Returns null on failure instead of throwing.
 */
async function bgMessage(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.warn('[PrivacyBlur popup] bgMessage failed:', err.message);
    return null;
  }
}

/**
 * Send a message to a content script running in a specific tab.
 * Silently fails for restricted pages (chrome://, about:, etc.).
 */
async function tabMessage(tabId, msg) {
  try {
    // Race against a timeout so the popup never hangs if the content script
    // doesn't respond (e.g. tab navigating, extension context invalidated).
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, msg),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
  } catch (err) {
    // Content script not present — non-fatal (chrome:// pages, etc.)
    console.warn('[PrivacyBlur popup] tabMessage failed:', err.message);
    return null;
  }
}

/**
 * Simple debounce — resets timer on every call.
 */
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Show a brief non-blocking toast notification.
 */
function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add('toast--visible');
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('toast--visible');
  }, TOAST_DURATION_MS);
}

/**
 * Extract a clean hostname from a URL, falling back to the raw value.
 */
function extractHostname(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || '—';
  }
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderEnableToggle() {
  ui.enableToggle.checked = settings.ENABLED;
  ui.enableLabel.textContent = settings.ENABLED ? 'On' : 'Off';
}

function renderStatusBadge(count) {
  ui.blurCount.textContent = count;
  ui.blurCount.classList.toggle('status-badge--zero', count === 0);
}

function renderSettingsPanel() {
  ui.blurRadius.value           = settings.BLUR_RADIUS;
  ui.blurRadiusValue.textContent = `${settings.BLUR_RADIUS}px`;
  ui.transitionToggle.checked   = (settings.TRANSITION_DURATION || 0) > 0;
  ui.revealModeSelect.value     = settings.REVEAL_MODE || 'click';
  ui.highlightColor.value       = settings.HIGHLIGHT_COLOR;
}

function renderCategoryToggles() {
  ui.thoroughBlur.checked = settings.THOROUGH_BLUR;
  const cats = settings.BLUR_CATEGORIES;
  ui.catText.checked      = cats.TEXT;
  ui.catMedia.checked     = cats.MEDIA;
  ui.catForm.checked      = cats.FORM;
  ui.catTable.checked     = cats.TABLE;
  ui.catStructure.checked = cats.STRUCTURE;
}

function renderBlurList() {
  const count = blurredItems.length;

  // Update counts
  renderStatusBadge(count);
  ui.listCount.textContent = count;

  // Empty state
  ui.blurListEmpty.classList.toggle('is-visible', count === 0);

  // Build list
  ui.blurList.innerHTML = '';
  blurredItems.forEach((selector, index) => {
    const li     = document.createElement('li');
    li.className = 'blur-list-item';
    li.dataset.index = index;

    const span   = document.createElement('span');
    span.className = 'blur-list-item__selector';
    span.textContent = selector;
    span.title = selector;

    const btn    = document.createElement('button');
    btn.className = 'blur-list-item__remove';
    btn.textContent = '×';
    btn.title = 'Remove blur';
    btn.setAttribute('aria-label', `Remove blur for ${selector}`);
    btn.dataset.selector = selector;

    li.append(span, btn);
    ui.blurList.appendChild(li);
  });
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

/**
 * Persist updated settings to the background and optionally notify the active tab.
 */
async function saveSettings(notifyTab = true) {
  await bgMessage({ type: MSG.SAVE_SETTINGS, settings });
  if (notifyTab && currentTab) {
    await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
  }
}

/**
 * Fetch blurred selectors for the current hostname from background storage.
 */
async function fetchBlurredSelectors() {
  if (!currentHost) return [];
  const resp = await bgMessage({ type: MSG.GET_SELECTORS, hostname: currentHost });
  return (resp && Array.isArray(resp.selectors)) ? resp.selectors : [];
}

// ─── Initialisation ──────────────────────────────────────────────────────────

async function init() {

  // Set extension version from manifest
  const manifest = chrome.runtime.getManifest();
  ui.extVersion.textContent = `${manifest.version}`;

  // Get current active tab — filter to http/https pages where content scripts run.
  // When opened as a new page (dev/testing), the "active" tab may be the popup itself.
  const allTabs = await chrome.tabs.query({ url: ['*://*/*'] });
  let tab = null;
  // find last accessed http tab in any window. 
    if (allTabs && allTabs.length > 0) {
      // Pick the most recently accessed tab. 
      allTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      tab = allTabs[0];
    }

  currentTab  = tab || null;
  currentHost = tab ? extractHostname(tab.url) : '';
  ui.hostname.textContent = currentHost || '—';
  ui.hostname.title = currentHost;

  // Fetch settings from background (already merged with defaults)
  const resp = await bgMessage({ type: MSG.GET_SETTINGS });
  if (resp && resp.settings) {
    // Background already deep-merges with DEFAULT_SETTINGS before responding.
    settings = resp.settings;
  }

  // Fetch blurred selectors and URL rules
  blurredItems = await fetchBlurredSelectors();
  const rulesResp = await bgMessage({ type: MSG.GET_RULES });
  if (rulesResp && Array.isArray(rulesResp.rules)) urlRules = rulesResp.rules;

  // Wire controls FIRST so buttons are responsive even if rendering fails.
  wireControls();

  // Then render — each wrapped individually so one failure doesn't block others.
  try { renderEnableToggle(); } catch (e) { console.warn('[PB popup] renderEnableToggle:', e); }
  try { renderSettingsPanel(); } catch (e) { console.warn('[PB popup] renderSettingsPanel:', e); }
  try { renderCategoryToggles(); } catch (e) { console.warn('[PB popup] renderCategoryToggles:', e); }
  try { renderRulesList(); } catch (e) { console.warn('[PB popup] renderRulesList:', e); }
  try { renderBlurList(); } catch (e) { console.warn('[PB popup] renderBlurList:', e); }
  try { renderShortcutDisplays(); } catch (e) { console.warn('[PB popup] renderShortcutDisplays:', e); }
}

// ─── Control wiring ──────────────────────────────────────────────────────────

function wireControls() {
  // Enable / disable toggle — save settings and notify tab via UPDATE_SETTINGS
  ui.enableToggle.addEventListener('change', async () => {
    settings.ENABLED = ui.enableToggle.checked;
    ui.enableLabel.textContent = settings.ENABLED ? 'On' : 'Off';
    await saveSettings(true);
    showToast(settings.ENABLED ? 'PrivacyBlur enabled' : 'PrivacyBlur disabled');
  });

  // Blur All button
  ui.blurAllBtn.addEventListener('click', async () => {
  
    if (!currentTab) return;
    ui.blurAllBtn.disabled = true;
    await tabMessage(currentTab.id, { type: MSG.TOGGLE_BLUR_ALL });
    // Re-fetch list after a short tick so content script has time to update storage
    setTimeout(async () => {
      blurredItems = await fetchBlurredSelectors();
      renderBlurList();
      ui.blurAllBtn.disabled = false;
    }, 200);
    showToast('All elements blurred');
  });

  // Clear Page button — wipe all selectors for this host via background
  ui.clearPageBtn.addEventListener('click', async () => {
    if (!currentTab) return;
    ui.clearPageBtn.disabled = true;
    await bgMessage({ type: MSG.CLEAR_HOST, hostname: currentHost });
    await tabMessage(currentTab.id, { type: MSG.CLEAR_ALL_BLUR });
    blurredItems = [];
    renderBlurList();
    ui.clearPageBtn.disabled = false;
    showToast('Page cleared');
  });

  // Settings collapsible
  ui.settingsToggle.addEventListener('click', () => {
    const isOpen = ui.settingsBody.classList.toggle('is-open');
    ui.settingsToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Categories collapsible
  ui.categoriesToggle.addEventListener('click', () => {
    const isOpen = ui.categoriesBody.classList.toggle('is-open');
    ui.categoriesToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // URL Rules collapsible + add button
  ui.rulesToggle.addEventListener('click', () => {
    const isOpen = ui.rulesBody.classList.toggle('is-open');
    ui.rulesToggle.setAttribute('aria-expanded', String(isOpen));
  });

  ui.addRuleBtn.addEventListener('click', () => {
    openRuleModal(null);
  });

  // Thorough blur toggle
  ui.thoroughBlur.addEventListener('change', async () => {
    settings.THOROUGH_BLUR = ui.thoroughBlur.checked;
    await saveSettings(true);
  });

  // Category toggles — each updates one key in settings.BLUR_CATEGORIES
  const categoryMap = {
    catText:      'TEXT',
    catMedia:     'MEDIA',
    catForm:      'FORM',
    catTable:     'TABLE',
    catStructure: 'STRUCTURE',
  };
  for (const [uiKey, catName] of Object.entries(categoryMap)) {
    ui[uiKey].addEventListener('change', async () => {
      settings.BLUR_CATEGORIES[catName] = ui[uiKey].checked;
      await saveSettings(true);
    });
  }

  // Blur radius slider (debounced)
  const saveRadius = debounce(async () => {
    await saveSettings();
    showToast(`Blur radius: ${settings.BLUR_RADIUS}px`);
  }, DEBOUNCE_DELAY_MS);

  ui.blurRadius.addEventListener('input', () => {
    settings.BLUR_RADIUS = Number(ui.blurRadius.value);
    ui.blurRadiusValue.textContent = `${settings.BLUR_RADIUS}px`;
    saveRadius();
  });

  // Smooth transition toggle — maps to transitionDuration (0 = off, 200 = on)
  ui.transitionToggle.addEventListener('change', async () => {
    settings.TRANSITION_DURATION = ui.transitionToggle.checked ? 200 : 0;
    await saveSettings();
    showToast(ui.transitionToggle.checked ? 'Smooth transition on' : 'Instant transition');
  });

  // Reveal mode select
  ui.revealModeSelect.addEventListener('change', async () => {
    settings.REVEAL_MODE = ui.revealModeSelect.value;
    await saveSettings(true);
    const labels = { click: 'Click to peek', hover: 'Hover to peek', none: 'Reveal disabled' };
    showToast(labels[settings.REVEAL_MODE] || 'Reveal mode updated');
  });

  // Highlight color (debounced)
  const saveColor = debounce(async () => {
    await saveSettings();
    showToast('Highlight color saved');
  }, DEBOUNCE_DELAY_MS);

  ui.highlightColor.addEventListener('input', () => {
    settings.HIGHLIGHT_COLOR = ui.highlightColor.value;
    saveColor();
  });

  // Blurred list: remove individual item (event delegation)
  ui.blurList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.blur-list-item__remove');
    if (!btn) return;

    const selector = btn.dataset.selector;
    if (!selector) return;

    // Remove from background storage
    await bgMessage({ type: MSG.REMOVE_SELECTOR, hostname: currentHost, selector });

    // Unblur the DOM element in the active tab
    if (currentTab) {
      await tabMessage(currentTab.id, { type: MSG.UNBLUR_SELECTOR, selector });
    }

    blurredItems = blurredItems.filter(s => s !== selector);
    renderBlurList();
    showToast('Blur removed');
  });

  // Shortcut "customize" buttons — open capture modal for the specified action
  document.querySelectorAll('.shortcut-customize').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.shortcut;
      if (action && settings.SHORTCUTS && settings.SHORTCUTS[action]) {
        openShortcutModal(action);
      }
    });
  });

  // Clear all sites — wipe entire blurred_selectors map via background
  ui.clearAllSitesBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'This will remove ALL blurred elements across every website. Continue?'
    );
    if (!confirmed) return;

    await bgMessage({ type: MSG.CLEAR_ALL });

    blurredItems = [];
    renderBlurList();

    if (currentTab) {
      await tabMessage(currentTab.id, { type: MSG.CLEAR_ALL_BLUR });
    }
    showToast('All sites cleared');
  });
}

// ─── URL Rules CRUD ─────────────────────────────────────────────────────────

function generateRuleId() {
  return 'r_' + Math.random().toString(36).slice(2, 10);
}

function renderRulesList() {
  const count = urlRules.length;
  ui.rulesCount.textContent = String(count);
  ui.rulesListEmpty.style.display = count === 0 ? '' : 'none';
  ui.rulesList.style.display = count > 0 ? '' : 'none';

  ui.rulesList.textContent = '';
  for (const rule of urlRules) {
    const li = document.createElement('li');
    li.className = 'rule-item';

    const name = document.createElement('span');
    name.className = 'rule-item__name';
    name.textContent = rule.name || 'Untitled';
    name.title = rule.name || '';

    const pattern = document.createElement('span');
    pattern.className = 'rule-item__pattern';
    pattern.textContent = rule.pattern || '';
    pattern.title = `${rule.patternType || 'wildcard'}: ${rule.pattern || ''}`;

    const editBtn = document.createElement('button');
    editBtn.className = 'rule-item__btn';
    editBtn.textContent = 'edit';
    editBtn.addEventListener('click', () => openRuleModal(rule));

    const delBtn = document.createElement('button');
    delBtn.className = 'rule-item__btn rule-item__btn--delete';
    delBtn.textContent = 'del';
    delBtn.addEventListener('click', async () => {
      urlRules = urlRules.filter(r => r.id !== rule.id);
      await bgMessage({ type: MSG.SAVE_RULES, rules: urlRules });
      if (currentTab) {
        await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
      }
      renderRulesList();
      showToast('Rule deleted');
    });

    li.append(name, pattern, editBtn, delBtn);
    ui.rulesList.appendChild(li);
  }
}

let editingRuleId = null; // null = adding new, string = editing existing

function openRuleModal(existingRule) {
  const modal     = document.getElementById('ruleModal');
  const title     = document.getElementById('ruleModalTitle');
  const nameInput = document.getElementById('ruleName');
  const patInput  = document.getElementById('rulePattern');
  const patType   = document.getElementById('rulePatternType');
  const formTgl   = document.getElementById('ruleFormToggle');
  const thorTgl   = document.getElementById('ruleThoroughToggle');
  const radSlider = document.getElementById('ruleBlurRadius');
  const radValue  = document.getElementById('ruleBlurRadiusValue');
  const saveBtn   = document.getElementById('ruleModalSave');
  const cancelBtn = document.getElementById('ruleModalCancel');

  if (existingRule) {
    editingRuleId = existingRule.id;
    title.textContent = 'Edit URL Rule';
    nameInput.value = existingRule.name || '';
    patInput.value = existingRule.pattern || '';
    patType.value = existingRule.patternType || 'wildcard';
    const s = existingRule.settings || {};
    formTgl.checked = !!(s.BLUR_CATEGORIES && s.BLUR_CATEGORIES.FORM);
    thorTgl.checked = !!s.THOROUGH_BLUR;
    radSlider.value = s.BLUR_RADIUS || MSG.DEFAULT_SETTINGS.BLUR_RADIUS;
    radValue.textContent = (s.BLUR_RADIUS || MSG.DEFAULT_SETTINGS.BLUR_RADIUS) + 'px';
  } else {
    editingRuleId = null;
    title.textContent = 'Add URL Rule';
    nameInput.value = '';
    patInput.value = '';
    patType.value = 'wildcard';
    formTgl.checked = false;
    thorTgl.checked = false;
    radSlider.value = 8;
    radValue.textContent = '8px';
  }

  modal.hidden = false;

  radSlider.oninput = () => {
    radValue.textContent = radSlider.value + 'px';
  };

  const onSave = async () => {
    const name = nameInput.value.trim();
    const pattern = patInput.value.trim();
    if (!pattern) {
      showToast('Pattern is required');
      return;
    }
    if (pattern.length > 500) {
      showToast('Pattern too long (max 500 chars)');
      return;
    }
    if (name.length > 100) {
      showToast('Name too long (max 100 chars)');
      return;
    }

    const ruleSettings = {};
    if (formTgl.checked) {
      ruleSettings.BLUR_CATEGORIES = { FORM: true };
    }
    if (thorTgl.checked) {
      ruleSettings.THOROUGH_BLUR = true;
    }
    const radius = Number(radSlider.value);
    if (radius !== 8) {
      ruleSettings.BLUR_RADIUS = radius;
    }

    if (editingRuleId) {
      // Update existing
      const idx = urlRules.findIndex(r => r.id === editingRuleId);
      if (idx >= 0) {
        urlRules[idx] = { ...urlRules[idx], name, pattern, patternType: patType.value, settings: ruleSettings };
      }
    } else {
      // Add new
      urlRules.push({ id: generateRuleId(), name, pattern, patternType: patType.value, settings: ruleSettings });
    }

    await bgMessage({ type: MSG.SAVE_RULES, rules: urlRules });
    // Notify the active tab directly so settings re-resolve immediately
    // (don't rely solely on storage.onChanged which can be delayed)
    if (currentTab) {
      await tabMessage(currentTab.id, { type: MSG.UPDATE_SETTINGS, settings });
    }
    renderRulesList();
    closeRuleModal();
    showToast(editingRuleId ? 'Rule updated' : 'Rule added');
    cleanup();
  };

  const onCancel = () => { closeRuleModal(); cleanup(); };

  function cleanup() {
    saveBtn.removeEventListener('click', onSave);
    cancelBtn.removeEventListener('click', onCancel);
    radSlider.oninput = null;
  }

  saveBtn.addEventListener('click', onSave);
  cancelBtn.addEventListener('click', onCancel);
}

function closeRuleModal() {
  document.getElementById('ruleModal').hidden = true;
  editingRuleId = null;
}

// ─── Shortcut display & capture ─────────────────────────────────────────────

const CODE_LABELS = {
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt',
  MetaLeft: 'L-Cmd', MetaRight: 'R-Cmd',
  CapsLock: 'CapsLock', Fn: 'Fn',
};

function codeLabel(code) {
  return CODE_LABELS[code] || code;
}

function renderShortcutDisplays() {
  const shortcuts = settings.SHORTCUTS || {};
  for (const [action, binding] of Object.entries(shortcuts)) {
    const display = document.getElementById('shortcutDisplay-' + action);
    if (!display || !binding) continue;
    display.textContent = '';

    // Primary modifier
    const modKbd = document.createElement('kbd');
    modKbd.textContent = codeLabel(binding.primaryModifier);
    display.appendChild(modKbd);

    // Additional keys
    if (Array.isArray(binding.keys)) {
      for (const k of binding.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = CODE_LABELS[k.code] || (k.key || '').toUpperCase();
        display.appendChild(kbd);
      }
    }
  }
}

/** Set of modifier key values to ignore during capture (bare modifier press). */
const MODIFIER_KEY_VALUES = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn',
]);

/** Set of modifier event.code values. */
const MODIFIER_CODE_SET = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'Fn',
]);

let modalKeydownHandler = null;
let _activeModalCleanup = null;
let activeModalAction   = null;
let capturedPrimaryMod  = null;
let capturedKeys        = [];   // { key, code }
let capturedKeyCodes    = new Set();

function openShortcutModal(actionName) {
  const modal   = document.getElementById('shortcutModal');
  const cap     = document.getElementById('captureDisplay');
  const saveBtn = document.getElementById('modalSave');
  const cancelBtn = document.getElementById('modalCancel');
  const resetBtn  = document.getElementById('modalReset');

  activeModalAction = actionName;
  capturedPrimaryMod = null;
  capturedKeys = [];
  capturedKeyCodes = new Set();
  saveBtn.disabled = true;
  cap.textContent = 'Press a key combo...';
  cap.className = 'modal__capture modal__capture--listening';
  modal.hidden = false;

  // Remove old handlers
  if (modalKeydownHandler) document.removeEventListener('keydown', modalKeydownHandler, true);

  function updateDisplay() {
    const parts = [];
    if (capturedPrimaryMod) parts.push(codeLabel(capturedPrimaryMod));
    for (const k of capturedKeys) {
      parts.push(CODE_LABELS[k.code] || k.key.toUpperCase());
    }
    cap.textContent = parts.length > 0 ? parts.join(' + ') : 'Press a key combo...';
  }

  modalKeydownHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { closeShortcutModal(); return; }

    // First modifier pressed → set as primary modifier
    if (!capturedPrimaryMod && MODIFIER_CODE_SET.has(e.code)) {
      capturedPrimaryMod = e.code;
      updateDisplay();
      return;
    }

    // Subsequent modifier presses → add to keys array (secondary modifiers)
    if (MODIFIER_CODE_SET.has(e.code) && capturedPrimaryMod && !capturedKeyCodes.has(e.code)) {
      capturedKeys.push({ key: e.key, code: e.code });
      capturedKeyCodes.add(e.code);
      updateDisplay();
      return;
    }

    // Non-modifier key → add to keys, enable save
    if (!MODIFIER_CODE_SET.has(e.code) && !capturedKeyCodes.has(e.code)) {
      if (!capturedPrimaryMod) {
        cap.textContent = 'Hold a modifier first, then press keys';
        return;
      }
      capturedKeys.push({ key: e.key, code: e.code });
      capturedKeyCodes.add(e.code);
      cap.className = 'modal__capture modal__capture--done';
      saveBtn.disabled = false;
      updateDisplay();
    }
  };

  document.addEventListener('keydown', modalKeydownHandler, true);

  // Button handlers
  const onSave = async () => {
    if (!capturedPrimaryMod || capturedKeys.length === 0) return;
    settings.SHORTCUTS[activeModalAction] = {
      primaryModifier: capturedPrimaryMod,
      keys: capturedKeys.map(k => ({ key: k.key, code: k.code })),
    };
    await saveSettings(true);
    renderShortcutDisplays();
    closeShortcutModal();
    showToast('Shortcut saved');
    cleanupModalListeners();
  };

  const onReset = async () => {
    const defaults = MSG.DEFAULT_SETTINGS.SHORTCUTS[activeModalAction];
    if (defaults) {
      settings.SHORTCUTS[activeModalAction] = JSON.parse(JSON.stringify(defaults));
      await saveSettings(true);
      renderShortcutDisplays();
    }
    closeShortcutModal();
    showToast('Shortcut reset to default');
    cleanupModalListeners();
  };

  const onCancel = () => { closeShortcutModal(); cleanupModalListeners(); };

  function cleanupModalListeners() {
    saveBtn.removeEventListener('click', onSave);
    cancelBtn.removeEventListener('click', onCancel);
    resetBtn.removeEventListener('click', onReset);
  }

  _activeModalCleanup = cleanupModalListeners;
  saveBtn.addEventListener('click', onSave);
  cancelBtn.addEventListener('click', onCancel);
  resetBtn.addEventListener('click', onReset);
}

function closeShortcutModal() {
  const modal = document.getElementById('shortcutModal');
  modal.hidden = true;
  if (modalKeydownHandler) {
    document.removeEventListener('keydown', modalKeydownHandler, true);
    modalKeydownHandler = null;
  }
  if (_activeModalCleanup) {
    _activeModalCleanup();
    _activeModalCleanup = null;
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[PrivacyBlur popup] Init error:', err);
  });
});
