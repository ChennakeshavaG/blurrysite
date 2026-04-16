Plan: Feature Documentation (docs/features/)

 Context

 Comprehensive feature audit was done via explore agent. User wants the findings written as reference docs in a new
 docs/features/ folder — one doc per logical feature area, plus an index. No code changes. Pure documentation.

 ---
 Folder Structure

 docs/features/
 ├── INDEX.md               ← master table: feature, UI location, storage key, shortcut
 ├── core-blur.md           ← blur-all, clear-all, per-element items list + remove
 ├── picker.md              ← dynamic mode, sticky-page, sticky-screen zone drawing
 ├── reveal.md              ← hover/click/none modes, PII reveal, zone reveal
 ├── pii-detection.md       ← EMAIL + NUMERIC (standard/conservative), label logic
 ├── settings-appearance.md ← blur radius, blur mode, highlight color, transition, redaction color
 ├── settings-behavior.md   ← reveal mode, thorough blur, tab privacy, auto-blur, idle timeout, blur timer
 ├── categories.md          ← TEXT/MEDIA/FORM/TABLE/STRUCTURE — what each covers
 ├── shortcuts.md           ← 4 default shortcuts, chrome.commands relay, JS dedup, customize modal
 ├── site-rules.md          ← URL rules, wildcard vs regex, override shape, rule resolution
 └── screenshot.md          ← capture viewport, download PNG, clipboard copy, crop

 ---
 Per-File Content Plan

 INDEX.md

 - One-line description per feature
 - Master table: Feature | UI | Keyboard | Storage key | Content script handler | Visual result
 - Same summary table the explore agent produced (cleaned up)

 core-blur.md

 - Blur All: button + Alt+Shift+B → blur_all_hosts[host] bool → _reconcile() → Engine.handleSite()
 - Clear All: button + Alt+Shift+U → clears blurred_items[host] + blur_all_hosts[host]
 - Per-element items list: shows in popup, remove button → Store.removeBlurItem() → storage.onChange → _reconcile()
 - Clear All Sites: footer button, confirm dialog → wipes entire blurred_items map
 - Data flow diagram (text)

 picker.md

 - Three modes: dynamic, sticky-page, sticky-screen
 - Dynamic: click → getSelector() → saveBlurItem({type:'dynamic', selector})
 - Sticky-page: draw rectangle → saveBlurItem({type:'sticky', anchor:'page', xPct, yPct, ...}) — scrolls with content,
 scoped to path
 - Sticky-screen: draw rectangle → saveBlurItem({type:'sticky', anchor:'screen', x, y, ...}) — fixed to viewport, no
 path scoping
 - Toolbar: draggable pill, mode switch, clear button, close button — position persisted at picker_toolbar_pos
 - Picker callbacks: onBlur, onUnblur, onStickyBlur, onStickyUnblur, onModeChange, onDeactivate
 - Storage shape for both item types

 reveal.md

 - Three modes: hover (50ms debounce), click (sticky until reload), none
 - Mechanism: stamps [data-bl-si-reveal="1"] on target + blurred children + ancestor chain
 - CSS override: [data-bl-si-blur][data-bl-si-reveal] { filter: none !important } (all 4 blur modes)
 - PII reveal: [data-bl-si-pii]:not([data-bl-si-reveal]) — same attribute, independent CSS rule
 - Zone reveal: inline backdrop-filter: none (zones have no injected CSS)
 - Known issue: background-color: transparent side-effect in redacted/masked modes during reveal

 pii-detection.md

 - Full explanation of EMAIL pattern + pre-filter (text.includes('@'))
 - NUMERIC regex — 5 sub-patterns in order (currency prefix, code suffix, comma-grouped, phone-like, bare 4+)
 - Three NUMERIC modes: off / standard / conservative
 - Conservative: _hasContextLabel() — 100-char window, SENSITIVE_LABELS regex, PRICE_SUPPRESSORS regex, decision tree
 - Independence from blur-all: [data-bl-si-pii] only, no [data-bl-si-blur]
 - Gate check: always NUMERIC && NUMERIC !== 'off' (never Boolean(NUMERIC) — 'off' is truthy)
 - Master toggle expandKeys: EMAIL→true/false, NUMERIC→'standard'/'off'

 settings-appearance.md

 - BLUR_RADIUS (2–30px) → --bl-si-radius CSS var on <html>
 - BLUR_MODE (gaussian/frosted/redacted/masked) → engine rebuilds <style> rules
 - HIGHLIGHT_COLOR (#hex) → --bl-si-highlight-color CSS var
 - TRANSITION_DURATION (0 or 150ms) → --bl-si-transition-duration CSS var
 - REDACTION_COLOR (#hex) → --bl-si-redaction-color CSS var (used by redacted + masked modes)
 - LANGUAGE (auto/en/hi_IN/ta_IN) → re-init i18n, rebuild all translated surfaces

 settings-behavior.md

 - REVEAL_MODE → Reveal.clearAll() on change
 - THOROUGH_BLUR → engine reads fresh per MutationObserver callback
 - TAB_PRIVACY → TabPrivacy.enable()/disable()
 - AUTO_BLUR_TAB_SWITCH + AUTO_BLUR_IDLE → AutoBlur.init({onIdle, onActive, onTabSwitch})
 - IDLE_TIMEOUT_SECONDS (30–3600s) → passed to AutoBlur
 - BLUR_TIMER_MINUTES (0–480min, 0=off) → BlurTimer.start(minutes, onExpire)

 categories.md

 - TEXT: headings, paragraphs, spans, links, inline text
 - MEDIA: img, video, audio, canvas, svg, picture, figure
 - FORM: input, textarea, select, button, label, fieldset
 - TABLE: table, thead, tbody, tr, td, th, caption
 - STRUCTURE: div, section, article, nav, aside, header, footer, main, li
 - How THOROUGH_BLUR interacts: enables textCheck elements (structural containers)
 - CSS injection via injectRules(root, categories, mode) into <style id="bl-si-blur-styles">

 shortcuts.md

 - 4 actions: TOGGLE_BLUR_ALL (Alt+Shift+B), TOGGLE_PICKER (Alt+Shift+P), CLEAR_ALL (Alt+Shift+U), SCREENSHOT
 (Alt+Shift+S)
 - Two trigger paths: JS keydown listener (capture phase) + chrome.commands relay via background
 - Dedup: __blsiShortcutFire[actionId] timestamp, 500ms window
 - Customize modal: capture UI → validates mods, rejects AltGr/bare Ctrl+Alt, collision detection, reserved chord
 warning
 - Storage: settings.SHORTCUTS.ACTION_ID.binding = [{code, mods}]
 - Per-site override: NOT supported (shortcuts excluded from site rules by design)

 site-rules.md

 - Shape: { id, name, pattern, patternType, settings: {partial overrides} }
 - patternType: wildcard (parse + match with domain boundaries) or regex (ReDoS-safe, rejects nested quantifiers)
 - Resolution: UrlMatcher.resolveSettings(url, globalSettings, rules) → first match wins → deepMerge
 - Override shape: null = inherit global; any value = override
 - What CAN be overridden: all settings except SHORTCUTS
 - What CANNOT: SHORTCUTS (excluded by design)
 - Rule editor: three-state selects for toggles (Global / On / Off), optional slider for ranges

 screenshot.md

 - Trigger: Alt+Shift+S shortcut (JS listener only — not in chrome.commands)
 - Flow: content script → background.js CAPTURE_VIEWPORT → chrome.tabs.captureVisibleTab() → PNG data URL → back to
 content script
 - Options: download as PNG or copy to clipboard
 - Crop: startCrop() — draws selection rectangle, captures only selected region
 - Blur preserved: capture happens AFTER blur is applied (CSS filter visible in screenshot)

 ---
 Files to Create

 All new files — no existing docs modified.

 docs/features/INDEX.md
 docs/features/core-blur.md
 docs/features/picker.md
 docs/features/reveal.md
 docs/features/pii-detection.md
 docs/features/settings-appearance.md
 docs/features/settings-behavior.md
 docs/features/categories.md
 docs/features/shortcuts.md
 docs/features/site-rules.md
 docs/features/screenshot.md

 11 files total. No source code changes. No test changes.
