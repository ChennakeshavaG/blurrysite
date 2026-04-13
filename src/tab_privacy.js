/**
 * tab_privacy.js — Hide browser tab title and favicon for screen-sharing privacy.
 *
 * Exposed as blsi.TabPrivacy (IIFE — no ES module syntax).
 */

const BlurrySiteTabPrivacy = (() => {
  'use strict';

  // 1x1 transparent PNG as a data URI (67 bytes decoded)
  const BLANK_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==';
  const REPLACEMENT_TITLE = 'Tab';

  let _originalTitle = null;
  let _originalFavicons = null; // [{el, href}]
  let _active = false;

  function enable() {
    if (_active) return; // idempotent

    // Store originals
    _originalTitle = document.title;
    _originalFavicons = [];

    const icons = document.querySelectorAll('link[rel*="icon"]');
    for (const el of icons) {
      _originalFavicons.push({ el, href: el.href });
      el.href = BLANK_FAVICON;
    }

    // If no favicon links exist, create one so the browser uses our blank
    if (_originalFavicons.length === 0) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = BLANK_FAVICON;
      document.head.appendChild(link);
      _originalFavicons.push({ el: link, href: null }); // null = we created it
    }

    document.title = REPLACEMENT_TITLE;
    _active = true;
  }

  function disable() {
    if (!_active) return;

    // Restore title
    if (_originalTitle !== null) {
      document.title = _originalTitle;
    }

    // Restore favicons
    if (_originalFavicons) {
      for (const { el, href } of _originalFavicons) {
        if (href === null) {
          // We created this element — remove it
          el.remove();
        } else {
          el.href = href;
        }
      }
    }

    _originalTitle = null;
    _originalFavicons = null;
    _active = false;
  }

  function isActive() {
    return _active;
  }

  return { enable, disable, isActive };
})();

blsi.TabPrivacy = BlurrySiteTabPrivacy;
