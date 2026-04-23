'use strict';

// Shared performance metric utilities for the BlurrySite perf test suite.
//
// Usage in test files:
//   const { setupWebVitals, collectHeap, summarize, waitForBlurred, waitForPii, waitForClass, waitForAttr } = require('../shared/metrics');

// ---------------------------------------------------------------------------
// setupWebVitals(page)
//
// MUST be called before page.goto(). Injects a PerformanceObserver into the
// page that records FCP, LCP, and cumulative CLS. Returns a collector
// function that the test calls after navigation + settle to read the values.
//
// Pattern:
//   const collectVitals = await setupWebVitals(page);
//   await page.goto(url);
//   await page.waitForLoadState('load');
//   const vitals = await collectVitals();   // { fcp, lcp, cls }
// ---------------------------------------------------------------------------
async function setupWebVitals(page) {
  await page.addInitScript(() => {
    window.__perfMetrics = { fcp: null, lcp: null, cls: 0 };
    window.__interactions = [];

    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') {
          window.__perfMetrics.fcp = entry.startTime;
        }
        if (entry.entryType === 'largest-contentful-paint') {
          // LCP is emitted multiple times; keep the latest (largest startTime)
          window.__perfMetrics.lcp = entry.startTime;
        }
        if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
          window.__perfMetrics.cls += entry.value;
        }
      }
    });

    try {
      obs.observe({
        entryTypes: ['paint', 'largest-contentful-paint', 'layout-shift'],
      });
    } catch (e) {
      // Browser may not support all entry types — degrade gracefully
    }

    // event-timing for INP (Interaction to Next Paint). durationThreshold:0 captures
    // all events, not just those >104ms, so we can compute our own INP from the max.
    try {
      const evtObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'event') {
            window.__interactions.push({
              type:       entry.name,
              duration:   Math.round(entry.duration),
              delay:      Math.round(entry.processingStart - entry.startTime),
              processing: Math.round(entry.processingEnd   - entry.processingStart),
            });
          }
        }
      });
      evtObs.observe({ type: 'event', buffered: true, durationThreshold: 0 });
    } catch (_) {
      // event-timing not supported — skip INP
    }
  });

  // Return the collector. Tests call this after navigation + settle.
  return async function collect() {
    // Give the browser a moment to flush any pending PerformanceObserver callbacks.
    await page.waitForTimeout(1000);
    return page.evaluate(() => {
      const m = window.__perfMetrics || { fcp: null, lcp: null, cls: 0 };
      // INP = 98th-percentile interaction duration across all event-timing entries
      const durations = (window.__interactions || []).map((e) => e.duration);
      if (durations.length > 0) {
        const sorted = [...durations].sort((a, b) => a - b);
        const idx = Math.min(Math.ceil(sorted.length * 0.98) - 1, sorted.length - 1);
        m.inp = sorted[idx];
        m.inp_count = sorted.length;
      } else {
        m.inp = null;
        m.inp_count = 0;
      }
      return m;
    });
  };
}

// ---------------------------------------------------------------------------
// collectHeap(page)
//
// Forces a GC cycle via CDP before reading JS heap usage, eliminating the
// ±10-20 MB noise from pending allocations. Chrome only — returns null on
// other browsers or if CDP session cannot be established.
//
// Returns: { used: number, total: number } | null
// ---------------------------------------------------------------------------
async function collectHeap(page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    await session.detach();
  } catch (_) {
    // CDP unavailable (non-Chrome or incognito restrictions) — proceed without GC
  }
  return page.evaluate(() => {
    if (!performance.memory) return null;
    return {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
    };
  });
}

// ---------------------------------------------------------------------------
// summarize(arr)
//
// Computes descriptive statistics over an array of numbers (e.g. timing
// samples). All values are returned as integers (Math.round applied to mean).
//
// Returns: { n, min, p50, p95, max, mean }
// ---------------------------------------------------------------------------
function summarize(arr) {
  if (!arr || arr.length === 0) {
    return { min: 0, p50: 0, p95: 0, max: 0, mean: 0, n: 0 };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: Math.round(arr.reduce((s, v) => s + v, 0) / n),
    p50: sorted[Math.min(Math.ceil(n * 0.50) - 1, n - 1)],
    p95: sorted[Math.min(Math.ceil(n * 0.95) - 1, n - 1)],
  };
}

