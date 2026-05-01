# Third-Party Licenses

BlurrySite is released under the [GNU General Public License v3.0 or later](LICENSE)
(SPDX: `GPL-3.0-or-later`). The project bundles or derives from a few
third-party assets, each with its own license. This file inventories them
so contributors and downstream users have a single place to confirm
attribution.

---

## Fonts

### `fonts/disc.woff2` — derivative of `noppa/text-security`

Used as `bl-si-censored-disc` for the blur-all `censored` mode. Maps every
Unicode codepoint to a filled disc (●).

- **Source:** https://github.com/noppa/text-security
- **Author:** Oskari Noppa
- **License:** SIL Open Font License, Version 1.1 (OFL-1.1)
- **License copy:** [`fonts/LICENSE-text-security.txt`](fonts/LICENSE-text-security.txt)

### `fonts/asterisk.woff2` — original work

Maps every Unicode BMP codepoint to a 6-arm asterisk (*) via cmap format 4.
Generated independently with [fontTools](https://github.com/fonttools/fonttools).
Used as `bl-si-starred-asterisk` for the auto-detect-PII `starred` mode.

- **Source:** this repository (original work).
- **License:** GPL-3.0-or-later (covered by the project's [`LICENSE`](LICENSE)).

### `Pinyon Script` — embedded in icon SVGs

Embedded as a base64 WOFF2 inside `icons/logo-dark.svg` and `icons/logo-light.svg`
to render the cursive "blur" easter-egg text on the brand mark.

- **Source:** https://fonts.google.com/specimen/Pinyon+Script
- **Designer:** Nicole Fally
- **License:** SIL Open Font License, Version 1.1 (OFL-1.1)
- **License copy:** [`icons/LICENSE-pinyon-script.txt`](icons/LICENSE-pinyon-script.txt)

---

## Icons + brand artwork

`icons/icon*.png`, `icons/logo-*.png`, `icons/logo-*.svg` are original
artwork for this project. Covered by the project's [`LICENSE`](LICENSE)
(GPL-3.0-or-later).

---

## npm dependencies

All build-time and dev-time npm dependencies are listed in `package.json`.
Their licenses can be inspected directly inside `node_modules/<pkg>/LICENSE`
after `npm install`. None of them ship inside the published extension —
the manifest content scripts and popup files are vanilla JavaScript with
no bundler.

---

## Reporting attribution issues

If you spot a missing attribution or a license-compatibility concern,
please open an issue at
https://github.com/ChennakeshavaG/blurrysite/issues.
