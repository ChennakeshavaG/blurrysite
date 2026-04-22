# Popup Redesign — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the old popup entirely, add new settings keys to `src/constants.js`, and build a minimal working popup scaffold (blank sections, opens without errors, theme switching works).

**Architecture:** Clean-slate — every file in `popup/` is deleted and recreated from spec. The Slate token system lives in `popup/theme.css` (pure CSS custom properties, nothing else). Structural styles in `popup/popup.css` consume those tokens. `popup/popup.js` is a loading stub: loads settings, applies theme, wires the power button, and navigates between main view and sub-pages. No rendering logic beyond that — that belongs to Plans 2 and 3. New settings keys added to `src/constants.js` with full `validateSettings` coverage and unit tests before any code is written.

**Tech Stack:** Vanilla JS (IIFE, no bundler), CSS custom properties, Chrome MV3 extension, Jest for unit tests.

**Primary directive:** Do NOT reference or read old popup files during implementation. Git history is available if needed. Build everything from the design spec: `docs/superpowers/specs/2026-04-18-popup-redesign-design.md`.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Delete | `popup/popup.html` | Old markup |
| Delete | `popup/popup.css` | Old styles |
| Delete | `popup/popup.js` | Old logic |
| Delete | `popup/popup_configs.js` | Old configs |
| Delete | `popup/popup_i18n.js` | Old i18n |
| Delete | `popup/popup_settings_renderer.js` | Old renderers |
| Delete | `popup/fonts/` | Old font assets |
| Modify | `src/constants.js` | Add 5 new enum objects + 5 new DEFAULT_SETTINGS keys + validateSettings for all of them |
| Modify | `tests/unit/constants.test.js` | Tests for every new enum, default, and validation path |
| Create | `popup/theme.css` | Slate CSS custom property tokens (dark + light) — nothing else |
| Create | `popup/popup.html` | Full section structure per spec §12, all sub-page shells, script tags |
| Create | `popup/popup.css` | Structural styles: header, sections, mode blocks, chips, toggle, nav rows, footer, sub-pages |
| Create | `popup/popup.js` | Loading stub: theme, power toggle, host/version display, sub-page navigation |

---

### Task 1: Delete old popup files

