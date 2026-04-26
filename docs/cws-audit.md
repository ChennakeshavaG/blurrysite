# CWS Approval Audit

Audit date: 2026-04-25. Three parallel agents scanned manifest, service worker, all source files,
popup renders, and CSS for MV3 compliance issues and Chrome Web Store policy flags.

**Result: no blockers. Three warnings to fix before first submission.**

---

## Summary

| Severity | Count | Action |
|---|---|---|
| BLOCKER | 0 | — |
| WARNING | 3 | Fix in code before submitting |
| INFO | 2 | Address in store listing only |

---

## What Was Audited — All Clean

| Check | Status | Notes |
|---|---|---|
| `manifest_version: 3` | ✅ | |
| `background.service_worker` stateless | ✅ | Only `_sharePorts` Map is in-memory — intentional, self-clearing on SW restart |
| No deprecated APIs | ✅ | No executeScript, webRequest, browser_action, page_action, getBackgroundPage |
| No `eval` / `new Function` / string `setTimeout` | ✅ | |
| No remote fetch / XHR / CDN | ✅ | All `fetch()` calls use `chrome.runtime.getURL()` (internal) or `data:` URLs |
| No inline scripts in popup.html | ✅ | All 13 scripts are external files |
| No external analytics or telemetry | ✅ | Zero third-party calls |
| All declared permissions used | ✅ | `storage`, `activeTab`, `tabs`, `contextMenus`, `<all_urls>` all have real callers |
| `web_accessible_resources` MV3 object format | ✅ | Not the deprecated string-array form |
| No `unsafe-eval` / `unsafe-inline` in CSP | ✅ | Uses MV3 default strict CSP — no explicit CSP declaration needed |
| `main_world_bridge.js` MAIN-world patching | ✅ | Standard MV3 approach; no data exfiltration |
| No deceptive UI / ad injection / crypto mining | ✅ | |
| `_locales` complete (`en` required) | ✅ | en, hi_IN, ta_IN all present |
| User data stays local | ✅ | Zero PII transmitted; storage is chrome.storage.local / .session only |

---

## Warnings — Fix Before First Submission

### W1 — `innerHTML` used to inject SVG icons

**Risk:** CWS automated scanner flags ALL `innerHTML` assignments regardless of content.
Hardcoded SVG still triggers elevation to manual review.

**Files:**
- `popup/popup_ui.js:22` — `btn.innerHTML = isDark ? _SVG_SUN : _SVG_MOON`
- `popup/renders/keyboard.js:117` — `iconEl.innerHTML = ACTION_ICONS[action.id] || ''`
- `popup/renders/keyboard.js:215` — same pattern

**Fix:** Write a small helper that parses the SVG string into an off-DOM container then
moves the child into the live element via `replaceChildren`:

```js
function setSvgIcon(el, svgStr) {
  const tmp = document.createElement('span');
  tmp.innerHTML = svgStr;
  el.replaceChildren(tmp.firstElementChild);
}
```

---

### W2 — `innerHTML = ''` used to clear containers

**Risk:** Same automated scanner trigger as W1. All instances are safe (no user data),
but scanners do not distinguish.

**Files (all safe, all need migration):**
- `popup/renders/main.js` — lines 96, 106, 155, 190, 200, 390, 480
- `popup/renders/keyboard.js` — lines 100, 198, 293, 351
- `popup/renders/automate.js` — line 218
- `popup/renders/howtoblur.js` — line 455
- `popup/renders/site_rules.js` — lines 474, 522

**Fix:** Replace all with `el.replaceChildren()` (Chrome 86+, Firefox 78+, safe for our targets).

---

### W3 — Embedded base64 font assets lack attribution

**Risk:** `src/fonts.js:22-26` embeds WOFF2 glyphs as base64 strings. Opaque binary blobs
without source documentation can trigger policy review for hidden/obfuscated code.

**Context:** These are noppa/text-security glyphs (OFL-1.1), built with fontTools.
Only the custom censoring glyphs are included.

**Fix:**
1. Add comment block at top of `src/fonts.js`:
   ```
   // Font glyphs from noppa/text-security (https://github.com/noppa/text-security)
   // License: OFL-1.1. Built with fontTools; only censor glyphs included.
   // Full license text: LICENSES/text-security.txt
   ```
2. Create `LICENSES/text-security.txt` with the OFL-1.1 full text.

---

## Info — Store Listing Only (No Code Changes)

### I1 — Screen capture patching must be disclosed

`src/main_world_bridge.js` patches `navigator.mediaDevices.getDisplayMedia` in the MAIN world.
This is technically compliant (standard MV3 approach, no stream interception, no data exfiltration),
but CWS reviewers must understand the intent.

**Include in the CWS store listing description:**

> "When automate blur is enabled, Blurry Site detects when you start a screen-sharing session
> and automatically blurs your screen. Detection is entirely local — no screen data, video frames,
> or identifiers ever leave your device."

### I2 — `<all_urls>` host permission justification

`<all_urls>` in `host_permissions` triggers a visible install-time warning to users. No code change
needed, but prepare the CWS listing justification:

> "Required to inject blur CSS on any website the user visits. Without broad host access,
> Blurry Site cannot apply blur to pages the user opens."

---

## Remediation Checklist

- [ ] `popup/popup_ui.js:22` — replace innerHTML with `setSvgIcon` helper (W1)
- [ ] `popup/renders/keyboard.js:117` — same (W1)
- [ ] `popup/renders/keyboard.js:215` — same (W1)
- [ ] All `innerHTML = ''` in 5 render files → `replaceChildren()` (W2)
- [ ] Comment block at top of `src/fonts.js` (W3)
- [ ] `LICENSES/text-security.txt` created with OFL-1.1 text (W3)
- [ ] CWS store listing draft — include I1 and I2 disclosures

---

## Verification After Fixes

```bash
npm run test:unit   # 732 tests must stay green
npm test            # coverage check (~91%)
```

Manual smoke test: load unpacked extension, open popup, verify theme toggle icon renders (W1),
verify section transitions render (W2), toggle screen-share automate on a test page (confirms W1/W2
didn't break event wiring).
