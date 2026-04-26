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
  let _nativeTitleDescriptor = null;
  let _pendingTitle = null;

  function enable() {
    if (_active) return; // idempotent

    // Store originals
    _originalTitle = document.title;
    _pendingTitle = _originalTitle;
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

    // Intercept page-side writes to document.title so SPAs (Gmail unread counter,
    // Slack, Twitter) cannot overwrite our placeholder during obscured mode.
    _nativeTitleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    if (_nativeTitleDescriptor && _nativeTitleDescriptor.set) {
      Object.defineProperty(document, 'title', {
        configurable: true,
        enumerable: true,
        get() { return REPLACEMENT_TITLE; },
        set(v) { _pendingTitle = v == null ? '' : String(v); },
      });
      _nativeTitleDescriptor.set.call(document, REPLACEMENT_TITLE);
    } else {
      // Fallback for environments without a native descriptor (defensive).
      document.title = REPLACEMENT_TITLE;
    }

    _active = true;
  }

  function disable() {
    if (!_active) return;

    // Restore native title accessor first, then write the latest title the page
    // attempted while obscured (or the pre-enable title if the page never wrote).
    if (_nativeTitleDescriptor) {
      Object.defineProperty(document, 'title', _nativeTitleDescriptor);
    }
    const restoreTo = _pendingTitle != null ? _pendingTitle : _originalTitle;
    if (restoreTo !== null) {
      document.title = restoreTo;
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
    _nativeTitleDescriptor = null;
    _pendingTitle = null;
    _active = false;
  }

  function isActive() {
    return _active;
  }

  return { enable, disable, isActive };
})();

blsi.TabPrivacy = BlurrySiteTabPrivacy;