**Files:**
- Delete: `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `popup/popup_configs.js`, `popup/popup_i18n.js`, `popup/popup_settings_renderer.js`, `popup/fonts/`

- [ ] **Step 1: Remove popup files**

```bash
rm popup/popup.html popup/popup.css popup/popup.js popup/popup_configs.js popup/popup_i18n.js popup/popup_settings_renderer.js
rm -rf popup/fonts/
```

- [ ] **Step 2: Confirm directory is empty**

```bash
ls popup/
```

Expected: empty output (no files listed).

- [ ] **Step 3: Confirm tests still pass (nothing in popup/ should be under test)**

```bash
npm run test:unit
```

Expected: all tests pass (538 tests, same count as before).

- [ ] **Step 4: Commit**

```bash
git add -A popup/
git commit -m "chore: delete old popup — rebuilding from scratch per design spec"
```

---

### Task 2: Add new enum constants to constants.js

**Files:**
- Modify: `src/constants.js` (after the `PICKER_MODES` block, ~line 113)
- Modify: `tests/unit/constants.test.js` (add describe block inside `describe('BlurrySite constants', ...)`)

- [ ] **Step 1: Write failing tests**

Open `tests/unit/constants.test.js`. Inside the outer `describe('BlurrySite constants', () => {` block, add the following describe block (place it near the end, before the closing `}`):

```js
// ── New popup redesign enums ────────────────────────────────────────────────

describe('ACTIVE_MODES enum', () => {
  test('has blur-all and pick-blur values', () => {
    expect(blsi.ACTIVE_MODES).toEqual({ BLUR_ALL: 'blur-all', PICK_BLUR: 'pick-blur' });
  });
  test('is frozen', () => {
    expect(Object.isFrozen(blsi.ACTIVE_MODES)).toBe(true);
  });
});

describe('PICK_BLUR_MODES enum', () => {
  test('has gaussian, frosted, color — no redacted or masked', () => {
    expect(blsi.PICK_BLUR_MODES).toEqual({
      GAUSSIAN: 'gaussian',
      FROSTED: 'frosted',
      COLOR: 'color',
    });
  });
  test('is frozen', () => {
    expect(Object.isFrozen(blsi.PICK_BLUR_MODES)).toBe(true);
  });
});

describe('PII_MODES enum', () => {
  test('has gaussian, frosted, redacted, asterisked', () => {
    expect(blsi.PII_MODES).toEqual({
      GAUSSIAN: 'gaussian',
      FROSTED: 'frosted',
      REDACTED: 'redacted',
      ASTERISKED: 'asterisked',
    });
  });
  test('is frozen', () => {
    expect(Object.isFrozen(blsi.PII_MODES)).toBe(true);
  });
});

describe('TIMER_UNITS enum', () => {
  test('has sec, min, hr', () => {
    expect(blsi.TIMER_UNITS).toEqual({ SEC: 'sec', MIN: 'min', HR: 'hr' });
  });
  test('is frozen', () => {
    expect(Object.isFrozen(blsi.TIMER_UNITS)).toBe(true);
  });
});

describe('IDLE_UNITS enum', () => {
  test('has sec and min only — no hr (Chrome API cap is 3000 s)', () => {
    expect(blsi.IDLE_UNITS).toEqual({ SEC: 'sec', MIN: 'min' });
  });
  test('does not contain hr', () => {
    expect(blsi.IDLE_UNITS).not.toHaveProperty('HR');
  });
  test('is frozen', () => {
    expect(Object.isFrozen(blsi.IDLE_UNITS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --testPathPattern=constants
```

Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'BLUR_ALL')`

- [ ] **Step 3: Add enums to src/constants.js**

In `src/constants.js`, after the `PICKER_MODES` block (after the line containing `});` that closes `PICKER_MODES`), add:

```js
// Active blur mode — which top-level mode is currently selected.
// Switching modes is destructive: stored blur items for the deactivated mode
// are deleted from chrome.storage.
const ACTIVE_MODES = Object.freeze({
  BLUR_ALL: 'blur-all',
  PICK_BLUR: 'pick-blur',
});

// Pick & Blur blur types — separate set from BLUR_MODES (no Redacted/Masked).
// Color is a solid-cover mode exclusive to Pick & Blur.
const PICK_BLUR_MODES = Object.freeze({
  GAUSSIAN: 'gaussian',
  FROSTED: 'frosted',
  COLOR: 'color',
});

// PII auto-detect blur types — independent of blur-all and pick-blur.
const PII_MODES = Object.freeze({
  GAUSSIAN: 'gaussian',
  FROSTED: 'frosted',
  REDACTED: 'redacted',
  ASTERISKED: 'asterisked',
});

// Timer unit options — supports hours (no Chrome API constraint on setTimeout).
const TIMER_UNITS = Object.freeze({
  SEC: 'sec',
  MIN: 'min',
  HR: 'hr',
});

// Idle unit options — hr excluded: Chrome idle API hard cap is 3000 s (50 min).
const IDLE_UNITS = Object.freeze({
  SEC: 'sec',
  MIN: 'min',
});
```

Also update the `return Object.assign(flat, categories, {` statement (near the bottom of the file) to include the new enums:

```js
return Object.assign(flat, categories, {
  REVEAL_MODES,
  BLUR_MODES,
  PICKER_MODES,
  ACTIVE_MODES,
  PICK_BLUR_MODES,
  PII_MODES,
  TIMER_UNITS,
  IDLE_UNITS,
  PATTERN_TYPES,
  // ... rest unchanged
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm run test:unit -- --testPathPattern=constants
```

Expected: all constants tests PASS.

---

### Task 3: Add new DEFAULT_SETTINGS keys

**Files:**
- Modify: `src/constants.js` (inside `DEFAULT_SETTINGS = Object.freeze({...})`, after `BLUR_CATEGORIES`)
- Modify: `tests/unit/constants.test.js`

- [ ] **Step 1: Write failing tests**

Inside `tests/unit/constants.test.js`, inside the outer describe, add:

```js
describe('DEFAULT_SETTINGS — new popup redesign keys', () => {
  test('ACTIVE_MODE defaults to blur-all', () => {
    expect(blsi.DEFAULT_SETTINGS.ACTIVE_MODE).toBe('blur-all');
  });

  test('PICK_BLUR_TYPE defaults to gaussian', () => {
    expect(blsi.DEFAULT_SETTINGS.PICK_BLUR_TYPE).toBe('gaussian');
  });

  test('PICK_BLUR_COLOR defaults to opaque black', () => {
    expect(blsi.DEFAULT_SETTINGS.PICK_BLUR_COLOR).toEqual({ HEX: '#000000', OPACITY: 1.0 });
  });

  test('PICK_BLUR_COLOR is frozen', () => {
    expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.PICK_BLUR_COLOR)).toBe(true);
  });

  test('PII_MODE defaults to gaussian', () => {
    expect(blsi.DEFAULT_SETTINGS.PII_MODE).toBe('gaussian');
  });

  test('AUTOMATE has correct default structure', () => {
    expect(blsi.DEFAULT_SETTINGS.AUTOMATE).toEqual({
      TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false },
      IDLE: { VALUE: 5, UNIT: 'min', ENABLED: false },
      TAB_SWITCH: { ENABLED: false },
    });
  });

  test('AUTOMATE is frozen (top-level and nested)', () => {
    expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE)).toBe(true);
    expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.TIMER)).toBe(true);
    expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.IDLE)).toBe(true);
    expect(Object.isFrozen(blsi.DEFAULT_SETTINGS.AUTOMATE.TAB_SWITCH)).toBe(true);
  });

  test('buildDefaultSettings includes all new keys', () => {
    const s = blsi.buildDefaultSettings();
    expect(s).toHaveProperty('ACTIVE_MODE');
    expect(s).toHaveProperty('PICK_BLUR_TYPE');
    expect(s).toHaveProperty('PICK_BLUR_COLOR');
    expect(s).toHaveProperty('PII_MODE');
    expect(s).toHaveProperty('AUTOMATE');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --testPathPattern=constants
```

Expected: FAIL — `expect(received).toBe('blur-all') — received: undefined`

- [ ] **Step 3: Add keys to DEFAULT_SETTINGS in src/constants.js**

In `src/constants.js`, inside the `DEFAULT_SETTINGS = Object.freeze({` block, after the `BLUR_CATEGORIES` entry (before the closing `});`), add:

```js
    // ── Popup redesign keys ───────────────────────────────────────────────────
    // Which top-level mode is active. Destructive switch — other mode's items deleted.
    ACTIVE_MODE: 'blur-all',

    // Blur type used in Pick & Blur mode (gaussian | frosted | color).
    PICK_BLUR_TYPE: 'gaussian',

    // Color used in Pick & Blur 'color' type. HEX is a 6-char hex string; OPACITY 0–1.
    PICK_BLUR_COLOR: Object.freeze({
      HEX: '#000000',
      OPACITY: 1.0,
    }),

    // Blur type used by auto-detect PII rendering.
    PII_MODE: 'gaussian',

    // Automate trigger settings. VALUE is 1–99; UNIT is from TIMER_UNITS / IDLE_UNITS.
    AUTOMATE: Object.freeze({
      TIMER: Object.freeze({ VALUE: 0, UNIT: 'min', ENABLED: false }),
      IDLE: Object.freeze({ VALUE: 5, UNIT: 'min', ENABLED: false }),
      TAB_SWITCH: Object.freeze({ ENABLED: false }),
    }),
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm run test:unit -- --testPathPattern=constants
```

Expected: all constants tests PASS.

---

### Task 4: Add validateSettings for new keys

**Files:**
- Modify: `src/constants.js` (inside `validateSettings()`, after the BLUR_CATEGORIES block)
- Modify: `tests/unit/constants.test.js`

- [ ] **Step 1: Write failing tests**

Inside `tests/unit/constants.test.js`, add:

```js
describe('validateSettings — new popup redesign keys', () => {
  function base() { return blsi.buildDefaultSettings(); }

  // ACTIVE_MODE
  test('ACTIVE_MODE: pick-blur passes through', () => {
    const r = blsi.validateSettings({ ...base(), ACTIVE_MODE: 'pick-blur' });
    expect(r.ACTIVE_MODE).toBe('pick-blur');
  });
  test('ACTIVE_MODE: invalid value falls back to blur-all', () => {
    const r = blsi.validateSettings({ ...base(), ACTIVE_MODE: 'unknown' });
    expect(r.ACTIVE_MODE).toBe('blur-all');
  });
  test('ACTIVE_MODE: missing key falls back to default', () => {
    const s = base(); delete s.ACTIVE_MODE;
    const r = blsi.validateSettings(s);
    expect(r.ACTIVE_MODE).toBe('blur-all');
  });

  // PICK_BLUR_TYPE
  test('PICK_BLUR_TYPE: color passes through', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'color' });
    expect(r.PICK_BLUR_TYPE).toBe('color');
  });
  test('PICK_BLUR_TYPE: redacted is rejected (not a Pick & Blur type)', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'redacted' });
    expect(r.PICK_BLUR_TYPE).toBe('gaussian');
  });
  test('PICK_BLUR_TYPE: masked is rejected', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_TYPE: 'masked' });
    expect(r.PICK_BLUR_TYPE).toBe('gaussian');
  });

  // PICK_BLUR_COLOR
  test('PICK_BLUR_COLOR: valid hex + opacity pass through', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ff3300', OPACITY: 0.5 } });
    expect(r.PICK_BLUR_COLOR).toEqual({ HEX: '#ff3300', OPACITY: 0.5 });
  });
  test('PICK_BLUR_COLOR: 3-char hex falls back to default hex', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#f30', OPACITY: 1.0 } });
    expect(r.PICK_BLUR_COLOR.HEX).toBe('#000000');
  });
  test('PICK_BLUR_COLOR: named color "red" falls back to default hex', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: 'red', OPACITY: 1.0 } });
    expect(r.PICK_BLUR_COLOR.HEX).toBe('#000000');
  });
  test('PICK_BLUR_COLOR: opacity > 1 falls back to 1.0', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ffffff', OPACITY: 1.5 } });
    expect(r.PICK_BLUR_COLOR.OPACITY).toBe(1.0);
  });
  test('PICK_BLUR_COLOR: opacity < 0 falls back to 1.0', () => {
    const r = blsi.validateSettings({ ...base(), PICK_BLUR_COLOR: { HEX: '#ffffff', OPACITY: -0.1 } });
    expect(r.PICK_BLUR_COLOR.OPACITY).toBe(1.0);
  });
  test('PICK_BLUR_COLOR: missing key falls back to defaults', () => {
    const s = base(); delete s.PICK_BLUR_COLOR;
    const r = blsi.validateSettings(s);
    expect(r.PICK_BLUR_COLOR).toEqual({ HEX: '#000000', OPACITY: 1.0 });
  });

  // PII_MODE
  test('PII_MODE: asterisked passes through', () => {
    const r = blsi.validateSettings({ ...base(), PII_MODE: 'asterisked' });
    expect(r.PII_MODE).toBe('asterisked');
  });
  test('PII_MODE: redacted passes through', () => {
    const r = blsi.validateSettings({ ...base(), PII_MODE: 'redacted' });
    expect(r.PII_MODE).toBe('redacted');
  });
  test('PII_MODE: invalid value falls back to gaussian', () => {
    const r = blsi.validateSettings({ ...base(), PII_MODE: 'bogus' });
    expect(r.PII_MODE).toBe('gaussian');
  });

  // AUTOMATE.TIMER
  test('AUTOMATE.TIMER: valid value + sec unit pass through', () => {
    const s = base();
    s.AUTOMATE = { TIMER: { VALUE: 30, UNIT: 'sec', ENABLED: true }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TIMER).toEqual({ VALUE: 30, UNIT: 'sec', ENABLED: true });
  });
  test('AUTOMATE.TIMER: VALUE 0 is valid (timer off)', () => {
    const s = base();
    s.AUTOMATE = { TIMER: { VALUE: 0, UNIT: 'min', ENABLED: false }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TIMER.VALUE).toBe(0);
  });
  test('AUTOMATE.TIMER: VALUE 100 (above max 99) falls back to 0', () => {
    const s = base();
    s.AUTOMATE = { TIMER: { VALUE: 100, UNIT: 'min', ENABLED: false }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TIMER.VALUE).toBe(0);
  });
  test('AUTOMATE.TIMER: hr unit passes through', () => {
    const s = base();
    s.AUTOMATE = { TIMER: { VALUE: 2, UNIT: 'hr', ENABLED: true }, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TIMER.UNIT).toBe('hr');
  });

  // AUTOMATE.IDLE
  test('AUTOMATE.IDLE: valid value + min unit pass through', () => {
    const s = base();
    s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 10, UNIT: 'min', ENABLED: true }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.IDLE).toEqual({ VALUE: 10, UNIT: 'min', ENABLED: true });
  });
  test('AUTOMATE.IDLE: hr unit rejected (Chrome API cap) — falls back to min', () => {
    const s = base();
    s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 2, UNIT: 'hr', ENABLED: true }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.IDLE.UNIT).toBe('min');
  });
  test('AUTOMATE.IDLE: VALUE 0 (below min 1) falls back to 5', () => {
    const s = base();
    s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: { VALUE: 0, UNIT: 'min', ENABLED: false }, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.IDLE.VALUE).toBe(5);
  });

  // AUTOMATE.TAB_SWITCH
  test('AUTOMATE.TAB_SWITCH: enabled true passes through', () => {
    const s = base();
    s.AUTOMATE = { TIMER: s.AUTOMATE.TIMER, IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: { ENABLED: true } };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TAB_SWITCH.ENABLED).toBe(true);
  });

  // AUTOMATE missing entirely
  test('AUTOMATE missing falls back to full defaults', () => {
    const s = base(); delete s.AUTOMATE;
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE).toEqual(blsi.DEFAULT_SETTINGS.AUTOMATE);
  });

  // AUTOMATE partial — missing sub-keys
  test('AUTOMATE.TIMER missing falls back to default timer', () => {
    const s = base();
    s.AUTOMATE = { IDLE: s.AUTOMATE.IDLE, TAB_SWITCH: s.AUTOMATE.TAB_SWITCH };
    const r = blsi.validateSettings(s);
    expect(r.AUTOMATE.TIMER).toEqual(blsi.DEFAULT_SETTINGS.AUTOMATE.TIMER);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm run test:unit -- --testPathPattern=constants
```

Expected: FAIL — multiple failures for missing `result.ACTIVE_MODE` etc.

- [ ] **Step 3: Add validation in src/constants.js**

Inside `validateSettings()`, after the `BLUR_CATEGORIES` block (after the closing `}` of the `for (const key of Object.keys(defaults.BLUR_CATEGORIES))` loop), add:

```js
    // ── Popup redesign keys ─────────────────────────────────────────────────

    result.ACTIVE_MODE = Object.values(ACTIVE_MODES).includes(settings.ACTIVE_MODE)
      ? settings.ACTIVE_MODE
      : defaults.ACTIVE_MODE;

    result.PICK_BLUR_TYPE = Object.values(PICK_BLUR_MODES).includes(settings.PICK_BLUR_TYPE)
      ? settings.PICK_BLUR_TYPE
      : defaults.PICK_BLUR_TYPE;

    const pbc =
      settings.PICK_BLUR_COLOR && typeof settings.PICK_BLUR_COLOR === 'object'
        ? settings.PICK_BLUR_COLOR
        : {};
    result.PICK_BLUR_COLOR = {
      HEX:
        typeof pbc.HEX === 'string' && /^#[0-9a-fA-F]{6}$/.test(pbc.HEX)
          ? pbc.HEX
          : defaults.PICK_BLUR_COLOR.HEX,
      OPACITY:
        typeof pbc.OPACITY === 'number' && pbc.OPACITY >= 0 && pbc.OPACITY <= 1
          ? pbc.OPACITY
          : defaults.PICK_BLUR_COLOR.OPACITY,
    };

    result.PII_MODE = Object.values(PII_MODES).includes(settings.PII_MODE)
      ? settings.PII_MODE
      : defaults.PII_MODE;

    const automateIn =
      settings.AUTOMATE && typeof settings.AUTOMATE === 'object' ? settings.AUTOMATE : {};
    const timerIn =
      automateIn.TIMER && typeof automateIn.TIMER === 'object' ? automateIn.TIMER : {};
    const idleIn =
      automateIn.IDLE && typeof automateIn.IDLE === 'object' ? automateIn.IDLE : {};
    const tabIn =
      automateIn.TAB_SWITCH && typeof automateIn.TAB_SWITCH === 'object'
        ? automateIn.TAB_SWITCH
        : {};
    result.AUTOMATE = {
      TIMER: {
        VALUE:
          typeof timerIn.VALUE === 'number' &&
          timerIn.VALUE >= 0 &&
          timerIn.VALUE <= 99
            ? timerIn.VALUE
            : defaults.AUTOMATE.TIMER.VALUE,
        UNIT: Object.values(TIMER_UNITS).includes(timerIn.UNIT)
          ? timerIn.UNIT
          : defaults.AUTOMATE.TIMER.UNIT,
        ENABLED:
          typeof timerIn.ENABLED === 'boolean'
            ? timerIn.ENABLED
            : defaults.AUTOMATE.TIMER.ENABLED,
      },
      IDLE: {
        VALUE:
          typeof idleIn.VALUE === 'number' &&
          idleIn.VALUE >= 1 &&
          idleIn.VALUE <= 99
            ? idleIn.VALUE
            : defaults.AUTOMATE.IDLE.VALUE,
        UNIT: Object.values(IDLE_UNITS).includes(idleIn.UNIT)
          ? idleIn.UNIT
          : defaults.AUTOMATE.IDLE.UNIT,
        ENABLED:
          typeof idleIn.ENABLED === 'boolean'
            ? idleIn.ENABLED
            : defaults.AUTOMATE.IDLE.ENABLED,
      },
      TAB_SWITCH: {
        ENABLED:
          typeof tabIn.ENABLED === 'boolean'
            ? tabIn.ENABLED
            : defaults.AUTOMATE.TAB_SWITCH.ENABLED,
      },
    };
```

- [ ] **Step 4: Run all unit tests**

```bash
npm run test:unit
```

Expected: all tests PASS. Test count will be higher than 538 (all new tests added).

- [ ] **Step 5: Commit constants changes**

```bash
git add src/constants.js tests/unit/constants.test.js
git commit -m "feat: add popup redesign settings keys (ACTIVE_MODE, PICK_BLUR_TYPE, PICK_BLUR_COLOR, PII_MODE, AUTOMATE) with full validateSettings coverage"
```

- [ ] **Step 6: Update TEST_VALIDATION.md**

In `docs/TEST_VALIDATION.md`, add an entry for the new test group. Find the `constants.test.js` section and add:

```
### New popup redesign keys (Task 4 of Plan 1)

**Tests:** validateSettings — ACTIVE_MODE, PICK_BLUR_TYPE, PICK_BLUR_COLOR, PII_MODE, AUTOMATE

**What each asserts:**
- ACTIVE_MODE: valid/invalid/missing values — falls back to 'blur-all'
- PICK_BLUR_TYPE: 'color' passes; 'redacted'/'masked' rejected (not Pick & Blur types)
- PICK_BLUR_COLOR: valid hex + opacity pass; 3-char hex, named colors, out-of-range opacity fall back
- PII_MODE: all 4 valid values pass; invalid falls back to 'gaussian'
- AUTOMATE.TIMER: VALUE 0–99 valid; hr unit passes; VALUE 100 falls back
- AUTOMATE.IDLE: VALUE 1–99 valid; hr unit rejected (Chrome API cap), falls back to min; VALUE 0 falls back
- AUTOMATE.TAB_SWITCH: boolean passes through
- AUTOMATE missing entirely / partially: all sub-keys fall back to defaults

**Manual replication:** Open browser console on any page. Run:
  blsi.validateSettings({ ACTIVE_MODE: 'unknown' }).ACTIVE_MODE   // → 'blur-all'
  blsi.validateSettings({ PICK_BLUR_TYPE: 'redacted' }).PICK_BLUR_TYPE  // → 'gaussian'
  blsi.validateSettings({ AUTOMATE: { IDLE: { VALUE: 2, UNIT: 'hr', ENABLED: true } } }).AUTOMATE.IDLE.UNIT  // → 'min'
```

---

### Task 5: Create popup/theme.css

**Files:**
- Create: `popup/theme.css`

No automated tests — visual token file. Manually verified when the popup opens in Plans 2+.

- [ ] **Step 1: Create popup/theme.css**

```css
/* Slate dark mode (default) */
:root {
  --bl-base:         #0a0b0f;
  --bl-surface:      #13151f;
  --bl-raised:       #1e2130;
  --bl-amber:        #fbbf24;
  --bl-sky:          #38bdf8;
  --bl-violet:       #818cf8;
  --bl-danger:       #f87171;
  --bl-text-primary: #e8eaf0;
  --bl-text-muted:   #6b7280;
  --bl-text-dim:     #3a3d50;
}

/* Slate light mode — cool-shifted, aligned with Slate palette */
[data-theme="light"] {
  --bl-base:         #f8f9fc;
  --bl-surface:      #eef0f6;
  --bl-raised:       #e4e8f2;
  --bl-amber:        #d97706;
  --bl-sky:          #0284c7;
  --bl-violet:       #6d28d9;
  --bl-danger:       #dc2626;
  --bl-text-primary: #0f1117;
  --bl-text-muted:   #6b7280;
  --bl-text-dim:     #9098b0;
}
```

- [ ] **Step 2: Commit**

```bash
git add popup/theme.css
git commit -m "feat: Slate CSS token system for popup redesign"
```

---

### Task 6: Create popup/popup.html

**Files:**
- Create: `popup/popup.html`

The HTML provides the full structural skeleton per spec §12. All sections exist; they will be populated by `popup.js` in Plans 2 and 3. Sub-page shells are present but `hidden` by default.

- [ ] **Step 1: Verify manifest points to popup/popup.html**

```bash
grep "default_popup" manifest.json
```

Expected: `"default_popup": "popup/popup.html"`

- [ ] **Step 2: Create popup/popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blurry Site</title>
  <link rel="stylesheet" href="theme.css">
  <link rel="stylesheet" href="popup.css">
</head>
<body>

  <!-- ── HEADER ──────────────────────────────────────────────────────── -->
  <header class="bl-header" id="bl-header">
    <div class="bl-header__brand">
      <span class="bl-header__dot" aria-hidden="true">●</span>
      <span class="bl-header__wordmark">Blurry Site</span>
    </div>
    <span class="bl-header__host" id="bl-host"></span>
    <button class="bl-icon-btn" id="bl-theme-toggle" aria-label="Toggle theme" title="Toggle theme">☀</button>
    <button class="bl-icon-btn bl-icon-btn--power" id="bl-power" aria-label="Power on/off" title="Toggle Blurry Site on/off">⏻</button>
  </header>

  <!-- ── MAIN VIEW ───────────────────────────────────────────────────── -->
  <main class="bl-main" id="bl-view-main">

    <!-- SWAPPABLE MODES -->
    <section class="bl-section bl-modes" id="bl-modes">
      <div id="bl-mode-active" class="bl-mode-block bl-mode-block--active"></div>
      <div id="bl-mode-waiting" class="bl-mode-block bl-mode-block--waiting"></div>
      <button class="bl-btn-ghost bl-btn-danger bl-clear-all" id="bl-clear-all" disabled>Clear All</button>
    </section>

    <!-- HOW TO BLUR -->
    <section class="bl-section" id="bl-how-to-blur">
      <div class="bl-section__header">
        <span class="bl-section__title">How to Blur</span>
        <button class="bl-btn-text" id="bl-htb-modify">Modify →</button>
      </div>
      <div class="bl-chips" id="bl-htb-chips" role="list" aria-label="Blur type"></div>
      <div class="bl-summary" id="bl-htb-summary"></div>
    </section>

    <!-- AUTO-DETECT PII -->
    <section class="bl-section" id="bl-pii">
      <div class="bl-section__header">
        <span class="bl-section__title">Auto-Detect PII</span>
        <label class="bl-toggle" aria-label="Auto-detect PII on/off">
          <input type="checkbox" id="bl-pii-master">
          <span class="bl-toggle__track"></span>
        </label>
      </div>
      <div class="bl-chips" id="bl-pii-chips" role="list" aria-label="PII blur mode"></div>
      <p class="bl-section__hint">Detects emails and numeric patterns</p>
    </section>

    <!-- AUTOMATE -->
    <section class="bl-section" id="bl-automate">
      <div class="bl-section__header">
        <span class="bl-section__title">Automate</span>
        <button class="bl-btn-text" id="bl-automate-modify">Modify →</button>
      </div>
      <div class="bl-summary" id="bl-automate-summary"></div>
    </section>

    <!-- NAV ROWS -->
    <nav class="bl-nav-rows" aria-label="Settings">
      <button class="bl-nav-row" id="bl-nav-shortcuts">
        <span>Shortcuts</span>
        <span class="bl-nav-row__arrow" aria-hidden="true">→</span>
      </button>
      <button class="bl-nav-row" id="bl-nav-site-rules">
        <span>Site Rules</span>
        <span class="bl-nav-row__arrow" aria-hidden="true">→</span>
      </button>
    </nav>

    <!-- FOOTER -->
    <footer class="bl-footer">
      <span class="bl-footer__version" id="bl-version"></span>
      <button class="bl-footer__btn" id="bl-feedback">Feedback</button>
      <button class="bl-footer__btn" id="bl-export">Export</button>
      <button class="bl-footer__btn" id="bl-logs">Logs</button>
      <button class="bl-footer__btn" id="bl-language">Language</button>
    </footer>

  </main>

  <!-- ── SUB-PAGES ───────────────────────────────────────────────────── -->

  <div class="bl-subpage" id="bl-view-htb-modify" hidden>
    <header class="bl-subpage__header">
      <button class="bl-back-btn" data-back="main" aria-label="Back">←</button>
      <span class="bl-subpage__title">How to Blur</span>
      <span class="bl-subpage__host" id="bl-host-htb"></span>
    </header>
    <div class="bl-subpage__body" id="bl-htb-modify-body"></div>
  </div>

  <div class="bl-subpage" id="bl-view-automate-modify" hidden>
    <header class="bl-subpage__header">
      <button class="bl-back-btn" data-back="main" aria-label="Back">←</button>
      <span class="bl-subpage__title">Automate</span>
      <span class="bl-subpage__host" id="bl-host-automate"></span>
    </header>
    <div class="bl-subpage__body" id="bl-automate-modify-body"></div>
  </div>

  <div class="bl-subpage" id="bl-view-shortcuts" hidden>
    <header class="bl-subpage__header">
      <button class="bl-back-btn" data-back="main" aria-label="Back">←</button>
      <span class="bl-subpage__title">Shortcuts</span>
      <span class="bl-subpage__host" id="bl-host-shortcuts"></span>
    </header>
    <div class="bl-subpage__body" id="bl-shortcuts-body"></div>
  </div>

  <div class="bl-subpage" id="bl-view-site-rules" hidden>
    <header class="bl-subpage__header">
      <button class="bl-back-btn" data-back="main" aria-label="Back">←</button>
      <span class="bl-subpage__title">Site Rules</span>
      <span class="bl-subpage__host" id="bl-host-site-rules"></span>
    </header>
    <div class="bl-subpage__body" id="bl-site-rules-body"></div>
  </div>

  <!-- Scripts: constants → logger → action_registry → storage_manager → popup -->
  <script src="../src/constants.js"></script>
  <script src="../src/logger.js"></script>
  <script src="../src/action_registry.js"></script>
  <script src="../src/storage_manager.js"></script>
  <script src="popup.js"></script>

</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html
git commit -m "feat: popup HTML scaffold — full section structure per design spec §12"
```

---

### Task 7: Create popup/popup.css

**Files:**
- Create: `popup/popup.css`

All styles use `--bl-*` tokens from `theme.css`. No hardcoded colors. Class names all prefixed `bl-`.

- [ ] **Step 1: Create popup/popup.css**

```css
/* ── Reset ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Base ───────────────────────────────────────────────────────────── */
html, body {
  position: relative;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  width: 360px;
  background: var(--bl-base);
  color: var(--bl-text-primary);
  line-height: 1.5;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.bl-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--bl-surface);
  border-bottom: 1px solid var(--bl-raised);
  flex-shrink: 0;
}

.bl-header__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
  color: var(--bl-amber);
  flex: 1;
  min-width: 0;
}

.bl-header__dot { font-size: 8px; }

.bl-header__host,
.bl-subpage__host {
  font-size: 11px;
  color: var(--bl-text-muted);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Icon buttons ───────────────────────────────────────────────────── */
.bl-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--bl-text-muted);
  border-radius: 7px;
  font-size: 14px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.bl-icon-btn:hover { color: var(--bl-text-primary); background: var(--bl-raised); }

.bl-icon-btn--power { color: var(--bl-amber); }
.bl-icon-btn--power:hover { background: var(--bl-raised); }
.bl-icon-btn--power.is-off { color: var(--bl-text-muted); }

/* ── Main scroll area ───────────────────────────────────────────────── */
.bl-main {
  overflow-y: auto;
  max-height: 540px;
}

/* ── Sections ───────────────────────────────────────────────────────── */
.bl-section {
  padding: 12px 14px;
  border-bottom: 1px solid var(--bl-raised);
}

.bl-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.bl-section__title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--bl-text-dim);
}

.bl-section__hint {
  font-size: 11px;
  color: var(--bl-text-muted);
  margin-top: 6px;
}

/* ── Swappable modes section ────────────────────────────────────────── */
.bl-modes {
  position: relative;
  padding-bottom: 44px;
}

.bl-mode-block {
  background: var(--bl-surface);
  border: 1px solid var(--bl-raised);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
  min-height: 60px;
}

.bl-mode-block--waiting {
  opacity: 0.45;
}

.bl-clear-all {
  position: absolute;
  bottom: 12px;
  right: 14px;
}

/* ── Chips ──────────────────────────────────────────────────────────── */
.bl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bl-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--bl-raised);
  background: var(--bl-raised);
  color: var(--bl-text-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.bl-chip:hover { color: var(--bl-text-primary); }

.bl-chip--active {
  color: var(--bl-text-primary);
  border-color: var(--bl-amber);
  background: color-mix(in srgb, var(--bl-amber) 12%, var(--bl-raised));
}

.bl-chip--sky.bl-chip--active {
  border-color: var(--bl-sky);
  background: color-mix(in srgb, var(--bl-sky) 12%, var(--bl-raised));
}

/* ── Summary rows ────────────────────────────────────────────────────── */
.bl-summary {
  font-size: 12px;
}

.bl-summary-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 0;
}

.bl-summary-row__label { color: var(--bl-text-dim); font-size: 11px; }
.bl-summary-row__value { color: var(--bl-text-primary); }
.bl-summary-row__value--off { color: var(--bl-text-muted); }

/* ── Toggle switch ──────────────────────────────────────────────────── */
.bl-toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}
.bl-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }

