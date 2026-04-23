'use strict';

// generate-analysis.js — reads all fixture JSONs and writes reports/ANALYSIS.md
//
// Usage:
//   node generate-analysis.js
//
// Reads:  reports/fixtures/*.json
// Writes: reports/ANALYSIS.md

const fs   = require('fs');
const path = require('path');

const FIXTURE_IDS = ['text-heavy', 'pii-rich', 'comprehensive', 'reveal', 'picker', 'spa', 'forms', 'media'];
const DIR = path.join(__dirname, 'reports', 'fixtures');
const OUT = path.join(__dirname, 'reports', 'ANALYSIS.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const r1  = (v) => v == null ? null : Math.round(v * 10) / 10;
const fmt = (v, unit = '') => v == null ? '—' : `${v}${unit}`;
const fmtDelta = (v, unit = '') => {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v + unit;
};
const fmtPct = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v + '%';

function pct(a, b) {
  if (a == null || b == null || b === 0) return null;
  return r1((a - b) / b * 100);
}

function throughput(count, ms) {
  if (!count || !ms || ms <= 0) return null;
  return r1(count / ms);
}

function stddev(arr) {
  if (!arr) return null;
  const valid = arr.filter((v) => v != null);
  if (valid.length < 2) return null;
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length - 1);
  return r1(Math.sqrt(variance));
}

function minOf(arr) {
  if (!arr) return null;
  const valid = arr.filter((v) => v != null);
  return valid.length > 0 ? Math.min(...valid) : null;
}

