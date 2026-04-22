# Popup Redesign Plan 2 — Main View Rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the popup main view alive — render real settings data into every section of the main popup view.

**Architecture:** A new `popup/popup_render.js` IIFE (`BlurrySitePopupRender`) owns all DOM rendering for the four main sections. It is stateless — caller passes `settings`, it mutates the DOM. `popup.js` calls `renderAll(settings)` on init and after each interactive settings change. PII toggle and PII mode chips become interactive in this plan. HTB chips navigate to the Modify sub-page. The Blur All toggle in the mode block maps to the global `ENABLED` flag.

**Tech Stack:** Vanilla JS, IIFEs, `chrome.i18n.getMessage`, Jest/jsdom unit tests.

---

## Scope (what Plan 2 does NOT include)

- Mode switching (Blur All ↔ Pick & Blur) with confirmation — Plan 3
- Sub-page content (Modify screens for HTB/Automate/Shortcuts/Site Rules) — Plan 3
- Open Picker button functionality — Plan 3
- Clear All — Plan 3
- Pick & Blur element list (needs live tab messaging) — Plan 3
- Live count badge for Blur All (needs live tab messaging) — Plan 3

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `_locales/en/popup.json` | Modify | 35 new i18n keys for all rendered content |
| `popup/popup_render.js` | Create | Stateless rendering functions for all 4 main sections |
| `popup/popup.css` | Modify | Mode block content styles (dot, header, body, empty state) |
| `popup/popup.html` | Modify | Add `<script>` for popup_render.js |
| `popup/popup.js` | Modify | Call renderAll on init; wire PII toggle, PII chips, HTB chips, Blur All toggle; add `_saveAndApply` helper |
| `tests/setup.js` | Modify | Add `chrome.i18n` mock |
| `tests/unit/popup_render.test.js` | Create | ~20 unit tests for all render functions |
| `docs/TEST_VALIDATION.md` | Modify | Add section for popup_render.test.js |
| `scripts/string_lint.js` | Modify | No new ALLOW_LIST entries needed (all strings go through `_t()`) |

---

## Task 1: Add i18n keys to popup.json

**Files:**
- Modify: `_locales/en/popup.json`

- [ ] **Step 1: Add 35 new keys after the `"tt_rule_delete"` entry**

Open `_locales/en/popup.json`. Append these entries before the closing `}`:

```json
  "off_state_message": "Blurry Site is off",
  "off_state_hint": "All blur is paused on every site",
  "power_turn_on": "Turn On",

  "htb_chip_gaussian": "Gaussian",
  "htb_chip_frosted": "Frosted",
  "htb_chip_redacted": "Redacted",
  "htb_chip_masked": "Masked",
  "htb_chip_color": "Color",
  "htb_label_covers": "Covers",
  "htb_label_strength": "Strength",
  "htb_label_reveal": "Reveal",
  "htb_label_color": "Color",
  "htb_strength_subtle": "Subtle",
  "htb_strength_moderate": "Moderate",
  "htb_strength_strong": "Strong",
  "htb_pick_blur_note": "Redacted & Masked available in Blur All mode.",

  "pii_chip_gaussian": "Gaussian",
  "pii_chip_frosted": "Frosted",
  "pii_chip_redacted": "Redacted",
  "pii_chip_asterisked": "Asterisked",

  "automate_timer": "Timer",
  "automate_idle": "Idle",
  "automate_tab_switch": "Tab Switch",
  "automate_off": "Off",
  "automate_on": "On",
  "automate_unit_sec": "sec",
  "automate_unit_min": "min",
  "automate_unit_hr": "hr",

  "mode_blur_all_active_desc": "All matching categories are blurred on this page.",
  "mode_blur_all_off_hint": "Off — page is visible.",
  "mode_pick_blur_empty": "No elements picked yet. Open the picker to start.",
  "mode_open_picker": "Open Picker",
  "mode_blur_all_cats": "categories"
```

- [ ] **Step 2: Verify JSON is valid**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('_locales/en/popup.json','utf8')); console.log('valid')"
```
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add _locales/en/popup.json
git commit -m "feat(popup): add Plan 2 i18n keys (35 new strings)"
```

---

## Task 2: Create popup_render.js with tests

**Files:**
- Create: `popup/popup_render.js`
- Create: `tests/unit/popup_render.test.js`
- Modify: `tests/setup.js`

- [ ] **Step 1: Add `chrome.i18n` to tests/setup.js**

In `tests/setup.js`, find the `global.chrome = {` block. Add `i18n` after the existing `runtime` entry:

```js
  i18n: {
    getMessage: jest.fn((key) => key),
  },
```

Full chrome mock shape after edit:

```js
global.chrome = {
  i18n: {
    getMessage: jest.fn((key) => key),
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    lastError: null,
  },
  // ... rest unchanged
};
```

- [ ] **Step 2: Run tests to confirm green baseline**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: 568 tests passed.

- [ ] **Step 3: Write the failing tests**

Create `tests/unit/popup_render.test.js`:

