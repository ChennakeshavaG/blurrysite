# Automate: Structure Reference

## Layer 1 — Main popup (read-only summary)
`renders/main.js:192–219` → renders into `#bl-automate-summary`

Three summary rows, side-by-side label+value:
```
Timer      [live countdown or "N min" or "Off"]
Idle       [N min or "Off"]
Tab Switch [On or "Off"]
```
"**Modify →**" button (`#bl-automate-modify`) opens the sub-page.

---

## Layer 2 — Sub-page (editable)
`renders/automate.js` → renders into `#bl-automate-modify-body`

Three blocks, top-to-bottom, `<hr>` dividers between them:

| Block | Controls | Constraint |
|---|---|---|
| **Tab Switch** | Toggle only | — |
| **Idle** | Enable toggle + slider (15 s – 60 min) | UX cap at 3600 s; Chrome idle API has no documented max |
| **Timer** | `[number]` `[sec/min/hr]` + **Start/Stop** button | Min 30 s; inputs lock while running |

Timer Start saves `{ enabled: true, started_at: Date.now() }`. Stop saves `{ enabled: false, started_at: null }`.

---

## CSS
`popup/renders/automate.css` — `.bl-auto-block`, `.bl-auto-input-row`, `.bl-auto-num`, `.bl-auto-unit`, `.bl-auto-start-stop`