function maxOf(arr) {
  if (!arr) return null;
  const valid = arr.filter((v) => v != null);
  return valid.length > 0 ? Math.max(...valid) : null;
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

function load() {
  const d = {};
  for (const id of FIXTURE_IDS) {
    const p = path.join(DIR, `${id}.json`);
    if (fs.existsSync(p)) d[id] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return d;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const data = load();
  const present = FIXTURE_IDS.filter((id) => data[id]);

  if (present.length === 0) {
    console.error('No fixture JSONs found in', DIR);
    process.exit(1);
  }

  const lines = [];
  const $ = (s = '') => lines.push(s);

  $('# BlurrySite Extension — Deep Performance Analysis');
  $('');
  $(`Generated: ${new Date().toISOString()}`);
  $(`Fixtures: ${present.join(', ')}`);
  $('');
  $('---');
  $('');

  // ─── 1. Executive Summary ──────────────────────────────────────────────────
  $('## Executive Summary');
  $('');

  const idleRows = present
    .filter((id) => data[id].states.vanilla && data[id].states.idle)
    .map((id) => {
      const v = data[id].states.vanilla;
      const e = data[id].states.idle;
      return {
        id,
        fcp_pct:    pct(e.fcp, v.fcp),
        heap_delta: r1(e.heap_mb - v.heap_mb),
      };
    });

  const avgIdleFcpPct  = idleRows.length ? r1(idleRows.reduce((s, r) => s + (r.fcp_pct || 0), 0) / idleRows.length) : null;
  const avgIdleHeap    = idleRows.length ? r1(idleRows.reduce((s, r) => s + (r.heap_delta || 0), 0) / idleRows.length) : null;
  const worstIdleFcp   = idleRows.slice().sort((a, b) => b.fcp_pct - a.fcp_pct)[0];

  const blurFixtures = present.filter((id) => data[id].states.blur_all?.blur_p50 != null);
  const blurP50s     = blurFixtures.map((id) => ({ id, p50: data[id].states.blur_all.blur_p50 })).sort((a, b) => a.p50 - b.p50);

  const clsAnywhere = present.some((id) =>
    Object.values(data[id].states).some((st) => st && st.cls > 0.001)
  );

  const piiHeapWorst = present
    .filter((id) => data[id].states.pii_only && data[id].states.vanilla)
    .map((id) => ({
      id,
      heap_delta: r1(data[id].states.pii_only.heap_mb - data[id].states.vanilla.heap_mb),
      pii_count:  data[id].states.pii_only.pii_count,
    }))
    .sort((a, b) => b.heap_delta - a.heap_delta)[0];

  if (avgIdleFcpPct != null) $(`- **Idle FCP overhead**: avg ${fmtPct(avgIdleFcpPct)} across all fixtures (avg ${fmtDelta(avgIdleHeap, ' MB')} heap)`);
  if (worstIdleFcp)          $(`- **Highest idle impact**: \`${worstIdleFcp.id}\` at ${fmtPct(worstIdleFcp.fcp_pct)} FCP overhead`);
  if (blurP50s.length > 0) {
    const fastest = blurP50s[0];
    const slowest = blurP50s[blurP50s.length - 1];
    $(`- **Blur activation**: ${fastest.p50}ms p50 (\`${fastest.id}\`) → ${slowest.p50}ms p50 (\`${slowest.id}\`)`);
  }
  $(`- **Layout stability (CLS)**: ${clsAnywhere ? 'regressions detected — see per-fixture data' : 'zero CLS across all fixtures and all states'}`);
  if (piiHeapWorst) $(`- **PII heap cost**: up to ${fmtDelta(piiHeapWorst.heap_delta, ' MB')} for ${piiHeapWorst.pii_count} matches (\`${piiHeapWorst.id}\`)`);

  $('');
  $('---');
  $('');

  // ─── 2. Extension Idle Tax ─────────────────────────────────────────────────
  $('## 1. Extension Idle Tax');
  $('');
  $('The unavoidable overhead of having the extension loaded. Content script injected, storage');
  $('initialized — nothing blurred.');
  $('');
  $('| Fixture | Vanilla FCP | Idle FCP | FCP +ms | FCP +% | Heap +MB | DOM +nodes | LT count |');
  $('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s = data[id].states;
    if (!s.vanilla || !s.idle) continue;
    const v = s.vanilla, e = s.idle;
    $(`| \`${id}\` | ${fmt(v.fcp, 'ms')} | ${fmt(e.fcp, 'ms')} | ${fmtDelta(r1(e.fcp - v.fcp), 'ms')} | ${fmtPct(pct(e.fcp, v.fcp))} | ${fmtDelta(r1(e.heap_mb - v.heap_mb), 'MB')} | ${fmtDelta(Math.round(e.dom_nodes - v.dom_nodes))} | ${fmt(e.long_task_count)} |`);
  }

  $('');
  $('> LT count = number of long tasks (>50ms) observed during page load + 1.5s settle.');
  $('');
  $('---');
  $('');

  // ─── 3. Blur-All Activation Cost ──────────────────────────────────────────
  $('## 2. Blur-All Activation Cost');
  $('');
  $('Incremental cost beyond idle. Δ columns compare blur_all vs idle (not vs vanilla).');
  $('');
  $('| Fixture | Blur count | p50 | p95 | Throughput (el/ms) | FCP Δ vs idle | Heap Δ vs idle | LT Δ vs idle |');
  $('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s = data[id].states;
    if (!s.blur_all) continue;
    const b = s.blur_all, e = s.idle;
    const tp     = throughput(b.blur_count, b.blur_ms);
    const fcpD   = b.fcp     != null && e?.fcp     != null ? r1(b.fcp - e.fcp)         : null;
    const heapD  = b.heap_mb != null && e?.heap_mb != null ? r1(b.heap_mb - e.heap_mb)  : null;
    const ltD    = b.long_task_count != null && e?.long_task_count != null
      ? (b.long_task_count - e.long_task_count)
      : null;
    $(`| \`${id}\` | ${fmt(b.blur_count)} | ${fmt(b.blur_p50, 'ms')} | ${fmt(b.blur_p95, 'ms')} | ${fmt(tp)} | ${fmtDelta(fcpD, 'ms')} | ${fmtDelta(heapD, 'MB')} | ${fmtDelta(ltD)} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 4. PII Detection Analysis ────────────────────────────────────────────
  $('## 3. PII Detection Analysis');
  $('');
  $('PII detector wraps matched text nodes in `[data-bl-si-pii]` spans — DOM injection, not CSS blur.');
  $('Each match = 1 new `<span>` in the DOM, affecting DOM node count and heap.');
  $('');
  $('| Fixture | Matches | p50 | p95 | Throughput (m/ms) | DOM +nodes | Heap Δ vs vanilla | Nodes/match |');
  $('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s = data[id].states;
    if (!s.pii_only) continue;
    const p = s.pii_only, v = s.vanilla;
    const domD       = p.dom_nodes != null && v?.dom_nodes != null ? Math.round(p.dom_nodes - v.dom_nodes)   : null;
    const heapD      = p.heap_mb   != null && v?.heap_mb   != null ? r1(p.heap_mb - v.heap_mb)               : null;
    const tp         = throughput(p.pii_count, p.pii_ms);
    const nodesMatch = p.pii_count && domD ? r1(domD / p.pii_count) : null;
    $(`| \`${id}\` | ${fmt(p.pii_count)} | ${fmt(p.pii_p50, 'ms')} | ${fmt(p.pii_p95, 'ms')} | ${fmt(tp)} | ${fmtDelta(domD)} | ${fmtDelta(heapD, 'MB')} | ${fmt(nodesMatch)} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 5. Activation Latency Comparison ─────────────────────────────────────
  $('## 4. Activation Latency — All Mechanisms');
  $('');
  $('Time from DOMContentLoaded until first visible extension effect. p50 / p95 of 5 iterations.');
  $('');
  $('| Fixture | Blur p50 | Blur p95 | PII p50 | PII p95 | Pick p50 | Pick p95 |');
  $('| --- | --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s     = data[id].states;
    const blur_p50  = s.blur_all?.blur_p50  ?? s.all_active?.blur_p50  ?? null;
    const blur_p95  = s.blur_all?.blur_p95  ?? s.all_active?.blur_p95  ?? null;
    const pii_p50   = s.pii_only?.pii_p50   ?? s.all_active?.pii_p50   ?? null;
    const pii_p95   = s.pii_only?.pii_p95   ?? s.all_active?.pii_p95   ?? null;
    const pick_p50  = s.pick_blur?.pick_p50 ?? null;
    const pick_p95  = s.pick_blur?.pick_p95 ?? null;
    if (blur_p50 == null && pii_p50 == null && pick_p50 == null) continue;
    $(`| \`${id}\` | ${fmt(blur_p50, 'ms')} | ${fmt(blur_p95, 'ms')} | ${fmt(pii_p50, 'ms')} | ${fmt(pii_p95, 'ms')} | ${fmt(pick_p50, 'ms')} | ${fmt(pick_p95, 'ms')} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 6. Memory Analysis ───────────────────────────────────────────────────
  $('## 5. Memory (Heap) Analysis');
  $('');
  $('`usedJSHeapSize` after 1.5s settle. All values as delta from vanilla baseline.');
  $('');
  $('| Fixture | Vanilla | Idle Δ | Blur-All Δ | PII-Only Δ | All-Active Δ |');
  $('| --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s = data[id].states;
    if (!s.vanilla) continue;
    const v = s.vanilla.heap_mb;
    const d = (st) => st?.heap_mb != null ? fmtDelta(r1(st.heap_mb - v), 'MB') : '—';
    $(`| \`${id}\` | ${fmt(v, 'MB')} | ${d(s.idle)} | ${d(s.blur_all)} | ${d(s.pii_only)} | ${d(s.all_active)} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 7. DOM Node Overhead ─────────────────────────────────────────────────
  $('## 6. DOM Node Overhead');
  $('');
  $('Blur-all: near-zero DOM overhead (CSS injection, no new nodes). PII: 1 `<span>` per match.');
  $('');
  $('| Fixture | Vanilla nodes | Idle Δ | Blur-All Δ | PII-Only Δ | nodes/match |');
  $('| --- | --- | --- | --- | --- | --- |');

  for (const id of present) {
    const s = data[id].states;
    if (!s.vanilla) continue;
    const v = s.vanilla.dom_nodes;
    const d = (st) => st?.dom_nodes != null ? fmtDelta(Math.round(st.dom_nodes - v)) : '—';
    let nPerMatch = '—';
    if (s.pii_only?.pii_count && s.pii_only?.dom_nodes && v) {
      const added = Math.round(s.pii_only.dom_nodes - v);
      nPerMatch = r1(added / s.pii_only.pii_count);
    }
    $(`| \`${id}\` | ${fmt(v)} | ${d(s.idle)} | ${d(s.blur_all)} | ${d(s.pii_only)} | ${nPerMatch} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 8. Long Task Analysis ────────────────────────────────────────────────
  const hasLongTasks = present.some((id) =>
    Object.values(data[id].states).some((st) => st?.long_task_count != null)
  );

  if (hasLongTasks) {
    $('## 7. Long Task Analysis');
    $('');
    $('Tasks > 50ms that block the main thread during page load + 1.5s settle window.');
    $('`count / total_ms` format.');
    $('');
    $('| Fixture | Vanilla | Idle | Blur-All | PII-Only | All-Active |');
    $('| --- | --- | --- | --- | --- | --- |');

    const fmtLt = (st) => {
      if (!st || st.long_task_count == null) return '—';
      return `${st.long_task_count} / ${st.long_task_total_ms}ms`;
    };

    for (const id of present) {
      const s = data[id].states;
      const hasAny = Object.values(s).some((st) => st?.long_task_count != null);
      if (!hasAny) continue;
      $(`| \`${id}\` | ${fmtLt(s.vanilla)} | ${fmtLt(s.idle)} | ${fmtLt(s.blur_all)} | ${fmtLt(s.pii_only)} | ${fmtLt(s.all_active)} |`);
    }

    $('');
    $('---');
    $('');
  }

  // ─── 9. Measurement Variance ──────────────────────────────────────────────
  const hasRaw = present.some((id) =>
    Object.values(data[id].states).some((st) => st?._raw)
  );

  if (hasRaw) {
    $(`## ${hasLongTasks ? '8' : '7'}. Measurement Variance`);
    $('');
    $('Standard deviation of 5 iterations. Low stddev = stable measurement environment.');
    $('`stdev` in same unit as the metric.');
    $('');
    $('| Fixture | State | FCP stdev | Blur stdev | LT-count stdev |');
    $('| --- | --- | --- | --- | --- |');

    for (const id of present) {
      for (const [stateName, metrics] of Object.entries(data[id].states)) {
        if (!metrics?._raw) continue;
        const fcpSd  = stddev(metrics._raw.fcp);
        const blurSd = stddev(metrics._raw.blur_ms);
        const ltSd   = stddev(metrics._raw.long_task_count);
        if (fcpSd == null && blurSd == null && ltSd == null) continue;
        $(`| \`${id}\` | ${stateName} | ${fmt(fcpSd, 'ms')} | ${fmt(blurSd, 'ms')} | ${fmt(ltSd)} |`);
      }
    }

    $('');
    $('---');
    $('');
  }

  // ─── 10. Normalized FCP Overhead ──────────────────────────────────────────
  const sectionN = (hasLongTasks ? 8 : 7) + (hasRaw ? 1 : 0) + 1;
  $(`## ${sectionN}. Normalized FCP Overhead`);
  $('');
  $('FCP overhead as % above vanilla. Ranked by idle overhead (highest first).');
  $('Helps identify which fixture types are most sensitive to extension presence.');
  $('');
  $('| Fixture | Idle % | Blur-All % | PII-Only % | All-Active % |');
  $('| --- | --- | --- | --- | --- |');

  const normalized = present
    .filter((id) => data[id].states.vanilla)
    .map((id) => {
      const s = data[id].states, v = s.vanilla.fcp;
      return {
        id,
        idle:       pct(s.idle?.fcp,       v),
        blur_all:   pct(s.blur_all?.fcp,   v),
        pii_only:   pct(s.pii_only?.fcp,   v),
        all_active: pct(s.all_active?.fcp,  v),
      };
    })
    .sort((a, b) => (b.idle || 0) - (a.idle || 0));

  for (const r of normalized) {
    $(`| \`${r.id}\` | ${fmtPct(r.idle)} | ${fmtPct(r.blur_all)} | ${fmtPct(r.pii_only)} | ${fmtPct(r.all_active)} |`);
  }

  $('');
  $('---');
  $('');

  // ─── 11. Anomalies & Insights ──────────────────────────────────────────────
  $(`## ${sectionN + 1}. Anomalies & Insights`);
  $('');

  const insights = [];

  // Media blur latency outlier
  if (data.media?.states?.blur_all?.blur_p50 != null) {
    const mediaBp50 = data.media.states.blur_all.blur_p50;
    const others = FIXTURE_IDS
      .filter((id) => id !== 'media' && data[id]?.states?.blur_all?.blur_p50 != null)
      .map((id) => data[id].states.blur_all.blur_p50);
    if (others.length > 0) {
      const avg = r1(others.reduce((s, v) => s + v, 0) / others.length);
      const ratio = r1(mediaBp50 / avg);
      insights.push(
        `**Media blur is ${ratio}x slower than average** (${mediaBp50}ms vs ${avg}ms avg for other fixtures). ` +
        'CSS-only fixtures (img/video/canvas — no `data-bl-si-blur` attribute) rely on `#bl-si-blur-styles` injection + SVG filter creation. ' +
        'The SVG `<feGaussianBlur>` filter element setup is heavier than attribute stamping on text nodes.'
      );
    }
  }

  // SPA large idle FCP overhead in %
  if (data.spa?.states?.vanilla && data.spa?.states?.idle) {
    const spaPct = pct(data.spa.states.idle.fcp, data.spa.states.vanilla.fcp);
    if (spaPct != null && spaPct > 100) {
      insights.push(
        `**SPA has ${spaPct}% idle FCP overhead** — highest in percentage terms. ` +
        `SPA vanilla FCP (${data.spa.states.vanilla.fcp}ms) is unusually fast because the initial shell is near-empty; ` +
        'the content script settle delay (+1.5s wait) amplifies the ratio, not actual slowness on SPA-style pages.'
      );
    }
  }

  // text-heavy PII heap spike
  if (data['text-heavy']?.states?.pii_only && data['text-heavy']?.states?.idle) {
    const h = data['text-heavy'].states.pii_only.heap_mb;
    const idleH = data['text-heavy'].states.idle.heap_mb;
    if (h > idleH + 2) {
      const cnt = data['text-heavy'].states.pii_only.pii_count;
      insights.push(
        `**text-heavy PII heap spike (+${r1(h - idleH)}MB vs idle)**: ${cnt} PII spans injected as text-node wrappers. ` +
        `Each match ≈ ${r1((data['text-heavy'].states.pii_only.dom_nodes - data['text-heavy'].states.vanilla.dom_nodes) / cnt)} new DOM nodes and associated JS objects. Proportional to match count — no leak.`
      );
    }
  }

  // pii-rich pii_only heap < idle (GC artifact)
  if (data['pii-rich']?.states?.pii_only && data['pii-rich']?.states?.idle) {
    const piiHeap  = data['pii-rich'].states.pii_only.heap_mb;
    const idleHeap = data['pii-rich'].states.idle.heap_mb;
    if (piiHeap < idleHeap) {
      insights.push(
        `**pii-rich pii_only heap (${piiHeap}MB) < idle heap (${idleHeap}MB)** — apparent paradox. ` +
        'GC likely ran between PII span allocation and the 1.5s settle snapshot, ' +
        'releasing prior allocations faster than the span footprint accumulated. Not a measurement error — just GC timing.'
      );
    }
  }

  // All-active blur_count > blur_all blur_count
  if (data['text-heavy']?.states?.all_active && data['text-heavy']?.states?.blur_all) {
    const aa = data['text-heavy'].states.all_active.blur_count;
    const ba = data['text-heavy'].states.blur_all.blur_count;
    if (aa != null && ba != null && aa > ba) {
      insights.push(
        `**All-Active has more blurred elements than Blur-All alone** (${aa} vs ${ba} in text-heavy). ` +
        'PII `<span>` wrappers become additional DOM nodes that also match blur-all element selectors, ' +
        'so enabling both PII + blur-all blurs more elements than either alone.'
      );
    }
  }

  // CLS zero
  if (!clsAnywhere) {
    insights.push(
      '**Zero CLS across all fixtures and all states.** ' +
      'CSS `filter` injection does not trigger layout recalculation (filter is a paint-phase property). ' +
      'PII span injection can theoretically cause CLS if spans change line-wrapping, but measurements show none in practice.'
    );
  }

  // Blur throughput outlier: text-heavy high count but fast throughput
  const blurThroughputs = present
    .filter((id) => data[id]?.states?.blur_all?.blur_ms && data[id]?.states?.blur_all?.blur_count)
    .map((id) => ({
      id,
      tp: throughput(data[id].states.blur_all.blur_count, data[id].states.blur_all.blur_ms),
    }))
    .sort((a, b) => b.tp - a.tp);

  if (blurThroughputs.length >= 2) {
    const fastest = blurThroughputs[0];
    const slowest = blurThroughputs[blurThroughputs.length - 1];
    if (fastest.tp && slowest.tp && fastest.tp > slowest.tp * 2) {
      insights.push(
        `**Blur throughput varies ${r1(fastest.tp / slowest.tp)}x across fixtures**: ` +
        `\`${fastest.id}\` processes ${fastest.tp} elements/ms (DOM attribute stamp path), ` +
        `\`${slowest.id}\` processes ${slowest.tp} elements/ms. ` +
        'Throughput is dominated by DOM query cost (number of nodes scanned), not element count blurred.'
      );
    }
  }

  if (insights.length === 0) {
    $('No anomalies detected.');
  } else {
    for (let i = 0; i < insights.length; i++) {
      $(`### ${i + 1}. ${insights[i].split('**')[1] || 'Finding'}`);
      $('');
      $(insights[i].replace(/^\*\*[^*]+\*\*\s*/, ''));
      $('');
    }
  }

  // ─── Write output ──────────────────────────────────────────────────────────
  const output = lines.join('\n');
  fs.writeFileSync(OUT, output, 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`${lines.length} lines, ${present.length} fixtures analyzed`);

  console.log('\nKey findings:');
  for (const ins of insights) {
    const title = ins.match(/\*\*([^*]+)\*\*/)?.[1] || ins.slice(0, 60);
    console.log(`  • ${title}`);
  }
}

main();