```js
'use strict';

const fs   = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../popup/popup_render.js');

function loadRender() {
  if (global.BlurrySitePopupRender) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  return `(function(){
    'use strict';
    const BlurrySitePopupRender = {
      renderAll(s){},
      renderHtbSection(s){},
      renderPiiSection(s){},
      renderAutomateSection(s){},
      renderModesSection(s){},
    };
    window.BlurrySitePopupRender = BlurrySitePopupRender;
  })();`;
}

function makeSettings(overrides) {
  const base = {
    ACTIVE_MODE: 'blur-all',
    BLUR_MODE: 'gaussian',
    PICK_BLUR_TYPE: 'gaussian',
    PII_MODE: 'gaussian',
    BLUR_RADIUS: 6,
    REVEAL_MODE: 'hover',
    ENABLED: true,
    BLUR_CATEGORIES: { TEXT: true, MEDIA: true, FORM: false, TABLE: true, STRUCTURE: true },
    AUTO_DETECT: { EMAIL: false, NUMERIC: false },
    PICK_BLUR_COLOR: { HEX: '#000000', OPACITY: 1.0 },
    AUTOMATE: {
      TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
      IDLE:  { VALUE: 5, UNIT: 'min', ENABLED: false },
      TAB_SWITCH: { ENABLED: false },
    },
  };
  return Object.assign({}, base, overrides);
}

function setupDom() {
  document.body.innerHTML = `
    <div id="bl-htb-chips"></div>
    <div id="bl-htb-summary"></div>
    <section id="bl-pii">
      <input type="checkbox" id="bl-pii-master">
      <div id="bl-pii-chips"></div>
    </section>
    <div id="bl-automate-summary"></div>
    <div id="bl-mode-active" class="bl-mode-block"></div>
    <div id="bl-mode-waiting" class="bl-mode-block"></div>
  `;
}

beforeAll(() => loadRender());
beforeEach(() => {
  setupDom();
  chrome.i18n.getMessage.mockImplementation((key) => key);
});
afterEach(() => { document.body.innerHTML = ''; });

// ── renderHtbSection ─────────────────────────────────────────────────────────

describe('renderHtbSection', () => {
  test('blur-all mode renders 4 type chips', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'blur-all' }));
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    expect(chips).toHaveLength(4);
  });

  test('active blur-all chip has bl-chip--active class', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'blur-all', BLUR_MODE: 'frosted' }));
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    const active = [...chips].find(c => c.classList.contains('bl-chip--active'));
    expect(active).toBeTruthy();
    expect(active.dataset.type).toBe('frosted');
  });

  test('pick-blur mode renders 3 type chips (no redacted/masked)', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'pick-blur' }));
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    expect(chips).toHaveLength(3);
    const types = [...chips].map(c => c.dataset.type);
    expect(types).not.toContain('redacted');
    expect(types).not.toContain('masked');
    expect(types).toContain('color');
  });

  test('pick-blur mode shows a note element below chips', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'pick-blur' }));
    const note = document.querySelector('.bl-htb-note');
    expect(note).toBeTruthy();
    expect(note.textContent).toBe('htb_pick_blur_note');
  });

  test('blur-all mode shows no note element', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'blur-all' }));
    expect(document.querySelector('.bl-htb-note')).toBeNull();
  });

  test('blur-all summary has Covers row listing enabled categories', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({
      ACTIVE_MODE: 'blur-all',
      BLUR_CATEGORIES: { TEXT: true, MEDIA: false, FORM: false, TABLE: true, STRUCTURE: false },
    }));
    const labels = [...document.querySelectorAll('.bl-summary-row__label')].map(el => el.textContent);
    expect(labels).toContain('htb_label_covers');
    const coversRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_covers'
    );
    const value = coversRow.querySelector('.bl-summary-row__value').textContent;
    expect(value).toContain('cat_text');
    expect(value).toContain('cat_table');
    expect(value).not.toContain('cat_media');
  });

  test('summary Strength row uses Moderate label for radius 6', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ BLUR_RADIUS: 6, BLUR_MODE: 'gaussian' }));
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow).toBeTruthy();
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_moderate');
  });

  test('summary Strength row uses Subtle label for radius 3', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ BLUR_RADIUS: 3, BLUR_MODE: 'gaussian' }));
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_subtle');
  });

  test('summary Strength row uses Strong label for radius 10', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ BLUR_RADIUS: 10, BLUR_MODE: 'gaussian' }));
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_strong');
  });

  test('pick-blur mode has no Covers row in summary', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ ACTIVE_MODE: 'pick-blur', PICK_BLUR_TYPE: 'gaussian' }));
    const labels = [...document.querySelectorAll('.bl-summary-row__label')].map(el => el.textContent);
    expect(labels).not.toContain('htb_label_covers');
  });

  test('color mode shows Color row and no Strength/Reveal rows', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({
      ACTIVE_MODE: 'pick-blur',
      PICK_BLUR_TYPE: 'color',
    }));
    const labels = [...document.querySelectorAll('.bl-summary-row__label')].map(el => el.textContent);
    expect(labels).toContain('htb_label_color');
    expect(labels).not.toContain('htb_label_strength');
    expect(labels).not.toContain('htb_label_reveal');
  });
});

// ── renderPiiSection ─────────────────────────────────────────────────────────

describe('renderPiiSection', () => {
  test('master toggle is checked when EMAIL is true', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({
      AUTO_DETECT: { EMAIL: true, NUMERIC: false },
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(true);
  });

  test('master toggle is unchecked when both are false', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({
      AUTO_DETECT: { EMAIL: false, NUMERIC: false },
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(false);
  });

  test('renders 4 PII mode chips', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings());
    expect(document.querySelectorAll('#bl-pii-chips .bl-chip')).toHaveLength(4);
  });

  test('active PII chip has bl-chip--active and bl-chip--sky', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({ PII_MODE: 'redacted' }));
    const chips = document.querySelectorAll('#bl-pii-chips .bl-chip');
    const active = [...chips].find(c => c.classList.contains('bl-chip--active'));
    expect(active).toBeTruthy();
    expect(active.dataset.piiMode).toBe('redacted');
    expect(active.classList.contains('bl-chip--sky')).toBe(true);
  });
});

// ── renderAutomateSection ────────────────────────────────────────────────────

describe('renderAutomateSection', () => {
  test('renders 3 summary rows', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings());
    expect(document.querySelectorAll('#bl-automate-summary .bl-summary-row')).toHaveLength(3);
  });

  test('TIMER disabled shows Off value', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      AUTOMATE: {
        TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
        IDLE:  { VALUE: 5, UNIT: 'min', ENABLED: false },
        TAB_SWITCH: { ENABLED: false },
      },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const timerRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_timer'
    );
    expect(timerRow.querySelector('.bl-summary-row__value').textContent).toBe('automate_off');
  });

  test('IDLE enabled with value=5 unit=min shows value and unit key', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      AUTOMATE: {
        TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
        IDLE:  { VALUE: 5, UNIT: 'min', ENABLED: true },
        TAB_SWITCH: { ENABLED: false },
      },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const idleRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_idle'
    );
    expect(idleRow.querySelector('.bl-summary-row__value').textContent).toBe('5 automate_unit_min');
  });

  test('TAB_SWITCH enabled shows On value', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      AUTOMATE: {
        TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
        IDLE:  { VALUE: 5, UNIT: 'min', ENABLED: false },
        TAB_SWITCH: { ENABLED: true },
      },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const tabRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_tab_switch'
    );
    expect(tabRow.querySelector('.bl-summary-row__value').textContent).toBe('automate_on');
  });
});

// ── renderModesSection ───────────────────────────────────────────────────────

describe('renderModesSection', () => {
  test('blur-all active: #bl-mode-active gets blur-all and active classes', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'blur-all' }));
    const active = document.getElementById('bl-mode-active');
    expect(active.classList.contains('bl-mode-block--blur-all')).toBe(true);
    expect(active.classList.contains('bl-mode-block--active')).toBe(true);
  });

  test('blur-all active: #bl-mode-waiting gets pick-blur and waiting classes', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'blur-all' }));
    const waiting = document.getElementById('bl-mode-waiting');
    expect(waiting.classList.contains('bl-mode-block--pick-blur')).toBe(true);
    expect(waiting.classList.contains('bl-mode-block--waiting')).toBe(true);
  });

  test('pick-blur active: #bl-mode-active gets pick-blur and active classes', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'pick-blur' }));
    const active = document.getElementById('bl-mode-active');
    expect(active.classList.contains('bl-mode-block--pick-blur')).toBe(true);
    expect(active.classList.contains('bl-mode-block--active')).toBe(true);
  });

  test('blur-all active block contains bl-blur-all-toggle checkbox', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'blur-all' }));
    const toggle = document.getElementById('bl-blur-all-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.type).toBe('checkbox');
  });

  test('bl-blur-all-toggle is checked when ENABLED=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'blur-all', ENABLED: true }));
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(true);
  });

  test('bl-blur-all-toggle is unchecked when ENABLED=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'blur-all', ENABLED: false }));
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(false);
  });

  test('pick-blur active block contains bl-open-picker button', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ ACTIVE_MODE: 'pick-blur' }));
    expect(document.getElementById('bl-open-picker')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run failing tests**

```bash
npm run test:unit -- --testPathPattern=popup_render 2>&1 | tail -10
```
Expected: FAIL (module not found / stub runs, stub renders no DOM).

- [ ] **Step 5: Create popup/popup_render.js**

Create `popup/popup_render.js`:

```js
const BlurrySitePopupRender = (() => {
  'use strict';

  function _t(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  const _TYPE_KEY = {
    gaussian: 'htb_chip_gaussian',
    frosted:  'htb_chip_frosted',
    redacted: 'htb_chip_redacted',
    masked:   'htb_chip_masked',
    color:    'htb_chip_color',
  };

  const _PII_KEY = {
    gaussian:   'pii_chip_gaussian',
    frosted:    'pii_chip_frosted',
    redacted:   'pii_chip_redacted',
    asterisked: 'pii_chip_asterisked',
  };

  const _CAT_KEY = {
    TEXT:      'cat_text',
    MEDIA:     'cat_media',
    FORM:      'cat_form',
    TABLE:     'cat_table',
    STRUCTURE: 'cat_structure',
  };

  function _summaryRow(label, value) {
    const row = document.createElement('div');
    row.className = 'bl-summary-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'bl-summary-row__label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'bl-summary-row__value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  // ── How to Blur section ────────────────────────────────────────────────────

  function renderHtbSection(settings) {
    const chipsEl   = document.getElementById('bl-htb-chips');
    const summaryEl = document.getElementById('bl-htb-summary');
    if (!chipsEl || !summaryEl) return;

    const isBlurAll  = settings.ACTIVE_MODE === 'blur-all';
    const activeType = isBlurAll ? settings.BLUR_MODE : settings.PICK_BLUR_TYPE;
    const types      = isBlurAll
      ? ['gaussian', 'frosted', 'redacted', 'masked']
      : ['gaussian', 'frosted', 'color'];

    // Chips
    chipsEl.innerHTML = '';
    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'bl-chip' + (t === activeType ? ' bl-chip--active' : '');
      btn.dataset.type = t;
      btn.textContent = _t(_TYPE_KEY[t]);
      chipsEl.appendChild(btn);
    }

    // Remove previous note if present
    const prevNote = chipsEl.parentNode.querySelector('.bl-htb-note');
    if (prevNote) prevNote.remove();

    // Pick-blur note
    if (!isBlurAll) {
      const note = document.createElement('p');
      note.className = 'bl-section__hint bl-htb-note';
      note.textContent = _t('htb_pick_blur_note');
      summaryEl.parentNode.insertBefore(note, summaryEl);
    }

    // Summary rows
    summaryEl.innerHTML = '';

    if (isBlurAll) {
      const cats = settings.BLUR_CATEGORIES;
      const catLabels = Object.keys(_CAT_KEY)
        .filter(k => cats[k])
        .map(k => _t(_CAT_KEY[k]));
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_covers'),
        catLabels.length ? catLabels.join(', ') : _t('automate_off'),
      ));
    }

    if (activeType !== 'color' && activeType !== 'redacted' && activeType !== 'masked') {
      const r = settings.BLUR_RADIUS;
      const strengthKey = r <= 4 ? 'htb_strength_subtle' : r <= 9 ? 'htb_strength_moderate' : 'htb_strength_strong';
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_strength'),
        _t(strengthKey) + ' (' + r + 'px)',
      ));
    }

    if (activeType !== 'color') {
      const revealKeyMap = { hover: 'reveal_hover', click: 'reveal_click', none: 'reveal_none' };
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_reveal'),
        _t(revealKeyMap[settings.REVEAL_MODE] || 'reveal_none'),
      ));
    }

    if (activeType === 'color') {
      summaryEl.appendChild(_summaryRow(
        _t('htb_label_color'),
        settings.PICK_BLUR_COLOR.HEX,
      ));
    }
  }

  // ── PII section ────────────────────────────────────────────────────────────

  function renderPiiSection(settings) {
    const toggleEl = document.getElementById('bl-pii-master');
    const chipsEl  = document.getElementById('bl-pii-chips');
    if (!toggleEl || !chipsEl) return;

    toggleEl.checked = settings.AUTO_DETECT.EMAIL || settings.AUTO_DETECT.NUMERIC;

    chipsEl.innerHTML = '';
    for (const t of ['gaussian', 'frosted', 'redacted', 'asterisked']) {
      const btn = document.createElement('button');
      const isActive = t === settings.PII_MODE;
      btn.className = 'bl-chip' + (isActive ? ' bl-chip--sky bl-chip--active' : '');
      btn.dataset.piiMode = t;
      btn.textContent = _t(_PII_KEY[t]);
      chipsEl.appendChild(btn);
    }
  }

  // ── Automate section ───────────────────────────────────────────────────────

  function renderAutomateSection(settings) {
    const summaryEl = document.getElementById('bl-automate-summary');
    if (!summaryEl) return;
    summaryEl.innerHTML = '';

    const a = settings.AUTOMATE;

    const timerVal = (a.TIMER.ENABLED && a.TIMER.VALUE > 0)
      ? a.TIMER.VALUE + ' ' + _t('automate_unit_' + a.TIMER.UNIT)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_timer'), timerVal));

    const idleVal = (a.IDLE.ENABLED && a.IDLE.VALUE > 0)
      ? a.IDLE.VALUE + ' ' + _t('automate_unit_' + a.IDLE.UNIT)
      : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_idle'), idleVal));

    const tabVal = a.TAB_SWITCH.ENABLED ? _t('automate_on') : _t('automate_off');
    summaryEl.appendChild(_summaryRow(_t('automate_tab_switch'), tabVal));
  }

  // ── Modes section ──────────────────────────────────────────────────────────

  function _renderBlurAllBlock(el, settings, isActive) {
    el.className = 'bl-mode-block bl-mode-block--blur-all' +
      (isActive ? ' bl-mode-block--active' : ' bl-mode-block--waiting');
    el.innerHTML = '';

    if (!isActive) {
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_blur_all');
      el.appendChild(title);
      return;
    }

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';

    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot bl-mode-block__dot--amber ' + (settings.ENABLED ? 'is-on' : 'is-off');
    header.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_blur_all');
    header.appendChild(title);

    const catCount = Object.values(settings.BLUR_CATEGORIES).filter(Boolean).length;
    const subtitle = document.createElement('span');
    subtitle.className = 'bl-mode-block__subtitle';
    subtitle.textContent = _t(_TYPE_KEY[settings.BLUR_MODE] || 'htb_chip_gaussian') +
      ' · ' + catCount + ' ' + _t('mode_blur_all_cats');
    header.appendChild(subtitle);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'bl-toggle bl-mode-block__toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.id = 'bl-blur-all-toggle';
    toggleInput.checked = settings.ENABLED;
    const toggleTrack = document.createElement('span');
    toggleTrack.className = 'bl-toggle__track';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleTrack);
    header.appendChild(toggleLabel);

    el.appendChild(header);

    const body = document.createElement('p');
    body.className = 'bl-mode-block__body';
    body.textContent = settings.ENABLED
      ? _t('mode_blur_all_active_desc')
      : _t('mode_blur_all_off_hint');
    el.appendChild(body);
  }

  function _renderPickBlurBlock(el, settings, isActive) {
    el.className = 'bl-mode-block bl-mode-block--pick-blur' +
      (isActive ? ' bl-mode-block--active' : ' bl-mode-block--waiting');
    el.innerHTML = '';

    if (!isActive) {
      const title = document.createElement('span');
      title.className = 'bl-mode-block__title';
      title.textContent = _t('btn_picker');
      el.appendChild(title);
      return;
    }

    const header = document.createElement('div');
    header.className = 'bl-mode-block__header';

    const dot = document.createElement('span');
    dot.className = 'bl-mode-block__dot bl-mode-block__dot--sky is-on';
    header.appendChild(dot);

    const title = document.createElement('span');
    title.className = 'bl-mode-block__title';
    title.textContent = _t('btn_picker');
    header.appendChild(title);

    el.appendChild(header);

    const empty = document.createElement('div');
    empty.className = 'bl-mode-block__empty';

    const emptyText = document.createElement('p');
    emptyText.className = 'bl-mode-block__empty-text';
    emptyText.textContent = _t('mode_pick_blur_empty');
    empty.appendChild(emptyText);

    const openBtn = document.createElement('button');
    openBtn.className = 'bl-btn-primary bl-mode-block__open-picker';
    openBtn.id = 'bl-open-picker';
    openBtn.textContent = _t('mode_open_picker');
    empty.appendChild(openBtn);

    el.appendChild(empty);
  }

  function renderModesSection(settings) {
    const activeEl  = document.getElementById('bl-mode-active');
    const waitingEl = document.getElementById('bl-mode-waiting');
    if (!activeEl || !waitingEl) return;

    if (settings.ACTIVE_MODE === 'blur-all') {
      _renderBlurAllBlock(activeEl, settings, true);
      _renderPickBlurBlock(waitingEl, settings, false);
    } else {
      _renderPickBlurBlock(activeEl, settings, true);
      _renderBlurAllBlock(waitingEl, settings, false);
    }
  }

  // ── Render all sections ────────────────────────────────────────────────────

  function renderAll(settings) {
    renderModesSection(settings);
    renderHtbSection(settings);
    renderPiiSection(settings);
    renderAutomateSection(settings);
  }

  return { renderAll, renderHtbSection, renderPiiSection, renderAutomateSection, renderModesSection };
})();
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npm run test:unit -- --testPathPattern=popup_render 2>&1 | tail -10
```
Expected: all popup_render tests PASS.

- [ ] **Step 7: Run full test suite**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: all tests pass (count increases by ~20).

- [ ] **Step 8: Run string linter**

```bash
node scripts/string_lint.js
```
Expected: `string lint: scanned N file(s), 0 hardcoded strings`

- [ ] **Step 9: Commit**

```bash
git add tests/setup.js popup/popup_render.js tests/unit/popup_render.test.js
git commit -m "feat(popup): popup_render.js — renderAll, renderHtbSection, renderPiiSection, renderAutomateSection, renderModesSection"
```

---

## Task 3: CSS additions for rendered content

**Files:**
- Modify: `popup/popup.css`

- [ ] **Step 1: Add mode block content styles to popup.css**

Append the following after the existing `.bl-mode-block--waiting` rule (around line 125):

```css
/* ── Mode block content ──────────────────────────────────────────────── */
.bl-mode-block--blur-all.bl-mode-block--active {
  border-color: color-mix(in srgb, var(--bl-amber) 40%, transparent);
}
.bl-mode-block--pick-blur.bl-mode-block--active {
  border-color: color-mix(in srgb, var(--bl-sky) 40%, transparent);
}

