# Contributing to BlurrySite

Thanks for considering a contribution. This file is the short version
of the project's working agreements; the long version lives in
[`CLAUDE.md`](CLAUDE.md) and the per-module contracts under
[`docs/contracts/`](docs/contracts/).

---

## Ground rules

1. **Read the relevant contract first.** Every module under `src/`
   has a contract at `docs/contracts/<module>.md`. It documents the
   public API, edge cases, and invariants that other modules depend
   on. A pre-edit hook will remind you.
2. **No ES modules, no bundler, no TypeScript.** Every source file is
   an IIFE that assigns a single `window.BlurrySite*` global. The
   load order is fixed by `manifest.json`. If your change can't be
   expressed within those rules, open an issue first to discuss.
3. **Same-commit rule for docs.** If you change a public API, the
   matching `docs/contracts/<module>.md` updates in the same commit.
   If you add or remove tests, update the matching
   `docs/contracts/<module>.tests.md`.
4. **Tests must stay green.** `npm run test:unit` reports `1205 / 1205`
   today. Don't push a PR with regressions.
5. **Conventional Commits.** Commit subjects follow `type(scope):
   short description`. Types: `feat`, `fix`, `chore`, `perf`,
   `refactor`, `docs`, `test`.

---

## Project layout

```
.
├── manifest.json              MV3 extension manifest
├── background.js              service worker
├── src/                       isolated-world content scripts (IIFE per file)
│   ├── core/                  blur engine
│   ├── pii/                   PII detection pipeline
│   └── automate/              idle / tab-switch / overlay
├── popup/                     toolbar popup UI (vanilla)
├── styles/                    injected page CSS
├── icons/                     brand artwork (original) + Pinyon Script license
├── fonts/                     OFL-1.1 fonts (disc, asterisk)
├── _locales/                  chrome.i18n strings
├── tests/
│   ├── unit/                  jsdom-based, 1205 passing
│   ├── e2e/                   Puppeteer (independent maintenance)
│   └── perf/                  Playwright fixtures (independent maintenance)
├── docs/
│   ├── contracts/             per-module contracts (READ FIRST)
│   └── …                      historical research / planning
├── scripts/                   i18n + string lints
├── CLAUDE.md                  project rules (read this)
├── PRIVACY_POLICY.md
├── SECURITY.md
└── THIRD_PARTY_LICENSES.md
```

---

## Setting up

```bash
npm install
npm run test:unit       # confirm 1205 / 1205 baseline
```

The `package-lock.json` pins to the public npm registry. If you have a
private registry override in `~/.npmrc`, prefer
`npm install --registry=https://registry.npmjs.org/` so contributors'
lockfiles don't drift.

---

## Loading the extension while you work

### Chrome / Edge

1. `chrome://extensions` → enable Developer mode.
2. Load unpacked → select the project root.
3. After every code change, click the reload icon on the extension
   card. Most pages also need a hard reload (`Cmd+Shift+R`).

### Firefox

1. `about:debugging#/runtime/this-firefox`.
2. Load Temporary Add-on → select `manifest.json`.
3. Reload the add-on after code changes via the Reload button.

---

## Making a change

### 1. Pick (or open) an issue

Describe what you're trying to fix or add. For non-trivial features,
expect a short discussion before code review — the project is
small, opinionated, and prefers to align on shape early.

### 2. Branch and code

```bash
git checkout -b feat/your-change
```

Keep diffs focused. One concern per PR. If you find drive-by cleanups
along the way, save them for a separate PR — review velocity is much
higher when the diff is single-purpose.

### 3. Run the local checks

```bash
npm run test:unit       # required — must be 1205 / 1205 green plus your additions
npm run lint            # ESLint
npm run i18n:lint       # locale coverage
npm run string:lint     # repo-specific string linter
```

For UI work, install the unpacked extension locally and exercise the
feature in a real browser before pushing.

### 4. Update the contract

If you touched a public API, update `docs/contracts/<module>.md` in
the same commit. If you touched tests, update
`docs/contracts/<module>.tests.md`. The same-commit rule keeps
contracts honest.

### 5. Commit

Use Conventional Commits. The repo's existing style:

```
perf(pii): defer initial scan past LCP + drop <4-char text nodes
```

If your change was paired with an AI assistant (Claude or otherwise),
add a `Co-Authored-By:` trailer per the existing convention. See
the recent log for the exact format.

### 6. Open the PR

- Reference the issue.
- Describe what changes and why, not how (the diff covers the how).
- Note any contract / docs changes you made.
- Note any tests you added.

---

## Adding a new feature

The full checklist for adding things lives in `CLAUDE.md`. The
critical hits:

| You added… | You also update |
|---|---|
| A new public method on a module | Module Globals table in `CLAUDE.md`, the module's `docs/contracts/<module>.md` |
| A new `chrome.runtime.sendMessage` type | `src/constants.js` (source of truth) + the message-protocol tables |
| A new key under `blsi_model` | `CLAUDE.md` Settings Shape section + `docs/contracts/storage_model.md` |
| A new source file | `manifest.json` content_scripts array, `CLAUDE.md` load order, `src/CLAUDE.md` |
| A new shortcut action | One entry in `src/action_registry.js` + one handler in `content_script.shortcutActionMap` + (optional) one entry in `manifest.json > commands` |
| A new test file | The matching `docs/contracts/<module>.tests.md` |

---

## Reporting bugs

For runtime bugs and feature requests:
https://github.com/ChennakeshavaG/blurrysite/issues

For security findings: see [`SECURITY.md`](SECURITY.md). Do **not**
file security issues in the public tracker.

---

## Code of conduct

This project follows the
[Contributor Covenant v2.1](CODE_OF_CONDUCT.md). Be kind, assume
good faith, prefer questions over assumptions. Reports to the email
in `CODE_OF_CONDUCT.md`.

---

## License

By contributing, you agree that your contribution is licensed under
the same [GNU GPL v3.0 or later](LICENSE) as the rest of the
project. There is no separate CLA.
