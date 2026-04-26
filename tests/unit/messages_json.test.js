'use strict';

const fs   = require('fs');
const path = require('path');

const LOCALES_DIR      = path.resolve(__dirname, '../../_locales');
// Chrome parses $WORD$ as a placeholder reference when WORD is alphanumeric+underscore.
// Numeric-only references ($1$–$9$) are positional from the placeholder content itself, not top-level refs.
const PLACEHOLDER_RE   = /\$([A-Za-z0-9_@]+)\$/g;

function localeFiles() {
  return fs.readdirSync(LOCALES_DIR)
    .filter((d) => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory())
    .map((locale) => path.join(LOCALES_DIR, locale, 'messages.json'))
    .filter((fp) => fs.existsSync(fp));
}

// USER IMPACT: an undefined $VAR$ in messages.json makes Chrome refuse to load the
// extension entirely ("Variable ... used but not defined. Could not load manifest.").
describe('messages.json locale files', () => {
  test('no $PLACEHOLDER$ reference is used without a matching placeholders definition', () => {
    const errors = [];

    for (const filePath of localeFiles()) {
      const rel      = path.relative(path.resolve(__dirname, '../../'), filePath);
      const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      for (const [key, entry] of Object.entries(messages)) {
        if (!entry || typeof entry.message !== 'string') continue;

        const defined = new Set(
          Object.keys(entry.placeholders || {}).map((k) => k.toLowerCase())
        );

        PLACEHOLDER_RE.lastIndex = 0;
        let match;
        while ((match = PLACEHOLDER_RE.exec(entry.message)) !== null) {
          const ref = match[1].toLowerCase();
          if (/^\d+$/.test(ref)) continue; // $1$–$9$ are positional, not key refs
          if (!defined.has(ref)) {
            errors.push(`${rel}  key "${key}":  $${match[1]}$  is used but not defined in placeholders`);
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        'Undefined $PLACEHOLDER$ references — Chrome will reject the manifest:\n\n' +
        errors.join('\n')
      );
    }
  });

  test('every messages.json is valid JSON and has the expected shape { key: { message } }', () => {
    const errors = [];

    for (const filePath of localeFiles()) {
      const rel = path.relative(path.resolve(__dirname, '../../'), filePath);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        errors.push(`${rel}: invalid JSON — ${e.message}`);
        continue;
      }

      if (typeof parsed !== 'object' || parsed === null) {
        errors.push(`${rel}: top level must be an object`);
        continue;
      }

      for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry !== 'object' || entry === null || typeof entry.message !== 'string') {
          errors.push(`${rel} key "${key}": must have a string .message field`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error('messages.json shape errors:\n\n' + errors.join('\n'));
    }
  });
});
