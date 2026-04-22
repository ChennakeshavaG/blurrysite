const BlurrySitePopupRenderSiteRules = (() => {
  'use strict';

  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  // ── Rule row ──────────────────────────────────────────────────────────────

  function _makeRuleRow(rule, rules, settings, callbacks, containerEl, editingValue) {
    const row = document.createElement('div');
    row.className = 'bl-rule-row';

    const info = document.createElement('div');
    info.className = 'bl-rule-row__info';

    const nameEl = document.createElement('div');
    nameEl.className = 'bl-rule-row__name';
    nameEl.textContent = rule.hostname_value;
    info.appendChild(nameEl);

    const typeEl = document.createElement('div');
    typeEl.className = 'bl-rule-row__pattern';
    typeEl.textContent = rule.hostname_type === blsi.pattern_types.regex
      ? _t('rule_pattern_regex')
      : _t('rule_pattern_wildcard');
    info.appendChild(typeEl);

    row.appendChild(info);

    const editBtn = document.createElement('button');
    editBtn.className = 'bl-rule-edit-btn';
    editBtn.type = 'button';
    editBtn.textContent = _t('rule_edit_btn');
    editBtn.addEventListener('click', function() {
      _render(containerEl, rules, settings, callbacks, rule.hostname_value + '::' + rule.hostname_type);
    });
    row.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'bl-rule-delete-btn';
    delBtn.type = 'button';
    delBtn.title = _t('rule_delete_btn');
    delBtn.textContent = '\u00d7'; // ×
    delBtn.addEventListener('click', function() {
      var updated = rules.filter(function(r) {
        return !(r.hostname_value === rule.hostname_value && r.hostname_type === rule.hostname_type);
      });
      callbacks.onSaveRules(updated).then(function() {
        _render(containerEl, updated, settings, callbacks);
      });
    });
    row.appendChild(delBtn);

    return row;
  }

  // ── Inline form (Add or Edit) ─────────────────────────────────────────────

  function _makeForm(existingRule, rules, settings, callbacks, containerEl) {
    var isEdit = !!existingRule;

    var initialPattern     = isEdit ? (existingRule.hostname_value || '') : '';
    var initialPatternType = isEdit
      ? (existingRule.hostname_type || blsi.pattern_types.wildcard)
      : blsi.pattern_types.wildcard;

    var form = document.createElement('div');
    form.className = 'bl-rule-form';

    // ── Pattern field ─────────────────────────────────────────────────────

    var patGroup = document.createElement('div');

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

    form.appendChild(patGroup);

    // ── Match type radios ─────────────────────────────────────────────────

    var typeGroup = document.createElement('div');

    var typeLbl = document.createElement('div');
    typeLbl.className = 'bl-rule-form__label';
    typeLbl.textContent = _t('rule_pattern_type');
    typeGroup.appendChild(typeLbl);

    var typeRow = document.createElement('div');
    typeRow.className = 'bl-rule-form__type';

    var radios = [
      { value: blsi.pattern_types.wildcard, labelKey: 'rule_pattern_wildcard' },
      { value: blsi.pattern_types.regex,    labelKey: 'rule_pattern_regex' },
    ];

    var radioInputs = [];

    radios.forEach(function(opt) {
      var lbl = document.createElement('label');
      lbl.className = 'bl-rule-form__radio';

      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'bl-rule-pattern-type-' + (isEdit ? (existingRule.hostname_value + '::' + existingRule.hostname_type) : 'new');
      radio.value = opt.value;
      radio.checked = (initialPatternType === opt.value);
      radioInputs.push(radio);

      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(_t(opt.labelKey)));
      typeRow.appendChild(lbl);
    });

    typeGroup.appendChild(typeRow);
    form.appendChild(typeGroup);

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

      // Determine selected pattern type
      var selectedType = blsi.pattern_types.wildcard;
      for (var i = 0; i < radioInputs.length; i++) {
        if (radioInputs[i].checked) {
          selectedType = radioInputs[i].value;
          break;
        }
      }

      var valid = true;

      // Validate pattern
      patError.hidden = true;
      if (!pattern) {
        patError.textContent = _t('rule_pattern_required');
        patError.hidden = false;
        valid = false;
      } else {
        var maxLen = (blsi.UrlMatcher && blsi.UrlMatcher.MAX_PATTERN_LENGTH) || 500;
        if (pattern.length > maxLen) {
          patError.textContent = _t('rule_pattern_too_long');
          patError.hidden = false;
          valid = false;
        }
      }

      if (!valid) return;

      var updatedRules;
      if (isEdit) {
        updatedRules = rules.map(function(r) {
          if (r.hostname_value !== existingRule.hostname_value || r.hostname_type !== existingRule.hostname_type) return r;
          return Object.assign({}, r, {
            hostname_value: pattern,
            hostname_type:  selectedType,
          });
        });
      } else {
        var newRule = {
          hostname_value: pattern,
          hostname_type:  selectedType,
          blur_all:       null,
          items:          [],
          settings:       {},
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

  function _render(containerEl, rules, settings, callbacks, editingKey) {
    containerEl.innerHTML = '';

    // Hint
    var hint = document.createElement('p');
    hint.className = 'bl-rules-hint';
    hint.textContent = _t('rule_hint');
    containerEl.appendChild(hint);

    // Rule list (or empty state)
    if (!rules || rules.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'bl-rules-empty';
      empty.textContent = _t('rule_no_rules');
      containerEl.appendChild(empty);
    } else {
      var list = document.createElement('div');
      list.className = 'bl-rules-list';

      rules.forEach(function(rule) {
        if (editingKey && (rule.hostname_value + '::' + rule.hostname_type) === editingKey) {
          // Render edit form inline in place of the row
          list.appendChild(_makeForm(rule, rules, settings, callbacks, containerEl));
        } else {
          list.appendChild(_makeRuleRow(rule, rules, settings, callbacks, containerEl, editingKey));
        }
      });

      containerEl.appendChild(list);
    }

    // Add button — shown only when no form is currently open
    if (!editingKey) {
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'bl-rule-add-btn';
      addBtn.textContent = _t('rule_add');
      addBtn.addEventListener('click', function() {
        // Replace add button with the add form
        containerEl.removeChild(addBtn);
        containerEl.appendChild(_makeForm(null, rules, settings, callbacks, containerEl));
      });
      containerEl.appendChild(addBtn);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function renderBody(containerEl, settings, callbacks) {
    containerEl.innerHTML = '';
    var rules = await blsi.Model.get_rules();
    _render(containerEl, rules, settings, callbacks);
  }

  return { renderBody };
})();

window.BlurrySitePopupRenderSiteRules = BlurrySitePopupRenderSiteRules;
