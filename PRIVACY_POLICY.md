# Privacy Policy — PrivacyBlur

**Last updated:** April 7, 2026

## Summary

PrivacyBlur does not collect, transmit, or share any user data. All data is stored locally on your device.

## What data is stored

PrivacyBlur stores the following data in your browser's local storage (`chrome.storage.local`):

- **Blur settings** — Your preferences (blur radius, highlight color, keyboard shortcuts, reveal mode, blur categories).
- **Blurred element selectors** — CSS selectors or coordinates identifying which elements you chose to blur on each website.
- **URL rules** — Custom per-site rules you create to override global settings.
- **Blur-all state** — Whether "blur all" mode was active on each website.

This data never leaves your browser.

## What data is NOT collected

- No personal information
- No browsing history
- No page content or screenshots
- No analytics or telemetry
- No cookies or tracking identifiers

## Data transmission

PrivacyBlur makes **zero network requests**. No data is transmitted to any server, third party, or external service. The extension operates entirely offline.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Save your blur settings and blurred element selections locally |
| `activeTab` | Apply blur to the current tab's page content |
| `tabs` | Detect page navigation to restore blur state |
| `contextMenus` | Add "Blur this element" / "Unblur this element" to the right-click menu |
| `<all_urls>` | Allow blurring elements on any website you visit |

## Data deletion

All stored data can be deleted by:
- Clicking "Clear All Sites" in the extension popup
- Uninstalling the extension (Chrome automatically removes all extension storage)

## Changes to this policy

If this policy changes, the updated version will be published at the same URL.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/ChennakeshavaG/privacyblur/issues
