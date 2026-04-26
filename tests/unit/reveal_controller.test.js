/**
 * tests/unit/reveal_controller.test.js
 *
 * Unit tests for src/reveal_controller.js
 * Module exposes blsi.Reveal with: init, destroy, clearAll.
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: click mode (reveal, second-click pass-through, preventDefault, Escape, input skip,
 *         picker gate, mode=none), hover mode (reveal, 50ms debounce), clearAll,
 *         shadow DOM composedPath pierce (hover + click), shadow host chain walk, destroy.
 *
 * REDUNDANT:
 *   - "onRevealMouseOver reveals composedPath target" and "onRevealClick reveals composedPath target"
 *     duplicate the composedPath-override path for two event types; the core logic is identical —
 *     a single parameterised test over event type would cover both.
 *
 * OPTIMIZE:
 *   - fireClick() and fireMouseOver() are near-identical factory functions; unify as
 *     fireEvent(type, target, extra?) to reduce duplication.
 *   - The two composedPath tests could be collapsed into test.each(['mouseover','click']).
 *
 * MISSING:
 *   - No test for revealAncestorChain() — ancestors up to documentElement should receive
 *     data-bl-si-reveal so parent containers are unblurred when a child is targeted.
 *   - No test for zone overlay reveal — a .bl-si-zone-overlay with data-bl-si-blur should
 *     respond to click/hover in the same way as a regular element.
 *   - No test for clearAll() when nothing is currently revealed (should be a silent no-op).
 *   - No test for nested shadow roots (two levels deep); existing shadow tests use 1 level only.
 *   - No test verifying that reveal is NOT applied when the element has no blur attribute
 *     (non-blurred element clicked in click mode).
 * ===*/

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_PATH   = path.resolve(__dirname, '../../src/reveal_controller.js');
const ENGINE_PATH   = path.resolve(__dirname, '../../src/blur_engine.js');
const SELECTOR_PATH = path.resolve(__dirname, '../../src/selector_utils.js');

function loadDeps() {
  if (!blsi.SelectorUtils && fs.existsSync(SELECTOR_PATH)) require(SELECTOR_PATH);
  if (!blsi.BlurEngine   && fs.existsSync(ENGINE_PATH))   require(ENGINE_PATH);
  if (!blsi.Reveal) {
    if (fs.existsSync(MODULE_PATH)) {
      require(MODULE_PATH);
    } else {
      (0, eval)(buildStubSource());
    }
  }
}

function buildStubSource() {
  return `
  (function() {
    'use strict';
    blsi.Reveal = {
      init: function() {},
      destroy: function() {},
      clearAll: function() {},
    };
  })();
  `;
}

beforeAll(() => { loadDeps(); });

let mode = 'click';
let pickerActive = false;

function resetState() {
  mode = 'click';
  pickerActive = false;
  document.body.innerHTML = '';
  document.head.querySelectorAll('#bl-si-blur-styles').forEach(e => e.remove());
  document.querySelectorAll('[data-bl-si-blur]').forEach(el => delete el.dataset.blSiBlur);
  blsi.BlurEngine.unblurAll();
  try { blsi.Reveal.destroy(); } catch (_) {}
  blsi.Reveal.init({
    getMode: () => mode,
    isPickerActive: () => pickerActive,
  });
}

beforeEach(resetState);
afterEach(() => { try { blsi.Reveal.destroy(); } catch (_) {} });

function fireClick(target) {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ev, 'target', { value: target, writable: false });
  document.dispatchEvent(ev);
  return ev;
}

function fireMouseOver(target) {
  const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ev, 'target', { value: target, writable: false });
  ev[Symbol.for('blsi_event_trusted')] = true;
  document.dispatchEvent(ev);
}

