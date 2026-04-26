#!/usr/bin/env node
/**
 * scripts/string_lint.js
 *
 * Hardcoded user-visible string linter. Scans popup/ and src/ for
 * assignments and calls that deliver English literals to the UI
 * without going through an i18n wrapper. Catches jargon regressions
 * and new hardcoded strings before commit.
 *
 * Flags:
 *   .textContent = 'literal'         → hardcoded UI text
 *   .title = 'literal'               → hardcoded tooltip
 *   .setAttribute('title', 'literal')
 *   .setAttribute('aria-label', 'literal')
 *   showToast('literal')             → hardcoded toast
 *   alert('literal')                 → hardcoded alert
 *   confirm('literal')               → hardcoded confirm
 *   placeholder="literal"            → hardcoded input placeholder (HTML)
 *
 * Ignores (false positives):
 *   - Empty strings ('' / "" / ``)
 *   - Symbol-only literals (×, …, →, ⚓, ⌘, etc.)
 *   - String assignments where the RHS is a call to I18n.t / ContentI18n.t / _t / chrome.i18n.getMessage
 *   - Lines containing `data-i18n` (template/HTML intended to be translated at runtime)
 *   - Explicit allow-list entries (see ALLOW_LIST below)
 *
 * Usage:
 *   node scripts/string_lint.js
 *   npm run string:lint
 *
 * Exit codes:
 *   0 — no hardcoded strings found
 *   1 — violations reported
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files to scan. Extensions included. Test files excluded (they use
// literal strings intentionally for assertions).
const SCAN = [
  { dir: 'popup', exts: ['.js', '.html'] },
  { dir: 'src',   exts: ['.js'] },
  { file: 'background.js' },
];

// Files or line patterns that are allowed to contain hardcoded literals.
// Each entry is { file: 'relative/path', contains: 'substring' }. A line
// in `file` that contains `contains` is ignored. Keep this list small and
// well-commented — every entry is a debt statement.
const ALLOW_LIST = [
  // Picker IIFE uses the _t shim for every user-visible string. The 2nd
  // argument to _t(key, fallback) is an English fallback literal by design
  // (it's what the user sees if ContentI18n failed to load). Flagging it
  // would require the linter to understand _t's signature, which is the
  // wrong layer.
  { file: 'src/picker.js', contains: "_t('" },

  // flashElementIndicator badge text is passed through Picker's _t shim
  // at the call site.
  { file: 'src/picker.js', contains: 'flashElementIndicator(target,' },

  // Version sigil — 'v' prefix is not translatable copy; the rest of the
  // string comes from the manifest. popup_ui.js reads via getManifest().
  { file: 'popup/popup_ui.js', contains: "chrome.runtime.getManifest().version" },

  // showToast calls in popup.js pass i18n message keys, not user-visible
  // literals. The linter cannot distinguish a key from a literal string.
  { file: 'popup/popup.js', contains: "showToast('toast_" },

  // screen_share.js injects a JS code string into the page's MAIN world.
  // The textContent assignment holds executable code, not user-visible text.
  { file: 'src/screen_share.js', contains: 's.textContent' },

  // PWA settings panel — shadow DOM elements injected by content_script.
  // The close-button aria-label and one-time hint toast are not routed through
  // ContentI18n because the panel is created imperatively (no DOM template).
  { file: 'src/content_script.js', contains: 'Close Blurry Site settings' },
  { file: 'src/content_script.js', contains: "'PWA — right-click or press '" },

  // New popup scaffold (Plan 1) — aria-label and title attrs are English
  // stubs. These will gain data-i18n attributes in Plan 2 when the i18n
  // system is wired into the new popup.
  { file: 'popup/popup.html', contains: 'aria-label="Toggle theme"' },
  { file: 'popup/popup.html', contains: 'title="Toggle theme"' },
  { file: 'popup/popup.html', contains: 'title="Toggle Blurry Site on/off"' },
  { file: 'popup/popup.html', contains: 'aria-label="Power on/off"' },
  { file: 'popup/popup.html', contains: 'aria-label="Blur type"' },
  { file: 'popup/popup.html', contains: 'aria-label="Auto-detect PII on/off"' },
  { file: 'popup/popup.html', contains: 'aria-label="PII blur mode"' },
  { file: 'popup/popup.html', contains: 'aria-label="Settings"' },
  { file: 'popup/popup.html', contains: 'aria-label="Close"' },
  { file: 'popup/popup.html', contains: 'aria-label="Dismiss"' },
  { file: 'src/shortcut_handler.js', contains: "setAttribute('aria-label', 'Dismiss')" },
];

// Patterns whose RHS is an i18n call — always OK.
const I18N_CALL = /(?:I18n\.t|ContentI18n\.t|_t|chrome\.i18n\.getMessage)\s*\(/;

// Decode a JS source-code string literal body into its actual runtime
// value so `\u00d7` → `×`, `\n` → newline, etc. We feed the raw captured
// body through JSON.parse by wrapping it in quotes, which handles all
// the escape sequences we care about. Falls back to the raw source if
// the literal isn't valid JSON (e.g. has a single quote).
function decodeLiteral(raw) {
  try {
    return JSON.parse('"' + raw.replace(/"/g, '\\"') + '"');
  } catch (_) {
    return raw;
  }
}

// Symbol-only literal detector — passes if the decoded literal contains
// any letter (Latin, Devanagari, Tamil, CJK, etc.). Multi-codepoint
// symbols like ⚓ (U+2693) and × (U+00D7) fall in Unicode category So/Sm
// and are correctly rejected.
function hasLetters(s) {
  return /[\p{L}]/u.test(s);
}

// Strip comments very naively — good enough for line-based linting.
// Removes // line comments only. Block comments and strings are untouched
// (false positives from block-comment examples go to the allow list).
function stripComments(line) {
  // Keep strings intact; only remove // if it's not inside a quoted string.
  let out = '';
  let inS = null; // 'S' | 'D' | 'T' (single/double/template) or null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = line[i - 1];
    if (inS) {
      out += ch;
      if (ch === inS && prev !== '\\') inS = null;
    } else {
      if (ch === "'") { inS = "'"; out += ch; continue; }
      if (ch === '"') { inS = '"'; out += ch; continue; }
      if (ch === '`') { inS = '`'; out += ch; continue; }
      if (ch === '/' && line[i + 1] === '/') break; // rest is comment
      out += ch;
    }
  }
  return out;
}

function listFiles() {
  const out = [];
  for (const entry of SCAN) {
    if (entry.file) {
      const p = path.join(ROOT, entry.file);
      if (fs.existsSync(p)) out.push(entry.file);
      continue;
    }
    const dir = path.join(ROOT, entry.dir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isFile() && entry.exts.some((e) => name.endsWith(e))) {
        out.push(path.join(entry.dir, name));
      }
    }
  }
  return out;
}

/** Test whether an entire line is allowed despite matching a pattern. */
function isAllowed(relPath, line) {
  for (const { file, contains } of ALLOW_LIST) {
    if (file === relPath && line.includes(contains)) return true;
  }
  // Any element that carries `data-i18n*` is translated at runtime.
  if (line.includes('data-i18n')) return true;
  // Any expression that routes through an i18n call is OK.
  if (I18N_CALL.test(line)) return true;
  return false;
}

