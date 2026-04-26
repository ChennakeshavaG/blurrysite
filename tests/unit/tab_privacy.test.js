/**
 * tests/unit/tab_privacy.test.js
 *
 * Unit tests for src/tab_privacy.js
 * Module exposes blsi.TabPrivacy with:
 *   enable, disable, isActive
 */

/* === TEST QUALITY ANNOTATIONS ===
 * COVERS: enable() replaces title and all favicon hrefs with generic placeholders;
 *         disable() restores original title and favicon hrefs; isActive() state reflection;
 *         double-enable idempotency (original not overwritten by placeholder);
 *         enable() when no favicon exists (creates blank then removes on disable());
 *         disable() no-op when not active; multiple favicon link element variants.
 *
 * REDUNDANT TESTS:
 *   - "disable() restores original title" and "disable() restores original favicon href"
 *     both call enable() then disable() and assert restoration; they could be merged into
 *     a single "disable() restores all tab identifiers" test with both assertions.
 *
 * OPTIMIZATION OPPORTUNITIES:
 *   - Favicon assertion pattern (icon.href matches /^data:image\/png;base64,/) is repeated
 *     across at least 5 tests; extract expectBlankFavicon(icon) and expectOriginalFavicon(icon,
 *     url) helpers to reduce repetition and make assertion intent clearer.
 *
 * MISSING COVERAGE:
 *   - No test for title change between enable() and disable(): if the page updates document.title
 *     while privacy is active, disable() should restore the pre-enable title, not the changed one.
 *   - No test for enable()/disable()/enable() cycle to verify state machine consistency across
 *     multiple activations.
 *   - No test for a favicon whose href attribute is missing or empty — module should not crash
 *     when restoring a corrupt/absent href.
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/tab_privacy.js');

function freshLoad() {
  delete blsi.TabPrivacy;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

// USER IMPACT: user enables tab privacy before screen sharing — tab title and favicon replaced so meeting participants cannot read sensitive page identity
describe('tab_privacy.js', () => {
  beforeEach(() => {
    // jsdom reads document.title from the <title> element, so set it via DOM
    document.head.innerHTML = '<title>My Banking App</title><link rel="icon" href="https://example.com/favicon.ico">';
    freshLoad();
  });

  afterEach(() => {
    try { blsi.TabPrivacy.disable(); } catch (_) {}
    document.head.innerHTML = '';
  });

  // USER IMPACT: user enables tab privacy before screen share — tab title and favicon replaced with generic versions
  test('enable() replaces document.title with generic placeholder', () => {
    blsi.TabPrivacy.enable();
    expect(document.title).toBe('Tab');
  });

  test('enable() replaces favicon href with blank data URI', () => {
    blsi.TabPrivacy.enable();
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon.href).toMatch(/^data:image\/png;base64,/);
  });

  // USER IMPACT: share session ends — original tab title and favicon restored so user sees their real page again
  // REDUNDANT: "disable() restores original title" and "disable() restores original favicon href" both call enable()+disable() and check restoration; could be one test with both assertions
  test('disable() restores original title', () => {
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    expect(document.title).toBe('My Banking App');
  });

  // REDUNDANT: same enable()+disable() sequence as "disable() restores original title"; only the asserted property differs
  // OPTIMIZE: favicon href assertion (/^data:image\/png;base64,/) is repeated here and in multiple tests; extract expectBlankFavicon(icon) helper
  test('disable() restores original favicon href', () => {
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon.href).toBe('https://example.com/favicon.ico');
  });

  // USER IMPACT: popup queries privacy status — can show accurate toggle state in the UI
  test('isActive() reflects current state', () => {
    expect(blsi.TabPrivacy.isActive()).toBe(false);
    blsi.TabPrivacy.enable();
    expect(blsi.TabPrivacy.isActive()).toBe(true);
    blsi.TabPrivacy.disable();
    expect(blsi.TabPrivacy.isActive()).toBe(false);
  });

  // USER IMPACT: user double-clicks enable — second call is safe, original title not lost
  test('double enable is idempotent — does not nest originals', () => {
    blsi.TabPrivacy.enable();
    // Title is now 'Tab'. If we enable again, it should NOT store 'Tab' as the original.
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    expect(document.title).toBe('My Banking App');
  });

  test('enable() works when no favicon link elements exist', () => {
    document.head.innerHTML = ''; // no favicons
    freshLoad();
    blsi.TabPrivacy.enable();
    expect(document.title).toBe('Tab');
    // Should have created a blank favicon
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon).not.toBeNull();
    expect(icon.href).toMatch(/^data:image\/png;base64,/);
  });

  test('disable() removes created favicon when none existed originally', () => {
    document.head.innerHTML = '';
    freshLoad();
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon).toBeNull();
  });

  test('disable() is a no-op when not active', () => {
    const originalTitle = document.title;
    blsi.TabPrivacy.disable(); // should not throw
    expect(document.title).toBe(originalTitle);
  });

  // USER IMPACT: site has apple-touch-icon and shortcut icon — all favicon variants replaced and restored, not just the first one found
  // OPTIMIZE: favicon href assertion pattern repeated again here; same expectBlankFavicon() helper would clean this up
  test('handles multiple favicon link elements', () => {
    document.head.innerHTML = `
      <link rel="icon" href="https://example.com/icon16.png">
      <link rel="shortcut icon" href="https://example.com/icon32.png">
      <link rel="apple-touch-icon" href="https://example.com/apple.png">
    `;
    freshLoad();
    blsi.TabPrivacy.enable();

    const icons = document.querySelectorAll('link[rel*="icon"]');
    for (const icon of icons) {
      expect(icon.href).toMatch(/^data:image\/png;base64,/);
    }

    blsi.TabPrivacy.disable();
    const restoredIcons = document.querySelectorAll('link[rel*="icon"]');
    const hrefs = [...restoredIcons].map(el => el.href);
    expect(hrefs).toContain('https://example.com/icon16.png');
    expect(hrefs).toContain('https://example.com/icon32.png');
    expect(hrefs).toContain('https://example.com/apple.png');
  });

  // USER IMPACT: SPA (Gmail unread counter, Slack, Twitter) tries to rewrite document.title while user is screen-sharing — extension's placeholder must hold; on disable, the latest page-attempted title is restored so the user does not see a stale title
  test('page-side writes to document.title cannot leak through while active', () => {
    blsi.TabPrivacy.enable();
    document.title = '(3) Inbox — Sensitive Project';
    expect(document.title).toBe('Tab');
    document.title = '(5) Inbox — Sensitive Project';
    expect(document.title).toBe('Tab');
    blsi.TabPrivacy.disable();
    expect(document.title).toBe('(5) Inbox — Sensitive Project');
  });

  // MISSING: no test for enable()/disable()/enable() cycle — state machine consistency across multiple activations is unverified
  // MISSING: no test for favicon with missing or empty href attribute — module should not crash when restoring a corrupt link element
});
