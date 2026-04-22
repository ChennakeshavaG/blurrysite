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

function makeSettings(overrides) {
  const base = {
    pick_blur_enabled: true,
    blur_mode: 'gaussian',
    pick_blur_type: 'gaussian',
    picker_mode: 'sticky-page',
    pii_mode: 'gaussian',
    blur_radius: 6,
    reveal_mode: 'hover',
    enabled: true,
    blur_categories: { text: true, media: true, form: false, table: true, structure: true },
    pii_email: false, pii_numeric: false,
    pick_blur_color: { hex: '#000000', opacity: 1.0 },
    automate_timer:      { value: 0, unit: 'min', enabled: false },
    automate_idle:       { value: 5, unit: 'min', enabled: false },
    automate_tab_switch: { enabled: false },
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
    BlurrySitePopupRender.renderHtbSection(makeSettings({ blur_mode: 'frosted' }), true);
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    const active = [...chips].find(c => c.classList.contains('bl-chip--active'));
    expect(active).toBeTruthy();
    expect(active.dataset.type).toBe('frosted');
  });

  test('pick-blur mode renders 3 type chips (no redacted/masked)', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings(), false);
    const chips = document.querySelectorAll('#bl-htb-chips .bl-chip');
    expect(chips).toHaveLength(3);
    const types = [...chips].map(c => c.dataset.type);
    expect(types).not.toContain('redacted');
    expect(types).not.toContain('masked');
    expect(types).toContain('color');
  });

  test('blur-all summary has Covers row listing enabled categories', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({
      blur_categories: { text: true, media: false, form: false, table: true, structure: false },
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
    BlurrySitePopupRender.renderHtbSection(makeSettings({ blur_radius: 6, blur_mode: 'gaussian' }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow).toBeTruthy();
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_moderate');
  });

  test('summary Strength row uses Subtle label for radius 3', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ blur_radius: 3, blur_mode: 'gaussian' }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_subtle');
  });

  test('summary Strength row uses Strong label for radius 10', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ blur_radius: 10, blur_mode: 'gaussian' }), true);
    const strengthRow = [...document.querySelectorAll('.bl-summary-row')].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'htb_label_strength'
    );
    expect(strengthRow.querySelector('.bl-summary-row__value').textContent).toContain('htb_strength_strong');
  });

  test('pick-blur mode has no Covers row in summary', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ pick_blur_type: 'gaussian' }), false);
    const labels = [...document.querySelectorAll('.bl-summary-row__label')].map(el => el.textContent);
    expect(labels).not.toContain('htb_label_covers');
  });

  test('color mode shows Color row and no Strength/Reveal rows', () => {
    BlurrySitePopupRender.renderHtbSection(makeSettings({ pick_blur_type: 'color' }), false);
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
      pii_email: true, pii_numeric: false,
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(true);
  });

  test('master toggle is unchecked when both are false', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({
      pii_email: false, pii_numeric: false,
    }));
    expect(document.getElementById('bl-pii-master').checked).toBe(false);
  });

  test('renders 4 PII mode chips', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings());
    expect(document.querySelectorAll('#bl-pii-chips .bl-chip')).toHaveLength(4);
  });

  test('active PII chip has bl-chip--active (amber, no sky class)', () => {
    BlurrySitePopupRender.renderPiiSection(makeSettings({ pii_mode: 'redacted' }));
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

  test('TIMER disabled shows Off value', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      automate_timer:      { value: 0, unit: 'min', enabled: false },
      automate_idle:       { value: 5, unit: 'min', enabled: false },
      automate_tab_switch: { enabled: false },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const timerRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_timer'
    );
    expect(timerRow.querySelector('.bl-summary-row__value').textContent).toBe('automate_off');
  });

  test('IDLE enabled with value=5 unit=min shows value and unit key', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      automate_timer:      { value: 0, unit: 'min', enabled: false },
      automate_idle:       { value: 5, unit: 'min', enabled: true },
      automate_tab_switch: { enabled: false },
    }));
    const rows = document.querySelectorAll('#bl-automate-summary .bl-summary-row');
    const idleRow = [...rows].find(
      r => r.querySelector('.bl-summary-row__label').textContent === 'automate_idle'
    );
    expect(idleRow.querySelector('.bl-summary-row__value').textContent).toBe('5 automate_unit_min');
  });

  test('TAB_SWITCH enabled shows On value', () => {
    BlurrySitePopupRender.renderAutomateSection(makeSettings({
      automate_timer:      { value: 0, unit: 'min', enabled: false },
      automate_idle:       { value: 5, unit: 'min', enabled: false },
      automate_tab_switch: { enabled: true },
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
  // ── accordion expansion ───────────────────────────────────────────────────

  test('expandedMode=blur-all: #bl-mode-blur-all has --expanded class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const el = document.getElementById('bl-mode-blur-all');
    expect(el.classList.contains('bl-mode-block--expanded')).toBe(true);
    expect(el.classList.contains('bl-mode-block--collapsed')).toBe(false);
  });

  test('expandedMode=blur-all: #bl-mode-pick-blur has --collapsed class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const el = document.getElementById('bl-mode-pick-blur');
    expect(el.classList.contains('bl-mode-block--collapsed')).toBe(true);
    expect(el.classList.contains('bl-mode-block--expanded')).toBe(false);
  });

  test('expandedMode=pick-blur: #bl-mode-pick-blur has --expanded class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const el = document.getElementById('bl-mode-pick-blur');
    expect(el.classList.contains('bl-mode-block--expanded')).toBe(true);
    expect(el.classList.contains('bl-mode-block--collapsed')).toBe(false);
  });

  test('expandedMode=pick-blur: #bl-mode-blur-all has --collapsed class', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const el = document.getElementById('bl-mode-blur-all');
    expect(el.classList.contains('bl-mode-block--collapsed')).toBe(true);
    expect(el.classList.contains('bl-mode-block--expanded')).toBe(false);
  });

  // ── dot color ─────────────────────────────────────────────────────────────

  test('blur-all expanded: dot has is-on when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true, 'blur-all');
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains('is-on')).toBe(true);
  });

  test('blur-all expanded: dot lacks is-on when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains('is-on')).toBe(false);
    expect(dot.classList.contains('is-off')).toBe(true);
  });

  test('blur-all collapsed: dot present with is-on when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true, 'pick-blur');
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains('is-on')).toBe(true);
  });

  test('blur-all collapsed: dot has is-off when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const dot = document.querySelector('#bl-mode-blur-all .bl-mode-block__dot');
    expect(dot.classList.contains('is-on')).toBe(false);
    expect(dot.classList.contains('is-off')).toBe(true);
  });

  test('pick-blur expanded: dot is-on when pick_blur_enabled=true (regardless of items)', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: true }), [], false, 'pick-blur');
    const dot = document.querySelector('#bl-mode-pick-blur .bl-mode-block__dot');
    expect(dot.classList.contains('is-on')).toBe(true);
  });

  test('pick-blur expanded: dot is-off when pick_blur_enabled=false', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: false }), items, false, 'pick-blur');
    const dot = document.querySelector('#bl-mode-pick-blur .bl-mode-block__dot');
    expect(dot.classList.contains('is-on')).toBe(false);
    expect(dot.classList.contains('is-off')).toBe(true);
  });

  // ── blur-all expanded: toggle + read-only table ───────────────────────────

  test('blur-all expanded: contains bl-blur-all-toggle checkbox', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const toggle = document.getElementById('bl-blur-all-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.type).toBe('checkbox');
  });

  test('bl-blur-all-toggle is checked when isPageBlurred=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true, 'blur-all');
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(true);
  });

  test('bl-blur-all-toggle is unchecked when isPageBlurred=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    expect(document.getElementById('bl-blur-all-toggle').checked).toBe(false);
  });

  test('blur-all expanded: header has title and toggle, no inline subtitle', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const header = document.querySelector('#bl-mode-blur-all .bl-mode-block__header');
    expect(header).toBeTruthy();
    expect(header.querySelector('.bl-mode-block__title')).toBeTruthy();
    expect(header.querySelector('.bl-toggle')).toBeTruthy();
    expect(header.querySelector('.bl-mode-block__subtitle')).toBeFalsy();
  });

  test('blur-all expanded: read-only table has Mode, Covers, Reveal opt-rows', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const labels = [...document.querySelectorAll('#bl-mode-blur-all .bl-opt-row__label')].map(e => e.textContent);
    expect(labels).toContain('htb_label_mode');
    expect(labels).toContain('htb_label_covers');
    expect(labels).toContain('htb_label_reveal');
  });

  test('blur-all expanded: no inline chips (read-only table only)', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    // No [data-type] buttons in blur-all expanded
    const typeChips = document.querySelectorAll('#bl-mode-blur-all [data-type]');
    expect(typeChips).toHaveLength(0);
  });

  // ── blur-all collapsed: compact summary ───────────────────────────────────

  test('blur-all collapsed: shows .bl-mode-compact summary', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const compact = document.querySelector('#bl-mode-blur-all .bl-mode-compact');
    expect(compact).toBeTruthy();
  });

  test('blur-all collapsed: no toggle present', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    expect(document.querySelector('#bl-mode-blur-all .bl-toggle')).toBeFalsy();
  });

  // ── pick-blur expanded: toggle + read-only info ───────────────────────────

  test('pick-blur expanded: contains bl-pick-blur-toggle checkbox', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const toggle = document.getElementById('bl-pick-blur-toggle');
    expect(toggle).toBeTruthy();
    expect(toggle.type).toBe('checkbox');
  });

  test('bl-pick-blur-toggle is checked when pick_blur_enabled=true', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: true }), [], false, 'pick-blur');
    expect(document.getElementById('bl-pick-blur-toggle').checked).toBe(true);
  });

  test('bl-pick-blur-toggle is unchecked when pick_blur_enabled=false', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: false }), [], false, 'pick-blur');
    expect(document.getElementById('bl-pick-blur-toggle').checked).toBe(false);
  });

  test('pick-blur expanded empty: shows mode_pick_blur_empty text', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count')).toBeTruthy();
    expect(document.querySelector('#bl-mode-pick-blur .bl-pick-count').textContent).toBe('mode_pick_blur_empty');
  });

  test('pick-blur expanded with items: shows item count in .bl-pick-count', () => {
    const items = [
      { type: 'dynamic', selector: '#a', name: 'a' },
      { type: 'dynamic', selector: '#b', name: 'b' },
    ];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false, 'pick-blur');
    const countEl = document.querySelector('#bl-mode-pick-blur .bl-pick-count');
    expect(countEl).toBeTruthy();
    // count > 0 means it called getMessage with count
    expect(countEl.textContent).not.toBe('mode_pick_blur_empty');
  });

  test('pick-blur expanded: shows 3 picker mode buttons [data-picker-mode]', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    expect(document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]')).toHaveLength(3);
  });

  test('pick-blur expanded enabled: picker mode buttons are not disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: true }), [], false, 'pick-blur');
    const btns = document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]');
    expect([...btns].every(b => !b.disabled)).toBe(true);
  });

  test('pick-blur expanded disabled: picker mode buttons are disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: false }), [], false, 'pick-blur');
    const btns = document.querySelectorAll('#bl-mode-pick-blur [data-picker-mode]');
    expect([...btns].every(b => b.disabled)).toBe(true);
  });

  test('pick-blur expanded disabled: Modify button is disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: false }), [], false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]');
    expect(btn.disabled).toBe(true);
  });

  test('pick-blur expanded enabled: Modify button is not disabled', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings({ pick_blur_enabled: true }), [], false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]');
    expect(btn.disabled).toBe(false);
  });

  test('pick-blur expanded: no inline item list (.bl-item-row) in mode block', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false, 'pick-blur');
    expect(document.querySelectorAll('#bl-mode-pick-blur .bl-item-row')).toHaveLength(0);
  });

  // ── pick-blur collapsed ───────────────────────────────────────────────────

  test('pick-blur collapsed: shows .bl-mode-compact with item count', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false, 'blur-all');
    const compact = document.querySelector('#bl-mode-pick-blur .bl-mode-compact');
    expect(compact).toBeTruthy();
    // Not empty text
    expect(compact.textContent).not.toBe('');
  });

  test('pick-blur collapsed with no items: shows mode_pick_blur_empty', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const compact = document.querySelector('#bl-mode-pick-blur .bl-mode-compact');
    expect(compact.textContent).toBe('mode_pick_blur_empty');
  });

  test('pick-blur collapsed: no toggle present', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    expect(document.querySelector('#bl-mode-pick-blur .bl-toggle')).toBeFalsy();
  });

  // ── mode actions: Clear All + Modify ─────────────────────────────────────

  test('blur-all expanded: has data-action="htb-modify" button with data-mode="blur-all"', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const btn = document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]');
    expect(btn).toBeTruthy();
    expect(btn.dataset.mode).toBe('blur-all');
  });

  test('pick-blur expanded: has data-action="htb-modify" button with data-mode="pick-blur"', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="htb-modify"]');
    expect(btn).toBeTruthy();
    expect(btn.dataset.mode).toBe('pick-blur');
  });

  test('blur-all expanded: no Clear All button', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true, 'blur-all');
    expect(document.querySelector('#bl-mode-blur-all [data-action="clear-all"]')).toBeFalsy();
  });

  test('pick-blur expanded: Clear All disabled when no items', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });

  test('pick-blur expanded: Clear All enabled when has items', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn.disabled).toBe(false);
  });

  test('pick-blur Clear All has data-mode="pick-blur"', () => {
    const items = [{ type: 'dynamic', selector: '#x', name: 'x' }];
    BlurrySitePopupRender.renderModesSection(makeSettings(), items, false, 'pick-blur');
    const btn = document.querySelector('#bl-mode-pick-blur [data-action="clear-all"]');
    expect(btn.dataset.mode).toBe('pick-blur');
  });

  test('blur-all expanded: Modify button disabled when !isPageBlurred', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], false, 'blur-all');
    const btn = document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]');
    expect(btn.disabled).toBe(true);
  });

  test('blur-all expanded: Modify button enabled when isPageBlurred', () => {
    BlurrySitePopupRender.renderModesSection(makeSettings(), [], true, 'blur-all');
    const btn = document.querySelector('#bl-mode-blur-all [data-action="htb-modify"]');
    expect(btn.disabled).toBe(false);
  });

  // ── renderAll ─────────────────────────────────────────────────────────────

  test('renderAll with no extra args does not throw', () => {
    expect(() => BlurrySitePopupRender.renderAll(makeSettings())).not.toThrow();
  });

  test('renderAll passes expandedMode to renderModesSection', () => {
    BlurrySitePopupRender.renderAll(makeSettings(), [], false, 'pick-blur');
    const el = document.getElementById('bl-mode-pick-blur');
    expect(el.classList.contains('bl-mode-block--expanded')).toBe(true);
  });
});
