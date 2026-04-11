# Plan: Reactive Storage with Diff-Based Repaint

**Date:** 2026-04-10
**Depends on:** Phase 1 of plan-message-audit.md (complete)
**Goal:** Make storage_manager.js the single source of truth with local cache, diff-based `onChanged`, and eliminate scorched-earth repaint.

---

## Core Design

### Principle

Storage is the authority. Every writer (popup, content_script, other tabs) writes to `chrome.storage.local` via `Store.*` methods. `storage_manager.js` maintains a **synchronous local cache** of every storage key. On `chrome.storage.onChanged`:

1. Compare `newValue` against cache
2. If same → self-echo, skip
3. If different → update cache, call subscriber with `(key, newValue, oldValue)`

Consumers (content_script, popup) subscribe once and receive only real changes.

### Why synchronous cache update on write

When `Store.saveBlurState(hostname, true)` is called:
1. Update `_cache.blur_all_hosts` **synchronously, before the async `chrome.storage.local.set`**
2. Then write to storage
3. When `onChanged` fires back, `newValue === cache` → self-echo detected → skip

The synchronous update ensures the cache is always ahead of or equal to the `onChanged` callback. No timer, no flag, no race.

---

## storage_manager.js Changes

### New internal state

```js
// Local cache — mirrors chrome.storage.local for this extension
let _cache = {
  settings: null,        // full settings object
  rules: null,           // array of URL rules
  blurred_items: null,   // { hostname: [items] } map
  blur_all_hosts: null,  // { hostname: true } map
};

// Subscriber
let _onChange = null;
```

### New public API

```js
// Subscribe to real (non-echo) storage changes
function onChange(callback) {
  // callback(key, newValue, oldValue)
  _onChange = callback;
}

// Synchronous read from cache (no storage I/O)
function getCachedBlurState(hostname) {
  const hosts = _cache.blur_all_hosts || {};
  return !!hosts[hostname];
}

// Initialize cache from storage (called once at startup)
async function initCache() {
  const result = await _storageGet(null); // get everything
  _cache.settings = result.settings || null;
  _cache.rules = result.rules || null;
  _cache.blurred_items = result.blurred_items || null;
  _cache.blur_all_hosts = result.blur_all_hosts || null;
}
```

### Modified write methods

Every write method updates `_cache` synchronously before calling `_storageSet`:

```js
async function saveBlurState(hostname, blurAll) {
  if (!hostname || !_isValidHostname(hostname)) return;

  // 1. Update cache synchronously
  const hosts = _cache.blur_all_hosts ? { ..._cache.blur_all_hosts } : {};
  if (blurAll) {
    hosts[hostname] = true;
  } else {
    delete hosts[hostname];
  }
  _cache.blur_all_hosts = hosts;

  // 2. Write to storage (async)
  await _storageSet({ blur_all_hosts: hosts });
}
```

Same pattern for `saveBlurItem`, `removeBlurItem`, `clearHost`, `clearAll`, `saveSettings`, `saveRules`.

### Modified read methods

Reads populate cache on miss:

```js
async function getSettings() {
  if (_cache.settings !== null) {
    // Return merged+validated from cache
    return MSG.validateSettings(MSG.deepMerge(MSG.DEFAULT_SETTINGS, _cache.settings));
  }
  const result = await _storageGet('settings');
  const saved = result.settings || {};
  _cache.settings = saved;
  return MSG.validateSettings(MSG.deepMerge(MSG.DEFAULT_SETTINGS, saved));
}
```

