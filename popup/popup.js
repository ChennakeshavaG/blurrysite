(() => {
  'use strict';

  const State = window.BlurrySitePopupState;
  const UI    = window.BlurrySitePopupUI;

  // UI-only accordion state — not persisted; always starts on blur-all
  let _expandedMode = 'blur-all';

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

  // ── Render coordinator ────────────────────────────────────────────────────
  function _renderCurrent() {
    const { settings, blurItems, isPageBlurred } = State.get();
    BlurrySitePopupRender.renderAll(settings, blurItems, isPageBlurred, _expandedMode);
    UI.updateClearAll(settings, blurItems, isPageBlurred);
    _updateScrollArrows();
    const timer = settings && settings.automate_timer;
    if (timer && timer.enabled && timer.started_at) {
      UI.startCountdown(timer, () => {
        if (State.get().settings.automate_timer.enabled) {
          _saveAndApply({ automate_timer: { value: timer.value, unit: timer.unit, enabled: false, started_at: null } });
        }
      });
    } else {
      UI.stopCountdown();
    }
  }

  async function _saveAndApply(patch) {
    await State.saveSettings(patch);
    _renderCurrent();
  }

  async function _onSave(patch) {
    await _saveAndApply(patch);
  }

  // ── Open HTB sub-page ─────────────────────────────────────────────────────
  function _openHtbModify(isBlurAll) {
    const bodyEl = document.getElementById('bl-htb-modify-body');
    BlurrySitePopupRenderHtb.renderBody(bodyEl, State.get().settings, _onSave, isBlurAll);
    UI.showView('bl-view-htb-modify', true);
    _updateSubpageArrows(bodyEl);
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      UI.applyTheme(data.blsi_popup_theme || 'dark');
    });

    UI.applyI18n();
    UI.setVersion();

    const tab = await new Promise((res) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => res(tabs && tabs[0]))
    );
    if (tab && tab.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        State.setHostname(hostname);
        UI.setHost(hostname);
      } catch (_) {}
    }

    // Initialise the model cache then load site-specific state
    await blsi.Model.init_cache();

    const { hostname } = State.get();
    const model = blsi.Model.get();
    State.setModel(model);

    const [items, pageBlurred] = await Promise.all([
      hostname ? blsi.Model.get_blur_items(hostname) : Promise.resolve([]),
      hostname ? blsi.Model.get_blur_state(hostname) : Promise.resolve(false),
    ]);
    State.setBlurItems(items || []);
    State.setPageBlurred(!!pageBlurred);

    UI.renderPowerButton(State.get().settings.enabled);
    _renderCurrent();

    // ── Live reactivity via external storage changes ─────────────────────
    State.onExternalChange((newModel) => {
      if (!newModel) return;
      State.setModel(newModel);

      const { hostname: h } = State.get();
      if (h) {
        const entry = blsi.Model.get_site_entry(h);
        if (entry) {
          State.setBlurItems(entry.items || []);
          // blur_all: null means inherit global
          const blurAllActive = entry.blur_all !== null
            ? !!entry.blur_all
            : newModel.blur_all.status;
          State.setPageBlurred(blurAllActive);
        } else {
          State.setPageBlurred(newModel.blur_all.status);
        }
      }

      _renderCurrent();
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
      if (!src) return;

      _positionTip(chip);
      _tipLabel.textContent = chip.dataset.tooltipLabel || '';
      _tipLabel.hidden = !chip.dataset.tooltipLabel;
      _tipCaption.textContent = caption;

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

    document.getElementById('bl-modes').addEventListener('mouseover', (e) => {
      const chip = e.target.closest('[data-tooltip-media]');
      if (chip) _showTip(chip);
    });
    document.getElementById('bl-modes').addEventListener('mouseout', (e) => {
      const chip = e.target.closest('[data-tooltip-media]');
      if (chip) _hideTip();
    });

    // ── Header ───────────────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', UI.toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      await _saveAndApply({ enabled: !State.get().settings.enabled });
      const { settings } = State.get();
      UI.renderPowerButton(settings.enabled);
      UI.showToast(settings.enabled ? 'toast_enabled' : 'toast_disabled');
    });

    // ── Off-state turn-on ─────────────────────────────────────────────────
    document.getElementById('bl-turn-on').addEventListener('click', async () => {
      await _saveAndApply({ enabled: true });
      UI.renderPowerButton(true);
      UI.showToast('toast_enabled');
    });

    // ── Mode block toggles ────────────────────────────────────────────────
    document.getElementById('bl-modes').addEventListener('change', async (e) => {
      if (e.target.id === 'bl-blur-all-toggle') {
        const checked = e.target.checked;
        State.setPageBlurred(checked);
        const { hostname } = State.get();
        if (hostname) await blsi.Model.save_blur_state(hostname, checked);
        _renderCurrent();
        UI.showToast(checked ? 'toast_blur_all' : 'toast_cleared');
        return;
      }
      if (e.target.id === 'bl-pick-blur-toggle') {
        await _onSave({ pick_blur_enabled: e.target.checked });
        return;
      }
    });

    // ── Mode block click handler ──────────────────────────────────────────
    document.getElementById('bl-modes').addEventListener('click', async (e) => {
      // Accordion: clicking collapsed block header expands it
      const collapsedBlock = e.target.closest('.bl-mode-block--collapsed');
      if (collapsedBlock && !e.target.closest('.bl-toggle')) {
        _expandedMode = collapsedBlock.classList.contains('bl-mode-block--blur-all') ? 'blur-all' : 'pick-blur';
        _renderCurrent();
        return;
      }

      // Remove a pick-blur item
      const removeBtn = e.target.closest('[data-item-id]');
      if (removeBtn) {
        const itemId = removeBtn.dataset.itemId;
        const { hostname } = State.get();
        if (itemId && hostname) {
          await blsi.Model.remove_blur_item(hostname, itemId);
          const items = (await blsi.Model.get_blur_items(hostname)) || [];
          State.setBlurItems(items);
          _renderCurrent();
        }
        return;
      }

      // Picker mode chip — save and open picker
      const pickerModeChip = e.target.closest('[data-picker-mode]');
      if (pickerModeChip) {
        const mode = pickerModeChip.dataset.pickerMode;
        if (mode) {
          await blsi.Model.patch_section('pick_and_blur', { settings: { picker_mode: mode } });
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(
                tabs[0].id,
                { type: blsi.command.toggle_picker, picker_mode: mode },
                () => { void chrome.runtime.lastError; }
              );
            }
            window.close();
          });
        }
        return;
      }

      // Type chip (blur mode or pick-blur type)
      const typeChip = e.target.closest('[data-type]');
      if (typeChip) {
        const type = typeChip.dataset.type;
        if (_expandedMode === 'blur-all') {
          await _onSave({ blur_mode: type });
        } else {
          await _onSave({ pick_blur_type: type });
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
        const mode = clearBtn.dataset.mode || _expandedMode;
        const { hostname } = State.get();
        if (mode === 'blur-all') {
          State.setPageBlurred(false);
          if (hostname) await blsi.Model.save_blur_state(hostname, false);
        } else {
          if (hostname) await blsi.Model.clear_host(hostname);
          State.setBlurItems([]);
        }
        _renderCurrent();
        UI.showToast('toast_cleared');
        return;
      }
    });

    // ── PII master toggle ─────────────────────────────────────────────────
    document.getElementById('bl-pii').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-pii-master') return;
      const on = e.target.checked;
      await _saveAndApply({ pii_enabled: on, pii_email: on, pii_numeric: on });
    });

    // ── PII mode chip click ───────────────────────────────────────────────
    document.getElementById('bl-pii-chips').addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-pii-mode]');
      if (!chip) return;
      await _saveAndApply({ pii_mode: chip.dataset.piiMode });
    });

    // ── Automate modify sub-page ──────────────────────────────────────────
    document.getElementById('bl-automate-modify').addEventListener('click', () => {
      const bodyEl = document.getElementById('bl-automate-modify-body');
      BlurrySitePopupRenderAutomate.renderBody(bodyEl, State.get().settings, _onSave);
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
    document.getElementById('bl-nav-site-rules').addEventListener('click', () => {
      const bodyEl = document.getElementById('bl-site-rules-body');
      UI.showView('bl-view-site-rules', true);
      BlurrySitePopupRenderSiteRules.renderBody(bodyEl, State.get().settings, {
        onSaveSettings: _onSave,
        onSaveRules: (newRules) => blsi.Model.save_rules(newRules),
      });
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
      btn.addEventListener('click', () => UI.showView('bl-view-main', State.get().settings.enabled));
    });

    // ── Click outside sub-page modal closes it ────────────────────────────
    const mid = document.querySelector('.bl-mid');
    if (mid) {
      mid.addEventListener('click', (e) => {
        if (e.target === mid && document.body.classList.contains('bl-has-subpage')) {
          UI.showView('bl-view-main', State.get().settings.enabled);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