.bl-toggle__track {
  position: relative;
  width: 34px;
  height: 18px;
  background: var(--bl-raised);
  border-radius: 9px;
  border: 1px solid transparent;
  transition: background 0.2s, border-color 0.2s;
}

.bl-toggle__track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--bl-text-muted);
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.bl-toggle input:checked + .bl-toggle__track {
  background: var(--bl-amber);
  border-color: var(--bl-amber);
}
.bl-toggle input:checked + .bl-toggle__track::after {
  transform: translateX(16px);
  background: var(--bl-base);
}

/* ── Nav rows ────────────────────────────────────────────────────────── */
.bl-nav-rows { border-bottom: 1px solid var(--bl-raised); }

.bl-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 11px 14px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--bl-raised);
  cursor: pointer;
  color: var(--bl-text-primary);
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
}
.bl-nav-row:last-child { border-bottom: none; }
.bl-nav-row:hover { background: var(--bl-surface); }

.bl-nav-row__arrow { color: var(--bl-text-dim); font-size: 12px; }

/* ── Footer ──────────────────────────────────────────────────────────── */
.bl-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  flex-wrap: wrap;
}

.bl-footer__version {
  font-size: 10px;
  color: var(--bl-text-dim);
  margin-right: 4px;
}

.bl-footer__btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--bl-text-muted);
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.bl-footer__btn:hover { color: var(--bl-text-primary); background: var(--bl-raised); }