.bl-mode-block__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.bl-mode-block__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--bl-text-dim);
  transition: background 0.2s, box-shadow 0.2s;
}
.bl-mode-block__dot--amber.is-on {
  background: var(--bl-amber);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bl-amber) 25%, transparent);
}
.bl-mode-block__dot--sky.is-on {
  background: var(--bl-sky);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bl-sky) 25%, transparent);
}

.bl-mode-block__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--bl-text-primary);
}

.bl-mode-block__subtitle {
  font-size: 11px;
  color: var(--bl-text-muted);
  flex: 1;
}

.bl-mode-block__toggle { margin-left: auto; }

.bl-mode-block__body {
  font-size: 11px;
  color: var(--bl-text-muted);
  line-height: 1.4;
}

.bl-mode-block__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px;
}

.bl-mode-block__empty-text {
  font-size: 12px;
  color: var(--bl-text-muted);
  text-align: center;
  line-height: 1.4;
}

.bl-mode-block__open-picker {
  font-size: 12px;
  padding: 6px 16px;
}
```

- [ ] **Step 2: Verify tests still pass**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: same test count, all pass.

- [ ] **Step 3: Commit**

```bash
git add popup/popup.css
git commit -m "feat(popup): mode block content CSS — dot, header, body, empty state"
```

---

## Task 4: Wire popup.html + popup.js + i18n init + TEST_VALIDATION

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `docs/TEST_VALIDATION.md`

- [ ] **Step 1: Add popup_render.js script tag to popup.html**

In `popup/popup.html`, find the scripts block at the bottom:
```html
  <!-- Scripts: constants → logger → action_registry → storage_manager → popup -->
  <script src="../src/constants.js"></script>
  <script src="../src/logger.js"></script>
  <script src="../src/action_registry.js"></script>
  <script src="../src/storage_manager.js"></script>
  <script src="popup.js"></script>
