# Financial Numerics — Global

> Extends `../financial-detection.md` (US). Cards, IBAN, SWIFT, bank account formats, crypto, tax IDs.

This document covers globally-applicable financial number formats: payment-card numbers, IBANs,
SWIFT/BIC codes, country-specific bank account formats, CVV/expiry, crypto wallet addresses,
tax/VAT/GST identifiers, and investment IDs (ISIN/CUSIP/SEDOL). For broader currency-amount
heuristics (label words, thresholds, suppressors), see `../financial-detection.md`.

## Cards (Visa / MC / Amex / Discover / JCB / Diners / UnionPay / RuPay / Maestro / Mir)

Card PANs are the highest-precision financial PII targets — checksum-validated, narrow length ranges,
distinctive prefixes. All major networks use **Luhn (mod-10)** as the final-digit checksum.

### Per-network IIN/BIN ranges and lengths

| Network | IIN prefix(es) | Length | Luhn | Notes |
|---|---|---|---|---|
| Visa | `4` | 13, 16, 19 | Yes | 16 dominant; 13 legacy; 19 for some EU debit |
| Mastercard | `51–55`, `2221–2720` (2-series since 2017) | 16 | Yes | 2-series mandatory accept since Apr 2022 |
| Amex | `34`, `37` | 15 | Yes | CVV is 4 digits (CID), not 3 |
| Discover | `6011`, `644–649`, `65`, `622126–622925` | 16–19 | Yes | UnionPay co-branded range overlaps |
| JCB | `3528–3589` | 16–19 | Yes | Japan-origin; global acceptance |
| Diners Club | `30`, `36`, `38`, `39` | 14–19 | Yes | Older 14-digit cards still in circulation |
| UnionPay (CUP) | `62`, `81` | 16–19 | Yes (mostly) | China; some non-Luhn legacy ranges exist |
| RuPay | `60`, `65`, `81`, `82`, `508`, `353`, `356` | 16 | Yes | India domestic; co-branded with Discover/JCB |
| Maestro | `5018`, `5020`, `5038`, `5893`, `6304`, `6759`, `6761–6763` | 12–19 | Yes | Variable length is recall-killer |
| Mir | `2200–2204` | 16–19 | Yes | Russian domestic |

**Format on screen:** Almost always grouped in 4-digit blocks separated by space or hyphen
(`4111 1111 1111 1111`, `4111-1111-1111-1111`). Amex groups 4-6-5 (`3782 822463 10005`).
Some UIs print without separators (`4111111111111111`) — must accept both.

### Regex sketch

A unified, network-agnostic regex matches the digit shape, then dispatches to a per-network length
+ prefix check, then Luhn-validates.

```javascript
// Step 1: Find candidate digit groups (12–19 digits, optional space/hyphen separators)
const PAN_RE = /(?<![A-Za-z\d])(?:\d[ -]?){11,18}\d(?![A-Za-z\d])/g;

// Step 2: Strip separators, classify, and Luhn-check.
function classifyPan(s) {
  const d = s.replace(/[ -]/g, '');
  const n = d.length;
  if (n < 12 || n > 19) return null;

  // Network detection by prefix
  if (/^4\d+$/.test(d) && [13, 16, 19].includes(n)) return 'visa';
  if (/^(?:5[1-5]\d{14}|2(?:2(?:2[1-9]|[3-9]\d)|[3-6]\d{2}|7(?:[01]\d|20))\d{12})$/.test(d)) return 'mastercard';
  if (/^3[47]\d{13}$/.test(d)) return 'amex';
  if (/^(?:6011|65\d{2}|64[4-9]\d|622(?:12[6-9]|1[3-9]\d|[2-8]\d{2}|9(?:[01]\d|2[0-5])))\d{12,15}$/.test(d)) return 'discover';
  if (/^35(?:2[89]|[3-8]\d)\d{12,15}$/.test(d)) return 'jcb';
  if (/^3(?:0[0-5]|[68]\d|9\d)\d{11,16}$/.test(d)) return 'diners';
  if (/^62\d{14,17}$/.test(d)) return 'unionpay';
  if (/^220[0-4]\d{12,15}$/.test(d)) return 'mir';
  return null;
}

function luhn(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
```

### Synthetic test values (canonical, well-known, safe to use)

