# Popup Revamp — Part 2: Gaps, Bugs & Priorities

## Priority 1: Critical Gaps (Blocks core functionality)

### 1.1 BLUR_MODE has no UI

The extension supports `gaussian` and `frosted` blur modes but the popup
has no way to switch between them. Frosted glass mode (AI-resistant,
SVG displacement + blur) is completely hidden from users.

**Needed**: Select or radio in Settings card: "Blur style: Gaussian / Frosted glass"
**Consider future**: Pixelation mode, noise injection mode (from AI_BYPASS.md)

### 1.2 PERFORMANCE settings have no UI

Three performance settings exist with no user-facing controls:

| Setting | Default | What it does | UI needed |
|---|---|---|---|
| `OFFSCREEN_UNBLUR` | true | IntersectionObserver removes blur from off-screen elements | Toggle: "Optimize for long pages" |
| `MAX_BLURRED` | 500 | Caps simultaneously blurred elements | Number input: "Max blur limit (0=unlimited)" |
| `CHUNK_SIZE` | 50 | MutationObserver batch size | Expert only — maybe hide in "Advanced" |

### 1.3 Popup has no storage.onChanged listener

If settings change from another source (cross-tab, storage.onChanged from
background), the popup shows stale data. The next user interaction overwrites
the external change.

**Fix**: Add `chrome.storage.onChanged` listener in popup.js that re-fetches
and re-renders all UI elements when settings change.

### 1.4 Color picker doesn't notify tab

`highlightColor` changes are debounced and saved to storage but the
`saveSettings()` call uses `notifyTab = true` (default). However, the
research found this might not be working — verify and fix.

## Priority 2: UX Improvements

### 2.1 Security level indicator

Users have no idea whether their current blur settings defeat OCR, AI
deblurring, or casual observation. Based on CSS_BLUR_RESEARCH.md and
AI_BYPASS.md:

| Radius | Visual label | What it defeats |
|---|---|---|
| 2-5px | Weak | Casual glance only |
| 6-9px | Moderate | Shoulder surfing |
| 10-14px | Strong | OCR (Tesseract), casual screenshots |
| 15-20px | Very strong | SOTA AI deblurring (Gaussian) |
| Frosted mode | AI-resistant | Non-invertible displacement defeats all known models |

**Show**: A small badge/label next to the blur radius slider showing the
current security level.

### 2.2 Blur radius range extension

Current slider max is 20px. Research recommends up to 30px for maximum
security. HTML `max` attribute should be updated to 30.

### 2.3 Element count in status

The blur count badge (`#blurCount`) shows "0" on first load. It should
query the content script via `GET_STATUS` to show the actual count of
blurred elements. Currently it only updates after blur-all toggle.

### 2.4 Category help text

| Category | What users need to know |
|---|---|
| Text | Blurs all readable text — headings, paragraphs, links, inline formatting |
| Media | Blurs images and video. DRM video shows dark overlay instead of blur. |
| Form | **Caution**: Fields remain interactive. Users can still type into blurred inputs. OFF by default. |
| Table | Cell-level blur preserves table structure. Sticky headers may break. |
| Structure | Blurs containers with text. "Thorough" mode blurs all containers regardless. |

### 2.5 URL rule improvements

Current rule editor only allows overriding:
- Form blur toggle
- Thorough blur toggle
- Blur radius

Should also allow overriding:
- All 5 category toggles
- Blur mode (gaussian/frosted per-site)
- Reveal mode per-site

## Priority 3: Code Quality & Polish

### 3.1 Dead CSS cleanup

| Class | Status |
|---|---|
| `.shortcut-browser-hint` | Defined but never rendered |
| `.modal__step-num` | Defined but never rendered |
| `.modal__step--dim` | Defined but never rendered |
| `.modal__step--active` | Defined but never rendered |

### 3.2 Inconsistent patterns

- Blur list empty state uses `classList.toggle('is-visible')`
- Rules list empty state uses `style.display = '' | 'none'`
- Should use same pattern everywhere

### 3.3 Rule modal cleanup

`radSlider.oninput` handler assigned inside `openRuleModal` is not properly
cleaned up between modal opens. Should use `addEventListener`/`removeEventListener`.

### 3.4 Tab messaging timing

Blur list re-fetch uses `setTimeout(200ms)` after blur-all toggle — brittle.
Should use the `sendResponse` callback to know when blur-all is complete,
then re-fetch.

## Summary: What needs to happen

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | Add BLUR_MODE select to Settings | Small | High — unlocks frosted glass for users |
| 2 | Add PERFORMANCE toggles to Settings (or Advanced section) | Small | Medium — lets users tune performance |
| 3 | Add storage.onChanged listener to popup | Small | High — fixes stale state bug |
| 4 | Add security level badge next to radius slider | Small | High — helps users choose appropriate settings |
| 5 | Extend blur radius max to 30 | Trivial | Medium — enables stronger blur |
| 6 | Add element count via GET_STATUS | Small | Medium — user awareness |
| 7 | Add category help tooltips | Small | Medium — user education |
| 8 | Expand rule editor overrides | Medium | High — per-site categories, mode, reveal |
| 9 | Clean dead CSS | Trivial | Low — hygiene |
| 10 | Fix inconsistent patterns | Small | Low — code quality |
