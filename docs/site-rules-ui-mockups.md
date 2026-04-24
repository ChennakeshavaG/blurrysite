# Site Rules UI — ASCII Mockups

Popup internal width: ~320px. Box-drawing chars only.

---

## 1. Empty State

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  Apply saved settings automatically  │
│  when you visit a matching site.     │
│                                      │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│                                      │
│       No site rules saved yet.       │
│                                      │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│                                      │
│  [ + Save current settings as site   │
│    rule                           ]  │
│                                      │
└──────────────────────────────────────┘
```

---

## 2. List View — All Collapsed

Three rules, all collapsed. Type badge right of pattern, chevron at end.

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  Apply saved settings automatically  │
│  when you visit a matching site.     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ github.com      [exact]      ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ *.google.com  [wildcard]     ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ^mail\.       [regex]        ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ + Save current settings as site   │
│    rule                           ]  │
│                                      │
└──────────────────────────────────────┘
```

---

## 3. List View — One Card Expanded (with snapshot)

Middle card expanded, showing snapshot key-value rows and actions.

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  Apply saved settings automatically  │
│  when you visit a matching site.     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ github.com      [exact]      ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ *.google.com  [wildcard]     ▼ │  │
│  ├────────────────────────────────┤  │
│  │  Settings snapshot             │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  Blur radius      10px         │  │
│  │  Blur mode        Frosted glass│  │
│  │  Reveal mode      Hover        │  │
│  │  Thorough blur    Off          │  │
│  │  Blur categories  Text, Media  │  │
│  │  Pick & blur type Blur         │  │
│  │  PII mode         Blur         │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  [Recapture] [Edit pattern] [×]│  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ^mail\.       [regex]        ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ + Save current settings as site   │
│    rule                           ]  │
│                                      │
└──────────────────────────────────────┘
```

---

## 4. List View — Expanded Card, No Snapshot

Card expanded but no snapshot was ever saved for this rule.

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  ┌────────────────────────────────┐  │
│  │ github.com      [exact]      ▼ │  │
│  ├────────────────────────────────┤  │
│  │  Settings snapshot             │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  No snapshot saved —           │  │
│  │  inherits global settings      │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  [Recapture] [Edit pattern] [×]│  │
│  └────────────────────────────────┘  │
│                                      │
│  [ + Save current settings as site   │
│    rule                           ]  │
│                                      │
└──────────────────────────────────────┘
```

---

## 5. Add Rule Form

Opened by clicking "+ Save current settings as site rule". Snapshot auto-captured on open.

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  Apply saved settings automatically  │
│  when you visit a matching site.     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Site pattern                  │  │
│  │  [github.com                 ] │  │
│  │                                │  │
│  │  Match type                    │  │
│  │  ● Wildcard  ○ Exact  ○ Regex  │  │
│  │                                │  │
│  │  Snapshot preview              │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  Blur radius      6px          │  │
│  │  Blur mode        Blur         │  │
│  │  Reveal mode      Hover        │  │
│  │  Thorough blur    Off          │  │
│  │  Blur categories  Text, Media, │  │
│  │                   Table,       │  │
│  │                   Structure    │  │
│  │  Pick & blur type Blur         │  │
│  │  PII mode         Blur         │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  [Recapture]                   │  │
│  │                                │  │
│  │        [Save]       [Cancel]   │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

---

## 6. Edit Form

Opened via "Edit pattern" in an expanded card. Pre-filled with existing rule data; snapshot shows saved values with "saved" note. Recapture replaces with fresh capture.

```
┌──────────────────────────────────────┐
│  ← Site Rules                        │
├──────────────────────────────────────┤
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Site pattern                  │  │
│  │  [*.google.com               ] │  │
│  │                                │  │
│  │  Match type                    │  │
│  │  ● Wildcard  ○ Exact  ○ Regex  │  │
│  │                                │  │
│  │  Snapshot preview  (saved)     │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  Blur radius      10px         │  │
│  │  Blur mode        Frosted glass│  │
│  │  Reveal mode      Hover        │  │
│  │  Thorough blur    Off          │  │
│  │  Blur categories  Text, Media  │  │
│  │  Pick & blur type Blur         │  │
│  │  PII mode         Blur         │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │  [Recapture]                   │  │
│  │                                │  │
│  │        [Save]       [Cancel]   │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ github.com      [exact]      ▶ │  │
│  └────────────────────────────────┘  │
│                                      │
│  [ + Save current settings as site   │
│    rule                           ]  │
│                                      │
└──────────────────────────────────────┘
```

---

## Type Badge Color Coding

| Badge | Color token |
|---|---|
| `[exact]`    | `--bl-indigo` |
| `[wildcard]` | `--bl-cyan` |
| `[regex]`    | `--bl-amber` |

Implemented via `.bl-rule-type-badge--exact`, `--wildcard`, `--regex` modifier classes.