/* ── Buttons ─────────────────────────────────────────────────────────── */
.bl-btn-text {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--bl-text-muted);
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
  flex-shrink: 0;
}
.bl-btn-text:hover { color: var(--bl-text-primary); }

.bl-btn-ghost {
  background: none;
  border: 1px solid var(--bl-raised);
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  padding: 4px 10px;
  color: var(--bl-text-muted);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.bl-btn-ghost:hover:not(:disabled) {
  border-color: var(--bl-text-muted);
  color: var(--bl-text-primary);
}
.bl-btn-ghost:disabled { opacity: 0.3; cursor: not-allowed; }

.bl-btn-danger {
  color: var(--bl-danger);
  border-color: color-mix(in srgb, var(--bl-danger) 25%, transparent);
}
.bl-btn-danger:hover:not(:disabled) {
  color: var(--bl-danger);
  border-color: var(--bl-danger);
  background: color-mix(in srgb, var(--bl-danger) 8%, transparent);
}

/* ── Sub-pages ───────────────────────────────────────────────────────── */
.bl-subpage {
  position: absolute;
  inset: 0;
  background: var(--bl-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.bl-subpage[hidden] { display: none; }

.bl-subpage__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bl-surface);
  border-bottom: 1px solid var(--bl-raised);
  flex-shrink: 0;
}

.bl-subpage__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--bl-text-primary);
  flex: 1;
}