### `onChanged` listener (inside storage_manager IIFE)

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  for (const key of Object.keys(changes)) {
    if (!(key in _cache)) continue; // not a key we track

    const newValue = changes[key].newValue;
    const oldValue = _cache[key];

    // Deep compare — if cache matches newValue, this is our own write
    if (_deepEqual(oldValue, newValue)) continue;

    // Real change from another source — update cache and notify
    const prevValue = oldValue;
    _cache[key] = newValue !== undefined ? newValue : null;

    if (_onChange) {
      _onChange(key, _cache[key], prevValue);
    }
  }
});
```

### `_deepEqual` helper

Simple JSON comparison (our data is plain objects/arrays, no functions/dates):

```js
function _deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
```

---

## content_script.js Changes

### Remove

- `_ownStorageWrite` flag + setTimeout (lines 41, 65-66)
- `chrome.storage.onChanged` listener (lines 1033-1059)
- `UPDATE_SETTINGS` message handler (lines 786-806)
- `UNBLUR_ITEM` message handler (lines 850-856)
- `RESTORE` message handler (lines 771-776) — `init()` + `onChanged` covers this
- `CLEAR_ALL_BLUR` message handler (lines 760-768) — storage writes + `onChanged` covers this
- Scorched-earth `repaint()` function (lines 63-162)

### Replace with

#### 1. Init: populate cache, apply initial state

```js
async function init() {
  await Store.initCache();
  settings = await Store.getSettings();
  rules = await Store.getRules();
  // ... existing init code (applySettingsToDom, shortcuts, etc.) ...

  // Initial blur restore (replaces RESTORE message)
  await applyBlurState();

  // Subscribe to storage changes
  Store.onChange(handleStorageChange);
}
```

#### 2. Single `handleStorageChange(key, newValue, oldValue)` handler

```js
function handleStorageChange(key, newValue, oldValue) {
  switch (key) {
    case 'settings':
      onSettingsChanged(newValue);
      break;
    case 'rules':
      onRulesChanged(newValue);
      break;
    case 'blurred_items':
      onBlurItemsChanged(newValue, oldValue);
      break;
    case 'blur_all_hosts':
      onBlurAllChanged(newValue);
      break;
  }
}
```

#### 3. Diff-based handlers

**Settings changed:**
```js
function onSettingsChanged(newRawSettings) {
  const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
  globalSettings = MSG.deepMerge(MSG.DEFAULT_SETTINGS, newRawSettings || {});
  const resolved = resolveSettings(location.href, globalSettings, rules);
  applyState(resolved, prev);
  // applyState already handles: CSS vars, shortcuts, picker, blur-all re-render if needed
}
```

**Rules changed:**
```js
function onRulesChanged(newRules) {
  const prev = { ...settings, BLUR_CATEGORIES: { ...settings.BLUR_CATEGORIES } };
  rules = newRules || [];
  const resolved = resolveSettings(location.href, globalSettings, rules);
  applyState(resolved, prev);
}
```

**Blur items changed (diff-based — the big win):**
```js
function onBlurItemsChanged(newMap, oldMap) {
  const newItems = (newMap || {})[hostname] || [];
  const oldItems = (oldMap || {})[hostname] || [];

  // Quick check: if this host's items didn't change, skip entirely
  if (JSON.stringify(newItems) === JSON.stringify(oldItems)) return;

  // Build lookup sets by item ID
  const oldById = new Map(oldItems.map(i => [_itemId(i), i]));
  const newById = new Map(newItems.map(i => [_itemId(i), i]));

  // Removed items: in old but not in new
  for (const [id, item] of oldById) {
    if (!newById.has(id)) {
      if (item.type === 'dynamic') {
        try {
          const el = Selector.restoreSelector(item.selector);
          if (el) Engine.removeBlur(el);
        } catch (_) {}
      } else if (item.type === 'sticky') {
        Engine.removeZoneOverlay(item.id);
      }
    }
  }

  // Added items: in new but not in old
  for (const [id, item] of newById) {
    if (!oldById.has(id)) {
      if (item.type === 'dynamic') {
        try {
          const el = Selector.restoreSelector(item.selector);
          if (el) Engine.applyBlur(el);
        } catch (_) {}
      } else if (item.type === 'sticky') {
        // createZoneOverlay with coordinate calc
        _restoreStickyItem(item);
      }
    }
  }

  // Update counters
  _recountItems(newItems);
}
```

**Blur-all state changed (diff-based):**
```js
function onBlurAllChanged(newHosts) {
  const wasActive = isPageBlurred;
  const nowActive = !!((newHosts || {})[hostname]);

  if (wasActive === nowActive) return; // no change for this host

  if (nowActive && !wasActive) {
    // Turning ON blur-all
    Engine.injectBlurRules(settings.BLUR_CATEGORIES, settings.BLUR_MODE);
    Engine.blurTextCheckElements(settings.BLUR_CATEGORIES, settings.THOROUGH_BLUR);
    startDomObserver();
    isPageBlurred = true;
  } else if (!nowActive && wasActive) {
    // Turning OFF blur-all
    Engine.removeBlurRules();
    // Remove only text-check stamps (individual picker blurs stay)
    _removeBlurAllStamps();
    stopDomObserver();
    isPageBlurred = false;
  }
}
```

### Simplified message handlers (4 remaining)

```js
case MSG.TOGGLE_BLUR_ALL: {
  // Just flip storage — onChanged handles the rest
  const current = Store.getCachedBlurState(hostname);
  Store.saveBlurState(hostname, !current);
  // No repaint call, no sendResponse needed
  break;
}

