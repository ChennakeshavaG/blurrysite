/**
 * PrivacyBlur — Popup Controller
 * Manages the extension popup UI: settings sync, blurred-element list,
 * per-tab messaging, and control wiring.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const MSG = Object.freeze({
  GET_SETTINGS:    'GET_SETTINGS',
  SAVE_SETTINGS:   'SAVE_SETTINGS',
  GET_SELECTORS:   'GET_SELECTORS',
  REMOVE_SELECTOR: 'REMOVE_SELECTOR',
  CLEAR_HOST:      'CLEAR_HOST',
  CLEAR_ALL:       'CLEAR_ALL',
  TOGGLE_BLUR_ALL: 'TOGGLE_BLUR_ALL',
  CLEAR_ALL_BLUR:  'CLEAR_ALL_BLUR',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled:           true,
  blurRadius:        8,
  transitionDuration: 200,
  revealOnHover:     false,
  highlightColor:    '#f59e0b',
  shortcuts: Object.freeze({
    chordKey1:     'k',
    chordKey2:     'v',
    chordModifier: 'ctrl',
  }),
});

const DEBOUNCE_DELAY_MS = 300;
const TOAST_DURATION_MS = 1800;

// ─── State ────────────────────────────────────────────────────────────────────

let currentTab    = null;
let currentHost   = '';
let settings      = { ...DEFAULT_SETTINGS };
let blurredItems  = [];   // string[] of CSS selectors
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
  hoverRevealToggle: $('hoverRevealToggle'),
  highlightColor:    $('highlightColor'),
  blurList:          $('blurList'),
  blurListEmpty:     $('blurListEmpty'),
  listCount:         $('listCount'),
  clearAllSitesBtn:  $('clearAllSitesBtn'),
  extVersion:        $('extVersion'),
  toast:             $('toast'),
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
  ui.enableToggle.checked = settings.enabled;
  ui.enableLabel.textContent = settings.enabled ? 'On' : 'Off';
}

function renderStatusBadge(count) {
  ui.blurCount.textContent = count;
  ui.blurCount.classList.toggle('status-badge--zero', count === 0);
}

function renderSettingsPanel() {
  ui.blurRadius.value           = settings.blurRadius;
  ui.blurRadiusValue.textContent = `${settings.blurRadius}px`;
  ui.transitionToggle.checked   = (settings.transitionDuration || 0) > 0;
  ui.hoverRevealToggle.checked  = settings.revealOnHover;
  ui.highlightColor.value       = settings.highlightColor;
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
  ui.extVersion.textContent = `v${manifest.version}`;

  // Get current active tab — filter to http/https pages where content scripts run.
  // When opened as a new page (dev/testing), the "active" tab may be the popup itself.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = tabs.find(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));

  // Fallback: if no http tab is active in this window, try lastFocusedWindow.
  if (!tab) {
    const fallbackTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = fallbackTabs.find(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
  }

  // Final fallback: find any http tab in any window.
  if (!tab) {
    const allTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    if (allTabs.length > 0) {
      // Pick the most recently accessed tab.
      allTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      tab = allTabs[0];
    }
  }

  currentTab  = tab || null;
  currentHost = tab ? extractHostname(tab.url) : '';
  ui.hostname.textContent = currentHost || '—';
  ui.hostname.title = currentHost;

  // Fetch settings from background
  const resp = await bgMessage({ type: MSG.GET_SETTINGS });
  if (resp && resp.settings) {
    settings = { ...DEFAULT_SETTINGS, ...resp.settings };
  }

  // Fetch blurred selectors for this hostname
  blurredItems = await fetchBlurredSelectors();

  // Render everything
  renderEnableToggle();
  renderSettingsPanel();
  renderBlurList();
  renderChordDisplay();

  // Wire controls
  wireControls();
}

// ─── Control wiring ──────────────────────────────────────────────────────────

function wireControls() {
  // Enable / disable toggle — save settings and notify tab via UPDATE_SETTINGS
  ui.enableToggle.addEventListener('change', async () => {
    settings.enabled = ui.enableToggle.checked;
    ui.enableLabel.textContent = settings.enabled ? 'On' : 'Off';
    await saveSettings(true);
    showToast(settings.enabled ? 'PrivacyBlur enabled' : 'PrivacyBlur disabled');
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

  // Blur radius slider (debounced)
  const saveRadius = debounce(async () => {
    await saveSettings();
    showToast(`Blur radius: ${settings.blurRadius}px`);
  }, DEBOUNCE_DELAY_MS);

  ui.blurRadius.addEventListener('input', () => {
    settings.blurRadius = Number(ui.blurRadius.value);
    ui.blurRadiusValue.textContent = `${settings.blurRadius}px`;
    saveRadius();
  });

  // Smooth transition toggle — maps to transitionDuration (0 = off, 200 = on)
  ui.transitionToggle.addEventListener('change', async () => {
    settings.transitionDuration = ui.transitionToggle.checked ? 200 : 0;
    await saveSettings();
    showToast(ui.transitionToggle.checked ? 'Smooth transition on' : 'Instant transition');
  });

  // Reveal on hover toggle
  ui.hoverRevealToggle.addEventListener('change', async () => {
    settings.revealOnHover = ui.hoverRevealToggle.checked;
    await saveSettings();
    showToast(settings.revealOnHover ? 'Reveal on hover on' : 'Reveal on hover off');
  });

  // Highlight color (debounced)
  const saveColor = debounce(async () => {
    await saveSettings();
    showToast('Highlight color saved');
  }, DEBOUNCE_DELAY_MS);

  ui.highlightColor.addEventListener('input', () => {
    settings.highlightColor = ui.highlightColor.value;
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
      await tabMessage(currentTab.id, { type: 'UNBLUR_SELECTOR', selector });
    }

    blurredItems = blurredItems.filter(s => s !== selector);
    renderBlurList();
    showToast('Blur removed');
  });

  // Shortcut "customize" button — open key-capture modal for chord
  document.querySelectorAll('.shortcut-customize').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.shortcut === 'chord') {
        openShortcutModal();
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

// ─── Shortcut customization modal ────────────────────────────────────────────

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** Map event modifier to storage key name */
function getModifierName(e) {
  if (e.ctrlKey)  return 'ctrl';
  if (e.altKey)   return 'alt';
  if (e.metaKey)  return 'meta';
  if (e.shiftKey) return 'shift';
  return null;
}