| Network | Test PAN | Display form |
|---|---|---|
| Visa | `4111 1111 1111 1111` | classic test number |
| Visa-debit | `4012 8888 8888 1881` | Stripe debit test |
| Mastercard | `5555 5555 5555 4444` | classic test |
| Mastercard 2-series | `2223 0031 2200 3222` | post-2017 range |
| Amex | `3782 822463 10005` | 15-digit, 4-6-5 grouping |
| Discover | `6011 1111 1111 1117` | classic test |
| JCB | `3530 1113 3330 0000` | classic test |
| Diners | `3056 9309 0259 04` | 14-digit |
| UnionPay | `6240 0086 3140 1148` | test value |
| Maestro | `6759 6498 2643 8453` | UK Maestro |

### FP collision

- 16-digit phone numbers / order IDs / tracking numbers can match the digit shape.
  Luhn cuts ~90% of these — but ~10% of random 16-digit strings still pass Luhn by chance.
- Long ISBN / ISIN-like codes can match if they're all digits.
- Mitigation: require the prefix-classification step (not just digit shape) — random strings
  rarely begin with valid IINs.

### Context tokens

| Language | Tokens |
|---|---|
| English | `card`, `card number`, `credit card`, `debit card`, `PAN`, `Visa`, `Mastercard`, `Amex`, `expires`, `CVV`, `CVC` |
| Spanish | `tarjeta`, `número de tarjeta`, `crédito`, `débito`, `caduca` |
| German | `Karte`, `Kartennummer`, `Kreditkarte`, `gültig bis` |
| French | `carte`, `numéro de carte`, `crédit`, `débit`, `expire` |
| Hindi | `कार्ड`, `कार्ड नंबर`, `क्रेडिट कार्ड`, `डेबिट कार्ड` |
| Japanese | `カード`, `カード番号`, `クレジットカード` |