```

Change to:
```html
  <!-- Scripts: constants → logger → action_registry → storage_manager → popup_render → popup -->
  <script src="../src/constants.js"></script>
  <script src="../src/logger.js"></script>
  <script src="../src/action_registry.js"></script>
  <script src="../src/storage_manager.js"></script>
  <script src="popup_render.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Update popup.js with full wiring**

Replace the entire contents of `popup/popup.js` with:

```js
const BlurrySitePopup = (() => {
  'use strict';

  let _settings = null;
  let _toastTimer = null;

  // ── Theme ──────────────────────────────────────────────────────────────
  const LOGO_DARK     = '../icons/icon-dark.png';
  const LOGO_LIGHT    = '../icons/icon-light.png';
  const LOGO_FALLBACK = '../icons/icon48.png';

  function _setLogoSrc(img, isDark) {
    if (!img) return;
    img.src = isDark ? LOGO_DARK : LOGO_LIGHT;
    img.onerror = () => { img.onerror = null; img.src = LOGO_FALLBACK; };
  }

  function applyTheme(theme) {
    const isDark = theme !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
    const btn = document.getElementById('bl-theme-toggle');
    if (btn) btn.textContent = isDark ? '☀' : '🌙';
    _setLogoSrc(document.getElementById('bl-logo'), isDark);
    _setLogoSrc(document.getElementById('bl-logo-off'), isDark);
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  function showToast(key, substitutions) {
    const el = document.getElementById('bl-toast');
    if (!el) return;
    const msg = chrome.i18n.getMessage(key, substitutions) || key;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('is-visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      _toastTimer = setTimeout(() => { el.hidden = true; }, 220);
    }, 2200);
  }

  // ── Host display ────────────────────────────────────────────────────────
  function setHost(hostname) {
    document.querySelectorAll('.bl-header__host, .bl-subpage__host').forEach((el) => {
      el.textContent = hostname || '';
    });
  }

  // ── Version ─────────────────────────────────────────────────────────────
  function setVersion() {
    const el = document.getElementById('bl-version');
    if (el) el.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // ── Apply data-i18n attributes ───────────────────────────────────────────
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = chrome.i18n.getMessage(el.dataset.i18n);
      if (msg) el.textContent = msg;
    });
  }

  // ── Save settings + re-render + notify tab ────────────────────────────────
  async function _saveAndApply(patch) {
    const next = { ..._settings, ...patch };
    await blsi.Storage.saveSettings(next);
    _settings = next;
    BlurrySitePopupRender.renderAll(_settings);
  }

  function _notifyTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: blsi.POPUP.UPDATE_SETTINGS,
          settings: _settings,
        }).catch(() => {});
      }
    });
  }

  // ── Power button + off-state ─────────────────────────────────────────────
  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (btn) {
      btn.classList.toggle('is-off', !enabled);
      btn.title = enabled ? 'Disable Blurry Site' : 'Enable Blurry Site';
    }
    document.getElementById('bl-view-main').hidden = !enabled;
    const offView = document.getElementById('bl-view-off');
    if (offView) offView.hidden = enabled;
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  const SUB_VIEWS = [
    'bl-view-htb-modify',
    'bl-view-automate-modify',
    'bl-view-shortcuts',
    'bl-view-site-rules',
  ];

  function showView(viewId) {
    const isMain = viewId === 'bl-view-main';
    document.getElementById('bl-view-main').hidden = !isMain || !_settings.ENABLED;
    document.getElementById('bl-view-off').hidden   = isMain ? _settings.ENABLED : true;
    for (const id of SUB_VIEWS) {
      document.getElementById(id).hidden = id !== viewId;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      applyTheme(data.blsi_popup_theme || 'dark');
    });

    applyI18n();
    setVersion();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url) {
        try { setHost(new URL(tab.url).hostname); } catch (_) {}
      }
    });

    _settings = await blsi.Storage.getSettings();
    renderPowerButton(_settings.ENABLED);
    BlurrySitePopupRender.renderAll(_settings);

    // ── Header ───────────────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      await _saveAndApply({ ENABLED: !_settings.ENABLED });
      renderPowerButton(_settings.ENABLED);
      showToast(_settings.ENABLED ? 'toast_enabled' : 'toast_disabled');
      _notifyTab();
    });

    // ── Off-state turn-on ─────────────────────────────────────────────────
    document.getElementById('bl-turn-on').addEventListener('click', async () => {
      await _saveAndApply({ ENABLED: true });
      renderPowerButton(true);
      showToast('toast_enabled');
      _notifyTab();
    });

    // ── Blur All toggle inside mode block (event delegation on #bl-modes) ─
    document.getElementById('bl-modes').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-blur-all-toggle') return;
      await _saveAndApply({ ENABLED: e.target.checked });
      renderPowerButton(_settings.ENABLED);
      showToast(_settings.ENABLED ? 'toast_enabled' : 'toast_disabled');
      _notifyTab();
    });

    // ── PII master toggle ─────────────────────────────────────────────────
    document.getElementById('bl-pii').addEventListener('change', async (e) => {
      if (e.target.id !== 'bl-pii-master') return;
      const on = e.target.checked;
      await _saveAndApply({
        AUTO_DETECT: { ...(_settings.AUTO_DETECT), EMAIL: on, NUMERIC: on },
      });
      _notifyTab();
    });

    // ── PII mode chip click ───────────────────────────────────────────────
    document.getElementById('bl-pii-chips').addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-pii-mode]');
      if (!chip) return;
      await _saveAndApply({ PII_MODE: chip.dataset.piiMode });
      _notifyTab();
    });

    // ── HTB chip click → navigate to modify sub-page ──────────────────────
    document.getElementById('bl-htb-chips').addEventListener('click', (e) => {
      if (e.target.closest('.bl-chip')) showView('bl-view-htb-modify');
    });

    // ── Sub-page navigation ───────────────────────────────────────────────
    document.getElementById('bl-htb-modify').addEventListener('click', () => showView('bl-view-htb-modify'));
    document.getElementById('bl-automate-modify').addEventListener('click', () => showView('bl-view-automate-modify'));
    document.getElementById('bl-nav-shortcuts').addEventListener('click', () => showView('bl-view-shortcuts'));
    document.getElementById('bl-nav-site-rules').addEventListener('click', () => showView('bl-view-site-rules'));

    // ── Back buttons ──────────────────────────────────────────────────────
    document.querySelectorAll('.bl-back-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView('bl-view-main'));
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showView, showToast };
})();
```

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 4: Run string linter**

