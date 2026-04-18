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

  test('blur-all active block contains subtitle with type and category count', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({
      ACTIVE_MODE: 'blur-all',
      BLUR_MODE: 'gaussian',
      BLUR_CATEGORIES: { TEXT: true, MEDIA: true, FORM: false, TABLE: true, STRUCTURE: true },
    }));
    const subtitle = document.querySelector('#bl-mode-active .bl-mode-block__subtitle');
    expect(subtitle).toBeTruthy();
    // The subtitle contains the chip label key and the category count
    expect(subtitle.textContent).toContain('htb_chip_gaussian');
    expect(subtitle.textContent).toContain('4');
  });
});
