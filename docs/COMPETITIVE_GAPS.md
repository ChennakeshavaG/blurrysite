# Competitive Feature Gaps — Priority Ranked

> Features competitors ship that BlurrySite does not.
> Ordered by differentiation impact for end-user use cases.
> Research date: 2026-04-12

---

## Priority 1 — High Impact, Broad Use Cases

### 1. Smart Auto-Detect & Blur Sensitive Data

**What it is:** Automatically scan the page and blur emails, phone numbers, SSNs, credit card numbers, financial figures (prices, salaries, revenue), and ID strings — without the user clicking each one.

**Who has it:**
| Extension | Detection Scope |
|---|---|
| Blur It ($49) | Emails, money/prices, phone numbers, ID strings |
| DataBlur (free) | Emails, IDs, phone numbers, cards, passwords |
| Blurrr (free) | "Smart blur" — auto-detects personal info (unspecified) |
| DataMask (freemium) | Scrambles all text + images automatically |
| Privacy Blur (freemium) | "Smart Financial Mode" — pattern-based financial masking |

**Why it matters:**
- **Screen-sharing is the #1 use case** across all competitors. Users don't know what's sensitive until it's already on screen. Manual click-to-blur doesn't scale when a dashboard has 40 data points.
- Demos, sales calls, support recordings, HR workflows — all have scattered PII. Auto-detect catches what humans miss.
- This is the feature most frequently mentioned in competitor marketing and AppSumo reviews.

**Differentiation potential:** Very high. Combining auto-detect WITH BlurrySite's existing category system and per-site rules would be best-in-class. No competitor has auto-detect + URL rules + categories together.

**Implementation complexity:** Medium-high. Requires regex patterns for common PII formats, a page scanner, and UI toggles per detection type.

---

### 2. Selected Text Blur

**What it is:** Highlight/select text on a page, then blur just that selection — without blurring the entire parent element.

**Who has it:**
| Extension | How it works |
|---|---|
| BlurWeb ($17) | Select text, click blur — blurs only the selection |
| DataBlur (free) | Select text, one-click blur on selection |
| BlurPage (AppSumo) | Select words/lines within a paragraph, blur individually |
| BlurAny (unknown) | Text selection blur supported |

**Why it matters:**
- A paragraph may contain one sensitive name or dollar amount. Element-level blur hides the entire paragraph — overkill.
- Precision blur builds user trust: "I can blur exactly what I need, nothing more."
- Content creators and bloggers specifically need word-level control for tutorials and documentation.

**Differentiation potential:** High. This fills a precision gap. Combined with BlurrySite's hover-to-peek, users could peek at a partially-blurred paragraph — nobody else can do that.

**Implementation complexity:** Medium. Requires wrapping selected text ranges in inline spans with blur applied. Edge cases: cross-element selections, contenteditable fields, SVG text.

---

### 3. Text Masking / Redaction (Non-Blur Alternatives)

**What it is:** Replace sensitive content with asterisks (`****`), solid color blocks, or placeholder text instead of (or in addition to) Gaussian blur.

**Who has it:**
| Extension | Modes offered |
|---|---|
| BlurPage | Asterisk replacement, colored redaction blocks |
| DataMask | Irreversible "Blur+" and text scrambling |
| Privacy Blur | Word masking with custom word lists |
| Blur It | Solid block option alongside blur |

**Why it matters:**
- Blur can sometimes be reversed (AI deblurring, low-radius guessing). Solid redaction is irreversible.
- Screenshots and exports look more professional with clean redaction bars vs. fuzzy blur.
- Compliance use cases (GDPR, HIPAA) may require provably irreversible masking, not just visual obscuring.
- BlurrySite's "frosted/AI-proof" mode partially addresses this, but solid redaction is a stronger guarantee.

**Differentiation potential:** High. Positions BlurrySite as privacy-serious, not just privacy-convenient. Pairs naturally with the existing frosted mode as a third tier: blur → frosted → redacted.

**Implementation complexity:** Low-medium. For solid blocks: overlay a colored div. For asterisks: replace `textContent` with masked version (need to store original for undo).

---

## Priority 2 — Medium Impact, Specific Use Cases

### 4. Hide Tab Title & Favicon

**What it is:** Replace the browser tab's title and icon with generic/blank content so observers can't see what site you're on.

**Who has it:**
| Extension | Details |
|---|---|
| BlurWeb ($17) | Hides tab titles and icons |
| DataBlur (free) | Tab/title masking included |
| BlurAny (unknown) | "Conceal tab titles & icons" |

**Why it matters:**
- During screen shares and presentations, the tab bar is visible. Even if page content is blurred, a tab reading "Chase Bank — Account Summary" leaks context.
- Simple to implement, high perceived value, frequently requested in reviews.

**Differentiation potential:** Medium-high. Low effort, noticeable polish. Complements BlurrySite's screen-anchored zones for a complete screen-sharing story.

**Implementation complexity:** Low. `document.title = 'Untitled'` + replace favicon link. Store originals for restore. Can tie into the master on/off toggle.

---

### 5. Screenshot Capture with Masking

**What it is:** Take a screenshot of the current viewport or a selected area with all blur/redaction applied, directly from the extension — no need for a separate screenshot tool.

**Who has it:**
| Extension | Details |
|---|---|
| DataMask (freemium) | Viewport + element screenshots with masking baked in |

**Why it matters:**
- The workflow "blur → screenshot → share" is extremely common for documentation, bug reports, Slack messages, support tickets.
- OS screenshots capture the blurred state, but element-level screenshots (just a component, not the whole page) require external tools.
- DataMask is the only competitor with this, so it's a differentiator if adopted.

**Differentiation potential:** Medium. Streamlines the most common end-to-end workflow. Not a must-have (OS screenshots work), but a nice-to-have that reduces friction.