```bash
node scripts/string_lint.js
```
Expected: `string lint: scanned N file(s), 0 hardcoded strings`

- [ ] **Step 5: Add TEST_VALIDATION.md entry**

In `docs/TEST_VALIDATION.md`, add a new section for `popup_render.test.js` with the following entry (add after the last existing test section):

```markdown
## 20. popup_render.test.js

Unit tests for `BlurrySitePopupRender` — the stateless DOM renderer for the popup main view sections.

### renderHtbSection — blur-all mode renders 4 type chips
**Asserts:** When `ACTIVE_MODE='blur-all'`, four `.bl-chip` elements appear in `#bl-htb-chips`.
**Manual:** Load the popup with `ACTIVE_MODE='blur-all'` in settings, open DevTools, confirm `#bl-htb-chips` has 4 children with class `bl-chip`.

### renderHtbSection — active chip has bl-chip--active
**Asserts:** The chip matching `BLUR_MODE` (e.g. `frosted`) has class `bl-chip--active`.
**Manual:** With `BLUR_MODE='frosted'`, open popup; the Frosted chip should be highlighted amber.

### renderHtbSection — pick-blur mode renders 3 chips (no redacted/masked)
**Asserts:** `ACTIVE_MODE='pick-blur'` yields 3 chips; none have `data-type='redacted'` or `'masked'`; one has `data-type='color'`.
**Manual:** Switch `ACTIVE_MODE` to `pick-blur` in storage, open popup; confirm 3 chips (Gaussian, Frosted, Color).

