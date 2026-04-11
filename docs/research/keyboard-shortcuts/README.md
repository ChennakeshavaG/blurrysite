# Keyboard Shortcuts Research

This folder collects the research that informs the Keyboard Shortcuts v2 redesign.

## Files

| File | Content | Size |
|---|---|---|
| [`00-synthesis.md`](00-synthesis.md) | Cross-dossier synthesis + decisions for the Blurry Site redesign | small |
| [`01-current-state.md`](01-current-state.md) | Exhaustive audit of the current shortcut implementation: storage shape, matcher logic, capture UI, tests, docs, every hardcoded assumption, known quirks | ~42 KB |
| [`02-industry.md`](02-industry.md) | How 24 products (Vimium, Linear, VS Code, Figma, GitHub, Mousetrap, TinyKeys, hotkeys-js, Electron Accelerator, …) handle shortcut storage, capture, display, conflict detection, cross-platform, sequences, and extensibility. Includes a comparison table and "patterns worth stealing / to avoid" lists | ~53 KB |
| [`03-technical.md`](03-technical.md) | Definitive reference on the `KeyboardEvent` API: `key` vs `code`, modifier handling, AltGr, dead keys, IME, `chrome.commands` quirks, platform differences, proposed data model, canonical capture flow. MDN-quoted | ~78 KB |

## Status

These files are **frozen research artifacts**. They reflect what was known at the time of the v2 redesign (2026-04). If future decisions change the approach, update `00-synthesis.md` — not the numbered dossiers.

The authoritative design for the redesign itself lives in the plan file (`~/.claude-alphared/plans/curious-stargazing-wand.md`) and eventually in `docs/LLD.md §5` once the code ships.

## Provenance

- Dossier 1 was produced by an Explore agent that read the current implementation directly (no web research).
- Dossiers 2 and 3 were produced by parallel Explore agents with web research (MDN, Chrome docs, VS Code docs, GitHub source, library READMEs).
- Each dossier was generated in a single agent run with an explicit "maximum detail, no restrictions" directive, then lightly cleaned (stripped agent preamble) before being committed.