/** Pretty-print a modifier name for display */
function modifierLabel(mod) {
  const labels = { ctrl: 'Ctrl', alt: 'Alt', meta: 'Cmd', shift: 'Shift' };
  return labels[mod] || mod;
}

/** Update the chord keys display in the shortcuts list */
function renderChordDisplay() {
  const display = document.getElementById('chordKeysDisplay');
  if (!display) return;
  const s = settings.shortcuts || {};
  const mod = modifierLabel(s.chordModifier || 'ctrl');
  const k1  = (s.chordKey1 || 'k').toUpperCase();
  const k2  = (s.chordKey2 || 'v').toUpperCase();

  display.textContent = '';
  const kbd1 = document.createElement('kbd');
  kbd1.textContent = mod;
  const kbd2 = document.createElement('kbd');
  kbd2.textContent = k1;
  const then = document.createTextNode(' then ');
  const kbd3 = document.createElement('kbd');
  kbd3.textContent = k2;
  display.append(kbd1, kbd2, then, kbd3);
}

let modalKeyHandler = null;
let pendingChord = { modifier: null, key1: null, key2: null };
let modalPhase = 0; // 0 = waiting for first combo, 1 = waiting for second key

function openShortcutModal() {
  const modal      = document.getElementById('shortcutModal');
  const step1      = document.getElementById('modalStep1');
  const step2      = document.getElementById('modalStep2');
  const cap1       = document.getElementById('captureDisplay');
  const cap2       = document.getElementById('captureDisplay2');
  const saveBtn    = document.getElementById('modalSave');
  const cancelBtn  = document.getElementById('modalCancel');
  const resetBtn   = document.getElementById('modalReset');

  // Reset state
  pendingChord = { modifier: null, key1: null, key2: null };
  modalPhase = 0;
  saveBtn.disabled = true;

  step1.classList.add('modal__step--active');
  step1.classList.remove('modal__step--dim');
  step2.classList.add('modal__step--dim');
  step2.classList.remove('modal__step--active');
  cap1.textContent = 'Press a key combo...';
  cap1.className = 'modal__capture modal__capture--listening';
  cap2.textContent = 'Waiting...';
  cap2.className = 'modal__capture modal__capture--dim';

  modal.hidden = false;

  // Key capture handler
  if (modalKeyHandler) document.removeEventListener('keydown', modalKeyHandler, true);

  modalKeyHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      closeShortcutModal();
      return;
    }

    // Ignore bare modifier presses
    if (MODIFIER_KEYS.has(e.key)) return;

    if (modalPhase === 0) {
      // Phase 1: capture modifier + key
      const mod = getModifierName(e);
      if (!mod) {
        cap1.textContent = 'Hold a modifier (Ctrl/Alt/Shift) + a key';
        return;
      }
      pendingChord.modifier = mod;
      pendingChord.key1 = e.key.toLowerCase();
      cap1.textContent = `${modifierLabel(mod)} + ${e.key.toUpperCase()}`;
      cap1.className = 'modal__capture modal__capture--done';

      // Move to phase 2
      modalPhase = 1;
      step1.classList.remove('modal__step--active');
      step2.classList.remove('modal__step--dim');
      step2.classList.add('modal__step--active');
      cap2.textContent = 'Press a single key...';
      cap2.className = 'modal__capture modal__capture--listening';
    } else if (modalPhase === 1) {
      // Phase 2: capture second key (no modifier required)
      if (e.ctrlKey || e.altKey || e.metaKey) {
        cap2.textContent = 'Just press a single key (no modifier)';
        return;
      }
      pendingChord.key2 = e.key.toLowerCase();
      cap2.textContent = e.key.toUpperCase();
      cap2.className = 'modal__capture modal__capture--done';
      saveBtn.disabled = false;

      // Remove listener — capture complete
      document.removeEventListener('keydown', modalKeyHandler, true);
      modalKeyHandler = null;
    }
  };

  document.addEventListener('keydown', modalKeyHandler, true);

  // Save button
  const onSave = async () => {
    if (!pendingChord.modifier || !pendingChord.key1 || !pendingChord.key2) return;
    settings.shortcuts = {
      chordModifier: pendingChord.modifier,
      chordKey1:     pendingChord.key1,
      chordKey2:     pendingChord.key2,
    };
    await saveSettings(true);
    renderChordDisplay();
    closeShortcutModal();
    showToast('Chord shortcut saved');
    cleanupModalListeners();
  };

  // Reset button — restore defaults
  const onReset = async () => {
    settings.shortcuts = {
      chordModifier: 'ctrl',
      chordKey1:     'k',
      chordKey2:     'v',
    };
    await saveSettings(true);
    renderChordDisplay();
    closeShortcutModal();
    showToast('Chord shortcut reset to default');
    cleanupModalListeners();
  };

  const onCancel = () => {
    closeShortcutModal();
    cleanupModalListeners();
  };

  function cleanupModalListeners() {
    saveBtn.removeEventListener('click', onSave);
    cancelBtn.removeEventListener('click', onCancel);
    resetBtn.removeEventListener('click', onReset);
  }

  saveBtn.addEventListener('click', onSave);
  cancelBtn.addEventListener('click', onCancel);
  resetBtn.addEventListener('click', onReset);
}

function closeShortcutModal() {
  const modal = document.getElementById('shortcutModal');
  modal.hidden = true;
  if (modalKeyHandler) {
    document.removeEventListener('keydown', modalKeyHandler, true);
    modalKeyHandler = null;
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[PrivacyBlur popup] Init error:', err);
  });
});