// ---------------------------------------------------------------------------
// waitForBlurred(page, minCount, opts?)
//
// Polls until at least `minCount` elements carry the `.bl-si-blurred` class.
// The timer (t0) is captured at call time, so call this BEFORE triggering the
// blur action — then trigger, then await the returned promise. This ensures t0
// precedes the storage.onChanged propagation to the content script.
//
// Returns: { count: number, durationMs: number }
//
// opts:
//   timeout  — ms to wait before rejecting (default 15 000)
// ---------------------------------------------------------------------------
async function waitForBlurred(page, minCount, opts) {
  const timeout = (opts && opts.timeout) != null ? opts.timeout : 15000;

  // Capture t0 inside the page so the timer is not affected by the
  // Node↔Chrome IPC round-trip on the return path.
  const t0 = await page.evaluate(() => performance.now());

  await page.waitForFunction(
    (min) => document.querySelectorAll('.bl-si-blurred').length >= min,
    minCount,
    { timeout, polling: 4 }
  );

  return page.evaluate((startTime, min) => ({
    count: document.querySelectorAll('.bl-si-blurred').length,
    durationMs: Math.round(performance.now() - startTime),
  }), t0, minCount);
}

// ---------------------------------------------------------------------------
// waitForPii(page, minCount, opts?)
//
// Same as waitForBlurred but waits for elements carrying the
// [data-bl-si-pii] attribute (PII detection output).
//
// Returns: { count: number, durationMs: number }
// ---------------------------------------------------------------------------
async function waitForPii(page, minCount, opts) {
  const timeout = (opts && opts.timeout) != null ? opts.timeout : 15000;

  const t0 = await page.evaluate(() => performance.now());

  await page.waitForFunction(
    (min) => document.querySelectorAll('[data-bl-si-pii]').length >= min,
    minCount,
    { timeout, polling: 4 }
  );

  return page.evaluate((startTime, min) => ({
    count: document.querySelectorAll('[data-bl-si-pii]').length,
    durationMs: Math.round(performance.now() - startTime),
  }), t0, minCount);
}

// ---------------------------------------------------------------------------
// waitForClass(page, selector, className, opts?)
//
// Waits until the first element matching `selector` has `className` in its
// classList. Useful for state transitions like picker activation
// ('bl-si-picker-active' on <html>).
//
// Returns: { durationMs: number }
//
// opts:
//   timeout  — ms to wait before rejecting (default 10 000)
// ---------------------------------------------------------------------------
async function waitForClass(page, selector, className, opts) {
  const timeout = (opts && opts.timeout) != null ? opts.timeout : 10000;

  const t0 = await page.evaluate(() => performance.now());

  await page.waitForFunction(
    ({ sel, cls }) => {
      const el = document.querySelector(sel);
      return el !== null && el.classList.contains(cls);
    },
    { sel: selector, cls: className },
    { timeout, polling: 4 }
  );

  const durationMs = await page.evaluate(
    (startTime) => Math.round(performance.now() - startTime),
    t0
  );

  return { durationMs };
}

// ---------------------------------------------------------------------------
// waitForAttr(page, selector, attrName, opts?)
//
// Waits until the first element matching `selector` has the attribute
// `attrName` present (i.e. hasAttribute returns true). Useful for reveal
// state checks (data-bl-si-reveal).
//
// Returns: { durationMs: number }
//
// opts:
//   timeout  — ms to wait before rejecting (default 10 000)
// ---------------------------------------------------------------------------
async function waitForAttr(page, selector, attrName, opts) {
  const timeout = (opts && opts.timeout) != null ? opts.timeout : 10000;

  const t0 = await page.evaluate(() => performance.now());

  await page.waitForFunction(
    ({ sel, attr }) => {
      const el = document.querySelector(sel);
      return el !== null && el.hasAttribute(attr);
    },
    { sel: selector, attr: attrName },
    { timeout, polling: 4 }
  );

  const durationMs = await page.evaluate(
    (startTime) => Math.round(performance.now() - startTime),
    t0
  );

  return { durationMs };
}

