const BlurrySitePopupRenderSiteRules = (() => {
  'use strict';

  var _t = BlurrySitePopupShared.t;

  // ── Snapshot key label map ────────────────────────────────────────────────

  var SNAPSHOT_LABELS = {
    blur_radius:           'rule_snap_blur_radius',
    blur_mode:             'rule_snap_blur_mode',
    reveal_mode:           'rule_snap_reveal_mode',
    thorough_blur:         'rule_snap_thorough_blur',
    blur_categories:       'rule_snap_blur_categories',
    pick_blur_enabled:     'rule_snap_pick_blur_enabled',
    pick_blur_type:        'rule_snap_pick_blur_type',
    // PII
    pii_email:             'rule_snap_label_pii_email',
    pii_numeric:           'rule_snap_label_pii_numeric',
    pii_mode:              'rule_snap_label_pii_mode',
    pii_redaction_color:   'rule_snap_label_pii_redaction_color',
    // Automate
    automate_idle:         'rule_snap_label_automate_idle',
    automate_tab_switch:   'rule_snap_label_automate_tab_switch',
    automate_screen_share: 'rule_snap_label_automate_screen_share',
  };

  var SECTION_KEYS = {
    blur:     ['blur_radius', 'blur_mode', 'reveal_mode', 'thorough_blur',
               'blur_categories', 'pick_blur_enabled', 'pick_blur_type'],
    pii:      ['pii_email', 'pii_numeric', 'pii_mode', 'pii_redaction_color'],
    automate: ['automate_idle', 'automate_tab_switch', 'automate_screen_share'],
  };

  var SECTION_TITLES = {
    blur:     'rule_snap_section_blur',
    pii:      'rule_snap_section_pii',
    automate: 'rule_snap_section_automate',
  };

  var BLUR_MODE_I18N = {
    blur:     'rule_snap_val_blur',
    frosted:  'rule_snap_val_frosted',
    color:    'rule_snap_val_color',
    redacted: 'rule_snap_val_redacted',
    censored: 'rule_snap_val_censored',
    starred:  'rule_snap_val_starred',
  };

  var REVEAL_MODE_I18N = {
    hover: 'rule_snap_val_reveal_hover',
    click: 'rule_snap_val_reveal_click',
    none:  'rule_snap_val_reveal_none',
  };

  // ── Snapshot value formatter ──────────────────────────────────────────────

  function _formatSnapshotValue(key, value) {
    if (value === undefined || value === null) return null;
    if (key === 'blur_radius') {
      return value + 'px';
    }
    if (key === 'blur_mode' || key === 'pick_blur_type' || key === 'pii_mode') {
      return _t(BLUR_MODE_I18N[value]) || value;
    }
    if (key === 'reveal_mode') {
      return _t(REVEAL_MODE_I18N[value]) || value;
    }
    if (
      key === 'thorough_blur' ||
      key === 'pick_blur_enabled' ||
      key === 'pii_email' ||
      key === 'pii_numeric' ||
      key === 'automate_idle' ||
      key === 'automate_tab_switch' ||
      key === 'automate_screen_share'
    ) {
      return value ? _t('rule_snap_val_on') : _t('rule_snap_val_off');
    }
    if (key === 'pii_redaction_color' && typeof value === 'string') {
      return value;
    }
    if (key === 'blur_categories' && typeof value === 'object' && value !== null) {
      var enabled = Object.keys(value).filter(function(k) { return value[k]; });
      if (enabled.length === 0) return _t('rule_snap_val_none');
      return enabled.map(function(k) { return _t('cat_' + k) || k; }).join(', ');
    }
    return String(value);
  }

  // ── Snapshot summary rows (read-only key-value list) ────────────────────

  function _flattenSnapshot(snapshot) {
    var flat = {};
    if (!snapshot) return flat;
    if (snapshot.settings) Object.assign(flat, snapshot.settings);
    if (snapshot.blur_all && snapshot.blur_all.settings) Object.assign(flat, snapshot.blur_all.settings);
    if (snapshot.pick_and_blur) {
      var pb = snapshot.pick_and_blur;
      if (typeof pb.status === 'boolean') flat.pick_blur_enabled = pb.status;
      if (pb.settings) {
        if (pb.settings.blur_type   !== undefined) flat.pick_blur_type  = pb.settings.blur_type;
        if (pb.settings.blur_color  !== undefined) flat.pick_blur_color = pb.settings.blur_color;
        if (pb.settings.picker_mode !== undefined) flat.picker_mode     = pb.settings.picker_mode;
      }
    }
    if (snapshot.auto_detect_pii && snapshot.auto_detect_pii.settings) {
      var ap = snapshot.auto_detect_pii.settings;
      if (typeof ap.email === 'boolean')               flat.pii_email = ap.email;
      if (typeof ap.numeric === 'boolean')             flat.pii_numeric = ap.numeric;
      if (ap.pii_mode !== undefined)                   flat.pii_mode = ap.pii_mode;
      if (typeof ap.pii_redaction_color === 'string')  flat.pii_redaction_color = ap.pii_redaction_color;
    }
    if (snapshot.automate && snapshot.automate.settings) {
      var am = snapshot.automate.settings;
      if (am.idle && typeof am.idle.enabled === 'boolean')               flat.automate_idle = am.idle.enabled;
      if (am.tab_switch && typeof am.tab_switch.enabled === 'boolean')   flat.automate_tab_switch = am.tab_switch.enabled;
      if (am.screen_share && typeof am.screen_share.enabled === 'boolean') flat.automate_screen_share = am.screen_share.enabled;
    }
    return flat;
  }

  function _makeSnapshotRows(snapshot) {
    var flat = _flattenSnapshot(snapshot);

    var wrap = document.createElement('div');
    wrap.className = 'bl-rule-snapshot';

    var anyRendered = false;
    var sectionOrder = ['blur', 'pii', 'automate'];

    for (var s = 0; s < sectionOrder.length; s++) {
      var sec = sectionOrder[s];
      var sectionKeys = SECTION_KEYS[sec];
      var rendered = [];

      for (var i = 0; i < sectionKeys.length; i++) {
        var key = sectionKeys[i];
        if (!(key in flat)) continue;
        var formatted = _formatSnapshotValue(key, flat[key]);
        if (formatted === null) continue;

        var row = document.createElement('div');
        row.className = 'bl-rule-snapshot-row';

        var keyEl = document.createElement('span');
        keyEl.className = 'bl-rule-snapshot-key';
        keyEl.textContent = _t(SNAPSHOT_LABELS[key]);
        row.appendChild(keyEl);

        var valEl = document.createElement('span');
        valEl.className = 'bl-rule-snapshot-val';
        valEl.textContent = formatted;
        row.appendChild(valEl);

        rendered.push(row);
      }

      if (!rendered.length) continue;

      anyRendered = true;
      var hdr = document.createElement('div');
      hdr.className = 'bl-rule-snap-section';
      hdr.textContent = _t(SECTION_TITLES[sec]);
      wrap.appendChild(hdr);
      for (var r = 0; r < rendered.length; r++) wrap.appendChild(rendered[r]);
    }

    if (!anyRendered) {
      var empty = document.createElement('p');
      empty.className = 'bl-rule-snapshot-empty';
      empty.textContent = _t('rule_snapshot_empty');
      wrap.appendChild(empty);
    }

    return wrap;
  }

  // ── Collapsible card ──────────────────────────────────────────────────────

  function _makeCard(rule, rules, settings, callbacks, containerEl, autoExpand) {
    var card = document.createElement('div');
    card.className = 'bl-rule-card';

    var isExpanded = false;

    // ── Header ─────────────────────────────────────────────────────────────

    var header = document.createElement('div');
    header.className = 'bl-rule-card__header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    var nameEl = document.createElement('span');
    nameEl.className = 'bl-rule-card__name';
    nameEl.textContent = rule.hostname_value;
    header.appendChild(nameEl);

    var badge = document.createElement('span');
    badge.className = 'bl-rule-type-badge bl-rule-type-badge--' + rule.hostname_type;
    badge.textContent = rule.hostname_type;
    header.appendChild(badge);

    var chevron = document.createElement('span');
    chevron.className = 'bl-rule-card__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▶';
    header.appendChild(chevron);

    card.appendChild(header);

    // ── Body ───────────────────────────────────────────────────────────────

    var body = document.createElement('div');
    body.className = 'bl-rule-card__body';
    body.hidden = true;

    // Settings snapshot section label
    var snapshotLabel = document.createElement('div');
    snapshotLabel.className = 'bl-rule-snapshot-label';
    snapshotLabel.textContent = _t('rule_snapshot_label');
    body.appendChild(snapshotLabel);

    var hasSnapshot = rule.snapshot && Object.keys(rule.snapshot).length > 0;
    var snapshotWrap;

    if (hasSnapshot) {
      snapshotWrap = _makeSnapshotRows(rule.snapshot || {});
    } else {
      snapshotWrap = document.createElement('p');
      snapshotWrap.className = 'bl-rule-snapshot-empty';
      snapshotWrap.textContent = _t('rule_snapshot_empty');
    }
    body.appendChild(snapshotWrap);

    // ── Action row ─────────────────────────────────────────────────────────

    var actRow = document.createElement('div');
    actRow.className = 'bl-rule-card__actions';

    // Recapture button
    var recaptureBtn = document.createElement('button');
    recaptureBtn.type = 'button';
    recaptureBtn.className = 'bl-rule-recapture-btn';
    recaptureBtn.textContent = _t('rule_snapshot_recapture');
    recaptureBtn.addEventListener('click', function() {
      var snapshot = callbacks.captureSnapshot();
      callbacks.saveSiteSnapshot(rule.hostname_value, rule.hostname_type, snapshot).then(function() {
        rule.snapshot = snapshot;
        body.removeChild(snapshotWrap);
        snapshotWrap = _makeSnapshotRows(snapshot);
        body.insertBefore(snapshotWrap, actRow);
        return callbacks.onSaveRules(rules);
      });
    });
    actRow.appendChild(recaptureBtn);

    // Edit pattern button
    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'bl-rule-edit-btn';
    editBtn.textContent = _t('rule_edit_pattern');
    editBtn.addEventListener('click', function() {
      _render(containerEl, rules, settings, callbacks, rule.hostname_value + '::' + rule.hostname_type);
    });
    actRow.appendChild(editBtn);

    // Delete button
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bl-rule-delete-btn';
    delBtn.title = _t('rule_delete_btn');
    delBtn.textContent = '×'; // ×
    delBtn.addEventListener('click', function() {
      var updated = rules.filter(function(r) {
        return !(r.hostname_value === rule.hostname_value && r.hostname_type === rule.hostname_type);
      });
      callbacks.onSaveRules(updated).then(function() {
        _render(containerEl, updated, settings, callbacks);
      });
    });
    actRow.appendChild(delBtn);

    body.appendChild(actRow);
    card.appendChild(body);

    // ── Toggle expand/collapse ─────────────────────────────────────────────

    function _toggle() {
      isExpanded = !isExpanded;
      body.hidden = !isExpanded;
      chevron.textContent = isExpanded ? '▼' : '▶';
      card.classList.toggle('bl-rule-card--expanded', isExpanded);
      header.setAttribute('aria-expanded', String(isExpanded));
    }

    header.addEventListener('click', _toggle);
    header.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _toggle();
      }
    });

    if (autoExpand) {
      _toggle();
      // Defer scrollIntoView until after the card is in the DOM.
      setTimeout(function() {
        try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_e) {}
      }, 0);
    }

    return card;
  }

  // ── Form (Add or Edit) ────────────────────────────────────────────────────

  function _makeForm(existingRule, rules, settings, callbacks, containerEl) {
    var isEdit = !!existingRule;

    var initialPattern     = isEdit ? (existingRule.hostname_value || '') : '';
    var initialPatternType = isEdit
      ? (existingRule.hostname_type || blsi.pattern_types.exact)
      : blsi.pattern_types.exact;

    // Capture snapshot immediately on form open
    var currentSnapshot = isEdit
      ? (existingRule.snapshot && Object.keys(existingRule.snapshot).length > 0
          ? existingRule.snapshot
          : callbacks.captureSnapshot())
      : callbacks.captureSnapshot();

    var form = document.createElement('div');
    form.className = 'bl-rule-form';

    // ── Pattern field ─────────────────────────────────────────────────────

    var patGroup = document.createElement('div');
    patGroup.className = 'bl-rule-form__group';

    var patLbl = document.createElement('label');
    patLbl.className = 'bl-rule-form__label';
    patLbl.textContent = _t('rule_pattern');
    patGroup.appendChild(patLbl);

    var patInput = document.createElement('input');
    patInput.type = 'text';
    patInput.className = 'bl-rule-form__input';
    patInput.placeholder = _t('rule_pattern_placeholder');
    patInput.value = initialPattern;
    patGroup.appendChild(patInput);

    var patError = document.createElement('div');
    patError.className = 'bl-rule-form__error';
    patError.hidden = true;
    patGroup.appendChild(patError);

    var patHelp = document.createElement('div');
    patHelp.className = 'bl-rule-form__help';
    patGroup.appendChild(patHelp);

    form.appendChild(patGroup);

    // ── Match type radios ─────────────────────────────────────────────────

    var typeGroup = document.createElement('div');
    typeGroup.className = 'bl-rule-form__group';

    var typeLbl = document.createElement('div');
    typeLbl.className = 'bl-rule-form__label';
    typeLbl.textContent = _t('rule_pattern_type');
    typeGroup.appendChild(typeLbl);

    var typeRow = document.createElement('div');
    typeRow.className = 'bl-rule-form__type';

    var HELP_KEYS = {
      wildcard: 'rule_pattern_help_wildcard',
      regex:    'rule_pattern_help_regex',
      exact:    'rule_pattern_help_exact',
    };

    var radios = [
      { value: blsi.pattern_types.exact,    labelKey: 'rule_pattern_exact' },
      { value: blsi.pattern_types.wildcard, labelKey: 'rule_pattern_wildcard' },
      { value: blsi.pattern_types.regex,    labelKey: 'rule_pattern_regex' },
    ];

    var radioInputs = [];
    var radioName = 'bl-rule-type-' + (isEdit ? (existingRule.hostname_value + '::' + existingRule.hostname_type) : 'new');

    radios.forEach(function(opt) {
      var lbl = document.createElement('label');
      lbl.className = 'bl-rule-form__radio';

      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = radioName;
      radio.value = opt.value;
      radio.checked = (initialPatternType === opt.value);
      radioInputs.push(radio);

      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(_t(opt.labelKey)));
      typeRow.appendChild(lbl);
    });

    typeGroup.appendChild(typeRow);
    form.appendChild(typeGroup);

    // Keep help text in sync with selected type
    function _updateHelp() {
      var sel = blsi.pattern_types.wildcard;
      for (var i = 0; i < radioInputs.length; i++) {
        if (radioInputs[i].checked) { sel = radioInputs[i].value; break; }
      }
      patHelp.textContent = _t(HELP_KEYS[sel] || 'rule_pattern_help_wildcard');
    }
    radioInputs.forEach(function(r) { r.addEventListener('change', _updateHelp); });
    _updateHelp();

    // ── Snapshot preview ──────────────────────────────────────────────────

    var previewGroup = document.createElement('div');
    previewGroup.className = 'bl-rule-form__group bl-rule-form__preview-group';

    var previewHeader = document.createElement('div');
    previewHeader.className = 'bl-rule-form__preview-header';

    var previewLbl = document.createElement('span');
    previewLbl.className = 'bl-rule-form__label';
    previewLbl.textContent = _t('rule_snapshot_preview');
    previewHeader.appendChild(previewLbl);

    if (isEdit && existingRule.snapshot && Object.keys(existingRule.snapshot).length > 0) {
      var savedNote = document.createElement('span');
      savedNote.className = 'bl-rule-form__snapshot-note';
      savedNote.textContent = _t('rule_snapshot_saved_note');
      previewHeader.appendChild(savedNote);
    }

    previewGroup.appendChild(previewHeader);

    var previewRows = _makeSnapshotRows(currentSnapshot);
    previewRows.className += ' bl-rule-form__snapshot-preview';
    previewGroup.appendChild(previewRows);

    var recaptureBtn = document.createElement('button');
    recaptureBtn.type = 'button';
    recaptureBtn.className = 'bl-rule-recapture-btn bl-rule-recapture-btn--inline';
    recaptureBtn.textContent = _t('rule_snapshot_recapture');
    recaptureBtn.addEventListener('click', function() {
      currentSnapshot = callbacks.captureSnapshot();
      var newRows = _makeSnapshotRows(currentSnapshot);
      newRows.className += ' bl-rule-form__snapshot-preview';
      previewGroup.replaceChild(newRows, previewRows);
      previewRows = newRows;
    });
    previewGroup.appendChild(recaptureBtn);

    form.appendChild(previewGroup);

    // ── Actions row ───────────────────────────────────────────────────────

    var actionsRow = document.createElement('div');
    actionsRow.className = 'bl-rule-form__actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'bl-rule-save-btn';
    saveBtn.textContent = _t('modal_save');

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'bl-rule-cancel-btn';
    cancelBtn.textContent = _t('modal_cancel');

    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);
    form.appendChild(actionsRow);

    // ── Handlers ──────────────────────────────────────────────────────────

    cancelBtn.addEventListener('click', function() {
      _render(containerEl, rules, settings, callbacks);
    });

    saveBtn.addEventListener('click', function() {
      var pattern = patInput.value.trim();

      var selectedType = blsi.pattern_types.exact;
      for (var i = 0; i < radioInputs.length; i++) {
        if (radioInputs[i].checked) {
          selectedType = radioInputs[i].value;
          break;
        }
      }

      // Validate
      patError.hidden = true;
      if (!pattern) {
        patError.textContent = _t('rule_pattern_required');
        patError.hidden = false;
        return;
      }
      var maxLen = (blsi.UrlMatcher && blsi.UrlMatcher.MAX_PATTERN_LENGTH) || 500;
      if (pattern.length > maxLen) {
        patError.textContent = _t('rule_pattern_too_long');
        patError.hidden = false;
        return;
      }

      var updatedRules;
      if (isEdit) {
        updatedRules = rules.map(function(r) {
          if (r.hostname_value !== existingRule.hostname_value || r.hostname_type !== existingRule.hostname_type) return r;
          return Object.assign({}, r, {
            hostname_value: pattern,
            hostname_type:  selectedType,
            snapshot:       currentSnapshot,
          });
        });
      } else {
        var newRule = {
          hostname_value: pattern,
          hostname_type:  selectedType,
          blur_all:       null,
          snapshot:       currentSnapshot,
        };
        updatedRules = rules.concat([newRule]);
      }

      callbacks.onSaveRules(updatedRules).then(function() {
        _render(containerEl, updatedRules, settings, callbacks);
      });
    });

    return form;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function _render(containerEl, rules, settings, callbacks, editingKey, focusKey) {
    containerEl.replaceChildren();

    // Hint
    var hint = document.createElement('p');
    hint.className = 'bl-rules-hint';
    hint.textContent = _t('rule_hint');
    containerEl.appendChild(hint);

    // Rule list
    if (!rules || rules.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'bl-rules-empty';
      empty.textContent = _t('rule_no_rules');
      containerEl.appendChild(empty);
    } else {
      var list = document.createElement('div');
      list.className = 'bl-rules-list';

      rules.forEach(function(rule) {
        var ruleKey = rule.hostname_value + '::' + rule.hostname_type;
        if (editingKey && ruleKey === editingKey) {
          list.appendChild(_makeForm(rule, rules, settings, callbacks, containerEl));
        } else {
          var autoExpand = !!(focusKey && ruleKey === focusKey);
          list.appendChild(_makeCard(rule, rules, settings, callbacks, containerEl, autoExpand));
        }
      });

      containerEl.appendChild(list);
    }

    // Add button — shown only when no inline form is open
    if (!editingKey) {
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'bl-rule-add-btn';
      addBtn.textContent = _t('rule_add_for_site');
      addBtn.addEventListener('click', function() {
        containerEl.removeChild(addBtn);
        containerEl.appendChild(_makeForm(null, rules, settings, callbacks, containerEl));
      });
      containerEl.appendChild(addBtn);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function renderBody(containerEl, settings, callbacks, opts) {
    containerEl.replaceChildren();
    var rules = await callbacks.getRules();
    var focusKey = null;
    if (opts && opts.focusRule && opts.focusRule.hostname_value) {
      focusKey = opts.focusRule.hostname_value + '::' + (opts.focusRule.hostname_type || '');
    }
    _render(containerEl, rules, settings, callbacks, null, focusKey);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderSiteRules = BlurrySitePopupRenderSiteRules;
