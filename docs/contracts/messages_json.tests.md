# messages_json Test Contract

## Overview

Tests for the `_locales/*/messages.json` locale files. No source module is loaded — the test reads locale files directly from the filesystem using Node's `fs` module. The suite validates two structural invariants that Chrome enforces at extension-load time: (1) every `$PLACEHOLDER$` reference in a message string must have a matching entry in that message's `placeholders` object, and (2) every `messages.json` must be valid JSON with the required `{ key: { message: string } }` shape. A failure in either test means Chrome will refuse to load the extension.

## Setup & Teardown

- No `beforeAll` / `beforeEach` / `afterEach` — tests are fully synchronous and stateless.
- `localeFiles()` — scans `_locales/` subdirectories and returns paths to all `messages.json` files that exist.
- `PLACEHOLDER_RE` — `/\$([A-Za-z0-9_@]+)\$/g` matches Chrome placeholder reference syntax. Numeric-only matches (`$1$`–`$9$`) are skipped as positional references, not key references.

## Test Groups

### messages.json locale files

- `no $PLACEHOLDER$ reference is used without a matching placeholders definition` — for every locale file, for every message entry, every `$NAME$` token in the `message` string must have a corresponding key in `entry.placeholders` (case-insensitive). Collects all violations and throws a single descriptive error listing file, key, and offending token. Purely numeric placeholder tokens (`$1$`–`$9$`) are explicitly exempted.
- `every messages.json is valid JSON and has the expected shape { key: { message } }` — for every locale file: parses as valid JSON without throwing; top-level value is a non-null object; every entry value is a non-null object with a `string`-typed `message` field. Collects all violations and throws a single descriptive error.

## Edge Cases Covered

- `$1$`–`$9$` positional placeholder tokens exempted from the defined-reference check (Chrome treats them as positional, not named).
- Placeholder key comparison is case-insensitive (Chrome normalises placeholder keys to lowercase).
- Missing `placeholders` object on an entry is handled gracefully — `Object.keys(entry.placeholders || {})` defaults to empty set.
- Missing or structurally wrong `messages.json` entries (non-object values, missing `message` field) are all caught and reported.
- Each test accumulates all errors before throwing, so a single run surfaces every violation across all locales (not just the first).

## Coverage Gaps

- No test verifying that every key present in one locale also appears in all other locales (translation completeness / key parity).
- No test for `description` field formatting or presence.
- No test for `placeholders` entries that are defined but never referenced in the message string (dead placeholders).
- No test for placeholder `content` field being a valid `$N$` reference or literal string (only key existence is checked, not value shape).
- No test that the `default_locale` declared in `manifest.json` matches one of the present locale directories.
- No test for locale directory naming conventions (e.g. `en` vs `en_US` format).