// ---------------------------------------------------------------------------
// collectNavTiming(page)
//
// Reads PerformanceNavigationTiming for DCL and load event end.
//
// Returns: { dcl: number|null, load: number|null }
// ---------------------------------------------------------------------------
async function collectNavTiming(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('navigation');
    if (!entries || !entries[0]) return { dcl: null, load: null };
    const nav = entries[0];
    return {
      dcl:  Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
    };
  });
}

// ---------------------------------------------------------------------------
// collectDomNodes(page)
//
// Counts all DOM nodes in the page.
//
// Returns: number
// ---------------------------------------------------------------------------
async function collectDomNodes(page) {
  return page.evaluate(() => document.querySelectorAll('*').length);
}

// ---------------------------------------------------------------------------
// trackContentScriptReady(page)
//
// Must be called BEFORE page.goto(). Injects an init script that listens for
// the 'bl-si-ready' custom event dispatched by content_script.js at the end
// of its init() function and sets window.__blsiReady = true.
//
// Call waitForContentScript(page) after goto() to block until the signal fires.
// ---------------------------------------------------------------------------
async function trackContentScriptReady(page) {
  await page.addInitScript(() => {
    window.__blsiReady = false;
    document.addEventListener('bl-si-ready', () => { window.__blsiReady = true; }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// waitForContentScript(page, opts?)
//
// Waits until content_script.js has fully initialized (bl-si-ready fired).
// Replaces fixed waitForTimeout(1000/1500) guesses after page.goto().
//
// opts:
//   timeout — ms before rejecting (default 15 000)
// ---------------------------------------------------------------------------
async function waitForContentScript(page, opts) {
  const timeout = (opts && opts.timeout) != null ? opts.timeout : 15000;
  await page.waitForFunction(() => window.__blsiReady === true, { timeout, polling: 4 });
}

// ---------------------------------------------------------------------------
// measureStoragePropagation(page, trigger, waitFn)
//
// Measures the round-trip from the moment trigger() is called (a function that
// fires a storage change) to the moment an observable DOM effect appears.
//
// trigger — async function to call (e.g. () => setModel(sw, patch))
// waitFn  — async function that returns a promise resolving when effect visible
//            (e.g. () => waitForBlurred(page, 1))
//
// Returns: { durationMs, t0_to_trigger_ms }
// ---------------------------------------------------------------------------
async function measureStoragePropagation(page, trigger, waitFn) {
  const t0 = await page.evaluate(() => performance.now());
  const effectPromise = waitFn();
  await trigger();
  const result = await effectPromise;
  return result; // { durationMs } from waitFn
}

// ---------------------------------------------------------------------------
// computeHeapSlope(heapSamples)
// heapSamples — array of heap MB values (one per iteration)
// Returns slope in MB/iteration via least-squares linear regression, rounded to 3 dp.
// ---------------------------------------------------------------------------
function computeHeapSlope(heapSamples) {
  const n = heapSamples.filter((v) => v != null).length;
  if (n < 2) return null;
  const valid = heapSamples.map((v, i) => ({ x: i, y: v })).filter((p) => p.y != null);
  const xMean = valid.reduce((s, p) => s + p.x, 0) / valid.length;
  const yMean = valid.reduce((s, p) => s + p.y, 0) / valid.length;
  const num   = valid.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0);
  const den   = valid.reduce((s, p) => s + (p.x - xMean) ** 2, 0);
  if (den === 0) return 0;
  return Math.round((num / den) * 1000) / 1000;
}

module.exports = {
  setupWebVitals,
  collectHeap,
  summarize,
  waitForBlurred,
  waitForPii,
  waitForClass,
  waitForAttr,
  collectNavTiming,
  collectDomNodes,
  trackContentScriptReady,
  waitForContentScript,
  measureStoragePropagation,
  computeHeapSlope,
};