### renderHtbSection — pick-blur shows note element
**Asserts:** A `.bl-htb-note` element exists below chips when `ACTIVE_MODE='pick-blur'`.
**Manual:** In pick-blur mode, note text "Redacted & Masked available in Blur All mode." appears below chips.

### renderHtbSection — blur-all hides note element
**Asserts:** No `.bl-htb-note` in blur-all mode.
**Manual:** In blur-all mode, no note text between chips and summary.

### renderHtbSection — Covers row lists enabled categories
**Asserts:** Summary has a Covers row; its value includes keys for enabled categories only.
**Manual:** With TEXT+TABLE enabled (rest off), Covers row shows "Text, Tables".

### renderHtbSection — Strength row: Moderate for radius 6
**Asserts:** A Strength summary row exists with value containing `htb_strength_moderate` for `BLUR_RADIUS=6`.
**Manual:** With `BLUR_RADIUS=6`, Strength row shows "Moderate (6px)".

### renderHtbSection — Strength row: Subtle for radius 3
**Asserts:** Strength row value contains `htb_strength_subtle` for `BLUR_RADIUS=3`.
**Manual:** Set `BLUR_RADIUS=3` in storage, open popup; Strength shows "Subtle (3px)".

### renderHtbSection — Strength row: Strong for radius 10
**Asserts:** Strength row value contains `htb_strength_strong` for `BLUR_RADIUS=10`.
**Manual:** Set `BLUR_RADIUS=10`, confirm "Strong (10px)".

