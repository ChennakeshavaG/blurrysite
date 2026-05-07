# Changelog

All notable changes to BlurrySite are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it leaves the `0.x` line.

---

## [0.69.3] — 2025-05-07

### Removed
- Competitive analysis and market strategy documents stripped from the
  tracked tree and working directory ahead of the public open-source
  release.

### Added
- `THIRD_PARTY_LICENSES.md` — consolidated inventory of bundled third-party
  assets and their licenses.
- `icons/LICENSE-pinyon-script.txt` — OFL-1.1 license for the Pinyon Script
  font embedded as base64 inside the icon SVGs (previously unattributed).
- `SECURITY.md` — coordinated-disclosure policy with two private reporting
  channels (GitHub Security Advisories preferred, email fallback) and an
  in-scope / out-of-scope matrix.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` — public contributor docs.
- `.npmrc` and `package-lock.json` regenerated against the public npm
  registry; previous lockfile pinned to a private mirror.

### Changed
- **License:** switched from MIT to GPL-3.0-or-later. Rationale: prevent
  closed-source commercial forks of the PII detection pipeline + blur
  engine.
- `PRIVACY_POLICY.md`: per-storage-key inventory (4 local + 4 session
  keys), full permissions table including `scripting` and `idle`, explicit
  disclosure of the main-world bridge for `getDisplayMedia` and
  `attachShadow`.
- `package.json`: added `license`, `author`, `repository`, `bugs`,
  `homepage` metadata for the public release.
- README: rewritten end-to-end. Stale references to `PrivacyBlur*` class
  names removed; current architecture (`blsi.*` IIFE globals, split
  `core/` + `pii/` + `automate/` modules) documented.
- PII auto-detect: initial `scan()` deferred past LCP via
  `requestIdleCallback` to keep the text-walk + DOM rewraps off the
  largest-contentful-paint critical path; text nodes shorter than 4
  characters are skipped.
- Strength slider: shows tier label (`subtle` / `moderate` / `strong`)
  instead of raw pixel value. Storage still keeps pixels.

### Fixed
- Build: include `fonts/` in the packaged ZIP so `disc.woff2` and
  `asterisk.woff2` resolve at runtime; exclude dev-only files from the
  pack.

### Security
- History rewritten via `git-filter-repo` to replace employer email on
  every commit's author + committer fields with the personal release
  email. Co-author trailers (Claude) preserved.

---

## [0.69] — pre-release tagged in private repo

Last private-repo version. Feature set frozen for the open-source
release; subsequent changes appear under `[Unreleased]` until the
first public tag is cut.

Highlights at this version:
- Blur all + Pick & Blur with sticky-page / sticky-screen / dynamic
  modes.
- Auto-detect PII with tier-based false-positive suppressor cascade
  (multilingual keyword windows for ES/FR/DE/IT/JA/ZH/HI).
- Automate triggers: idle, tab-switch, screen-share.
- Site rules with full-snapshot semantics.
- Tab privacy (title masking).
- Selection blur and screenshot capture.
- Reveal modes: hover / click / disabled.
- Custom font modes (censored discs + starred asterisks via OFL fonts).
- Multi-language popup UI.

For the granular pre-release history, see `git log` — the iterative
refactors (engine split, automate redesign, contracts evolution,
storage model migration) are all preserved.
