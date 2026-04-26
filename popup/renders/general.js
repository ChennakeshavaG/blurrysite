const BlurrySitePopupRenderGeneral = (() => {
  'use strict';

  var _t           = BlurrySitePopupShared.t;
  var _makeToggle  = BlurrySitePopupShared.makeToggle;

  function _buildTabPrivacyRow(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-gen-block';

    var header = document.createElement('div');
    header.className = 'bl-gen-block__header';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'bl-gen-block__label-wrap';

    var label = document.createElement('span');
    label.className = 'bl-gen-block__label';
    label.textContent = _t('setting_tab_privacy');

    var hint = document.createElement('span');
    hint.className = 'bl-gen-block__hint';
    hint.textContent = _t('setting_tab_privacy_hint');

    labelWrap.appendChild(label);
    labelWrap.appendChild(hint);

    var checked = !!(settings.global_default_settings && settings.global_default_settings.tab_privacy);
    var tog = _makeToggle('bl-gen-tab-privacy', checked, _t('setting_tab_privacy'));

    tog.input.addEventListener('change', function () {
      onSave({ global_default_settings: { tab_privacy: tog.input.checked } });
    });

    header.appendChild(labelWrap);
    header.appendChild(tog.label);
    block.appendChild(header);

    return block;
  }

  function _buildLanguageRow(settings, onSave) {
    var block = document.createElement('div');
    block.className = 'bl-gen-block';

    var header = document.createElement('div');
    header.className = 'bl-gen-block__header';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'bl-gen-block__label-wrap';

    var label = document.createElement('span');
    label.className = 'bl-gen-block__label';
    label.textContent = _t('setting_language');

    var hint = document.createElement('span');
    hint.className = 'bl-gen-block__hint';
    hint.textContent = _t('setting_language_hint');

    labelWrap.appendChild(label);
    labelWrap.appendChild(hint);

    var current = (settings.global_default_settings && settings.global_default_settings.language) || 'auto';
    var select = document.createElement('select');
    select.className = 'bl-gen-select';
    select.setAttribute('aria-label', _t('setting_language'));

    var langs = blsi.supported_languages;
    for (var i = 0; i < langs.length; i++) {
      var opt = document.createElement('option');
      opt.value = langs[i];
      opt.textContent = _t('lang_' + langs[i]);
      if (langs[i] === current) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', function () {
      onSave({ global_default_settings: { language: select.value } });
    });

    header.appendChild(labelWrap);
    header.appendChild(select);
    block.appendChild(header);

    return block;
  }

  function _buildDebugRow(debugEnabled, onToggleDebug) {
    var block = document.createElement('div');
    block.className = 'bl-gen-block';

    var header = document.createElement('div');
    header.className = 'bl-gen-block__header';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'bl-gen-block__label-wrap';

    var label = document.createElement('span');
    label.className = 'bl-gen-block__label';
    label.textContent = _t('setting_debug_logging');

    var hint = document.createElement('span');
    hint.className = 'bl-gen-block__hint';
    hint.textContent = _t('setting_debug_logging_hint');

    labelWrap.appendChild(label);
    labelWrap.appendChild(hint);

    var tog = _makeToggle('bl-gen-debug-logging', !!debugEnabled, _t('setting_debug_logging'));

    tog.input.addEventListener('change', function () {
      if (onToggleDebug) onToggleDebug(tog.input.checked);
    });

    header.appendChild(labelWrap);
    header.appendChild(tog.label);
    block.appendChild(header);

    return block;
  }

  function _buildBackupRow(onExport, onImport) {
    var block = document.createElement('div');
    block.className = 'bl-gen-block';

    var header = document.createElement('div');
    header.className = 'bl-gen-block__header';

    var labelWrap = document.createElement('div');
    labelWrap.className = 'bl-gen-block__label-wrap';

    var label = document.createElement('span');
    label.className = 'bl-gen-block__label';
    label.textContent = _t('setting_backup');

    var hint = document.createElement('span');
    hint.className = 'bl-gen-block__hint';
    hint.textContent = _t('setting_backup_hint');

    labelWrap.appendChild(label);
    labelWrap.appendChild(hint);

    var btnWrap = document.createElement('div');
    btnWrap.className = 'bl-gen-btns';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'bl-gen-btn';
    exportBtn.type = 'button';
    exportBtn.textContent = _t('btn_export');
    exportBtn.addEventListener('click', function () {
      if (onExport) onExport();
    });

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        if (onImport) onImport(e.target.result);
        fileInput.value = '';
      };
      reader.onerror = function () {
        fileInput.value = '';
        if (onImport) onImport(null);
      };
      reader.readAsText(file);
    });

    var importBtn = document.createElement('button');
    importBtn.className = 'bl-gen-btn';
    importBtn.type = 'button';
    importBtn.textContent = _t('btn_import');
    importBtn.addEventListener('click', function () {
      fileInput.click();
    });

    btnWrap.appendChild(exportBtn);
    btnWrap.appendChild(importBtn);
    block.appendChild(fileInput);

    header.appendChild(labelWrap);
    header.appendChild(btnWrap);
    block.appendChild(header);

    return block;
  }

  function renderBody(containerEl, settings, callbacks) {
    var onSave        = typeof callbacks === 'function' ? callbacks : (callbacks && callbacks.onSave);
    var debugEnabled  = callbacks && callbacks.debugEnabled;
    var onToggleDebug = callbacks && callbacks.onToggleDebug;
    var onExport      = callbacks && callbacks.onExport;
    var onImport      = callbacks && callbacks.onImport;

    containerEl.replaceChildren();
    containerEl.appendChild(_buildLanguageRow(settings, onSave));
    // Hide tab_privacy when current host is rule-managed — the rule snapshot
    // owns that field; editing it from General would be a no-op for this host.
    if (!BlurrySitePopupShared.isRuleManaged(settings)) {
      containerEl.appendChild(_buildTabPrivacyRow(settings, onSave));
    }
    containerEl.appendChild(_buildDebugRow(debugEnabled, onToggleDebug));
    containerEl.appendChild(_buildBackupRow(onExport, onImport));
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderGeneral = BlurrySitePopupRenderGeneral;