.bl-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--bl-text-muted);
  font-size: 16px;
  border-radius: 7px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}
.bl-back-btn:hover { color: var(--bl-text-primary); background: var(--bl-raised); }

.bl-subpage__body {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1;
}
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.css
git commit -m "feat: popup structural styles consuming Slate token system"
```

---

### Task 8: Create popup/popup.js loading stub

**Files:**
- Create: `popup/popup.js`

This stub does the minimum needed to open the popup without errors:
- Applies saved theme on load
- Displays hostname and version
- Wires power toggle + theme toggle
- Enables sub-page navigation (back buttons + nav rows + Modify buttons)

No section rendering — that's Plans 2 and 3.

- [ ] **Step 1: Create popup/popup.js**

```js
const BlurrySitePopup = (() => {
  'use strict';

  let _settings = null;

  // ── Theme ──────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    const btn = document.getElementById('bl-theme-toggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀';
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ blsi_popup_theme: next });
  }

  // ── Host display ────────────────────────────────────────────────────────
  function setHost(hostname) {
    document.querySelectorAll('.bl-header__host, .bl-subpage__host').forEach((el) => {
      el.textContent = hostname || '';
    });
  }

  // ── Version ─────────────────────────────────────────────────────────────
  function setVersion() {
    const el = document.getElementById('bl-version');
    if (el) el.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // ── Power button ────────────────────────────────────────────────────────
  function renderPowerButton(enabled) {
    const btn = document.getElementById('bl-power');
    if (!btn) return;
    btn.classList.toggle('is-off', !enabled);
    btn.title = enabled ? 'Disable Blurry Site' : 'Enable Blurry Site';
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  const SUB_VIEWS = [
    'bl-view-htb-modify',
    'bl-view-automate-modify',
    'bl-view-shortcuts',
    'bl-view-site-rules',
  ];

  function showView(viewId) {
    const isMain = viewId === 'bl-view-main';
    document.getElementById('bl-view-main').hidden = !isMain;
    for (const id of SUB_VIEWS) {
      document.getElementById(id).hidden = id !== viewId;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    // Theme persisted separately so it survives settings resets
    chrome.storage.local.get('blsi_popup_theme', (data) => {
      applyTheme(data.blsi_popup_theme || 'dark');
    });

    setVersion();

    // Hostname from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.url) {
        try { setHost(new URL(tab.url).hostname); } catch (_) {}
      }
    });

    // Load settings
    _settings = await blsi.Storage.getSettings();
    renderPowerButton(_settings.ENABLED);

    // ── Event listeners ───────────────────────────────────────────────────
    document.getElementById('bl-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('bl-power').addEventListener('click', async () => {
      _settings.ENABLED = !_settings.ENABLED;
      await blsi.Storage.saveSettings(_settings);
      renderPowerButton(_settings.ENABLED);
      // Notify active tab to apply or tear down
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: blsi.POPUP.UPDATE_SETTINGS,
            settings: _settings,
          });
        }
      });
    });

    // Sub-page navigation
    document.getElementById('bl-htb-modify').addEventListener('click', () => showView('bl-view-htb-modify'));
    document.getElementById('bl-automate-modify').addEventListener('click', () => showView('bl-view-automate-modify'));
    document.getElementById('bl-nav-shortcuts').addEventListener('click', () => showView('bl-view-shortcuts'));
    document.getElementById('bl-nav-site-rules').addEventListener('click', () => showView('bl-view-site-rules'));

    // Back buttons
    document.querySelectorAll('.bl-back-btn').forEach((btn) => {
      btn.addEventListener('click', () => showView('bl-view-main'));
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showView };
})();
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.js
git commit -m "feat: popup.js loading stub — theme, power, navigation, host/version display"
```

---

### Task 9: Smoke-test the popup

Manual verification — no automated test possible for extension popup UI.

- [ ] **Step 1: Load the extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked" → select the project root (`/Users/keshava-13944/blurrysite`)
4. The extension should load without errors

- [ ] **Step 2: Open the popup**

Click the Blurry Site icon in the toolbar. Expected:
- Dark background (`#0a0b0f`)
- Amber "● Blurry Site" brand in header
- Hostname of current tab displayed (or empty for `chrome://` pages)
- Version number in footer (e.g. "v1.x.x")
- ☀ theme toggle button visible
- ⏻ power button visible in amber
- 5 empty section areas visible (Swappable Modes, How to Blur, PII, Automate, Nav rows)
- Footer with Feedback/Export/Logs/Language buttons