### renderHtbSection — pick-blur has no Covers row
**Asserts:** No `htb_label_covers` in summary when pick-blur mode.
**Manual:** In pick-blur mode, summary has no Covers row.

### renderHtbSection — color mode shows Color row, no Strength/Reveal
**Asserts:** `PICK_BLUR_TYPE='color'` shows a Color row; no Strength or Reveal row.
**Manual:** Set `PICK_BLUR_TYPE='color'`, open popup; only Color row visible in summary.

### renderPiiSection — toggle checked when EMAIL is true
**Asserts:** `#bl-pii-master` is checked when `AUTO_DETECT.EMAIL=true`.
**Manual:** Set `AUTO_DETECT.EMAIL=true` in storage, open popup; PII toggle appears on.

### renderPiiSection — toggle unchecked when both false
**Asserts:** `#bl-pii-master` unchecked when both EMAIL and NUMERIC are false.
**Manual:** Both false in storage; toggle appears off.

### renderPiiSection — 4 PII mode chips rendered
**Asserts:** Four `.bl-chip` elements in `#bl-pii-chips`.
**Manual:** Open popup; PII section shows Gaussian, Frosted, Redacted, Asterisked chips.

### renderPiiSection — active PII chip has correct classes
**Asserts:** Chip matching `PII_MODE` has both `bl-chip--active` and `bl-chip--sky`.
**Manual:** With `PII_MODE='redacted'`, the Redacted chip should be highlighted sky/cyan.

