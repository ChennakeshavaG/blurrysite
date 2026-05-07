# Security Policy — BlurrySite

## Reporting a vulnerability

**Please do not open a public GitHub issue for security findings.**

Use one of the following private channels:

1. **GitHub Security Advisories (preferred):**
   https://github.com/ChennakeshavaG/blurrysite/security/advisories/new
   Provides encrypted communication and a private vetting workflow.
2. **Email:** `gudapallichennakeshava@gmail.com`. Please include
   `[BlurrySite security]` in the subject line. PGP key on request.

When you report, please include:

- A clear description of the issue and its impact.
- Steps to reproduce (URL of a page where it triggers, exact extension
  settings, browser + OS version).
- Whether the issue is already public anywhere.
- Any suggested mitigation, if you have one.

## What we treat as in scope

| In scope | Examples |
|---|---|
| Extension code in this repo | Content scripts, background service worker, popup, manifest. |
| Released versions on Chrome Web Store / Firefox AMO. | Match the tagged release in this repo. |
| Privacy guarantees stated in `PRIVACY_POLICY.md`. | Any code path that secretly transmits data, persists more than documented, or weakens the documented isolation between the page's main world and the extension's isolated world. |
| Permissions vs documented behavior. | The extension performing actions outside what `PRIVACY_POLICY.md` says it does. |
| Cross-context isolation breaks. | The MAIN-world bridge unintentionally exposing extension state to the page; bypasses of the page-vs-extension origin model. |
| Storage handling. | Sensitive data accidentally written to a less-private surface (e.g. session-leaked data ending up in `chrome.storage.local`). |
| Picker / reveal escapes. | A page being able to coerce blur to lift unintentionally, or to detect blurred regions through side channels. |
| Pinning / supply-chain. | An npm dependency that runs at install / build time taking unauthorized actions. |

## What is out of scope

- **Browser bugs.** Vulnerabilities in Chromium, Firefox, or their
  rendering / blink internals. Report those to the browser vendors
  directly.
- **Vulnerabilities in pages that the extension was asked to blur.**
  We do not control or sanitize page content; we only render it
  through CSS filters or wrap text in spans.
- **CVE-classed npm vulnerabilities that are not actually shipped.**
  The extension ships with no bundled JavaScript dependencies — only
  vanilla source files. `node_modules/` contents stay on developer
  machines and CI. A vulnerability in a `devDependency` such as
  `puppeteer` is generally not a vulnerability in BlurrySite.
- **Issues that require a malicious or compromised browser** — once
  the browser is owned, the extension's threat model collapses anyway.
- **Self-XSS / social-engineering against the user**, e.g. asking
  users to paste arbitrary code into devtools.
- **Theoretical CSS filter side-channels in highly contrived setups**
  unless you can demonstrate a concrete privacy leak under the
  documented `PRIVACY_POLICY.md` claims.

## Security model in one paragraph

BlurrySite runs entirely client-side. The content script lives in the
extension's isolated world and does not inject library code into the
page's main world. The single tiny `main_world_bridge.js` that runs
in the page's main world only listens for two browser APIs
(`getDisplayMedia` and `attachShadow`) and dispatches local
`CustomEvent`s back to the isolated world; it never receives data
from the isolated side, and it never stores or transmits anything.
There is no remote server, no telemetry, no analytics, no update
channel beyond the browser's built-in extension auto-update.

## Disclosure timeline (target)

- **Acknowledgement** of receipt: within **3 business days**.
- **Triage** + initial severity assessment: within **7 business days**.
- **Fix** for high-severity, network-irrelevant issues (this is a
  client-side extension, so most issues are): within **30 days** of a
  validated report.
- **Public disclosure**: coordinated with the reporter; typically
  after the fix has shipped to the Chrome Web Store / Firefox AMO and
  most users have been auto-updated.

For findings that turn out to be browser bugs surfaced via this
extension, we'll help shepherd the report to the right vendor.

## Credit

Security reporters are credited (with their permission) in the
release notes for the fixed version.

## Bug bounty

There is **no bug bounty program** for BlurrySite. This is a
single-author open-source project; reports are accepted in good
faith and credited but not compensated.