// ── Rule definitions ─────────────────────────────────────────────────────
// Each rule is { id, regex, extractor(match, line) -> literal | null }.
// The extractor returns the captured literal so we can filter symbol-only
// / empty strings without re-parsing.

const RULES = [
  {
    id: 'textContent-assign',
    // .textContent = '...' or = "..."
    regex: /\.textContent\s*=\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'title-assign',
    // .title = '...' or = "..."
    regex: /\.title\s*=\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'setAttribute-title',
    regex: /\.setAttribute\s*\(\s*['"]title['"]\s*,\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'setAttribute-aria-label',
    regex: /\.setAttribute\s*\(\s*['"]aria-label['"]\s*,\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'showToast-literal',
    regex: /\bshowToast\s*\(\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'alert-literal',
    regex: /\balert\s*\(\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  {
    id: 'confirm-literal',
    regex: /\bconfirm\s*\(\s*(['"])((?:\\\1|(?!\1).)*)\1/,
  },
  // HTML placeholder="literal" — scanned only for .html files
  {
    id: 'html-placeholder',
    regex: /\bplaceholder\s*=\s*"([^"]*)"/,
    htmlOnly: true,
    extract: (m) => m[1],
  },
  // HTML title="literal" outside of data-i18n-title
  {
    id: 'html-title-attr',
    regex: /\btitle\s*=\s*"([^"]*)"/,
    htmlOnly: true,
    extract: (m) => m[1],
  },
  // HTML aria-label="literal"
  {
    id: 'html-aria-label',
    regex: /\baria-label\s*=\s*"([^"]*)"/,
    htmlOnly: true,
    extract: (m) => m[1],
  },
];

function extractLiteral(rule, match) {
  if (rule.extract) return rule.extract(match);
  return match[2] || '';
}

function lint() {
  const files = listFiles();
  const violations = [];

  for (const rel of files) {
    const isHtml = rel.endsWith('.html');
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = src.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = isHtml ? rawLine : stripComments(rawLine);
      if (!line.trim()) continue;
      if (isAllowed(rel, rawLine)) continue;

      for (const rule of RULES) {
        if (rule.htmlOnly && !isHtml) continue;
        const m = rule.regex.exec(line);
        if (!m) continue;
        const literalRaw = extractLiteral(rule, m);
        if (!literalRaw) continue;                      // empty string
        const literal = decodeLiteral(literalRaw);
        if (!literal) continue;
        if (!hasLetters(literal)) continue;             // symbol-only (×, ⚓, …)
        // HTML attributes ignore the data-i18n check globally (done in isAllowed),
        // but also ignore if the SAME tag already has a data-i18n-* for this attr.
        if (rule.htmlOnly) {
          const tag = rawLine;
          if (rule.id === 'html-placeholder'  && tag.includes('data-i18n-placeholder')) continue;
          if (rule.id === 'html-title-attr'   && tag.includes('data-i18n-title'))       continue;
          if (rule.id === 'html-aria-label'   && tag.includes('data-i18n-aria-label'))  continue;
        }
        violations.push({ file: rel, line: i + 1, rule: rule.id, literal });
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  if (violations.length === 0) {
    console.log(`string lint: scanned ${files.length} file(s), 0 hardcoded strings`);
    return;
  }

  // Group by file.
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  console.error(`string lint: ${violations.length} hardcoded string(s) across ${byFile.size} file(s)`);
  for (const [file, items] of byFile) {
    console.error(`\n  ${file}`);
    for (const v of items) {
      const preview = v.literal.length > 60 ? v.literal.slice(0, 57) + '…' : v.literal;
      console.error(`    :${v.line}  [${v.rule}]  "${preview}"`);
    }
  }
  console.error(`\nfail: ${violations.length} violation(s). Route through I18n.t / ContentI18n.t / chrome.i18n.getMessage, add data-i18n* attribute, or add an entry to ALLOW_LIST in scripts/string_lint.js (debt tracked inline).`);
  process.exit(1);
}

lint();