- [ ] **Step 3: Test theme toggle**

Click ☀. Expected: popup switches to light mode (pale grey background `#f8f9fc`, dark text). Click 🌙. Expected: returns to dark mode. Reload popup — theme persists.

- [ ] **Step 4: Test power toggle**

Click ⏻. Expected: power button gains `is-off` class (color shifts to muted). Settings ENABLED=false saved. Click again — returns to amber.

- [ ] **Step 5: Test sub-page navigation**

Click "Modify →" in How to Blur. Expected: main view hides, sub-page "How to Blur" header appears. Click ←. Expected: returns to main view. Repeat for Automate Modify, Shortcuts, Site Rules.

- [ ] **Step 6: Check DevTools console for errors**

Right-click popup → Inspect. Console should show zero errors. Warnings about empty blsi.Storage calls are acceptable.

- [ ] **Step 7: Run unit tests one final time to confirm nothing regressed**

```bash
npm run test:unit
```

Expected: all tests pass.

---

## Self-Review

### 1. Spec Coverage

| Spec section | Covered by |
|---|---|
| §2 Color Scheme — Slate | Task 5 (theme.css) |
| §3 Header (brand, host, theme, power) | Task 6 (HTML) + Task 8 (popup.js) |
| §4 Swappable Modes — HTML shells | Task 6 (HTML) — rendering deferred to Plan 2 |
| §5 How to Blur — HTML shell + Modify nav | Task 6 (HTML) + Task 8 (popup.js) |
| §7 PII — HTML shell | Task 6 (HTML) — rendering deferred to Plan 2 |
| §8 Automate — HTML shell + Modify nav | Task 6 (HTML) + Task 8 (popup.js) |
| §9 Nav Rows | Task 6 (HTML) + Task 8 (popup.js) |
| §10 Footer | Task 6 (HTML) |
| §11 Sub-pages (all 4 shells) | Task 6 (HTML) + Task 8 (popup.js) |
| §12 Layout order | Task 6 (HTML) |
| New settings keys (ACTIVE_MODE etc.) | Tasks 2–4 (constants.js) |

**Not in Plan 1 (deferred to Plans 2 and 3):**
- Mode block rendering (Blur All card, Pick & Blur card, empty state)
- How to Blur chips + summary rendering
- PII chips + master toggle wiring
- Automate summary rendering
- All sub-page content
- Picker toolbar (Plan 3)
- Color mode (Plan 3)
- Site Rules sub-page content (Plan 3)

### 2. Placeholder scan

No TBDs, TODOs, or "implement later" in any task. All code is complete. ✓

### 3. Type consistency

- `blsi.ACTIVE_MODES.BLUR_ALL` = `'blur-all'` — used consistently across Tasks 2, 3, 4.
- `blsi.PICK_BLUR_MODES` — same object referenced in validateSettings fallback and tests.
- `showView(viewId)` — called with string IDs in Task 8, defined in Task 8. ✓
- `blsi.Storage.getSettings()` / `blsi.Storage.saveSettings()` — existing API, unchanged. ✓
- `blsi.POPUP.UPDATE_SETTINGS` — existing message type in constants.js. ✓
