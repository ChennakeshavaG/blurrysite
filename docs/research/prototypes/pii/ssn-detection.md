# SSN PII Detection

> Not implemented. Target: `[data-bl-si-pii="SSN"]` via TreeWalker. Highest-sensitivity PII — lean toward recall over precision.

## Format Coverage

| Format | Example | Frequency | Default-on? |
|---|---|---|---|
| F1: Dash-separated | `123-45-6789` | Very high (>90%) | Yes |
| F2: Space-separated | `123 45 6789` | Low–medium (5–15%) | Yes |
| F3: Mixed separators | `123-45 6789` | Rare | Yes (covered by B) |
| F4: No separators (bare 9-digit) | `123456789` | Common in exports | No — opt-in only |
| F5–F8: Partially masked | `***-**-6789`, `XXX-XX-6789` | Common on HR pages | Yes |
| F9: Labeled | `SSN: 123-45-6789` | Frequent | Yes (label anchors match) |

## Recommended Regex (Composite)

```javascript
// Pattern A — dash-separated (safe baseline, very low FP)
const SSN_RE_DASH  = /\b(\d{3})-(\d{2})-(\d{4})\b/g;

// Pattern B — dash-or-space (F1 + F2)
const SSN_RE_FMT   = /\b(\d{3})([-\s])(\d{2})\2(\d{4})\b/g;

// Pattern C — bare 9-digit (opt-in SSN_BARE only, high FP)
const SSN_RE_BARE  = /\b(\d{9})\b/g;

// Pattern D — context-anchored bare (label present before digits)
const SSN_RE_LABEL = /\b(?:SSN|social\s+security(?:\s+number)?|tax\s+id)[\s:#\-]*(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/gi;

// Pattern E — masked formats
const SSN_RE_MASK  = /\b[*Xx]{3}[-\s]?[*Xx]{2}[-\s]?(\d{4})\b/g;
```

Use Pattern B + D + E for default detection. Pattern C (bare) only behind an explicit opt-in.

## Structural Validation (Mandatory)

```javascript
function isValidSSN(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return false;

  const area   = digits.slice(0, 3);
  const group  = digits.slice(3, 5);
  const serial = digits.slice(5, 9);

  if (area === '000' || area === '666' || area >= '900') return false;
  if (group === '00') return false;
  if (serial === '0000') return false;

  // Known example/prop SSNs
  const n = area + group + serial;
  if (n === '123456789') return false;
  if (n === '219099999') return false;  // 1938 wallet insert
  if (n === '078051120') return false;  // Whitcher wallet insert

  return true;
}

// For masked patterns (only last 4 visible)
function isValidMaskedSSN(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 4 && digits !== '0000';
}
```

**Note:** Do NOT use geographic area-code filtering — SSA randomized assignments in 2011; old geographic rules are unreliable for post-2011 SSNs.

## Key False Positives

| Source | Risk | Mitigation |
|---|---|---|
| EIN (Employer ID) | `12-3456789` — different grouping (2-7) | Not matched by `NNN-NN-NNNN` |
| ZIP+4 | `12345-6789` — different grouping (5-4) | Not matched |
| ABA routing numbers | Some pass structural validation | Partial — group=00 rule catches common ones |
| Product catalog numbers `NNN-NN-NNNN` | Direct collision with F1 | Structural validation rejects ~15% |
| Phone numbers (bare) | Only with Pattern C (bare 9-digit) | Structural validation reduces but ~50% FP still |

FP rate: **1–2%** for formatted (F1+F2), **~50%** for bare 9-digit (hence opt-in only).

## Implementation Notes

- Do NOT use geographic area-code range tables for validation — they're invalid post-2011 randomization.
- Bare 9-digit (`SSN_BARE`) must be opt-in with a prominent FP warning in popup.
- Label-anchored pattern (D) is the safest way to detect bare digits — use it always.
- SSNs split across `<span>` elements are undetectable with TreeWalker — accepted limitation.
- PDF.js renders SSNs as individual character `<span>` elements — undetectable at text-node level.