// USER IMPACT: user clicks blurred element — unblurs for inspection, second click navigates link
describe('blsi.Reveal — click mode', () => {
  test('click on blurred element reveals it', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('second click on same element keeps reveal (link pass-through)', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('first click on blurred element calls preventDefault', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    const ev = fireClick(el);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('second click on revealed element does not preventDefault (link works)', () => {
    mode = 'click';
    const link = document.createElement('a');
    link.href = 'https://example.com';
    document.body.appendChild(link);
    blsi.BlurEngine.applyBlur(link);
    fireClick(link);
    const ev = fireClick(link);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('Escape dismisses click reveal', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(ev);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });

  test('first click on blurred input reveals it; second click passes through', () => {
    mode = 'click';
    const input = document.createElement('input');
    document.body.appendChild(input);
    blsi.BlurEngine.applyBlur(input);
    // First click — intercept and reveal
    fireClick(input);
    expect(input.dataset.blSiReveal).toBe('1');
    // Second click — inside revealed area, passes through without re-intercepting
    const e2 = new MouseEvent('click', { bubbles: true, cancelable: true });
    input.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });

  test('picker active blocks click reveal', () => {
    mode = 'click';
    pickerActive = true;
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });

  test('mode=none disables click reveal', () => {
    mode = 'none';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
  // MISSING: no test verifying click on an unblurred element does nothing (no data-bl-si-reveal added)
});

// USER IMPACT: user hovers blurred element — temporary reveal with 50ms debounce prevents flicker
describe('blsi.Reveal — hover mode', () => {
  test('mouseover on blurred element reveals it', () => {
    mode = 'hover';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireMouseOver(el);
    expect(el.dataset.blSiReveal).toBe('1');
  });

  test('mouseout debounces dismiss by 50ms', () => {
    jest.useFakeTimers();
    mode = 'hover';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireMouseOver(el);
    const out = new MouseEvent('mouseout', { bubbles: true });
    Object.defineProperty(out, 'target', { value: el });
    out[Symbol.for('blsi_event_trusted')] = true;
    document.dispatchEvent(out);
    // Still revealed right after mouseout
    expect(el.dataset.blSiReveal).toBe('1');
    jest.advanceTimersByTime(60);
    expect(el.dataset.blSiReveal).toBeUndefined();
    jest.useRealTimers();
  });
  // MISSING: no test for hover mode with mode=none (should not reveal on mouseover)
  // MISSING: no test for picker-active blocking hover reveal
});

// USER IMPACT: Escape key or picker activation — all active reveals cleared at once
describe('blsi.Reveal.clearAll', () => {
  test('clears any active reveal', () => {
    mode = 'click';
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBe('1');
    blsi.Reveal.clearAll();
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
  // MISSING: no test for clearAll() when nothing is currently revealed (should be a no-op)
});

// USER IMPACT: web component content — reveal finds actual element not shadow host
// OPTIMIZE: two tests here are mirror copies for mouseover vs click; collapse with test.each(['hover','click'])
describe('blsi.Reveal — composedPath (shadow DOM pierce)', () => {
  test('onRevealMouseOver reveals composedPath target, not retargeted e.target', () => {
    // Simulates shadow DOM event retargeting: e.target = shadow host, but
    // composedPath()[0] = the actual blurred element inside the shadow root.
    mode = 'hover';
    const innerEl = document.createElement('span');
    innerEl.textContent = 'shadow content';
    document.body.appendChild(innerEl);
    blsi.BlurEngine.applyBlur(innerEl);

    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    // hostEl is NOT blurred — simulates unblurred shadow host

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: hostEl, writable: false });
    ev[Symbol.for('blsi_event_trusted')] = true;
    // Override composedPath to return the actual inner element first
    ev.composedPath = () => [innerEl, hostEl, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(innerEl.dataset.blSiReveal).toBe('1');
    expect(hostEl.dataset.blSiReveal).toBeUndefined();
  });

  // REDUNDANT: same composedPath override logic as "onRevealMouseOver" test above — only event type differs
  test('onRevealClick reveals composedPath target, not retargeted e.target', () => {
    mode = 'click';
    const innerEl = document.createElement('span');
    innerEl.textContent = 'shadow content';
    document.body.appendChild(innerEl);
    blsi.BlurEngine.applyBlur(innerEl);

    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: hostEl, writable: false });
    ev.composedPath = () => [innerEl, hostEl, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(innerEl.dataset.blSiReveal).toBe('1');
    expect(hostEl.dataset.blSiReveal).toBeUndefined();
  });
});

// USER IMPACT: Reddit/Polymer custom elements — hovering shadow DOM child reveals blurred host or light DOM ancestor
describe('blsi.Reveal — shadow host reveal (parentElement boundary)', () => {
  test('hover over element inside shadow root reveals blurred shadow host', () => {
    // <rpl-badge data-bl-si-blur="1"> → #shadow-root → <span>NEW</span>
    // parentElement of <span> is null (ShadowRoot is not an Element).
    // findBlurredTarget must walk the host chain via getRootNode().host.
    mode = 'hover';
    const host = document.createElement('rpl-badge');
    document.body.appendChild(host);
    blsi.BlurEngine.applyBlur(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'NEW';
    shadow.appendChild(inner);

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: host, writable: false });
    ev[Symbol.for('blsi_event_trusted')] = true;
    ev.composedPath = () => [inner, shadow, host, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(host.dataset.blSiReveal).toBe('1');
  });

  test('hover over shadow DOM child finds blurred light DOM ancestor of host', () => {
    // <div data-bl-si-blur="1"> → <custom-el> → #shadow-root → <span>
    // parentElement chain: span→null; then host chain: host not blurred;
    // light DOM walk from host's parentElement: finds the blurred <div>.
    mode = 'hover';
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    blsi.BlurEngine.applyBlur(wrapper);

    const host = document.createElement('custom-el');
    wrapper.appendChild(host);
    // host is NOT blurred — blur is on the outer wrapper

    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'content';
    shadow.appendChild(inner);

    const ev = new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'target', { value: host, writable: false });
    ev[Symbol.for('blsi_event_trusted')] = true;
    ev.composedPath = () => [inner, shadow, host, wrapper, document.body, document.documentElement, document, window];
    document.dispatchEvent(ev);

    expect(wrapper.dataset.blSiReveal).toBe('1');
    expect(host.dataset.blSiReveal).toBeUndefined();
  });
  // MISSING: no test for nested shadow roots (two levels deep) — inner element inside shadow-of-shadow
});

// USER IMPACT: picker activation / page navigation — event listeners torn down so reveal stops working
describe('blsi.Reveal.destroy', () => {
  test('after destroy, clicks no longer reveal', () => {
    mode = 'click';
    blsi.Reveal.destroy();
    const el = document.createElement('div');
    document.body.appendChild(el);
    blsi.BlurEngine.applyBlur(el);
    fireClick(el);
    expect(el.dataset.blSiReveal).toBeUndefined();
  });
  // MISSING: no test for destroy when hover mode is active — pending debounce timer should be cancelled
});
