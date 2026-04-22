# Credit Card PII Detection

> Not implemented. Target: `[data-bl-si-pii="CREDIT_CARD"]` via TreeWalker. Luhn check mandatory.

## Network Format Reference

| Network | Length | Prefix | Display grouping |
|---|---|---|---|
| Visa | 13 (legacy), 16 | Starts with `4` | 4-4-4-4 |
| Mastercard | 16 | 51–55 or 2221–2720 | 4-4-4-4 |
| Amex | 15 | 34, 37 | 4-6-5 |
| Discover | 16 | 6011, 622126–622925, 65 | 4-4-4-4 |
| Diners Club | 14 | 300–305, 36, 54 | 4-6-4 |
| JCB | 16 | 3528–3589 | 4-4-4-4 |
| UnionPay | 16–19 | 62, 81 | 4-4-4-4 |

## Recommended Regex Set

```javascript
const CC_RE_16_SPACED  = /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/g;
const CC_RE_16_COMPACT = /\b\d{16}\b/g;
const CC_RE_15_SPACED  = /\b\d{4}[\s\-]\d{6}[\s\-]\d{5}\b/g;   // Amex
const CC_RE_15_COMPACT = /\b\d{15}\b/g;
const CC_RE_14_SPACED  = /\b\d{4}[\s\-]\d{6}[\s\-]\d{4}\b/g;   // Diners
const CC_RE_14_COMPACT = /\b\d{14}\b/g;
const CC_RE_13_COMPACT = /\b\d{13}\b/g;                          // Visa legacy

// Masked first-4/last-4 — cannot Luhn-check, detect as-is
const CC_RE_MASKED = /\b\d{4}[\s\-][*X•]{4}[\s\-][*X•]{4}[\s\-]\d{4}\b/gi;
```

Always clone `/g` regexes before use (`new RegExp(re.source, re.flags)`) — stateful `.lastIndex` causes silent misses on repeated calls.

## Luhn Validation (Mandatory)

```javascript
function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function luhnCheck(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 13 && luhn(digits);
}
```

- Every legitimate card passes Luhn — zero false negatives from Luhn filtering.
- ~10% of random digit strings pass Luhn (check digit has exactly one valid value).
- FP rate after Luhn: **2–5%** for spaced format, **1–3%** for per-network prefix regex.

## Key False Positives

| Source | Risk | Mitigation |
|---|---|---|
| Order/transaction IDs | 3–12% pass Luhn | IIN prefix check (must start with known network prefix) |
| Phone numbers (10-digit) | ~10% pass Luhn | Length mismatch (10 ≠ 13–19 digits) |
| EAN-13 barcodes | Different checksum (weight 1/3 not 1/2) — some overlap | Luhn partially helps |
| Loyalty/account numbers | Variable — empirically 3–12% pass Luhn | No reliable mitigation |

## Implementation Notes

- **Do NOT detect last-4-only** (`ending in 9010`) — 10,000 possibilities, appears in PINs, ZIPs, years.
- **Detect masked first-4/last-4** (`4532 **** **** 9010`) — distinctive pattern, low FP.
- `<input type="text">` and `<input autocomplete="cc-number">` have no text nodes — not detected by TreeWalker (intentional; blurring active entry fields breaks UX).
- Non-breaking spaces appear in formatted numbers — regex `[\s\-]` already covers ` ` via `\s`.
