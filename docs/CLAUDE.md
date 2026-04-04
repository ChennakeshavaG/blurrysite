# docs/ — Documentation Maintenance Guide

## Document Map

| File | Purpose | Update when |
|---|---|---|
| `HLD.md` | Component diagram, data flows, message protocol tables, storage schema | New module added, new message type, data flow changes, storage schema changes |
| `LLD.md` | Module contracts (TypeScript interfaces), state variables, algorithm pseudocode | Public API changes, new state variables, algorithm changes |
| `CROSS_BROWSER.md` | Chrome/Firefox compat matrix, extensibility gap analysis | New browser API used, new known limitation found, gap closed |

## Critical Facts to Preserve

These were hard-won during initial development. Do not let them drift:

### Message type registry
The single source of truth for message type strings is the protocol table in `HLD.md §6`. Any new message type must be added to both the sending module AND the background.js handler AND this table — all three or none.

### Settings shape
Settings use a single UPPER_SNAKE_CASE shape everywhere. `content_script.js` passes `settings.SHORTCUTS` directly to `Shortcuts.init()` — no flattening needed.

### Load order
The module load order diagram in `HLD.md §2` must match `manifest.json content_scripts.js[]` exactly.

## Style Rules for These Docs

- Use tables and code blocks instead of prose paragraphs where possible — reduces tokens for future agents.
- Pseudocode blocks use plain indented text (not real code) — do not add syntax highlighting.
- Interface definitions use TypeScript-style annotations for clarity even though the code is vanilla JS.
- `§N` section references (e.g., `LLD.md §4`) are used across docs — preserve section numbering when editing.