**Source:** [Payment card number — Wikipedia](https://en.wikipedia.org/wiki/Payment_card_number)

## Bank account numbers (US ABA, UK sort+account, IBAN, JP zengin, IN account+IFSC, BR agência+conta, AU BSB)

Bank account formats vary wildly by country. Most use a **routing/branch identifier + account number**
pair. IBAN unifies most of Europe under one format with a built-in checksum.

### Per-country formats

| Country | Pieces | Format | Length | Checksum | Source URL |
|---|---|---|---|---|---|
| **US** | ABA routing + account | 9-digit routing + 4-17-digit account | 13–26 | ABA mod-10 weighted | [routingnumber.aba.com](https://www.routingnumber.aba.com/) |
| **UK** | Sort code + account | `XX-XX-XX` (6 digits) + 8-digit account | 14 | None standard (Mod-10/11 internal) | [Wikipedia: Sort code](https://en.wikipedia.org/wiki/Sort_code) |
| **JP (zengin)** | Bank code + branch + account | 4-digit bank + 3-digit branch + 7-digit account | 14 | None | [Wikipedia: Zengin System](https://en.wikipedia.org/wiki/Zengin_System) |
| **IN** | Account + IFSC | 9–18 digits + IFSC `AAAA0NNNNNN` (4 letters + 0 + 6 alphanumeric) | varies + 11 | None | [RBI IFSC](https://en.wikipedia.org/wiki/Indian_Financial_System_Code) |
| **BR** | Agência + conta | 4-digit agência + variable account (typically 5–8 digits) | varies | mod-11 (per bank) | [Wikipedia: Bank account](https://en.wikipedia.org/wiki/Bank_account#Brazil) |
| **AU** | BSB + account | 6-digit BSB (`XXX-XXX`) + 6–10-digit account | 12–16 | None | [APCA BSB](https://en.wikipedia.org/wiki/Bank_state_branch) |
| **CA** | Transit + institution + account | 5-digit transit + 3-digit institution + 7-12-digit account | 15–20 | None | [Wikipedia: Canadian bank](https://en.wikipedia.org/wiki/Canadian_payments_system) |
| **ZA** | Branch + account | 6-digit branch + 9-11-digit account | 15–17 | None | [PASA](https://www.pasa.org.za/) |

### Regex sketches

```javascript
// US ABA routing (9 digits) — must satisfy ABA weighted checksum
const ABA_RE = /(?<![A-Za-z\d])\d{9}(?![A-Za-z\d])/g;
function abaCheck(d) {
  // weights 3,7,1,3,7,1,3,7,1
  const w = [3,7,1,3,7,1,3,7,1];
  let s = 0;
  for (let i = 0; i < 9; i++) s += d.charCodeAt(i) - 48 << 0, s += (+d[i]) * w[i];
  // (single sum is enough)
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (+d[i]) * w[i];
  return sum % 10 === 0 && d[0] !== '0' || true; // first digit can be 0–3 (Federal Reserve districts) — relax
}

// UK sort code + account
const UK_BANK_RE = /(?<![A-Za-z\d])(\d{2}[- ]?\d{2}[- ]?\d{2})\s+(\d{8})(?![A-Za-z\d])/g;

// India IFSC (always 11 chars: 4 letters + 0 + 6 alphanumeric)
const IFSC_RE = /(?<![A-Za-z\d])[A-Z]{4}0[A-Z0-9]{6}(?![A-Za-z\d])/g;

// Australia BSB (6 digits, often "XXX-XXX")
const BSB_RE = /(?<![A-Za-z\d])\d{3}-?\d{3}(?![A-Za-z\d])/g;

// Japan zengin: 4-3-7 digit groups
const ZENGIN_RE = /(?<![A-Za-z\d])\d{4}[- ]\d{3}[- ]\d{7}(?![A-Za-z\d])/g;
```

### Synthetic test values

| Country | Example |
|---|---|
| US | Routing `021000021` (Chase NY), Account `123456789` |
| UK | `12-34-56` `12345678` |
| IN | IFSC `HDFC0000001`, Account `12345678901` |
| AU | BSB `062-001` (CBA Sydney), Account `12345678` |
| JP | `0001-001-1234567` (Mizuho main branch shape) |

### FP collision

- **9-digit US routing** vs SSN: same length, different position. SSN has `XXX-XX-XXXX` dashes.
  Bare 9-digit numbers — only context disambiguates.
- **8-digit UK account** vs random IDs / dates without separator. Sort code prefix is the anchor.
- **IFSC** `[A-Z]{4}0[A-Z0-9]{6}` is highly distinctive — collision risk near zero.
- **BSB** `XXX-XXX` collides with phone number area-code-style formatting; require "BSB" context.

### Context tokens

| Language | Tokens |
|---|---|
| English | `account`, `account number`, `acct`, `routing`, `ABA`, `sort code`, `BSB`, `IFSC`, `branch code` |
| Hindi | `खाता संख्या`, `खाता नंबर`, `IFSC कोड` |
| Japanese | `口座番号`, `銀行コード`, `支店コード` |
| Portuguese (BR) | `agência`, `conta`, `número da conta` |

---

### IBAN — top 13 countries by web traffic

IBAN unifies bank account formats across SEPA + neighbours. Each IBAN is country-code-prefixed
and length-fixed. Validation via **mod-97**.

| Country | ISO | Total length | BBAN structure | Example |
|---|---|---|---|---|
| Germany | DE | 22 | 18n | `DE89 3704 0044 0532 0130 00` |
| France | FR | 27 | 10n,11c,2n | `FR14 2004 1010 0505 0001 3M02 606` |
| United Kingdom | GB | 22 | 4a,14n | `GB82 WEST 1234 5698 7654 32` |
| Spain | ES | 24 | 20n | `ES91 2100 0418 4502 0005 1332` |
| Italy | IT | 27 | 1a,10n,12c | `IT60 X054 2811 1010 0000 0123 456` |
| Netherlands | NL | 18 | 4a,10n | `NL91 ABNA 0417 1643 00` |
| Belgium | BE | 16 | 12n | `BE68 5390 0754 7034` |
| Switzerland | CH | 21 | 5n,12c | `CH93 0076 2011 6238 5295 7` |
| Ireland | IE | 22 | 4a,6n,8n | `IE29 AIBK 9311 5212 3456 78` |
| Portugal | PT | 25 | 21n | `PT50 0002 0123 1234 5678 9015 4` |
| Norway | NO | 15 | 11n | `NO93 8601 1117 947` |
| Denmark | DK | 18 | 14n | `DK50 0040 0440 1162 43` |
| Sweden | SE | 24 | 20n | `SE45 5000 0000 0583 9825 7466` |

**Key:** `n` = numeric, `a` = uppercase alpha, `c` = alphanumeric.

**India:** No IBAN. Uses 9–18-digit account number + 11-char IFSC code (above).

### IBAN regex sketch

```javascript
// Country-aware IBAN — full set of supported countries with their lengths
const IBAN_LENGTHS = {
  AD:24, AE:23, AL:28, AT:20, AZ:28, BA:20, BE:16, BG:22, BH:22, BR:29, CH:21,
  CR:22, CY:28, CZ:24, DE:22, DK:18, DO:28, EE:20, ES:24, FI:18, FO:18, FR:27,
  GB:22, GE:22, GI:23, GL:18, GR:27, GT:28, HR:21, HU:28, IE:22, IL:23, IS:26,
  IT:27, JO:30, KW:30, KZ:20, LB:28, LI:21, LT:20, LU:20, LV:21, MC:27, MD:24,
  ME:22, MK:19, MR:27, MT:31, MU:30, NL:18, NO:15, PK:24, PL:28, PS:29, PT:25,
  QA:29, RO:24, RS:22, SA:24, SE:24, SI:19, SK:24, SM:27, TN:24, TR:26, UA:29,
  VG:24, XK:20,
};

const IBAN_RE = /(?<![A-Z\d])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Z\d])/g;

function ibanCheck(s) {
  const iban = s.replace(/\s+/g, '').toUpperCase();
  const cc = iban.slice(0, 2);
  if (IBAN_LENGTHS[cc] !== iban.length) return false;
  // Move first 4 chars to end, replace letters with 2-digit codes (A=10..Z=35), mod-97 == 1
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  // Compute mod-97 in chunks (BigInt-free for portability)
  let r = 0;
  for (let i = 0; i < expanded.length; i++) r = (r * 10 + (+expanded[i])) % 97;
  return r === 1;
}
```

### Display formatting

IBAN almost always rendered with spaces every 4 chars: `DE89 3704 0044 0532 0130 00`.
Some banking UIs print without spaces: `DE89370400440532013000`. Both must match.

### FP collision

- IBAN's two-letter country code prefix + mod-97 makes it extremely high-precision.
- Random alphanumeric strings of correct length passing mod-97: ~1/97 ≈ 1%.
- Combined with valid country code prefix and length match: collision rate near zero.
- **Verdict: regex + checksum alone is sufficient.** No context needed for high precision.

### Context tokens

| Language | Tokens |
|---|---|
| English | `IBAN`, `account number`, `bank account` |
| German | `IBAN`, `Kontonummer`, `Bankverbindung` |
| French | `IBAN`, `numéro de compte`, `RIB` |
| Italian | `IBAN`, `coordinate bancarie` |
| Spanish | `IBAN`, `número de cuenta` |

**Source:** [IBAN — Wikipedia](https://en.wikipedia.org/wiki/International_Bank_Account_Number),
[ECBS IBAN Registry](https://www.swift.com/standards/data-standards/iban-international-bank-account-number)

## SWIFT / BIC

- **Format**: 8 or 11 alphanumeric characters. Structure: 4-char bank code (letters) + 2-char country code (ISO 3166-1 alpha-2) + 2-char location code (alphanumeric) + optional 3-char branch code.
- **Regex sketch**:
  ```js
  const BIC_RE = /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;
  ```
- **Synthetic example**: `DEUTDEFF` (Deutsche Bank Frankfurt HQ), `BARCGB22` (Barclays London), `CHASUS33` (JPMorgan Chase NYC).
- **Checksum**: none.
- **FP collision**: alphanumeric strings of correct length but invalid country code (positions 5–6 must be valid ISO country code). Sentence words rarely contain 8+ all-uppercase characters with embedded country code.
- **Context tokens**: `BIC`, `SWIFT`, `SWIFT code`, `BIC code`, `Bankverbindung`, `code SWIFT`.
- **Source**: [ISO 9362](https://www.iso.org/standard/60390.html), [SWIFT BIC search](https://www.swift.com/our-solutions/services/business-intelligence/swift-bic).

## Card-not-present extras (CVV, expiry)

### CVV / CVC / CID

- **Visa / MC / Discover**: 3 digits.
- **Amex**: 4 digits (CID).
- **Format on screen**: bare 3-or-4-digit number near a card.
- **Regex sketch (with required nearby card-context)**:
  ```js
  const CVV_RE = /\b\d{3,4}\b/g; // run only inside a 50-char window of "CVV"|"CVC"|"CID"|"security code"
  ```
- **Detection strategy**: bare 3-digit numbers are everywhere on the web. Treat CVV as **context-only** — never flag a 3-digit number unless one of the keywords appears within 50 chars (or in the same form field's `<label>`).
- **Context tokens**: `CVV`, `CVC`, `CID`, `card security code`, `security code`, `código de seguridad`, `code de sécurité`, `Sicherheitscode`, `セキュリティコード`.

### Expiration date

- **Format**: `MM/YY`, `MM/YYYY`, `MM-YY`, `MM YY`. Year 2 or 4 digits; month 01–12.
- **Regex sketch**:
  ```js
  const EXPIRY_RE = /\b(0[1-9]|1[0-2])[\/\- ](?:\d{2}|20\d{2})\b/g;
  ```
- **Synthetic example**: `12/25`, `06/2027`.
- **FP collision**: any month/year date — the field meaning is contextual. Same constraint as CVV: only flag inside `expir(es|ation|y)` / `valid through` / `gültig bis` keyword window, OR adjacent to a card PAN match.
- **Context tokens**: `expires`, `expiration`, `valid through`, `valid thru`, `exp`, `gültig bis`, `caduca`, `expire`.

## Crypto addresses (BTC, ETH)

| Network | Format | Length | Regex sketch | Checksum | Example |
|---|---|---|---|---|---|
| BTC (P2PKH legacy) | Base58 starts `1` | 26–34 | `/\b1[a-km-zA-HJ-NP-Z1-9]{25,33}\b/g` | Base58Check (double-SHA256 last 4 bytes) | `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` (Satoshi genesis) |
| BTC (P2SH) | Base58 starts `3` | 26–34 | `/\b3[a-km-zA-HJ-NP-Z1-9]{25,33}\b/g` | Base58Check | `3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy` |
| BTC (Bech32 SegWit) | starts `bc1` | 14–74 | `/\bbc1[ac-hj-np-z02-9]{6,87}\b/g` | bech32 checksum (BIP-173) | `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4` |
| ETH | `0x` + 40 hex | 42 | `/\b0x[a-fA-F0-9]{40}\b/g` | EIP-55 mixed-case checksum (optional) | `0x742d35Cc6634C0532925a3b844Bc454e4438f44e` |
| Litecoin | starts `L`/`M`/`ltc1` | similar to BTC | similar | Base58Check / bech32 | `LbYPYHnFiy6KsM7gnANbJ8FUyrhCZsK4nq` |
| Solana | Base58 32-byte | 32–44 | `/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g` | none (just length) | `So11111111111111111111111111111111111111112` |

**Notes**:
- Crypto addresses are alphanumeric — included for completeness; the bare-digit regex won't match.
- Detection generally relies on prefix (`0x`, `bc1`, `1`, `3`, `ltc1`) + length + checksum.
- ETH `0x` + 40 hex is the highest-precision pattern (any non-`0x`-prefixed 40-hex string is unlikely on user pages).
- **Sensitivity**: addresses themselves are PUBLIC (visible on-chain) — but linking them to a real identity is sensitive. Treat as MEDIUM PII.

**Context tokens**: `wallet`, `address`, `BTC`, `Bitcoin`, `ETH`, `Ethereum`, `crypto`, `0x` (literal prefix is highly distinctive).

**Source**: [BIP-173 (bech32)](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki), [EIP-55](https://eips.ethereum.org/EIPS/eip-55).

## Tax / VAT / GST per country

| Country | ID | Format | Regex sketch | Checksum |
|---|---|---|---|---|
| EU VAT | varies — `[A-Z]{2}` country prefix + 8–12 digits/letters | `/\b[A-Z]{2}[A-Z0-9]{8,12}\b/g` | per-country (mod-97, mod-11, weighted) |
| DE VAT | `DE` + 9 digits | `/\bDE\d{9}\b/g` | mod-11 |
| FR VAT | `FR` + 2 alphanumeric + 9 digits | `/\bFR[A-Z0-9]{2}\d{9}\b/g` | mod-97 over the 9-digit SIREN |
| UK VAT | `GB` + 9 or 12 digits | `/\bGB\d{9}(?:\d{3})?\b/g` | weighted mod-97 |
| IT VAT | `IT` + 11 digits (= partita IVA) | `/\bIT\d{11}\b/g` | Luhn-like |
| ES VAT (NIF/NIE) | `ES` + 9 chars (mix letter+digit) | `/\bES[A-Z0-9]\d{7}[A-Z0-9]\b/g` | DNI letter algorithm |
| IN GSTIN | 15 chars: 2-digit state + 10-char PAN + entity + `Z` + check | `/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g` | base-36 weighted mod-36 |
| AU ABN | 11 digits | `/\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g` | weighted mod-89 |
| CA GST/HST | 9-digit BN + 2-letter program (`RT`) + 4-digit reference | `/\b\d{9}RT\d{4}\b/g` | none |
| SG GST | 9–10 char alphanumeric | `/\b[A-Z]\d{8,9}[A-Z]\b/g` | none |

**Context tokens**: `VAT`, `TVA` (FR), `IVA` (IT/ES), `MwSt`/`USt` (DE), `GST`, `GSTIN`, `ABN`, `Tax ID`, `BTW` (NL).

**Source**: [European Commission VIES](https://ec.europa.eu/taxation_customs/vies/), [GST Council India](https://gstcouncil.gov.in/).

## Investment IDs (ISIN, CUSIP, SEDOL)

| ID | Format | Length | Regex sketch | Checksum | Example |
|---|---|---|---|---|---|
| **ISIN** | 2-letter country + 9 alphanumeric + check digit | 12 | `/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g` | mod-10 (Luhn over alphanumeric→digit expansion) | `US0378331005` (Apple) |
| **CUSIP** | 9 alphanumeric, US/CA only | 9 | `/\b[0-9A-Z]{9}\b/g` (high FP without context) | mod-10 weighted | `037833100` (Apple) |
| **SEDOL** | 7 alphanumeric, UK | 7 | `/\b[B-DF-HJ-NP-TV-Z0-9]{6}\d\b/g` (no vowels) | weighted mod-10 | `2046251` (Vodafone) |
| **FIGI** | `BBG` + 8 alphanumeric + check | 12 | `/\bBBG[A-Z0-9]{8}\d\b/g` | mod-10 weighted | `BBG000B9XRY4` |

**Notes**:
- ISIN's leading 2-letter country prefix and trailing check digit make it self-validating.
- CUSIP regex is dangerously generic; require `CUSIP` keyword.
- SEDOL excludes vowels — that gates ~95% of random 7-char strings.

**Context tokens**: `ISIN`, `CUSIP`, `SEDOL`, `ticker`, `security`, `share`, `bond`, `WKN` (DE).

**Source**: [ISO 6166 (ISIN)](https://www.iso.org/standard/78502.html), [ANNA (Association of National Numbering Agencies)](https://www.anna-web.org/).

## Other (gift cards, transaction refs, policy numbers)

- **Gift cards / store credit**: vendor-specific, typically 16–19 digits or alphanumeric. Often look like card PANs (some pass Luhn). Example: Amazon gift card `AAAA-BBBBBB-CCCC` (alphanumeric). Detect via context only (`gift card`, `voucher`, `redemption`).
- **Transaction reference IDs**: highly variable. PayPal: `XXXXXXXXXX-XXXXXXXXX` (alphanumeric, 17 chars). Stripe: `pi_3...` / `ch_3...` (alphanumeric prefix). Square: `XXX-XXX-XXX`. Detect via vendor prefix when known.
- **Insurance policy numbers**: alphanumeric, often 8–14 chars. No standard format — context-only.
- **Loan / mortgage account numbers**: usually 8–12 digits, lender-specific. Context-only.
- **Wire transfer reference**: free-text alphanumeric. Context-only.
- **Order / receipt / confirmation numbers**: see `false-positives.md` — typically NOT sensitive but format collides with PII.

---

## Detection priority table

Sorted by **(precision × prevalence)**.

| Pattern | Tier | Precision tools | Notes |
|---|---|---|---|
| **Card PAN** | Tier 1 | Luhn + IIN/BIN range + 4-4-4-4 grouping | Highest-prevalence financial PII; mandatory Luhn |
| **IBAN** | Tier 1 | mod-97 + country code + length table | Self-validating; no context needed |
| **ETH wallet** | Tier 1 | `0x` + 40 hex literal | Very distinctive prefix |
| **BTC wallet** | Tier 1 | bech32/Base58 + prefix | Self-validating via checksum |
| **ISIN** | Tier 1 | country prefix + Luhn-like check | High precision via length + check |
| **GSTIN** | Tier 1 | 15-char structure + mod-36 | Distinctive |
| **VAT (EU country-prefixed)** | Tier 2 | country code + length table | Prefix gates collision |
| **SWIFT/BIC** | Tier 2 | format + valid country code | No checksum but country gate |
| **US ABA routing** | Tier 2 | mod-10 + Federal Reserve district 0–3 | 9-digit collides with SSN — context required |
| **UK sort code** | Tier 2 | `XX-XX-XX` + nearby 8-digit account | Sort-code keyword raises confidence |
| **AU BSB** | Tier 2 | `XXX-XXX` + `BSB` keyword | Collides with phone |
| **IN IFSC** | Tier 1 | `[A-Z]{4}0[A-Z0-9]{6}` literal | Very distinctive |
| **CUSIP** | Tier 3 | mod-10 + `CUSIP` keyword | Bare 9-char alphanumeric is too generic alone |
| **SEDOL** | Tier 3 | no-vowel rule + checksum + UK keyword | UK-specific |
| **CVV / CID** | Tier 3 | context-only (50-char window) | Bare 3–4 digits |
| **Expiry** | Tier 3 | context-only or PAN-adjacent | MM/YY shape too generic |
| **Gift card / voucher** | Tier 3 | vendor prefix + context | Highly variable |
| **Transaction ref** | Tier 4 | vendor prefix only | Skip unless vendor SDK present |

### Implementation guidance

1. **Run Tier 1 detectors first.** Their checksums + structural gates eliminate >99% of FPs without context.
2. **Tier 2 needs context windowing.** 100-char keyword window (English + 2–3 local languages).
3. **Tier 3 is opt-in only.** Most users don't want 3-digit numbers blurred; gate behind explicit "blur card details" toggle.
4. **Always tokenize before regex.** Strip thousand-separators (`,`/`.`/`'`) before Luhn/mod-97. PAN regex must accept space and hyphen separators.

---

## References

- ISO 7064 (check digit algorithms): [https://www.iso.org/standard/31531.html](https://www.iso.org/standard/31531.html)
- ISO 9362 (BIC): [https://www.iso.org/standard/60390.html](https://www.iso.org/standard/60390.html)
- ISO 6166 (ISIN): [https://www.iso.org/standard/78502.html](https://www.iso.org/standard/78502.html)
- ISO 13616 (IBAN): [https://www.iso.org/standard/41031.html](https://www.iso.org/standard/41031.html)
- Luhn algorithm: [https://en.wikipedia.org/wiki/Luhn_algorithm](https://en.wikipedia.org/wiki/Luhn_algorithm)
- Payment card numbers: [https://en.wikipedia.org/wiki/Payment_card_number](https://en.wikipedia.org/wiki/Payment_card_number)
- IBAN registry (SWIFT): [https://www.swift.com/standards/data-standards/iban-international-bank-account-number](https://www.swift.com/standards/data-standards/iban-international-bank-account-number)
- BIP-173 (bech32): [https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki)
- EIP-55 (Ethereum address checksum): [https://eips.ethereum.org/EIPS/eip-55](https://eips.ethereum.org/EIPS/eip-55)
- VIES VAT validator: [https://ec.europa.eu/taxation_customs/vies/](https://ec.europa.eu/taxation_customs/vies/)
- ANNA (numbering agencies): [https://www.anna-web.org/](https://www.anna-web.org/)
- BSB Codes Australia: [https://en.wikipedia.org/wiki/Bank_state_branch](https://en.wikipedia.org/wiki/Bank_state_branch)
- Sort code UK: [https://en.wikipedia.org/wiki/Sort_code](https://en.wikipedia.org/wiki/Sort_code)
- Routing transit number US: [https://www.routingnumber.aba.com/](https://www.routingnumber.aba.com/)
- IFSC codes India: [https://en.wikipedia.org/wiki/Indian_Financial_System_Code](https://en.wikipedia.org/wiki/Indian_Financial_System_Code)
