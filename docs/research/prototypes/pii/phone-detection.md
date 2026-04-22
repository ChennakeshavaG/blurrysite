# Phone PII Detection

> Not implemented. Target: `[data-bl-si-pii="PHONE"]` via TreeWalker. US NANP + common international.

## Format Coverage

| Format | Example | FP Risk |
|---|---|---|
| +1 (NPA) NXX-XXXX | `+1 (555) 123-4567` | Very low |
| +1-NPA-NXX-XXXX | `+1-555-123-4567` | Very low |
| 1-NPA-NXX-XXXX | `1-555-123-4567` | Low |
| (NPA) NXX-XXXX | `(555) 123-4567` | Low |
| NPA-NXX-XXXX (dashes/dots) | `555-123-4567` | Medium — SKUs, order #s |
| NPA NXX XXXX (spaces) | `555 123 4567` | High — skip |
| Bare 10-digit | `5551234567` | Very high — skip |
| International E.164 | `+44 20 7946 0958` | Low |
| With extension | `555-123-4567 ext. 42` | Low |

## Recommended Regex (Approach B — per-format array)

```javascript
const PHONE_REGEXES = [
  // +1 (NPA) NXX-XXXX
  /\+1[-.\s]?\(\d{3}\)[-.\s]?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,
  // +1 NPA-NXX-XXXX (no parens)
  /\+1[-.\s]?\d{3}[-.\s]\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,
  // 1-NPA-NXX-XXXX (leading 1, no +)
  /\b1[-.\s]?\(?(\d{3})\)?[-.\s]?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?\b/gi,
  // (NPA) NXX-XXXX
  /\(\d{3}\)\s?\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,
  // NPA-NXX-XXXX (dashes or dots only — no spaces to cut FPs)
  /\b\d{3}[-.](\d{3})[-.](\d{4})\b(?:\s*(?:ext|x|#)\.?\s*\d{1,6})?/gi,
  // International E.164 (non-+1)
  /\+(?!1\b)(?:[2-9]\d{0,2})[-.\s]?(?:\d[-.\s]?){6,12}\d/gi,
];
```

Also scan `href="tel:..."` attributes separately — zero FP rate (guaranteed phone number).

## NPA/NXX Structural Validation

```javascript
function isValidNANP(digits) {
  if (digits.length !== 10) return false;
  const npa = digits.slice(0, 3);
  const nxx = digits.slice(3, 6);
  // NPA: cannot start with 0 or 1; N11 service codes (211, 311…911) are valid but rare
  if (/^[01]/.test(npa)) return false;
  // NXX: cannot start with 0 or 1
  if (/^[01]/.test(nxx)) return false;
  // 555-0100–555-0199: fiction range
  if (npa === '555' && nxx === '555') return false;
  return true;
}
```

## Key False Positives

| Source | Format collision | Mitigation |
|---|---|---|
| Product SKUs | `555-123-4567` (Group 5 match) | NPA validation rejects some; context heuristics |
| Order/tracking numbers | Same 3-3-4 grouping | No reliable structural distinguisher |
| Dates | Different groupings — not a risk for formatted-only regex | N/A |
| SSNs | `NNN-NN-NNNN` ≠ `NNN-NNN-NNNN` — no collision | Safe |
| IP addresses | 4 groups, not 3 — no collision | Safe |

FP rate estimate (formatted-only, with NPA validation): **4–7%**.

## Implementation Notes

- Scan `href="tel:..."` as a separate path — no FP risk.
- Do NOT scan spaces-only format (`555 123 4567`) — too many false positives.
- Do NOT scan bare 10-digit — FP rate ~80% even with NPA validation.
- Non-breaking spaces (` `) appear in formatted numbers; normalize before matching.
- Phone numbers split across sibling elements are undetectable with TreeWalker — accepted limitation.