case MSG.TOGGLE_PICKER: { /* unchanged — purely in-memory */ }
case MSG.GET_STATUS: { /* unchanged — reads in-memory state */ }
case MSG.CONTEXT_BLUR: { /* unchanged — needs lastContextMenuTarget */ }
case MSG.CONTEXT_UNBLUR: { /* unchanged — needs lastContextMenuTarget */ }
```

`CLEAR_ALL_BLUR` is removed — popup calls `Store.clearHost()` + `Store.saveBlurState(hostname, false)` directly, both trigger `onChanged`.

---

## popup.js Changes

### Remove

- `chrome.storage.onChanged` listener (the `setupStorageListener` function)
- `TOGGLE_BLUR_ALL` tabMessage call (replaced by direct storage write)
- `CLEAR_ALL_BLUR` tabMessage call (replaced by direct storage write)
- `UNBLUR_ITEM` tabMessage call (removed — storage change triggers content_script)
- `UPDATE_SETTINGS` tabMessage calls (removed — storage change triggers content_script)

### Replace with

```js
// Subscribe to storage changes for UI updates
Store.onChange((key, newValue, oldValue) => {
  if (key === 'settings') {
    settings = MSG.validateSettings(MSG.deepMerge(MSG.DEFAULT_SETTINGS, newValue || {}));
    renderHeader();
    Renderer.updateAll(settings);
    document.documentElement.style.setProperty('--bl-si-bg-blur-radius', settings.BLUR_RADIUS + 'px');
  }
  if (key === 'rules') {
    urlRules = newValue || [];
    renderRulesList();
  }
  if (key === 'blurred_items') {
    blurredItems = (newValue || {})[currentHost] || [];
    renderBlurCount();
    renderBlurList();
  }
});
```

### Simplified button handlers

```js
// Blur All — just flip storage
ui.blurAllBtn.addEventListener('click', async () => {
  if (!currentHost) return;
  const current = Store.getCachedBlurState(currentHost);
  await Store.saveBlurState(currentHost, !current);
  // onChanged updates isPageBlurred via content_script, popup re-reads via its own onChange
});

// Clear All — just clear storage
ui.clearAllBtn.addEventListener('click', async () => {
  if (!currentHost) return;
  await Store.clearHost(currentHost);
  await Store.saveBlurState(currentHost, false);
  // onChanged handles everything
});

