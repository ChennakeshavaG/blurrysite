'use strict';

const fs   = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '../../popup/renders/main.js');

function loadRender() {
  if (global.BlurrySitePopupRender) return;
  if (fs.existsSync(MODULE_PATH)) {
    require(MODULE_PATH);
  } else {
    (0, eval)(buildStubSource());
  }
}

function buildStubSource() {
  throw new Error('popup/renders/main.js not found — cannot run tests against a stub');
}

function deepMerge(target, source) {
  const out = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object') {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function makeSettings(overrides) {
  const base = {
    global_default_settings: {
      enabled: true,
      blur_radius: 6,
      reveal_mode: 'hover',
      redaction_color: '#000000',
      thorough_blur: false,
      transition_duration: 150,
    },
    blur_all: {
      status: false,
      settings: {
        blur_mode: 'blur',
        blur_categories: { text: true, media: true, form: false, table: true, structure: true },
      },
    },
    pick_and_blur: {
      status: true,
      settings: {
        blur_type: 'blur',
        picker_mode: 'sticky-page',
        blur_color: { hex: '#000000', opacity: 1.0 },
      },
    },
    auto_detect_pii: {
      status: false,
      settings: {
        email: false,
        numeric: false,
        pii_mode: 'blur',
        pii_redaction_color: '#000000',
      },
    },
    automate: {
      status: false,
      settings: {
        idle:         { value: 5, unit: 'min', enabled: false },
        tab_switch:   { enabled: false },
        screen_share: { enabled: false },
      },
    },
    automate_blur_active:   false,
    automate_blur_triggers: { idle: false, tab_switch: false, screen_share: false },
  };
  if (!overrides) return base;
  return deepMerge(base, overrides);
}

