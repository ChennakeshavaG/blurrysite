/**
 * tests/unit/tab_privacy.test.js
 *
 * Unit tests for src/tab_privacy.js
 * Module exposes blsi.TabPrivacy with:
 *   enable, disable, isActive
 */

'use strict';

const path = require('path');
const MODULE_PATH = path.resolve(__dirname, '../../src/tab_privacy.js');

function freshLoad() {
  delete blsi.TabPrivacy;
  jest.resetModules();
  jest.isolateModules(() => { require(MODULE_PATH); });
}

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

  test('enable() replaces document.title with generic placeholder', () => {
    blsi.TabPrivacy.enable();
    expect(document.title).toBe('Tab');
  });

  test('enable() replaces favicon href with blank data URI', () => {
    blsi.TabPrivacy.enable();
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon.href).toMatch(/^data:image\/png;base64,/);
  });

  test('disable() restores original title', () => {
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    expect(document.title).toBe('My Banking App');
  });

  test('disable() restores original favicon href', () => {
    blsi.TabPrivacy.enable();
    blsi.TabPrivacy.disable();
    const icon = document.querySelector('link[rel*="icon"]');
    expect(icon.href).toBe('https://example.com/favicon.ico');
  });

  test('isActive() reflects current state', () => {
    expect(blsi.TabPrivacy.isActive()).toBe(false);
    blsi.TabPrivacy.enable();
    expect(blsi.TabPrivacy.isActive()).toBe(true);
    blsi.TabPrivacy.disable();
    expect(blsi.TabPrivacy.isActive()).toBe(false);
  });

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
});