### renderAutomateSection — 3 rows rendered
**Asserts:** `#bl-automate-summary` has exactly 3 `.bl-summary-row` children.
**Manual:** Open popup; Automate section shows Timer, Idle, Tab Switch rows.

### renderAutomateSection — TIMER disabled shows Off
**Asserts:** Timer row value is `automate_off` when TIMER.ENABLED=false.
**Manual:** Disable timer in settings; Timer row shows "Off".

### renderAutomateSection — IDLE enabled shows value and unit
**Asserts:** Idle row value is "5 automate_unit_min" when IDLE={VALUE:5, UNIT:'min', ENABLED:true}.
**Manual:** Enable idle with 5 min; row shows "5 min".

### renderAutomateSection — TAB_SWITCH enabled shows On
**Asserts:** Tab Switch row value is `automate_on` when TAB_SWITCH.ENABLED=true.
**Manual:** Enable tab switch; row shows "On".

### renderModesSection — blur-all active: active block has correct classes
**Asserts:** `#bl-mode-active` has `bl-mode-block--blur-all` and `bl-mode-block--active`.
**Manual:** With `ACTIVE_MODE='blur-all'`, top block shows Blur All styling with amber accent.

### renderModesSection — blur-all active: waiting block has pick-blur classes
**Asserts:** `#bl-mode-waiting` has `bl-mode-block--pick-blur` and `bl-mode-block--waiting`.
**Manual:** Bottom dimmed block shows "Pick & Blur" label.

### renderModesSection — pick-blur active: active block has pick-blur classes
**Asserts:** `#bl-mode-active` has `bl-mode-block--pick-blur` and `bl-mode-block--active` when `ACTIVE_MODE='pick-blur'`.
**Manual:** With `ACTIVE_MODE='pick-blur'`, top block shows sky accent.

### renderModesSection — blur-all toggle exists when blur-all active
**Asserts:** `#bl-blur-all-toggle` checkbox exists inside `#bl-mode-active` for blur-all mode.
**Manual:** In blur-all mode, mode block contains a toggle switch.

### renderModesSection — blur-all toggle checked matches ENABLED
**Asserts:** `#bl-blur-all-toggle` is checked/unchecked based on `ENABLED`.
**Manual:** Toggle off in popup; checkbox reflects off state.

### renderModesSection — pick-blur active has open-picker button
**Asserts:** `#bl-open-picker` button exists in `#bl-mode-active` for pick-blur mode.
**Manual:** In pick-blur mode, "Open Picker" button visible in top block.
```

- [ ] **Step 6: Final full test run + lint**

```bash
npm run test:unit 2>&1 | tail -5 && node scripts/string_lint.js
```
Expected: all tests pass, 0 hardcoded strings.

- [ ] **Step 7: Commit**

```bash
git add popup/popup.html popup/popup.js docs/TEST_VALIDATION.md
git commit -m "feat(popup): wire Plan 2 renderers — PII toggle/chips, HTB nav, Blur All toggle, i18n init"
```

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| §4 Swappable modes — active/waiting blocks, dot, title, subtitle, toggle, body | Task 2 renderModesSection + Task 3 CSS |
| §4.2 Blur All active — amber accent, dot, title, subtitle, toggle | Task 2 + Task 3 |
| §4.5 Pick & Blur empty state — message + Open Picker CTA | Task 2 |
| §5 How to Blur — type chips, summary, Modify → nav, pick-blur note | Task 2 renderHtbSection + Task 4 wiring |
| §7 Auto-Detect PII — master toggle, mode chips | Task 2 renderPiiSection + Task 4 wiring |
| §8 Automate — summary rows | Task 2 renderAutomateSection |
| §2 Color tokens | Task 3 CSS uses existing `theme.css` tokens |

**Not in Plan 2 (deferred):** §4.3 Blur All off dim state (toggle already sets ENABLED=false, CSS --waiting opacity handles it), §4.4 Pick & Blur element list + mode badge (Plan 3), §6 Picker toolbar (Plan 3), §8.2 Automate Modify sub-page (Plan 3), §9 Shortcuts/Site Rules sub-pages (Plan 3), §10 Footer utility links (Plan 3).

### Placeholder scan

No "TBD", "TODO", or "implement later" entries. No placeholders in code examples.

### Type consistency

- `renderHtbSection(settings)` — settings argument, DOM IDs `bl-htb-chips` + `bl-htb-summary` used consistently.
- `renderPiiSection(settings)` — DOM IDs `bl-pii-master` + `bl-pii-chips` match popup.html.
- `renderAutomateSection(settings)` — DOM ID `bl-automate-summary` matches popup.html.
- `renderModesSection(settings)` — DOM IDs `bl-mode-active` + `bl-mode-waiting` match popup.html.
- `bl-blur-all-toggle` created by `_renderBlurAllBlock`, listened to by event delegation on `#bl-modes` in popup.js.
- `bl-open-picker` created by `_renderPickBlurBlock`, ID matches test assertions.
- `data-pii-mode` attribute used in `renderPiiSection`, referenced in popup.js chip click handler.
- `data-type` attribute used in `renderHtbSection`, referenced in popup.js chip click handler.