function setupDom() {
  document.body.innerHTML = `
    <div id="bl-htb-chips"></div>
    <div id="bl-htb-summary"></div>
    <section id="bl-pii">
      <input type="checkbox" id="bl-pii-master">
      <div id="bl-pii-chips"></div>
      <div id="bl-pii-color-row"></div>
    </section>
    <div id="bl-automate-summary"></div>
    <div id="bl-mode-blur-all" class="bl-mode-block"></div>
    <div id="bl-mode-pick-blur" class="bl-mode-block"></div>
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
    BlurrySitePopupRender.renderHtbSection(makeSettings(), true);
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    expect(chips).toHaveLength(4);
  });

  test('active blur-all chip has bl-chip--active class', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ blur_all: { settings: { blur_mode: 'frosted' } } }), true);
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    const active = [...chips].find(c => c.classList.contains('bl-chip--active'));
    expect(active).toBeTruthy();
    expect(active.dataset.type).toBe('frosted');
  });

  test('pick-blur mode renders 3 type chips (no redacted/censored)', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings(), false);
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    expect(chips).toHaveLength(3);
    const types = [...chips].map(c => c.dataset.type);
    expect(types).not.toContain('redacted');
    expect(types).not.toContain('censored');
    expect(types).toContain('color');
  });

  test('blur-all summary has Covers row listing enabled categories', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({
      blur_all: { settings: { blur_categories: { text: true, media: false, form: false, table: true, structure: false } } },
    }), true);
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
    BlurrySitePopupRender.renderHtbSection(makeSettings({ global_default_settings: { blur_radius: 6 }, blur_all: { settings: { blur_mode: 'blur' } } }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow).toBeTruthy();
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_moderate');
  });

  test('summary Strength row uses Subtle label for radius 3', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ global_default_settings: { blur_radius: 3 }, blur_all: { settings: { blur_mode: 'blur' } } }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_subtle');
  });

  test('summary Strength row uses Strong label for radius 10', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ global_default_settings: { blur_radius: 10 }, blur_all: { settings: { blur_mode: 'blur' } } }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_strong');
  });

  test('pick-blur mode has no Covers row in summary', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ pick_and_blur: { settings: { blur_type: 'blur' } } }), false);
    const labels = [...document.querySelectorAll('.bl-summary-row__label')].map(el => el.textContent);
    expect(labels).not.toContain('htb_label_covers');
  });

  test('color mode shows Color row and no Strength/Reveal rows', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ pick_and_blur: { settings: { blur_type: 'color' } } }), false);
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
      auto_detect_pii: { settings: { email: true, numeric: false } },
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(true);
  });

  test('master toggle is unchecked when both are false', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({
      auto_detect_pii: { settings: { email: false, numeric: false } },
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(false);
  });

  test('renders 4 PII mode chips', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings());
    expect(document.querySelectorAll('#bl-pii-chips .bl-chip')).toHaveLength(4);
  });

  test('active PII chip has bl-chip--active (amber, no sky class)', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({ auto_detect_pii: { settings: { pii_mode: 'redacted' } } }));
    const chips = document.querySelectorAll('#bl-pii-chips .bl-chip');
    const active = [...chips].find(c => c.classList.contains('bl-chip--active'));
    expect(active).toBeTruthy();
    expect(active.dataset.piiMode).toBe('redacted');
    expect(active.classList.contains('bl-chip--sky')).toBe(false);
  });
});

// ── renderAutomateSection ────────────────────────────────────────────────────

describe('renderAutomateSection', () => {
  test('renders 3 summary rows', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings());
    expect(document.querySelectorAll('#bl-automate-summary .bl-summary-row')).toHaveLength(3);
  });

  test('IDLE enabled with value=5 unit=min shows value and unit key', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      automate: { settings: { idle: { value: 5, unit: 'min', enabled: true }, tab_switch: { enabled: false } } },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const idleRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_idle'
    );
    expect(idleRow.querySelector('.bl-summary-row__value').textContent).toBe('5 automate_unit_min');
  });

  test('TAB_SWITCH enabled shows On value', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      automate: { settings: { idle: { value: 5, unit: 'min', enabled: false }, tab_switch: { enabled: true } } },
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
  // ── mode classes ──────────────────────────────────────────────────────────

  test('blur-all block has bl-mode-block--blur-all class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.getElementById('bl-mode-blur-all').classList.contains('bl-mode-block--blur-all')).toBe(true);
  });

  test('pick-blur block has bl-mode-block--pick-blur class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.getElementById('bl-mode-pick-blur').classList.contains('bl-mode-block--pick-blur')).toBe(true);
  });

  // ── dot color ─────────────────────────────────────────────────────────────

  test('blur-all: dot has is-on when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains('is-on')).toBe(true);
  });

  test('blur-all: dot lacks is-on when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains('is-on')).toBe(false);
    expect(dot.classList.contains('is-off')).toBe(true);
  });

  test('pick-blur: dot is-on when pick_blur_enabled=true (regardless of items)', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    const dot = document.querySelector('#bl-mode-pick-blur .bl-mode-block__dot');
    expect(dot.classList.contains('is-on')).toBe(true);
  });

  test('pick-blur: dot is-off when pick_blur_enabled=false', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), items, false);
    const dot = document.querySelector('#bl-mode-pick-blur .bl-mode-block__dot');
    expect(dot.classList.contains('is-on')).toBe(false);
    expect(dot.classList.contains('is-off')).toBe(true);
  });

  // ── blur-all: toggle + read-only table ───────────────────────────────────

  test('blur-all: contains bl-blur-all-toggle checkbox', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const toggle = document.getElementById('bl-blur-all-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.type).toBe('checkbox');
  });

  test('bl-blur-all-toggle is checked when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(true);
  });

  test('bl-blur-all-toggle is unchecked when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(false);
  });

  test('blur-all: header has title and toggle, no inline subtitle', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const header = document.querySelector('#bl-mode-blur-all .bl-mode-block__header');
    expect(header).toBeTruthy();
    expect(header.querySelector('.bl-mode-block__title')).toBeTruthy();
    expect(header.querySelector('.bl-toggle')).toBeTruthy();
    expect(header.querySelector('.bl-mode-block__subtitle')).toBeFalsy();
  });

  test('blur-all: block has bl-mode-block--off when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.getElementById('bl-mode-blur-all').classList.contains('bl-mode-block--off')).toBe(true);
  });

  test('blur-all: block lacks bl-mode-block--off when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    expect(document.getElementById('bl-mode-blur-all').classList.contains('bl-mode-block--off')).toBe(false);
  });

  test('blur-all: shows mode_blur_all_off_hint and no summary table when off', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const hint = document.querySelector('#bl-mode-blur-all .bl-pick-count');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toBe('mode_blur_all_off_hint');
    expect(document.querySelectorAll('#bl-mode-blur-all .bl-summary-row')).toHaveLength(0);
  });

  test('blur-all: info table has Mode, Covers, Strength, Reveal summary rows', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    const labels = [...document.querySelectorAll('#bl-mode-blur-all .bl-summary-row__label')].map(e => e.textContent);
    expect(labels).toContain('htb_label_mode');
    expect(labels).toContain('htb_label_covers');
    expect(labels).toContain('htb_label_strength');
    expect(labels).toContain('htb_label_reveal');
  });

  test('blur-all: no inline chips (read-only table only)', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const typeChips = document.querySelectorAll('#bl-mode-blur-all [data-type]');
    expect(typeChips).toHaveLength(0);
  });

  // ── pick-blur: toggle + read-only info ───────────────────────────────────

  test('pick-blur: contains bl-pick-blur-toggle checkbox', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const toggle = document.getElementById('bl-pick-blur-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.type).toBe('checkbox');
  });

  test('bl-pick-blur-toggle is checked when pick_blur_enabled=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    expect(document.getElementById('bl-pick-blur-toggle').checked).toBe(true);
  });

  test('bl-pick-blur-toggle is unchecked when pick_blur_enabled=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    expect(document.getElementById('bl-pick-blur-toggle').checked).toBe(false);
  });

  test('pick-blur ON empty: shows mode_pick_blur_empty text', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count')).toBeTruthy();
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count').textContent).toBe('mode_pick_blur_empty');
  });

  test('pick-blur with items: shows item list and Mode/Strength summary rows', () => {
    const items = [
      { type: 'dynamic', selector: '#a', name: 'a' },
      { type: 'dynamic', selector: '#b', name: 'b' },
    ];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
    const labels = [...document.querySelectorAll('#bl-mode-pick-blur .bl-summary-row__label')].map(e => e.textContent);
    expect(labels).not.toContain('htb_label_items');
    expect(labels).toContain('htb_label_mode');
    expect(labels).toContain('htb_label_strength');
    expect(document.querySelectorAll('#bl-mode-pick-blur .bl-item-row')).toHaveLength(2);
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count')).toBeFalsy();
  });

  test('pick-blur: shows 3 picker mode buttons [data-picker-mode]', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]')).toHaveLength(3);
  });

  test('pick-blur enabled: picker mode buttons are not disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    const btns = document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]');
    expect([...btns].every(b => !b.disabled)).toBe(true);
  });

  test('pick-blur disabled: picker mode buttons are still enabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    const btns = document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]');
    expect([...btns].every(b => !b.disabled)).toBe(true);
  });

  test('pick-blur disabled: no Modify button when off', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    expect(document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]')).toBeFalsy();
  });

  test('pick-blur enabled: Modify button is not disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]');
    expect(btn.disabled).toBe(false);
  });

  test('pick-blur: active picker mode chip has bl-chip--active class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { settings: { picker_mode: 'sticky-screen' } } }), [], false);
    const btns = document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]');
    const active = [...btns].filter(b => b.classList.contains('bl-chip--active'));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.pickerMode).toBe('sticky-screen');
  });

  test('pick-blur ON: shows open-picker button', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    expect(document.querySelector('#bl-mode-pick-blur [data-action="open-picker"]')).toBeTruthy();
  });

  test('pick-blur OFF: no open-picker button', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    expect(document.querySelector('#bl-mode-pick-blur [data-action="open-picker"]')).toBeFalsy();
  });

  test('pick-blur OFF empty: shows mode_pick_off_hint text', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count').textContent).toBe('mode_pick_off_hint');
  });

  test('pick-blur OFF with items: shows mode_pick_off_paused text', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), items, false);
    // getMessage returns key in test env, so count falls back to '1 items · paused'
    const text = document.querySelector('#bl-mode-pick-blur .bl-pick-count').textContent;
    expect(text).toContain('paused');
  });

  test('pick-blur: inline item list (.bl-item-row) shown in mode block when enabled with items', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), items, false);
    const rows = document.querySelectorAll('#bl-mode-pick-blur .bl-item-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.bl-item-selector').textContent).toBe('x');
    expect(rows[0].querySelector('[data-item-id]').dataset.itemId).toBe('#x');
  });

  test('pick-blur: block has bl-mode-block--off when pick_blur_enabled=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: false } }), [], false);
    expect(document.getElementById('bl-mode-pick-blur').classList.contains('bl-mode-block--off')).toBe(true);
  });

  test('pick-blur: block lacks bl-mode-block--off when pick_blur_enabled=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_and_blur: { status: true } }), [], false);
    expect(document.getElementById('bl-mode-pick-blur').classList.contains('bl-mode-block--off')).toBe(false);
  });

  // ── mode actions: Clear All + Modify ─────────────────────────────────────

  test('blur-all: has data-action="htb-modify" button with data-mode="blur-all"', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    const btn = document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]');
    expect(btn).toBeTruthy();
    expect(btn.dataset.mode).toBe('blur-all');
  });

  test('pick-blur: has data-action="htb-modify" button with data-mode="pick-blur"', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]');
    expect(btn).toBeTruthy();
    expect(btn.dataset.mode).toBe('pick-blur');
  });

  test('blur-all: no Clear All button', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    expect(document.querySelector('#bl-mode-blur-all [data-action="clear-all"]')).toBeFalsy();
  });

  test('pick-blur: Clear All disabled when no items', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  test('pick-blur: Clear All enabled when has items', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn.disabled).toBe(false);
  });

  test('pick-blur Clear All has data-mode="pick-blur"', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn.dataset.mode).toBe('pick-blur');
  });

  test('blur-all: no Modify button when off', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false);
    expect(document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]')).toBeFalsy();
  });

  test('blur-all: Modify button enabled when isPageBlurred', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true);
    const btn = document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]');
    expect(btn.disabled).toBe(false);
  });

  // ── renderAll ─────────────────────────────────────────────────────────────

  test('renderAll with no extra args does not throw', () => {
    expect(() => BlurrySitePopupRender.renderAll(makeSettings())).not.toThrow();
  });

  test('renderAll: both blocks render with correct mode classes', () => {
    BlurrySitePopupRender.renderAll(makeSettings(), [], false);
    expect(document.getElementById('bl-mode-blur-all').classList.contains('bl-mode-block--blur-all')).toBe(true);
    expect(document.getElementById('bl-mode-pick-blur').classList.contains('bl-mode-block--pick-blur')).toBe(true);
  });

  describe('blur item row hover highlight data attributes', () => {
    test('dynamic item row has data-highlight-type="dynamic"', () => {
      const items = [{ type: 'dynamic', name: 'My El', selectors: ['#foo', '.bar'] }];
      BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
      const row = document.querySelector('.bl-item-row[data-highlight-type]');
      expect(row).not.toBeNull();
      expect(row.dataset.highlightType).toBe('dynamic');
    });

    test('dynamic item row has data-highlight-selectors as JSON array', () => {
      const items = [{ type: 'dynamic', name: 'El', selectors: ['#foo', '.bar'] }];
      BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
      const row = document.querySelector('.bl-item-row[data-highlight-type="dynamic"]');
      expect(JSON.parse(row.dataset.highlightSelectors)).toEqual(['#foo', '.bar']);
    });

    test('dynamic item with legacy selector string still populates selectors array', () => {
      const items = [{ type: 'dynamic', name: 'El', selector: '#legacy' }];
      BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
      const row = document.querySelector('.bl-item-row[data-highlight-type="dynamic"]');
      expect(JSON.parse(row.dataset.highlightSelectors)).toEqual(['#legacy']);
    });

    test('sticky item row has data-highlight-type="sticky" and data-highlight-id', () => {
      const items = [{ type: 'sticky', id: 'zone-abc', name: 'Zone 1', x: 0, y: 0, width: 100, height: 50 }];
      BlurrySitePopupRender.renderModesSection(makeSettings(), items, false);
      const row = document.querySelector('.bl-item-row[data-highlight-type="sticky"]');
      expect(row).not.toBeNull();
      expect(row.dataset.highlightId).toBe('zone-abc');
    });
  });
});

// ── renderAll rule-managed branch ────────────────────────────────────────────

describe('renderAll rule-managed branch', () => {
  function setupFullDom() {
    document.body.innerHTML = `
      <section id="bl-modes" class="bl-section bl-modes">
        <div id="bl-notif-area"></div>
        <div id="bl-mode-blur-all" class="bl-mode-block"><span>old-content</span></div>
        <div id="bl-mode-pick-blur" class="bl-mode-block"><span>old-content</span></div>
      </section>
      <section id="bl-pii"><div id="bl-pii-chips"></div><div id="bl-pii-color-row"></div></section>
      <section id="bl-automate"><div id="bl-automate-summary"></div></section>
    `;
  }

  beforeEach(() => {
    setupFullDom();
    document.body.classList.remove('bl-rule-managed');
  });

  test('rule-managed: stamps body class, renders banner, clears mode blocks', () => {
    const ruleMatch = { hostname_value: '*.example.com', hostname_type: 'wildcard' };
    const settings = makeSettings();
    BlurrySitePopupRender.renderAll(
      settings, [], false,
      () => {},
      null, () => {},
      { ruleMatch, ruleOverrides: { blur_mode: true, blur_categories: true } },
    );
    expect(document.body.classList.contains('bl-rule-managed')).toBe(true);
    expect(document.querySelector('#bl-notif-area .bl-rule-banner')).not.toBeNull();
    expect(document.getElementById('bl-mode-blur-all').children.length).toBe(0);
    expect(document.getElementById('bl-mode-pick-blur').children.length).toBe(0);
  });

  test('non-rule-managed: removes body class, renders modes normally', () => {
    document.body.classList.add('bl-rule-managed'); // start dirty
    const settings = makeSettings();
    BlurrySitePopupRender.renderAll(
      settings, [], false,
      () => {},
      null, () => {},
      { ruleMatch: null, ruleOverrides: {} },
    );
    expect(document.body.classList.contains('bl-rule-managed')).toBe(false);
    expect(document.querySelector('#bl-notif-area .bl-rule-banner')).toBeNull();
  });

  test('rule-managed: banner CTA invokes onOpenManagingRule with focusRule', () => {
    const ruleMatch = { hostname_value: 'github.com', hostname_type: 'exact' };
    const onOpen = jest.fn();
    BlurrySitePopupRender.renderAll(
      makeSettings(), [], false,
      () => {},
      null, () => {},
      { ruleMatch, ruleOverrides: { blur_mode: true }, onOpenManagingRule: onOpen },
    );
    const cta = document.querySelector('.bl-rule-banner__cta');
    expect(cta).not.toBeNull();
    cta.click();
    expect(onOpen).toHaveBeenCalledWith({ focusRule: ruleMatch });
  });
});

// ── renderNotifArea per-trigger sub-cards ──────────────────────────────────────

describe('renderNotifArea per-trigger sub-cards', () => {
  function setupNotifDom() {
    document.body.innerHTML = `
      <section id="bl-modes" class="bl-section bl-modes">
        <div id="bl-notif-area"></div>
        <div id="bl-mode-blur-all" class="bl-mode-block"></div>
        <div id="bl-mode-pick-blur" class="bl-mode-block"></div>
      </section>
      <section id="bl-pii"><div id="bl-pii-chips"></div><div id="bl-pii-color-row"></div></section>
      <section id="bl-automate"><div id="bl-automate-summary"></div></section>
    `;
  }

  function render(overrides, ctx) {
    const settings = makeSettings(overrides);
    BlurrySitePopupRender.renderAll(
      settings, [], false,
      () => {},
      null, () => {},
      ctx || {},
    );
    return document.getElementById('bl-notif-area');
  }

  beforeEach(() => setupNotifDom());

  test('single trigger renders one sub-card', () => {
    const area = render({
      automate_blur_active: true,
      automate_blur_triggers: { screen_share: false, idle: true, tab_switch: false },
    }, {
      onSuppressIdle: jest.fn(),
      onUnsuppressIdle: jest.fn(),
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('.bl-notif-card__actions')).not.toBeNull();
  });

  test('multiple triggers render separate sub-cards', () => {
    const area = render({
      automate_blur_active: true,
      automate_blur_triggers: { screen_share: false, idle: true, tab_switch: true },
    }, {
      onSuppressIdle: jest.fn(),
      onUnsuppressIdle: jest.fn(),
      onSuppressTabSwitch: jest.fn(),
      onUnsuppressTabSwitch: jest.fn(),
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(2);
  });

  test('suppressed trigger shows undo row, no action buttons', () => {
    const area = render({
      automate_blur_active: false,
      automate_blur_triggers: { screen_share: false, idle: false, tab_switch: false },
      idle_suppressed_for_tab: true,
    }, {
      onUnsuppressIdle: jest.fn(),
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('.bl-notif-card__suppress')).not.toBeNull();
    expect(cards[0].querySelector('.bl-notif-card__actions')).toBeNull();
  });

  test('sharing-tab renders single card with warn button only', () => {
    const area = render({
      automate_blur_active: true,
      automate_blur_triggers: { screen_share: true, idle: false, tab_switch: false },
      screen_share_state: { active: true, is_sharing_tab: true, started_at: Date.now() - 5000 },
    }, {
      onSuppressScreenShare: jest.fn(),
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(1);
    const btns = cards[0].querySelectorAll('.bl-notif-btn');
    expect(btns.length).toBe(1);
  });

  test('skipped state renders info-only card with no actions', () => {
    const area = render({
      automate_blur_active: false,
      automate_blur_skipped: true,
      automate_blur_skip_reason: 'manual',
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('.bl-notif-card__info')).not.toBeNull();
    expect(cards[0].querySelector('.bl-notif-card__actions')).toBeNull();
  });

  test('site-rule pill renders before sub-cards', () => {
    const activeRule = { hostname_value: 'example.com', hostname_type: 'exact' };
    const settings = makeSettings({
      automate_blur_active: true,
      automate_blur_triggers: { screen_share: false, idle: true, tab_switch: false },
    });
    BlurrySitePopupRender.renderAll(
      settings, [], false,
      () => {},
      activeRule, () => {},
      { onSuppressIdle: jest.fn(), onUnsuppressIdle: jest.fn() },
    );
    const area = document.getElementById('bl-notif-area');
    const children = area.children;
    expect(children[0].classList.contains('bl-notif-pill')).toBe(true);
    expect(children[1].classList.contains('bl-notif-card')).toBe(true);
  });

  test('all three triggers render three sub-cards', () => {
    const area = render({
      automate_blur_active: true,
      automate_blur_triggers: { screen_share: true, idle: true, tab_switch: true },
      screen_share_state: { active: true, is_sharing_tab: false, started_at: Date.now() - 60000 },
    }, {
      onSuppressScreenShare: jest.fn(),
      onUnsuppressScreenShare: jest.fn(),
      onSuppressIdle: jest.fn(),
      onUnsuppressIdle: jest.fn(),
      onSuppressTabSwitch: jest.fn(),
      onUnsuppressTabSwitch: jest.fn(),
    });
    const cards = area.querySelectorAll('.bl-notif-card');
    expect(cards.length).toBe(3);
  });
});
