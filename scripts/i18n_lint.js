#!/usr/bin/env node
/**
 * scripts/i18n_lint.js
 *
 * Locale parity linter. English (`_locales/en/`) is the source of truth;
 * every other locale must match its key set and `{{placeholder}}` inventory.
 * Also checks Chrome messages.json shape and flags empty values (except
 * keys deliberately allowed to be empty — see EMPTY_ALLOWED below).
 *
 * Catches:
 *  - Missing keys  (locale has dropped something en has)
 *  - Stale keys    (locale has something en has dropped)
 *  - Placeholder drift  ({{count}} in en → Hindi must still have {{count}})
 *  - Empty values  (probably forgotten translation)
 *  - Wrong shape   (messages.json must wrap each value in { "message": "..." })
 *
 * Usage:
 *   node scripts/i18n_lint.js
 *   npm run i18n:lint
 *
 * Exit codes:
 *   0 — all locales pass
 *   1 — drift detected (errors printed per locale)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../_locales');

/**
 * Keys that are allowed to be an empty string in non-English locales.
 * Example: `pickerPrefixLabel` is "Blur An:" in English but empty in
 * Hindi/Tamil because the sentence-fragment grammar doesn't carry.
 */
const EMPTY_ALLOWED = new Set([
  'pickerPrefixLabel',
]);

/** Keys whose value is metadata, not user-facing copy. Skip parity checks. */
const META_KEYS = new Set(['_meta']);

// ── Helpers ────────────────────────────────────────────────────────────────

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { __parseError: err.message };
  }
}

function listLocales() {
  return fs.readdirSync(LOCALES_DIR)
    .filter((name) => {
      const p = path.join(LOCALES_DIR, name);
      return fs.statSync(p).isDirectory();
    })
    .sort();
}

/** Extract `{{name}}` placeholders from a string, as a sorted set. */
function placeholderSet(str) {
  if (typeof str !== 'string') return new Set();
  const out = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(str)) !== null) out.add(m[1]);
  return out;
}

function setDiff(a, b) {
  const out = [];
  for (const x of a) if (!b.has(x)) out.push(x);
  return out.sort();
}

function eqSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── Shape validator ───────────────────────────────────────────────────────

/** messages.json: Chrome shape `{ "key": { "message": "value", ... } }`. */
function validateMessagesShape(data, errors) {
  if (data.__parseError) {
    errors.push('parse error: ' + data.__parseError);
    return false;
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    errors.push('root must be an object');
    return false;
  }
  let ok = true;
  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`key "${key}" must be an object with a "message" field`);
      ok = false;
      continue;
    }
    if (typeof entry.message !== 'string') {
      errors.push(`key "${key}" is missing the "message" string field`);
      ok = false;
    }
  }
  return ok;
}

/** Return a plain `{ key: string }` map from messages.json shape. */
function flatten(data) {
  const out = {};
  if (!data || data.__parseError) return out;
  for (const [key, value] of Object.entries(data)) {
    if (META_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && typeof value.message === 'string') {
      out[key] = value.message;
    }
  }
  return out;
}

// ── Parity check ──────────────────────────────────────────────────────────

function comparePair(enFlat, enKeys, locFlat, fileLabel, errors) {
  const locKeys = new Set(Object.keys(locFlat));

  const missing = setDiff(enKeys, locKeys);
  const stale   = setDiff(locKeys, enKeys);

  if (missing.length) {
    errors.push(`${fileLabel}: missing ${missing.length} key(s): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`);
  }
  if (stale.length) {
    errors.push(`${fileLabel}: stale ${stale.length} key(s) not in en: ${stale.slice(0, 8).join(', ')}${stale.length > 8 ? ', …' : ''}`);
  }

  // Placeholder parity + empty-value check for every key present in both.
  for (const key of enKeys) {
    if (!locKeys.has(key)) continue;
    const enVal  = enFlat[key];
    const locVal = locFlat[key];

    if (locVal === '' && !EMPTY_ALLOWED.has(key)) {
      errors.push(`${fileLabel}: key "${key}" is empty (not in EMPTY_ALLOWED)`);
    }

    const enPh  = placeholderSet(enVal);
    const locPh = placeholderSet(locVal);
    if (!eqSet(enPh, locPh)) {
      const enList  = [...enPh].sort().join(',') || '(none)';
      const locList = [...locPh].sort().join(',') || '(none)';
      errors.push(`${fileLabel}: placeholder drift on "${key}" — en has {${enList}}, locale has {${locList}}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

function lint() {
  const locales = listLocales();
  if (!locales.includes('en')) {
    console.error('fatal: _locales/en is missing — cannot lint without a reference locale');
    process.exit(2);
  }

  const enMessages = readJson(path.join(LOCALES_DIR, 'en', 'messages.json'));

  const messagesErrors = [];
  if (!validateMessagesShape(enMessages, messagesErrors)) {
    console.error('en/messages.json failed shape validation:');
    for (const e of messagesErrors) console.error('  ' + e);
    process.exit(1);
  }

  const enFlat = flatten(enMessages);
  const enKeys = new Set(Object.keys(enFlat));

  let totalErrors = 0;
  const perLocale = [];

  for (const loc of locales) {
    if (loc === 'en') continue;
    const errors = [];

    const messagesPath = path.join(LOCALES_DIR, loc, 'messages.json');

    if (!fs.existsSync(messagesPath)) {
      errors.push('messages.json: missing file');
    } else {
      const data = readJson(messagesPath);
      if (validateMessagesShape(data, errors)) {
        const flat = flatten(data);
        comparePair(enFlat, enKeys, flat, 'messages.json', errors);
      }
    }

    perLocale.push({ loc, errors });
    totalErrors += errors.length;
  }

  // ── Report ─────────────────────────────────────────────────────────────
  const allOk = totalErrors === 0;
  console.log(`i18n lint: ${locales.length} locales (en reference + ${locales.length - 1} target${locales.length - 1 === 1 ? '' : 's'})`);
  console.log(`  en/messages.json — ${enKeys.size} keys`);

  for (const { loc, errors } of perLocale) {
    if (errors.length === 0) {
      console.log(`  ${loc}  — OK`);
    } else {
      console.error(`  ${loc}  — ${errors.length} error(s)`);
      for (const e of errors) console.error(`      ${e}`);
    }
  }

  if (!allOk) {
    console.error(`\nfail: ${totalErrors} error(s) across ${perLocale.filter(p => p.errors.length).length} locale(s)`);
    process.exit(1);
  }
  console.log('\nok: all locales in sync with en');
}

lint();