// Remove blur item — just remove from storage
ui.blurList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.bl-si-blur-item__remove');
  if (!btn) return;
  await Store.removeBlurItem(currentHost, btn.dataset.itemId);
  // onChanged handles repaint + popup list update
});
```

No more `tabMessage` calls for storage-driven actions. Popup still needs `tabMessage` for:
- `GET_STATUS` (reads in-memory state from content_script)
- `TOGGLE_PICKER` (in-memory DOM state)

---

## Messages: Before vs After

### Before (9 content_script handlers)

`TOGGLE_BLUR_ALL`, `TOGGLE_PICKER`, `CLEAR_ALL_BLUR`, `RESTORE`, `UPDATE_SETTINGS`, `GET_STATUS`, `CONTEXT_BLUR`, `CONTEXT_UNBLUR`, `UNBLUR_ITEM`

### After (4 content_script handlers)

| Message | Sender | Purpose |
|---|---|---|
| `TOGGLE_BLUR_ALL` | background.js (keyboard shortcut), popup (button) | Flips `blur_all_hosts` in storage — `onChanged` does the rest |
| `TOGGLE_PICKER` | background.js (keyboard shortcut), popup (button) | In-memory DOM state — no storage involvement |
| `GET_STATUS` | popup (init + after actions) | Returns `{ isPageBlurred, isPickerActive, blurredCount }` |
| `CONTEXT_BLUR` / `CONTEXT_UNBLUR` | background.js (right-click menu) | Needs `lastContextMenuTarget` DOM reference |

### Eliminated (5 message types)

| Message | Replaced by |
|---|---|
| `CLEAR_ALL_BLUR` | Popup calls `Store.clearHost()` + `Store.saveBlurState()` directly |
| `RESTORE` | `init()` reads cache + `onChanged` handles future changes |
| `UPDATE_SETTINGS` | Settings writes trigger `onChanged` automatically |
| `UNBLUR_ITEM` | `Store.removeBlurItem()` triggers `onChanged` |
| _(TOGGLE_BLUR_ALL stays but simplified)_ | Handler just flips storage, no repaint call |

---

## CRs Resolved by This Plan

| CR | How |
|---|---|
| CR-03 | Diff-based handlers are idempotent — concurrent calls converge to same state |
| CR-06 | `applyState` no longer calls `repaint()` fire-and-forget — blur-all changes come via `onChanged` |
| CR-07 | `_ownStorageWrite` flag eliminated — cache comparison replaces it |
| CR-13 | Popup's `_processingStorageChange` flag eliminated — replaced by `Store.onChange` |
| CR-17 | `TOGGLE_BLUR_ALL` no longer returns stale `isPageBlurred` — no response needed |
| CR-33 | Single write path (`storage_manager.js`) with synchronous cache — no dual-write divergence |
| CR-37 | No more `applyState` → `repaint` → `onChanged` → `applyState` re-entrancy — single entry point |
| CR-39 | `onChanged` gives full `newValue` — no deepMerge accumulation |
| CR-40 | `onChanged` values go through `Store.onChange` which has cache context — can validate |
| CR-43 | Self-echo eliminated by cache comparison — no redundant repaint |

---

## Implementation Order

1. **storage_manager.js**: Add `_cache`, `_deepEqual`, synchronous cache update on all writes, `onChanged` listener with cache comparison, `onChange()` / `getCachedBlurState()` / `initCache()` public API

2. **content_script.js**: Replace `repaint()` + `onChanged` listener + 5 message handlers with `handleStorageChange` + 4 diff-based handlers. Simplify `TOGGLE_BLUR_ALL` handler.

3. **popup.js**: Replace `setupStorageListener` + `tabMessage` calls for settings/blur actions with `Store.onChange` subscriber + direct storage writes.

4. **Tests**: Update storage_manager tests for cache behavior + new API surface.

5. **Docs**: Update CLAUDE.md message protocol tables, HLD.md, plan-message-audit.md.

---

## Risk: `_deepEqual` via `JSON.stringify`

`JSON.stringify` comparison works for our data (plain objects, arrays, strings, numbers, booleans). No functions, no circular refs, no Dates. For `blurred_items` with 10 items per host × 20 hosts, stringify is ~2KB — negligible cost per `onChanged` event.

Edge case: key ordering. `JSON.stringify({a:1, b:2}) !== JSON.stringify({b:2, a:1})`. Our writes always produce consistent key order (same code paths), so this is safe for self-echo detection. Cross-tab changes from different code versions could theoretically differ in key order — but this would just cause a redundant (harmless, idempotent) diff-apply.