**Implementation complexity:** Medium. `html2canvas` or Chrome `tabs.captureVisibleTab` API for viewport. Element-level screenshots need more work.

---

### 6. Blur Presets / Profiles

**What it is:** Save named blur configurations (which elements, which zones, which categories, what strength) and switch between them. E.g., "Demo mode", "Recording mode", "Personal browsing".

**Who has it:**
| Extension | Details |
|---|---|
| Privacy Blur (freemium) | "Advanced blur presets" in premium tier |

**Why it matters:**
- Power users who blur for different contexts (demo vs. recording vs. personal) currently re-configure every time.
- Per-site URL rules partially address this, but profiles work across sites and capture the full config.

**Differentiation potential:** Medium. Mostly a power-user feature, but aligns with BlurrySite's existing power-user positioning (shortcuts, URL rules, categories).

**Implementation complexity:** Medium. Store named settings objects in `chrome.storage.local`, add a profile switcher to popup.

---

## Priority 3 — Niche Impact, Specialized Use Cases

### 7. Idle / Tab-Switch Auto-Blur

**What it is:** Automatically blur the page when the user is idle for N seconds, or when they switch to another tab. Unblur on return.

**Who has it:**
| Extension | Details |
|---|---|
| Privacy Blur (freemium) | "Smart Auto-Blur" with idle and tab detection (premium) |

**Why it matters:**
- Prevents shoulder-surfing in open offices, co-working spaces, coffee shops.
- "I forgot to blur before walking away" is a real scenario.

**Differentiation potential:** Medium. Niche but compelling for privacy-conscious users. No other competitor except Privacy Blur has it.

**Implementation complexity:** Low-medium. `document.visibilitychange` event + `setTimeout` for idle detection. Trigger existing `enableBlurAll()` / `disableBlurAll()`.

---

### 8. Decoy / Fake Content Mode

**What it is:** Replace the visible page with realistic-looking fake content (fake emails, fake dashboards, fake data) instead of blurring.

**Who has it:**
| Extension | Details |
|---|---|
| Privacy Blur (freemium) | "Decoy Mode" — replaces screen with realistic fake content |

**Why it matters:**
- Blurred content signals "something is hidden here." Decoy content looks normal — no one knows you're hiding anything.
- Useful for presentations where blur would raise questions from the audience.

**Differentiation potential:** Low-medium. Very niche. Cool factor is high but the implementation surface is large and the use case is narrow.

**Implementation complexity:** High. Requires generating plausible fake content for arbitrary page layouts. Template-based approach limits which sites it works on.

---

### 9. Timed / Temporary Blur

**What it is:** Apply blur for a set duration (e.g., 5 minutes, 30 minutes), then auto-remove. Or set a "privacy session" that expires.

**Who has it:**
| Extension | Details |
|---|---|
| Privacy Blur (freemium) | "Extended temporary protection with timer options" (premium) |

**Why it matters:**
- Users blur for a meeting, forget to unblur after. Timer ensures cleanup.
- Pairs well with the screen-sharing use case: "Blur for this 30-min call, then restore."

**Differentiation potential:** Low-medium. Convenience feature. BlurrySite's persistent blur is the opposite philosophy (blur stays until removed) — a timer option adds flexibility.

**Implementation complexity:** Low. `setTimeout` or `chrome.alarms` API to trigger `disableBlurAll()` after N minutes.

---

### 10. Blur URL / Address Bar Content

**What it is:** Obscure the URL in the address bar to prevent leaking internal URLs, staging environments, or authenticated endpoints during screen shares.

**Who has it:**
- Mentioned as a user request in ZeroBlur reviews. No competitor actually ships this — browser APIs don't expose address bar styling.

**Why it matters:**
- URLs like `internal.company.com/admin/users/salary-report` leak sensitive info even when the page content is blurred.

**Differentiation potential:** Low. Technically impossible via extension APIs (address bar is outside extension DOM scope). Can only be addressed via screen-anchored zone overlay positioned at the top of the viewport — a workaround BlurrySite already supports.

**Implementation complexity:** N/A (browser limitation). Document the workaround using screen-anchored zones.

---

## Summary: Priority Ranking

| # | Feature | Impact | Complexity | Recommended Phase |
|---|---|---|---|---|
| 1 | Smart auto-detect (PII, financial) | Very High | Medium-High | Phase 1 |
| 2 | Selected text blur | High | Medium | Phase 1 |
| 3 | Text masking / redaction | High | Low-Medium | Phase 1 |
| 4 | Hide tab title & favicon | Medium-High | Low | Phase 1 (quick win) |
| 5 | Screenshot with masking | Medium | Medium | Phase 2 |
| 6 | Blur presets / profiles | Medium | Medium | Phase 2 |
| 7 | Idle / tab-switch auto-blur | Medium | Low-Medium | Phase 2 |
| 8 | Decoy / fake content | Low-Medium | High | Phase 3 (if ever) |
| 9 | Timed / temporary blur | Low-Medium | Low | Phase 2 |
| 10 | Blur URL bar | Low | N/A | Document workaround only |

---

## BlurrySite's Existing Moat (features NO competitor has)

These are already shipped and should be emphasized in marketing:

1. **Hover-to-peek / Click-to-peek** — 0 competitors
2. **5 toggleable blur categories** — 0 competitors
3. **Per-site URL rules with regex + per-rule overrides** — 0 competitors
4. **Fully customizable keyboard shortcuts with capture UI** — 0 competitors
5. **Frosted / AI-proof blur mode** — 0 competitors
6. **Screen-anchored (viewport-fixed) blur zones** — 0 competitors
7. **Context menu blur/unblur** — 0 competitors
8. **Multi-language i18n** — 0 competitors
