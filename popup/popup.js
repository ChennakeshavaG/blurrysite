(() => {
  'use strict';

  const State = window.BlurrySitePopupState;
  const UI    = window.BlurrySitePopupUI;

  let _highlightedRowKey = null;

  // ── Scroll arrows ─────────────────────────────────────────────────────────
  function _updateScrollArrows() {
    const main   = document.getElementById('bl-view-main');
    const upEl   = document.getElementById('bl-scroll-up');
    const downEl = document.getElementById('bl-scroll-down');
    if (!main || !upEl || !downEl) return;
    upEl.classList.toggle('is-visible',   main.scrollTop > 2);
    downEl.classList.toggle('is-visible', main.scrollTop + main.clientHeight < main.scrollHeight - 2);
  }

  function _updateSubpageArrows(bodyEl) {
    if (!bodyEl) return;
    const wrap  = bodyEl.closest('.bl-subpage__scroll-wrap');
    if (!wrap) return;
    const upEl   = wrap.querySelector('.bl-sp-arrow--top');
    const downEl = wrap.querySelector('.bl-sp-arrow--bottom');
    if (upEl)   upEl.classList.toggle('is-visible',   bodyEl.scrollTop > 2);
    if (downEl) downEl.classList.toggle('is-visible', bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 2);
  }

  // ── Open Site Rules sub-page ──────────────────────────────────────────────
  // `opts.focusRule` (optional): { hostname_value, hostname_type } — auto-expand
  // the matching rule card after render. Used by the "Managed by site rule"
  // badges in the Automate / PII sub-pages.
  function _openSiteRulesPage(opts) {
    const bodyEl = document.getElementById('bl-site-rules-body');
    UI.showView('bl-view-site-rules', true);
    BlurrySitePopupRenderSiteRules.renderBody(bodyEl, State.get().settings, {
      onSaveSettings:   _onSave,
      // Reload after every site_rules write so the entire popup state — main
      // view banner, hidden sections, sub-page arrows, etc. — reflects the
      // updated rules without manual re-render plumbing across every screen.
      onSaveRules:      async (newRules) => {
        await State.saveRules(newRules);
        location.reload();
      },
      captureSnapshot:  () => State.captureSnapshot(),
      saveSiteSnapshot: async (hv, ht, snap) => {
        await State.saveSiteSnapshot(hv, ht, snap);
        location.reload();
      },
      getRules:         () => State.getRules(),
    }, opts);
    _updateSubpageArrows(bodyEl);
  }

  // Build a click handler the renders can attach to "Managed by site rule"
  // badges. Pulls ruleMatch from state at click time.
  function _onOpenManagingRule() {
    const { ruleMatch } = State.get();
    if (!ruleMatch) return;
    _openSiteRulesPage({ focusRule: ruleMatch });
  }

  // ── Render coordinator ────────────────────────────────────────────────────
  function _renderCurrent() {
    const st = State.get();
    const { settings, blurItems, isPageBlurred, activeRule } = st;
    BlurrySitePopupRender.renderAll(
      settings, blurItems, isPageBlurred,
      _onSave, _onClearAutomate,
      activeRule, _openSiteRulesPage,
      {
        resolved: st.resolved,
        ruleOverrides: st.ruleOverrides,
        ruleMatch: st.ruleMatch,
        onOpenManagingRule: _onOpenManagingRule,
        onSuppressScreenShare: _onSuppressScreenShare,
        onUnsuppressScreenShare: _onUnsuppressScreenShare,
      },
    );
    UI.updateClearAll(settings, blurItems, isPageBlurred);
    _updateScrollArrows();
  }

  async function _saveAndApply(patch) {
    await State.saveSettings(patch);
    if (patch.global_default_settings && patch.global_default_settings.language !== undefined) {
      await blsi.ContentI18n.init(patch.global_default_settings.language);
      UI.applyI18n();
      const generalView = document.getElementById('bl-view-general');
      if (generalView && !generalView.hidden) {
        const bodyEl = document.getElementById('bl-general-body');
        BlurrySitePopupRenderGeneral.renderBody(bodyEl, State.get().settings, _generalCallbacks());
      }
    }
    _renderCurrent();
  }

  async function _onSave(patch) {
    await _saveAndApply(patch);
  }

  async function _onClearAutomate() {
    await State.clearAutomateBlur();
    _renderCurrent();
  }

  // scope ∈ 'tab' | 'site_session' | 'feature'
  async function _onSuppressScreenShare(scope) {
    await State.suppressScreenShare(scope);
    _renderCurrent();
  }

  async function _onUnsuppressScreenShare(scope) {
    await State.unsuppressScreenShare(scope);
    _renderCurrent();
  }

  // ── Open HTB sub-page ─────────────────────────────────────────────────────
  function _openHtbModify(isBlurAll) {
    const bodyEl = document.getElementById('bl-htb-modify-body');
    BlurrySitePopupRenderHtb.renderBody(bodyEl, State.get().settings, _onSave, isBlurAll);
    UI.showView('bl-view-htb-modify', true);
    _updateSubpageArrows(bodyEl);
  }

  // ── General subpage callbacks ─────────────────────────────────────────────
  function _generalCallbacks() {
    return {
      onSave:        _onSave,
      debugEnabled:  blsi.Logger.enabled,
      onToggleDebug: (on) => { on ? blsi.Logger.enable() : blsi.Logger.disable(); },
      onExport: () => {
        const model = State.exportModel();
        const date  = new Date().toISOString().slice(0, 10);
        const blob  = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = `blurrysite-settings-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      onImport: async (text) => {
        try {
          if (text === null) throw new Error('read error');
          const parsed = JSON.parse(text);
          const valid  = blsi.validate_model(parsed);
          await State.importSettings(valid);
          _renderCurrent();
          UI.showToast('toast_import_success');
        } catch (_) {
          UI.showToast('toast_import_error');
        }
      },
    };
  }

  // ── Picker activation helper ─────────────────────────────────────────────
  // Query picker state first; if already active just close popup (preserve
  // the live picker session). Only send toggle_picker when picker is off.
  function _activatePicker(mode) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: blsi.popup.get_status },
        { frameId: 0 },
        (response) => {
          void chrome.runtime.lastError;
          if (response && response.isPickerActive) {
            window.close();
          } else {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { type: blsi.command.toggle_picker, picker_mode: mode },
              { frameId: 0 },
              () => { void chrome.runtime.lastError; window.close(); }
            );
          }
        }
      );
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      UI.applyTheme(data.blsi_popup_theme || 'dark');
    });

    await blsi.ContentI18n.init('auto');
    UI.applyI18n();
    UI.setVersion();

    const tab = await new Promise((res) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => res(tabs && tabs[0]))
    );
    // Chrome blocks extensions from injecting content scripts on a fixed list
    // of URLs (Web Store, chrome://*, etc.) regardless of host_permissions.
    // Show a dedicated empty state instead of the normal UI — the popup's
    // toggles cannot affect those tabs and silently failing UI looks broken.
    if (blsi.UrlMatcher.isRestrictedUrl(tab && tab.url)) {
      UI.showRestrictedView();
      return;
    }
    let hostname = '';
    if (tab && tab.url) {
      try {
        hostname = new URL(tab.url).hostname;
        UI.setHost(hostname);
      } catch (_) {}
    }

    await State.load(hostname, tab && tab.url ? tab.url : '', tab && tab.id);
    await blsi.ContentI18n.init(State.get().settings.global_default_settings.language);
    UI.applyI18n();

    UI.renderPowerButton(State.get().settings.global_default_settings.enabled);
    _renderCurrent();

    // ── Live reactivity via external storage changes ─────────────────────
    State.onExternalChange((newModel) => {
      if (!newModel) return;
      // storage_model._cache is already set to newModel before on_change fires.
      // refreshFromStorage() re-derives _model + hostname-specific state from the cache.
      // When _hostname is empty (no-URL tab), only _model and _isPageBlurred are updated.
      State.refreshFromStorage();
      const newLang = State.get().settings.global_default_settings.language;
      if (newLang !== blsi.ContentI18n.currentLang) {
        blsi.ContentI18n.init(newLang).then(() => { UI.applyI18n(); _renderCurrent(); });
      } else {
        _renderCurrent();
      }
    });

    // ── Media tooltip ────────────────────────────────────────────────────
    const _tipEl      = document.createElement('div');
    _tipEl.className  = 'bl-media-tooltip';
    const _tipShimmer = document.createElement('div');
    _tipShimmer.className = 'bl-media-tooltip__shimmer';
    const _tipImg     = document.createElement('img');
    _tipImg.className = 'bl-media-tooltip__img';
    _tipImg.alt       = '';
    const _tipVideo   = document.createElement('video');
    _tipVideo.className  = 'bl-media-tooltip__video';
    _tipVideo.autoplay   = true;
    _tipVideo.loop       = true;
    _tipVideo.muted      = true;
    _tipVideo.setAttribute('playsinline', '');
    _tipVideo.hidden     = true;
    const _tipLabel      = document.createElement('p');
    _tipLabel.className  = 'bl-media-tooltip__label';
    const _tipCaption    = document.createElement('p');
    _tipCaption.className = 'bl-media-tooltip__caption';
    _tipEl.appendChild(_tipShimmer);
    _tipEl.appendChild(_tipImg);
    _tipEl.appendChild(_tipVideo);
    _tipEl.appendChild(_tipLabel);
    _tipEl.appendChild(_tipCaption);
    document.body.appendChild(_tipEl);

    let _tipHideTimer = null;

    function _positionTip(chip) {
      const rect = chip.getBoundingClientRect();
      const tipW = 200;
      let   left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
      _tipEl.style.left   = left + 'px';
      _tipEl.style.top    = (rect.bottom + 8) + 'px';
      _tipEl.style.bottom = 'auto';
    }

    function _showTip(chip) {
      clearTimeout(_tipHideTimer);
      const src     = chip.dataset.tooltipMedia   || '';
      const caption = chip.dataset.tooltipCaption || '';
      if (!src && !caption) return;

      _positionTip(chip);
      _tipLabel.textContent = chip.dataset.tooltipLabel || '';
      _tipLabel.hidden = !chip.dataset.tooltipLabel;
      _tipCaption.textContent = caption;

      _tipEl.classList.toggle('bl-media-tooltip--text-only', !src);

      if (!src) {
        _tipImg.hidden   = true;
        _tipVideo.hidden = true;
        _tipImg.src   = '';
        _tipVideo.src = '';
        _tipEl.classList.remove('bl-media-tooltip--loading');
        _tipEl.classList.add('is-visible');
        return;
      }

      const isVideo = /\.(mp4|webm)$/i.test(src);
      _tipImg.hidden   = isVideo;
      _tipVideo.hidden = !isVideo;
      _tipEl.classList.add('bl-media-tooltip--loading');

      if (isVideo) {
        _tipVideo.src = src;
        _tipVideo.load();
        _tipVideo.oncanplay = () => _tipEl.classList.remove('bl-media-tooltip--loading');
        _tipVideo.onerror   = () => { _tipEl.classList.remove('bl-media-tooltip--loading'); _tipVideo.hidden = true; };
      } else {
        _tipImg.onload  = () => _tipEl.classList.remove('bl-media-tooltip--loading');
        _tipImg.onerror = () => { _tipEl.classList.remove('bl-media-tooltip--loading'); _tipImg.hidden = true; };
        _tipImg.src = src + '?_=' + Date.now();
      }

      _tipEl.classList.add('is-visible');
    }

    function _hideTip() {
      _tipHideTimer = setTimeout(() => {
        _tipEl.classList.remove('is-visible');
        _tipImg.src   = '';
        _tipVideo.src = '';
      }, 80);
    }

    document.body.addEventListener('mouseover', (e) => {
      const chip = e.target.closest('[data-tooltip-media], [data-tooltip-caption]');
      if (chip) _showTip(chip);
    });
    document.body.addEventListener('mouseout', (e) => {
      const chip = e.target.closest('[data-tooltip-media], [data-tooltip-caption]');
      if (chip) _hideTip();
    });

    // ── Header ───────────────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', UI.toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      await _saveAndApply({ global_default_settings: { enabled: !State.get().settings.global_default_settings.enabled } });
      const { settings } = State.get();
      UI.renderPowerButton(settings.global_default_settings.enabled);
      UI.showToast(settings.global_default_settings.enabled ? 'toast_enabled' : 'toast_disabled');
    });

    // ── Off-state turn-on ─────────────────────────────────────────────────
    document.getElementById('bl-turn-on').addEventListener('click', async () => {
      await _saveAndApply({ global_default_settings: { enabled: true } });
      UI.renderPowerButton(true);
      UI.showToast('toast_enabled');
    });

    // ── Mode block toggles ────────────────────────────────────────────────
    document.getElementById('bl-modes').addEventListener('change', async (e) => {
      if (e.target.id === 'bl-blur-all-toggle') {
        const checked = e.target.checked;
        await State.saveBlurState(checked);
        _renderCurrent();
        UI.showToast(checked ? 'toast_blur_all' : 'toast_cleared');
        return;
      }
      if (e.target.id === 'bl-pick-blur-toggle') {
        await _onSave({ pick_and_blur: { status: e.target.checked } });
        return;
      }
    });

    // ── Mode block click handler ──────────────────────────────────────────
    document.getElementById('bl-modes').addEventListener('click', async (e) => {
      // Remove a pick-blur item
      const removeBtn = e.target.closest('[data-item-id]');
      if (removeBtn) {
        const itemId = removeBtn.dataset.itemId;
        if (itemId) {
          await State.removeBlurItem(itemId);
          _highlightedRowKey = null;
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(
                tabs[0].id,
                { type: blsi.popup.clear_highlight },
                { frameId: 0 },
                () => { void chrome.runtime.lastError; }
              );
            }
          });
          _renderCurrent();
        }
        return;
      }

      // Picker mode chip — save mode, activate picker, then close popup
      const pickerModeChip = e.target.closest('[data-picker-mode]');
      if (pickerModeChip) {
        const mode = pickerModeChip.dataset.pickerMode;
        if (mode) {
          await State.saveSettings({ pick_and_blur: { settings: { picker_mode: mode } } });
          _activatePicker(mode);
        }
        return;
      }

      // Open Picker button — activate picker then close popup
      const openPickerBtn = e.target.closest('[data-action="open-picker"]');
      if (openPickerBtn) {
        const { settings } = State.get();
        _activatePicker((settings.pick_and_blur.settings.picker_mode) || 'sticky-page');
        return;
      }

      // Type chip (blur mode or pick-blur type) — derive block from DOM ancestry
      const typeChip = e.target.closest('[data-type]');
      if (typeChip) {
        const type = typeChip.dataset.type;
        if (typeChip.closest('.bl-mode-block--blur-all')) {
          await _onSave({ blur_all: { settings: { blur_mode: type } } });
        } else {
          await _onSave({ pick_and_blur: { settings: { blur_type: type } } });
        }
        return;
      }

      // HTB Modify button — data-mode tells us which block it came from
      const htbBtn = e.target.closest('[data-action="htb-modify"]');
      if (htbBtn) {
        const mode = htbBtn.dataset.mode;
        _openHtbModify(mode !== 'pick-blur');
        return;
      }

      // Clear All — data-mode tells us which block
      const clearBtn = e.target.closest('[data-action="clear-all"]');
      if (clearBtn) {
        const mode = clearBtn.dataset.mode;
        if (mode === 'blur-all') {
          await State.saveBlurState(false);
        } else {
          await State.clearHost();
        }
        _renderCurrent();
        UI.showToast('toast_cleared');
        return;
      }
    });

    // ── Pick-blur item hover highlight ───────────────────────────────────
    document.getElementById('bl-modes').addEventListener('mouseover', (e) => {
      const row = e.target.closest('.bl-item-row[data-highlight-type]');
      const key = row
        ? (row.dataset.highlightType === 'dynamic' ? row.dataset.highlightSelectors : row.dataset.highlightId)
        : null;
      if (key === _highlightedRowKey) return;
      _highlightedRowKey = key;
      if (!row) return;
      let selectors;
      try { selectors = JSON.parse(row.dataset.highlightSelectors || '[]'); } catch (_e) { selectors = []; }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { type: blsi.popup.highlight_item, item_type: row.dataset.highlightType, selectors, id: row.dataset.highlightId },
            { frameId: 0 },
            () => { void chrome.runtime.lastError; }
          );
        }
      });
    });

    document.getElementById('bl-modes').addEventListener('mouseout', (e) => {
      if (!_highlightedRowKey) return;
      const row = e.target.closest('.bl-item-row[data-highlight-type]');
      if (!row) return;
      const toRow = e.relatedTarget && e.relatedTarget.closest('.bl-item-row[data-highlight-type]');
      if (toRow === row) return;
      _highlightedRowKey = null;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { type: blsi.popup.clear_highlight },
            { frameId: 0 },
            () => { void chrome.runtime.lastError; }
          );
        }
      });
    });

    window.addEventListener('pagehide', () => {
      if (!_highlightedRowKey) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { type: blsi.popup.clear_highlight },
            { frameId: 0 },
            () => { void chrome.runtime.lastError; }
          );
        }
      });
    });

    // ── PII master toggle ─────────────────────────────────────────────────
    document.getElementById('bl-pii').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-pii-master') return;
      if (e.target.disabled) { e.preventDefault(); return; }
      const on = e.target.checked;
      await _saveAndApply({ auto_detect_pii: { settings: { email: on, numeric: on } } });
    });

    // ── PII mode chip click ───────────────────────────────────────────────
    document.getElementById('bl-pii-chips').addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-pii-mode]');
      if (!chip || chip.disabled) return;
      await _saveAndApply({ auto_detect_pii: { settings: { pii_mode: chip.dataset.piiMode } } });
    });

    // ── Automate modify sub-page ──────────────────────────────────────────
    document.getElementById('bl-automate-modify').addEventListener('click', () => {
      const bodyEl = document.getElementById('bl-automate-modify-body');
      const st = State.get();
      BlurrySitePopupRenderAutomate.renderBody(bodyEl, st.settings, _onSave, {
        resolved:        st.resolved,
        ruleOverrides:   st.ruleOverrides,
        ruleMatch:       st.ruleMatch,
        onOpenManagingRule: _onOpenManagingRule,
      });
      UI.showView('bl-view-automate-modify', true);
      _updateSubpageArrows(bodyEl);
    });

    // ── Shortcuts sub-page ────────────────────────────────────────────────
    document.getElementById('bl-nav-shortcuts').addEventListener('click', () => {
      const bodyEl = document.getElementById('bl-shortcuts-body');
      BlurrySitePopupRenderShortcuts.renderBody(bodyEl, State.get().settings, _onSave);
      UI.showView('bl-view-shortcuts', true);
      _updateSubpageArrows(bodyEl);
    });

    // ── Site Rules sub-page ───────────────────────────────────────────────
    document.getElementById('bl-nav-site-rules').addEventListener('click', _openSiteRulesPage);

    // ── General sub-page ──────────────────────────────────────────────────
    document.getElementById('bl-nav-general').addEventListener('click', () => {
      const bodyEl = document.getElementById('bl-general-body');
      BlurrySitePopupRenderGeneral.renderBody(bodyEl, State.get().settings, _generalCallbacks());
      UI.showView('bl-view-general', true);
      _updateSubpageArrows(bodyEl);
    });

    // ── Scroll arrows ─────────────────────────────────────────────────────
    const _mainEl = document.getElementById('bl-view-main');
    if (_mainEl) _mainEl.addEventListener('scroll', _updateScrollArrows, { passive: true });

    document.querySelectorAll('.bl-subpage__body').forEach((body) => {
      body.addEventListener('scroll', () => _updateSubpageArrows(body), { passive: true });
    });

    // ── Back buttons ──────────────────────────────────────────────────────
    document.querySelectorAll('.bl-back-btn').forEach((btn) => {
      btn.addEventListener('click', () => UI.showView('bl-view-main', State.get().settings.global_default_settings.enabled));
    });

    // ── Click outside sub-page modal closes it ────────────────────────────
    const mid = document.querySelector('.bl-mid');
    if (mid) {
      mid.addEventListener('click', (e) => {
        if (e.target === mid && document.body.classList.contains('bl-has-subpage')) {
          UI.showView('bl-view-main', State.get().settings.global_default_settings.enabled);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
