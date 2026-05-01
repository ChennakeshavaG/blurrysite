# Numeric PII Detection — Consolidated Regex Catalog & Pipeline

> One catalog. One state machine. Short-circuit on confident matches; cascade on weak ones.
>
> Goal: replace the current flat "match-then-suppress" loop in `src/pii_detector.js` with a staged pipeline. Each stage has known cost and confidence; later stages only run when earlier ones don't fire. Once a span is consumed by a high-confidence detector, no later stage re-examines it.

Source files for every entry below: see [`INDEX.md`](./INDEX.md) for the per-topic research.

---

## TL;DR — the cascade

```
┌─────────────────────────────────────────────────────────────────────┐
│ TEXT NODE                                                           │
│   │                                                                 │
│   ▼                                                                 │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ STAGE 0  PRE-FILTER (whole-node drop)                        │   │
│ │   • _isExtensionUI                                           │   │
│ │   • _isInsidePiiSpan                                         │   │
│ │   • _isInsideCodeBlock  (NEW — <pre>/<code>/<kbd>/<samp>)   │   │
│ │   • blank/whitespace                                         │   │
│ └──────────────────────────────────────────────────────────────┘   │
│   │ pass                                                            │
│   ▼                                                                 │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ STAGE 1  HIGH-CONFIDENCE DETECTORS  (regex + checksum)       │   │
│ │   self-validating — no context window needed                 │   │
│ │   ┌──────────────┐  match → CONSUME span → emit typed PII   │   │
│ │   │ EMAIL        │  → emit type='email'                     │   │
│ │   │ CARD PAN     │  Luhn + IIN + length                     │   │
│ │   │ IBAN         │  mod-97 + country length                 │   │
│ │   │ ETH wallet   │  0x + 40 hex                             │   │
│ │   │ BTC wallet   │  bech32 / Base58Check                    │   │
│ │   │ Aadhaar      │  Verhoeff + first-digit gate             │   │
│ │   │ CN ID        │  ISO 7064 mod-11-2 + DOB                 │   │
│ │   │ Codice Fisc. │  16 alphanumeric + check letter          │   │
│ │   │ NIE / DNI    │  letter checksum                         │   │
│ │   │ ISBN-13      │  Luhn-13 + 978/979 prefix → SUPPRESS     │   │
│ │   │ ISBN-10      │  mod-11 + 9-digit body → SUPPRESS        │   │
│ │   └──────────────┘  match → SUPPRESS span (consumed; not blurred)│
│ └──────────────────────────────────────────────────────────────┘   │
│   │ remaining text after consumed spans                             │
│   ▼                                                                 │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ STAGE 2  CONTEXT-GATED DETECTORS  (regex + keyword window)   │   │
│ │   need ±N-char keyword or page-country signal to fire        │   │
│ │   ┌──────────────┐  match → CONSUME span → emit typed PII   │   │
│ │   │ NHS Number   │  mod-11 + "NHS"/"patient" or .uk         │   │
│ │   │ SSN          │  range gates + "SSN"/"social"            │   │
│ │   │ NPI          │  Luhn(80840+npi) + "NPI"/"provider"      │   │
│ │   │ E.164 phone  │  + or country-code keyword               │   │
│ │   │ NANP phone   │  shape + "phone"/"tel" or US signal      │   │
│ │   │ National phn │  per country signal                      │   │
│ │   │ GPS dec coord│  bounds + "lat"/"lon"/"GPS"              │   │
│ │   │ DMS coord    │  ° ' " + N/S/E/W                         │   │
│ │   │ Plus code    │  alphanumeric + "+" position             │   │
│ │   │ MAC address  │  6 hex pairs                             │   │
│ │   │ IPv4 / IPv6  │  octet bounds + suppress private range   │   │
│ │   │ MRN          │  digit + "MRN"/"chart"/"patient ID"      │   │
│ │   │ Member ID    │  + "Member"/"Subscriber"/"Policy #"      │   │
│ │   │ SWIFT/BIC    │  4-2-2(-3) + valid ISO country letters   │   │
│ │   │ Postal code  │  digit shape + page-country signal       │   │
│ │   └──────────────┘                                           │   │
│ └──────────────────────────────────────────────────────────────┘   │
│   │ remaining text after consumed spans                             │
│   ▼                                                                 │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ STAGE 3  GENERIC NUMERIC REGEXES  (current 5 patterns)       │   │
│ │   ┌──────────────────────────────────────────┐               │   │
│ │   │ CURRENCY_PREFIX  $1,234.56               │               │   │
│ │   │ CURRENCY_SUFFIX  1234 USD                │               │   │
│ │   │ GROUPED_THOUSAND 1,234,567               │               │   │
│ │   │ PHONE_SHAPE      111-222-333             │               │   │
│ │   │ BARE_DIGITS      \b\d{4,}\b              │               │   │
│ │   └──────────────────────────────────────────┘               │   │
│ │   each candidate → STAGE 4 cascade                           │   │
│ └──────────────────────────────────────────────────────────────┘   │
│   │                                                                 │
│   ▼                                                                 │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ STAGE 4  FP SUPPRESSOR CASCADE  (cheap → expensive)          │   │
│ │   short-circuit on first hit → SUPPRESS                      │   │
│ │   1. STRUCTURAL (match-self, ~1µs):                          │   │
│ │      isYear, isHexColor, isPercentage,                       │   │
│ │      isScientificNotation, isYearRange, isVersion            │   │
│ │   2. TRAILING-CHAR (next 4–8 chars, ~1µs):                   │   │
│ │      isMeasurement, isResolution                             │   │
│ │   3. PRECEDING-WORD (back 30 chars, ~5µs):                   │   │
│ │      isOrdinalLabel                                          │   │
│ │   4. KEYWORD-WINDOW (±50 chars, ~10µs):                      │   │
│ │      isDateLike, isOrderRef                                  │   │
│ │   5. KEYWORD-WINDOW (±100/150 chars, ~20µs):                 │   │
│ │      isPublicPrice, isCountNoise, isStatistic                │   │
│ │   no suppressor fired → emit type='numeric'                  │   │
│ └──────────────────────────────────────────────────────────────┘   │
│   │                                                                 │
│   ▼                                                                 │
│ EMIT MATCHES → wrap in [data-bl-si-pii] spans                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Consolidated regex catalog

Every regex used across the research, in one place. Each entry: pattern → which stage runs it → required validator/gate → source file.

### Stage 1 — high-confidence (regex + checksum)

| ID | Regex (sketched) | Validator | Source |
|---|---|---|---|
| EMAIL | `\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b` | (none — already in pii_detector.js) | OVERVIEW.md |
| CARD_PAN | `(?<![A-Za-z\d])(?:\d[ -]?){11,18}\d(?![A-Za-z\d])` | strip seps → IIN classify → Luhn | financial-global.md §Cards |
| IBAN | `(?<![A-Z\d])[A-Z]{2}\d{2}[A-Z0-9]{11,30}(?![A-Z\d])` | country length table → mod-97 == 1 | financial-global.md §IBAN |
| ETH_WALLET | `\b0x[a-fA-F0-9]{40}\b` | (length is dispositive; EIP-55 case-check optional) | financial-global.md §Crypto |
| BTC_BECH32 | `\bbc1[ac-hj-np-z02-9]{6,87}\b` | bech32 checksum (BIP-173) | financial-global.md §Crypto |
| BTC_BASE58 | `\b[13][a-km-zA-HJ-NP-Z1-9]{25,33}\b` | Base58Check (double-SHA256 last 4) | financial-global.md §Crypto |
| AADHAAR | `\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b` | Verhoeff (D5 group) | government-ids.md §India |
| CN_ID | `\b[1-9]\d{5}(?:18\|19\|20)\d{2}(?:0[1-9]\|1[0-2])(?:0[1-9]\|[12]\d\|3[01])\d{3}[\dX]\b` | ISO 7064 mod-11-2 | government-ids.md §East Asia |
| CODICE_FISCALE | `\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b` | letter-table check | government-ids.md §EU |
| DNI | `\b\d{8}[A-HJ-NP-TV-Z]\b` | letter = `"TRWAGMYFPDXBNJZSQVHLCKE"[N mod 23]` | government-ids.md §EU |
| NIE | `\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b` | DNI algorithm with X=0/Y=1/Z=2 | government-ids.md §EU |
| ISBN_13 | `\b97[89][- ]?\d[- ]?\d{3}[- ]?\d{5}[- ]?\d\b` | mod-10 weighted (alternating ×1/×3) → SUPPRESS | false-positives.md §Identifiers |
| ISBN_10 | `\b\d{9}[\dX]\b` | mod-11 weighted sum → SUPPRESS | false-positives.md §Identifiers |
| NRIC_SG | `\b[STFGM]\d{7}[A-Z]\b` | letter checksum (S/T vs F/G vs M tables) | government-ids.md §East Asia |
| GSTIN_IN | `\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b` | base-36 weighted mod-36 | government-ids.md §India |

### Stage 2 — context-gated (regex + keyword/country signal)

| ID | Regex | Gate | Source |
|---|---|---|---|
| NHS_UK | `\b\d{3}[ -]?\d{3}[ -]?\d{4}\b` | mod-11 + (page=UK OR `NHS`/`patient` keyword) | healthcare-insurance.md §UK |
| SSN_US | `\b(?!000\|666\|9\d{2})\d{3}-?(?!00)\d{2}-?(?!0000)\d{4}\b` | range gates + (page=US OR `SSN`/`social`) | government-ids.md §US |
| ITIN_US | `\b9\d{2}-?(?:5\d\|6[0-5]\|7\d\|8[0-8]\|9[02-9])-?\d{4}\b` | + `ITIN`/`tax` | government-ids.md §US |
| EIN_US | `\b\d{2}-\d{7}\b` | IRS prefix list + `EIN`/`employer` | government-ids.md §US |
| NPI_US | `\b\d{10}\b` | Luhn(`80840`+npi) + `NPI`/`provider` | healthcare-insurance.md §US |
| MBI_US | `\b\d[A-HJ-KMNP-RT-Y][0-9A-HJ-KMNP-RT-Y]\d[A-HJ-KMNP-RT-Y][0-9A-HJ-KMNP-RT-Y]\d[A-HJ-KMNP-RT-Y]{2}\d{2}\b` | (positional pattern is dispositive — promote to Stage 1) | healthcare-insurance.md §US |
| SIN_CA | `\b[1-79]\d{2}[ -]?\d{3}[ -]?\d{3}\b` | Luhn + (page=CA OR `SIN`/`NAS`) | government-ids.md §Canada/AU |
| TFN_AU | `\b\d{3} ?\d{3} ?\d{2,3}\b` | weighted mod-11 + (page=AU OR `TFN`) | government-ids.md §Canada/AU |
| MEDICARE_AU | `\b[2-6]\d{3} ?\d{5} ?\d\b` | weighted mod-10 + `Medicare` | government-ids.md §Canada/AU |
| ABN_AU | `\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b` | mod-89 + `ABN` | government-ids.md §Canada/AU |
| MY_NUMBER_JP | `\b\d{4} ?\d{4} ?\d{4}\b` | mod-11 + (page=JP OR `マイナンバー`/`My Number`) | government-ids.md §East Asia |
| RRN_KR | `\b\d{6}-?[1-8]\d{6}\b` | weighted mod-11 + (page=KR OR `주민등록번호`) | government-ids.md §East Asia |
| CPF_BR | `\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b` | mod-11 twice + (page=BR OR `CPF`) | government-ids.md §LATAM |
| CNPJ_BR | `\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b` | mod-11 twice + `CNPJ` | government-ids.md §LATAM |
| CURP_MX | `\b[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z0-9]{3}\d\b` | (positional pattern dispositive — promote to Stage 1) | government-ids.md §LATAM |
| ZA_ID | `\b\d{6} ?\d{4} ?\d{2} ?\d\b` | Luhn + (page=ZA OR `ID number`) | government-ids.md §Other |
| EMIRATES_ID | `\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b` | Luhn + `784` literal prefix gate (often dispositive — can promote to Stage 1) | government-ids.md §Other |
| STEUER_ID_DE | `\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b` | ISO 7064 mod-11-10 + `Steuer-ID`/`IdNr` | government-ids.md §EU |
| INSEE_FR | `\b[1278] ?\d{2} ?\d{2} ?(?:2[AB]\|\d{2}) ?\d{3} ?\d{3} ?\d{2}\b` | mod-97 + (page=FR OR `numéro de sécu`/`NIR`) | government-ids.md §EU |
| BSN_NL | `\b\d{9}\b` | 11-test (weight `-1` on d9) + `BSN`/`burgerservicenummer` | government-ids.md §EU |
| PERSONNUMMER_SE | `\b(?:\d{2})?\d{6}[-+]?\d{4}\b` | Luhn + `personnummer` | government-ids.md §EU |
| AVS_CH | `\b756\.?\d{4}\.?\d{4}\.?\d{2}\b` | EAN-13 + `756` prefix (often dispositive) | healthcare-insurance.md §EU |
| ABHA_IN | `\b\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b` | Verhoeff + `ABHA`/`Health ID`/`आभा` | healthcare-insurance.md §India |
| IHI_AU | `\b8003 ?6\d{3} ?\d{4} ?\d{4}\b` | Luhn + `8003 6` literal prefix gate | healthcare-insurance.md §Australia |
| IMEI | `\b\d{15}\b` | Luhn + `IMEI` keyword | telecom-devices.md §Devices |
| ICCID | `\b89\d{17,20}\b` | Luhn + `ICCID`/`SIM` | telecom-devices.md §Devices |
| MAC | `\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b\|\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b` | (shape is dispositive) | telecom-devices.md §Devices |
| IPV4 | `\b(?:(?:25[0-5]\|2[0-4]\d\|[01]?\d\d?)\.){3}(?:25[0-5]\|2[0-4]\d\|[01]?\d\d?)\b` | suppress private ranges + `IP`/`from` | telecom-devices.md §Network |
| IPV6 | `\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b` (+ compressed forms) | (shape dispositive) | telecom-devices.md §Network |
| E164_PHONE | `\+\d{1,3}[ .\-]?\d[\d .\-]{6,14}` | leading `+` is dispositive | telecom-devices.md §Phones |
| NANP_PHONE | `(?:\+?1[ .\-]?)?\(?[2-9]\d{2}\)?[ .\-]?[2-9]\d{2}[ .\-]?\d{4}` | (page=US/CA OR `phone`/`tel`/`fax`) | telecom-devices.md §Phones |
| PHONE_PER_CTRY | (per-country sketches in telecom-devices.md) | page-country + local-language phone keyword | telecom-devices.md §Phones |
| GPS_DEC | `\b-?(?:90(?:\.0+)?\|[1-8]?\d(?:\.\d+)?)\s*,\s*-?(?:180(?:\.0+)?\|1[0-7]\d(?:\.\d+)?\|[1-9]?\d(?:\.\d+)?)\b` | (bounds dispositive) | address-location.md §Geocoords |
| GPS_DMS | `\b\d{1,3}°\d{1,2}['′]\d{1,2}(?:\.\d+)?["″]\s?[NSEW]\b` | (shape dispositive) | address-location.md §Geocoords |
| PLUS_CODE | `\b[2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,3}\b` | (shape dispositive) | address-location.md §Geocoords |
| EIRCODE | `\b[AC-FHKNPRTV-Y][0-9W][0-9 ][AC-FHKNPRTV-Y0-9]{4}\b` | (shape dispositive) | address-location.md §Other |
| UK_POSTCODE | `\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b` | (shape dispositive on UK pages) | address-location.md §Postal |
| CA_POSTAL | `\b[ABCEGHJ-NPR-TV-Z]\d[ABCEGHJ-NPR-TV-Z][ -]?\d[ABCEGHJ-NPR-TV-Z]\d\b` | (shape dispositive) | address-location.md §Postal |
| NL_POSTCODE | `\b[1-9]\d{3} ?[A-Z]{2}\b` | (shape dispositive) | address-location.md §Postal |
| JP_POSTCODE | `(?:〒\s?)?\b\d{3}-\d{4}\b` | `〒` symbol or page=JP | address-location.md §Postal |
| BR_CEP | `\b\d{5}-\d{3}\b` | (shape dispositive) | address-location.md §Postal |
| AR_CPA | `\b[A-Z]\d{4}[A-Z]{3}\b` | (shape dispositive) | address-location.md §Postal |
| US_ZIP4 | `\b\d{5}-\d{4}\b` | (ZIP+4 is unambiguous US) | address-location.md §Postal |
| POSTAL_5 | `\b\d{5}\b` | page-country + local postal-keyword (US/DE/FR/IT/ES/MX/KR) | address-location.md §5-digit collision |
| POSTAL_6 | `\b\d{6}\b` | page-country + local keyword (IN/CN/SG/RU) | address-location.md §Postal |
| POSTAL_4 | `\b\d{4}\b` | (HIGH FP — only with explicit postal keyword + city) | address-location.md §Postal |
| BIC_SWIFT | `\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b` | valid ISO country at pos 5–6 + `SWIFT`/`BIC` | financial-global.md §SWIFT |
| ISIN | `\b[A-Z]{2}[A-Z0-9]{9}\d\b` | mod-10 + valid country prefix | financial-global.md §Investments |

### Stage 3 — generic numeric (current 5 patterns)

(unchanged from `src/pii_detector.js`)

```js
const CURRENCY_PREFIX = /[$€£¥₹₩₿₺₨₱฿]\s*\d[\d,.' ]*/g;
const CURRENCY_SUFFIX = /\b\d[\d,.' ]*\s*(?:USD|EUR|GBP|JPY|INR|BTC|ETH)\b/g;
const GROUPED_THOUSAND = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/g;
const PHONE_SHAPE = /\b\d{3,}(?:[ \- ]\d{3,})+\b/g;
const BARE_DIGITS = /\b\d{4,}\b/g;
```

### Stage 4 — FP suppressors (cheap → expensive)

| Order | Suppressor | Cost (chars examined) | Source |
|---|---|---|---|
| 4.1 | isYear (existing) | match-self (≤4) | pii_detector.js |
| 4.2 | isVersion (existing) | match-self ±1 | pii_detector.js |
| 4.3 | isHexColor | match-self ±1 | false-positives.md |
| 4.4 | isPercentage | trailing 1 | false-positives.md |
| 4.5 | isScientificNotation | trailing 4 | false-positives.md |
| 4.6 | isYearRange | match-self | false-positives.md |
| 4.7 | isMeasurement | trailing 8 | false-positives.md |
| 4.8 | isResolution | match-spanning | false-positives.md |
| 4.9 | isOrdinalLabel | preceding 30 | false-positives.md |
| 4.10 | isDateLike (structural + 50-char window) | self + ±50 | false-positives.md |
| 4.11 | isOrderRef | ±50 | false-positives.md |
| 4.12 | isPublicPrice (existing, extended) | ±100 | pii_detector.js |
| 4.13 | isCountNoise (existing, extended) | ±150 | pii_detector.js |
| 4.14 | isStatistic | ±30 | false-positives.md |

---

## Validate-mode design (per-detector)

Each detector that has both a checksum AND a meaningful context keyword can pass via either signal. A bare-shape match is never sufficient; a detector requires at least one of `checksum` or `keyword` (or both, depending on `mode`).

### Mode field

```js
validate: {
  checksum:      (digits) => boolean,    // optional — present if algo exists
  keyword:       /regex/i,                // optional — multilingual context
  keywordWindow: 100,                     // ±N chars around match
  mode:          'either',                // 'either' | 'checksum' | 'keyword' | 'both'
}
```

- `'either'` — pass if **checksum OR keyword** matches. Default for sensitive types where typo-cards must still blur.
- `'checksum'` — pass only if **checksum** matches. Use when shape+checksum is dispositive on its own.
- `'keyword'` — pass only if **keyword window** matches. Use when no checksum exists.
- `'both'` — pass only if **checksum AND keyword** match. Use for high-collision shapes (NPI 10-digit collides with phone — needs both signals).

### Default mode per detector

| Detector | Mode | Reason |
|---|---|---|
| Card PAN | `'either'` | Mistyped card near "Card Number:" still blurs; pasted valid card anywhere blurs; bare 16-digit IDs without card keyword + bad Luhn get dropped |
| IBAN | `'either'` | mod-97 OR `IBAN`/`Bankverbindung` keyword |
| Aadhaar | `'either'` | Verhoeff OR `Aadhaar`/`आधार` keyword |
| NHS Number | `'either'` | mod-11 OR `NHS`/`patient` keyword (or page=UK) |
| SSN | `'either'` | range gates pass + (checksum N/A) — keyword path required for ambiguous shapes |
| CPF / CNPJ | `'either'` | mod-11-twice OR keyword |
| ZA ID / SIN / Personnummer / Emirates ID | `'either'` | Luhn OR keyword |
| Steuer-ID / BSN / RRN / My Number | `'either'` | mod-N OR keyword |
| ETH wallet `0x` + 40 hex | `'checksum'` | `0x` prefix + 40-hex shape is dispositive; no useful keyword |
| BTC wallet (bech32 / Base58) | `'checksum'` | prefix + checksum dispositive |
| ISIN | `'either'` | mod-10 OR `ISIN` keyword |
| Codice Fiscale / DNI / NIE / NRIC SG / GSTIN | `'checksum'` | shape is positional + alphanumeric — already dispositive |
| CN ID / CURP | `'checksum'` | full-shape encodes DOB + region — dispositive |
| MBI / Emirates ID prefix `784` / IHI prefix `8003 6` / AVS `756` | `'checksum'` | literal prefix is dispositive |
| ISBN-13 / ISBN-10 (anti-PII) | `'checksum'` | strict — only suppress if it's actually a valid ISBN |
| NPI | `'both'` | 10-digit shape collides with phone — needs Luhn AND `NPI`/`provider` keyword |
| MRN / Member ID / Group # | `'keyword'` | no standard checksum |
| Phone (E.164 / NANP / per-country) | `'keyword'` | leading `+` or `phone`/`tel`/`fax` keyword (some country shapes are inherently dispositive — those override to checksum-style "shape pass") |
| Postal code (per-country) | `'keyword'` | page-country signal + local postal-keyword |
| MAC / IPv4 / IPv6 | `'checksum'` | shape is dispositive (octet bounds; hex pairs) |
| GPS decimal / DMS / Plus code / Eircode | `'checksum'` | shape is dispositive |
| SWIFT/BIC | `'either'` | valid country pos 5–6 OR `SWIFT`/`BIC` keyword |

`'checksum'` here is shorthand for "regex shape itself is the validator" when no math algo applies — used interchangeably for either-pure-checksum or pure-shape-dispositive detectors.

---

## Separator classes

### DIGIT_SEP — for card / IBAN / Aadhaar / SSN / digit-block IDs

```js
const DIGIT_SEP = /[  ­\-‐‑‒–—]/;
//                 space, NBSP, soft-hyphen, hyphen-minus,
//                 hyphen, NB-hyphen, figure-dash, en-dash, em-dash
```

Excludes: period (collides with decimals), slash (collides with dates/paths), bullet (already-masked), underscore (collides with identifiers), tab (renders as space; covered by space).

### PHONE_SEP — for phone numbers (broader)

```js
const PHONE_SEP = /[  ­\-‐‑‒–—.\/]/;
//                  DIGIT_SEP + period + slash
```

Includes period (US: `555.123.4567`) and slash (DE: `030/12345678`, EU mixed).

### Soft-hyphen handling

Soft-hyphen (`U+00AD`) is invisible. Strip from match text before storing the wrapped span, otherwise the rendered span breaks oddly.

---

## Card PAN regex (shape + IIN, no Luhn-only)

Two-step: regex finds the shape, JS classifier verifies IIN + length per network. With `mode: 'either'`, an IIN-classify pass OR a card keyword in window is sufficient.

```js
// Step 1: shape regex — anything that COULD be a card
const CARD_SHAPE = new RegExp(
  `(?<![A-Za-z\\d])\\d(?:${DIGIT_SEP.source}?\\d){11,18}(?![A-Za-z\\d])`,
  'g'
);

// Step 2: classify by IIN + length
const _STRIP_DIGIT_SEP = /[  ­\-‐‑‒–—]/g;

function classifyPan(matchText) {
  const d = matchText.replace(_STRIP_DIGIT_SEP, '');
  const n = d.length;
  if (n < 12 || n > 19) return null;

  // Length 13/16/19 — Visa
  if ((n === 13 || n === 16 || n === 19) && d[0] === '4') return 'visa';

  // Length 16
  if (n === 16) {
    if (/^5[1-5]/.test(d)) return 'mastercard';
    if (/^2(?:2(?:2[1-9]|[3-9]\d)|[3-6]\d{2}|7(?:[01]\d|20))/.test(d)) return 'mastercard';
    if (/^(?:6011|65\d{2}|64[4-9]\d)/.test(d)) return 'discover';
    if (/^35(?:2[89]|[3-8]\d)/.test(d)) return 'jcb';
    if (/^62/.test(d)) return 'unionpay';
    if (/^(?:60|65|81|82)\d{2}|^508\d|^35[36]\d/.test(d)) return 'rupay';
    if (/^220[0-4]/.test(d)) return 'mir';
  }

  // Length 16-19 — extended
  if (n >= 16 && n <= 19) {
    if (/^(?:6011|65\d{2}|64[4-9]\d)/.test(d)) return 'discover';
    if (/^35(?:2[89]|[3-8]\d)/.test(d)) return 'jcb';
    if (/^62/.test(d)) return 'unionpay';
    if (/^220[0-4]/.test(d)) return 'mir';
  }

  // Length 15 — Amex
  if (n === 15 && /^3[47]/.test(d)) return 'amex';

  // Length 14-19 — Diners + Maestro
  if (n >= 14 && n <= 19 && /^3(?:0[0-5]|[689])/.test(d)) return 'diners';
  if (n >= 12 && n <= 19 && /^(?:5018|5020|5038|5893|6304|6759|676[1-3])/.test(d)) return 'maestro';

  return null;
}
```

**Detector descriptor**:
```js
const CARD_DETECTOR = Object.freeze({
  type: 'card',
  preScreen: /\d{12}/,
  regex: CARD_SHAPE,
  validate: {
    checksum: (matchText) => {
      const d = matchText.replace(_STRIP_DIGIT_SEP, '');
      return classifyPan(d) !== null && _luhn(d);
    },
    keyword: /\b(?:card|credit|debit|Visa|Mastercard|Amex|Discover|CVV|CVC|expir(?:es|ation|y)|tarjeta|crédit|débit|caduca|Karte|Kreditkarte|gültig|carte|crédit|expire|कार्ड|क्रेडिट|डेबिट|カード|クレジット|信用卡|卡号)\b/i,
    keywordWindow: 100,
    mode: 'either',
  },
  action: 'emit',
});
```

Card-shape inputs that SHOULD blur:
- `4111 1111 1111 1111` — IIN-classify pass + Luhn pass → emit (either path)
- `4111-1111-1111-1112` (typo, Luhn fail) near "Card Number:" → keyword path → emit
- `4111111111111111` — IIN pass + Luhn pass → emit
- `4111 1111 1111 1111` (NBSP) → emit

Card-shape inputs that SHOULD NOT blur:
- `Order #1234567890123456` near "Order" → IIN classifyPan returns `null` (no valid IIN) AND keyword "card" not in window AND `isOrderRef` Stage-4 fires → drop
- `4123456789012` (12-digit, looks like Visa-prefix but not in length [13,16,19]) → classifyPan null + no keyword → drop
- ASIN `B07PXGQC1Q` (alphanumeric) → CARD_SHAPE regex word-boundary excludes letters → no match

---

## Phone regexes (shape + bracket/quote handling)

Shape-only with `mode: 'keyword'` or `'either'`. E.164's `+` prefix is dispositive — pass without keyword. Local-format numbers need keyword OR page-country signal.

```js
const _PHONE_SEP_INNER =
  `[ \\u00A0\\u00AD\\-\\u2010\\u2011\\u2012\\u2013\\u2014.\\/]`;

// E.164 international — leading +, 1-3 digit CC, optional (0) trunk-zero, 6-14 NSN
const PHONE_E164 = new RegExp(
  `\\+\\d{1,3}` +
  `(?:${_PHONE_SEP_INNER}|\\(0\\))?` +              // separator OR (0)
  `\\d` +
  `(?:[\\d \\u00A0\\u00AD\\-\\u2010\\u2011\\u2012\\u2013\\u2014.\\/\\(\\)]*\\d){5,14}`,
  'g'
);

// NANP (US/CA) — optional +1, optional parens around area code
const PHONE_NANP = new RegExp(
  `(?:\\+?1${_PHONE_SEP_INNER}?)?` +                // optional +1 or 1
  `\\(?[2-9]\\d{2}\\)?` +                           // area code, optional parens
  _PHONE_SEP_INNER + `?` +
  `[2-9]\\d{2}` +                                   // exchange
  _PHONE_SEP_INNER + `?` +
  `\\d{4}` +                                        // subscriber
  `(?:[ \\u00A0]?(?:ext\\.?|x|#)\\s*\\d{1,5})?`,    // optional extension
  'gi'
);

// Generic global — no checksum, optional +CC, optional (area) or (0), mixed seps
const PHONE_GENERIC = new RegExp(
  `(?:\\+\\d{1,3}${_PHONE_SEP_INNER}?)?` +
  `(?:\\(0?\\d{1,4}\\)${_PHONE_SEP_INNER}?)?` +
  `\\d{2,4}` +
  `(?:${_PHONE_SEP_INNER}\\d{2,4}){2,4}` +
  `(?:[ \\u00A0]?(?:ext\\.?|x|#)\\s*\\d{1,5})?`,
  'g'
);
```

**Coverage** (all SHOULD match):
- `+1 555 123 4567`
- `+1-555-123-4567`
- `+15551234567`
- `(555) 123-4567`
- `(555)123-4567`
- `+44 (0)20 1234 5678` (trunk-zero in parens)
- `+44 (0)20-7123-4567`
- `+49 (0)30 12345678`
- `+91 98765 43210`
- `+86 138 0013 8000`
- `+33 1 23 45 67 89` (5 pairs)
- `+81-3-1234-5678`
- `030/12345678` (DE landline with slash — generic)
- `555.123.4567` (US dot-separated — NANP)
- `5551234567 ext. 567` (extension)
- `5551234567 x567`
- `5551234567 #567`

**Excluded** (intentional — too rare or out-of-scope):
- `[555] 123-4567` — square brackets
- `tel:+15551234567` — `tel:` protocol prefix (already in `<a>` href; extension UI guard skips)
- `"555-1234"` — quotes wrap, not part of number; regex matches the inner digits anyway
- Smart quotes inside (`5'5"5-1234`) — never seen in real phone formats

**Detector descriptors**:
```js
const PHONE_E164_DETECTOR = Object.freeze({
  type: 'phone',
  preScreen: /\+\d{2}/,
  regex: PHONE_E164,
  validate: {
    keyword: /\b(?:phone|mobile|tel|cell|fax|call|whatsapp|teléfono|móvil|celular|téléphone|mobile|portable|fixe|Telefon|Mobil|Handy|Festnetz|Fax|telefono|cellulare|電話|携帯|電話番号|電话|手机|연락처|전화|मोबाइल|फोन|دائرة|هاتف|جوال)\b/i,
    keywordWindow: 80,
    mode: 'checksum',  // shape-with-leading-+ is dispositive; no keyword needed
  },
  action: 'emit',
});

const PHONE_NANP_DETECTOR = Object.freeze({
  type: 'phone',
  preScreen: /\(?[2-9]\d{2}\)?[ .\-]?[2-9]\d{2}/,
  regex: PHONE_NANP,
  validate: {
    keyword: /\b(?:phone|mobile|tel|cell|fax|call|téléphone|teléfono)\b/i,
    keywordWindow: 80,
    mode: 'either',  // (xxx) yyy-zzzz parens-form is dispositive (checksum path), bare 555-123-4567 needs keyword
  },
  action: 'emit',
});

const PHONE_GENERIC_DETECTOR = Object.freeze({
  type: 'phone',
  preScreen: /\d{2,4}[\s\-.\/]\d{2,4}/,
  regex: PHONE_GENERIC,
  validate: {
    keyword: /\b(?:phone|mobile|tel|cell|fax|call|teléfono|móvil|téléphone|portable|Telefon|Mobil|Handy|Fax|telefono|cellulare|電話|携帯|电话|手机|전화|핸드폰|मोबाइल|फोन)\b/i,
    keywordWindow: 80,
    mode: 'keyword',  // no leading +, no parens — keyword required
  },
  action: 'emit',
});
```

---

## State machine semantics

### Span lifecycle

Each character offset in the text node lives in exactly one of these states:

```
   ┌─────────┐  pre-filter passes
   │ UNTOUCHED ├──────────────┐
   └─────────┘                │
                              ▼
                       ┌────────────┐
                       │ STAGE 1 hit │ ── CONSUMED + EMIT  (typed PII span)
                       └─────────────┘
                              │ no
                              ▼
                       ┌────────────┐
                       │ STAGE 1 hit │ ── CONSUMED + DROP   (e.g. ISBN — anti-PII match)
                       │  (suppress) │
                       └─────────────┘
                              │ no
                              ▼
                       ┌────────────┐
                       │ STAGE 2 hit │ ── CONSUMED + EMIT
                       └─────────────┘
                              │ no
                              ▼
                       ┌────────────┐
                       │ STAGE 3 hit │ ── candidate → STAGE 4
                       └─────────────┘
                              │
                              ▼
                       ┌────────────┐
                       │ STAGE 4 cascade │
                       │ any suppress?   │
                       └────────────┘
                       │ yes      │ no
                       ▼          ▼
                    DROP        EMIT (type='numeric')
```

### Short-circuit rules

1. **Early-stage win consumes the span.** Once STAGE 1 or STAGE 2 fires on `[start, end)`, no later stage examines that range. Implementation: keep a `consumed: Array<[number, number]>` and gate every later detector by `!overlaps(consumed, m.index, m.index + m[0].length)`.

2. **Anti-PII match still consumes.** ISBN-13/ISBN-10 are visible-by-design identifiers — STAGE 1 detects them precisely, marks the span CONSUMED, but emits NO match (so they're never blurred). This stops STAGE 3 BARE_DIGITS from blurring ISBNs.

3. **STAGE 4 is per-match, not per-node.** STAGE 3 produces N candidate matches; STAGE 4 runs the suppressor cascade on each candidate independently. Cheap suppressors (structural) run first; expensive ones (150-char window) only if cheap ones miss.

4. **Page-level country signal computed once per scan.** Captured at the top of `scan()` from TLD + `<html lang>` + meta + currency-symbol sample. Passed into every Stage 2 detector. SPAs invalidate via `applyState()`.

5. **STAGE 0 drops the entire node.** No regex runs on text inside `<code>` / extension UI / existing PII spans. This is the single highest-impact perf optimization for dev-doc and SO-style sites.

---

## Implementation sketch (pseudo-code)

```js
function _findMatches(text, types, node) {
  // ── STAGE 0 ─────────────────────────────────────────────────────────
  if (_isExtensionUI(node)) return [];
  if (_isInsidePiiSpan(node)) return [];
  if (_isInsideCodeBlock(node)) return [];                    // NEW
  if (!text || !text.trim()) return [];

  const country = _pageCountrySignal();                       // computed once per scan
  const consumed = [];                                        // sorted [start, end] ranges
  const emitted = [];                                         // {start, end, type}

  // ── STAGE 1 ─────────────────────────────────────────────────────────
  // In priority order. Each runs full-text scan; gate by !overlaps.
  // Validators run on every regex match before consuming.
  if (types.email)        runDetector(text, EMAIL_DETECTOR,        consumed, emitted, country);
  if (types.cards)        runDetector(text, CARD_DETECTOR,         consumed, emitted, country);
  if (types.iban)         runDetector(text, IBAN_DETECTOR,         consumed, emitted, country);
  if (types.crypto_eth)   runDetector(text, ETH_WALLET_DETECTOR,   consumed, emitted, country);
  if (types.crypto_btc)   runDetector(text, BTC_WALLET_DETECTOR,   consumed, emitted, country);
  if (types.gov_ids)      runDetector(text, AADHAAR_DETECTOR,      consumed, emitted, country);
                          runDetector(text, CN_ID_DETECTOR,        consumed, emitted, country);
                          runDetector(text, CODICE_FISCALE_DETECTOR, consumed, emitted, country);
                          runDetector(text, DNI_NIE_DETECTOR,      consumed, emitted, country);
                          runDetector(text, MBI_DETECTOR,          consumed, emitted, country);
                          runDetector(text, CURP_DETECTOR,         consumed, emitted, country);
                          runDetector(text, EMIRATES_ID_DETECTOR,  consumed, emitted, country);
  if (types.numeric)      runDetector(text, ISBN_13_DETECTOR,      consumed, emitted, country);
                          runDetector(text, ISBN_10_DETECTOR,      consumed, emitted, country);
  // ISBN detectors mark CONSUMED but don't emit — anti-PII suppression.

  // ── STAGE 2 ─────────────────────────────────────────────────────────
  if (types.health)       runDetector(text, NHS_DETECTOR,          consumed, emitted, country);
                          runDetector(text, NPI_DETECTOR,          consumed, emitted, country);
                          runDetector(text, IHI_DETECTOR,          consumed, emitted, country);
                          runDetector(text, AVS_DETECTOR,          consumed, emitted, country);
                          runDetector(text, MRN_DETECTOR,          consumed, emitted, country);
  if (types.gov_ids)      runDetector(text, SSN_DETECTOR,          consumed, emitted, country);
                          runDetector(text, ITIN_DETECTOR,         consumed, emitted, country);
                          runDetector(text, EIN_DETECTOR,          consumed, emitted, country);
                          // ... per-country government IDs ...
  if (types.phone)        runDetector(text, E164_DETECTOR,         consumed, emitted, country);
                          runDetector(text, NANP_DETECTOR,         consumed, emitted, country);
                          runDetector(text, PHONE_PER_CTRY,        consumed, emitted, country);
  if (types.location)     runDetector(text, GPS_DEC_DETECTOR,      consumed, emitted, country);
                          runDetector(text, GPS_DMS_DETECTOR,      consumed, emitted, country);
                          runDetector(text, PLUS_CODE_DETECTOR,    consumed, emitted, country);
                          runDetector(text, IPV4_DETECTOR,         consumed, emitted, country);
                          runDetector(text, IPV6_DETECTOR,         consumed, emitted, country);
                          runDetector(text, MAC_DETECTOR,          consumed, emitted, country);
                          runDetector(text, POSTAL_DETECTOR,       consumed, emitted, country);
  if (types.devices)      runDetector(text, IMEI_DETECTOR,         consumed, emitted, country);
                          runDetector(text, ICCID_DETECTOR,        consumed, emitted, country);
  if (types.finance)      runDetector(text, BIC_DETECTOR,          consumed, emitted, country);
                          runDetector(text, ISIN_DETECTOR,         consumed, emitted, country);

  // ── STAGE 3 ─────────────────────────────────────────────────────────
  if (types.numeric) {
    for (const re of [CURRENCY_PREFIX, CURRENCY_SUFFIX, GROUPED_THOUSAND, PHONE_SHAPE, BARE_DIGITS]) {
      const r = new RegExp(re.source, re.flags);
      let m;
      while ((m = r.exec(text)) !== null) {
        const start = m.index, end = m.index + m[0].length;
        if (overlaps(consumed, start, end)) continue;            // already typed
        // ── STAGE 4 ─────────────────────────────────────────
        if (!_falsePositivesCheckCascade(m[0], text, start, node)) {
          consumed.push([start, end]);
          emitted.push({ start, end, type: 'numeric' });
        }
        if (m[0].length === 0) r.lastIndex++;
      }
    }
  }

  return _mergeAndSort(emitted);
}

function runDetector(text, det, consumed, emitted, country) {
  const re = new RegExp(det.regex.source, det.regex.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index, end = m.index + m[0].length;
    if (overlaps(consumed, start, end)) continue;
    if (!det.validate(m[0], text, start, country)) continue;
    consumed.push([start, end]);
    if (det.action === 'emit') emitted.push({ start, end, type: det.type });
    // 'suppress' = consume but don't emit (e.g. ISBN)
    if (m[0].length === 0) re.lastIndex++;
  }
}

function _falsePositivesCheckCascade(matchText, text, idx, node) {
  // STAGE 4 cascade — short-circuit on first hit
  return _CHECKS_STRUCTURAL.some(fn => fn(matchText, text, idx))
      || _CHECKS_TRAILING.some(fn   => fn(matchText, text, idx))
      || _CHECKS_PRECEDING.some(fn  => fn(matchText, text, idx))
      || _CHECKS_KEYWORD_50.some(fn => fn(matchText, text, idx))
      || _CHECKS_KEYWORD_LARGE.some(fn => fn(matchText, text, idx, node));
}
```

### Detector descriptor shape

```js
const CARD_DETECTOR = Object.freeze({
  type: 'card',
  action: 'emit',                      // 'emit' | 'suppress'
  regex: /(?<![A-Za-z\d])(?:\d[ -]?){11,18}\d(?![A-Za-z\d])/g,
  validate(matchText, text, idx, country) {
    const d = matchText.replace(/[ -]/g, '');
    if (d.length < 12 || d.length > 19) return false;
    if (!_classifyPan(d)) return false;
    return _luhn(d);
  },
});

const ISBN_13_DETECTOR = Object.freeze({
  type: 'isbn',
  action: 'suppress',                  // anti-PII — consume span but don't blur
  regex: /\b97[89][- ]?\d[- ]?\d{3}[- ]?\d{5}[- ]?\d\b/g,
  validate(matchText) {
    const d = matchText.replace(/[- ]/g, '');
    if (d.length !== 13) return false;
    return _isbn13Check(d);
  },
});
```

### `consumed` data structure

A sorted array of `[start, end)` pairs is enough at expected match counts (≤100/node). For larger nodes consider an interval tree, but profile first.

```js
function overlaps(consumed, start, end) {
  // consumed is sorted by .start
  for (const [s, e] of consumed) {
    if (e <= start) continue;       // strictly before
    if (s >= end)   return false;   // strictly after — sorted means we're done
    return true;
  }
  return false;
}
```

---

## Performance characteristics

Approximate per-text-node cost (n = node length):

| Stage | Cost | Notes |
|---|---|---|
| 0 | O(1) | DOM ancestor walks; ≤5 closest() calls |
| 1 | O(n × D₁) where D₁ ≈ 12 active detectors | Each is one regex scan + checksum on matches; matches are rare in real text → ~O(n) |
| 2 | O(n × D₂) where D₂ ≈ 20 active detectors | Same pattern; gated by country/keyword check before checksum |
| 3 | O(n × 5) | Current generic regex set |
| 4 | O(M × S) where M = stage-3 candidates, S = suppressors | Cheap structural checks short-circuit — most candidates exit at suppressor 4.1–4.3 |

Net change vs current: **slower per node** (12+20+5 vs 5 regex scans) but **fewer wrap operations** (no double-blur, no FP wrap). Expect ~2× scan cost compensated by lower DOM-write cost. Profile on real pages before/after.

Hard cap on detector count: ~30 active per scan. Per-feature detector groups (`types.cards`, `types.gov_ids`, `types.phone`) allow users to disable groups they don't want, scaling cost down.

---

## User-facing settings shape (proposed)

`auto_detect_pii.settings` already has `email` and `numeric`. Extend to:

```js
auto_detect_pii.settings = {
  // existing
  email:    false,
  numeric:  false,                 // generic 5-pattern fallback (Stage 3 + 4)
  // Stage 1 / 2 dedicated detectors — opt-in groups
  cards:    false,                 // Card PAN + Luhn
  iban:     false,                 // IBAN + mod-97
  gov_ids:  false,                 // SSN, Aadhaar, NHS, CN ID, etc.
  health:   false,                 // NHS, MBI, NPI, IHI, ABHA, MRN
  phone:    false,                 // E.164, NANP, per-country
  location: false,                 // GPS, postal codes, IP
  devices:  false,                 // IMEI, ICCID, MAC
  crypto:   false,                 // ETH, BTC wallets
  finance:  false,                 // SWIFT/BIC, ISIN
}
```

Default: only `email` ON. Power users opt into specific groups. The popup's master AUTO_DETECT toggle still flips all sub-keys atomically.

---

## Testing strategy

For each detector:

- **One true-positive test** — synthetic (publicly-known test value or fictional but format-valid), checksum-passing.
- **One near-miss test** — same shape, checksum FAIL → must NOT emit.
- **One overlap test** — text contains both a Stage 1 hit (e.g. card PAN) and a Stage 3 candidate that would have matched the same digit run; assert Stage 1 wins and Stage 3 doesn't double-emit.
- **One ISBN/anti-PII test** — text contains a 13-digit number with valid ISBN-13 checksum; assert it is consumed (no PII span emitted) and no Stage 3 generic match fires on the same range.

For Stage 4 cascade:

- **One suppressor true-positive** — input matches the suppressor's signal; assert match is dropped.
- **One suppressor false-positive** — real PII near a suppressor keyword; assert the match still passes (suppressor is not too aggressive).

Update [`docs/contracts/pii_detector.tests.md`](../../contracts/pii_detector.tests.md) for every new test.

---

## Migration plan from current `pii_detector.js`

1. **Phase 1 — STAGE 0 + STAGE 4 expansion**. Add `_isInsideCodeBlock` and Tier-A suppressors from [`false-positives.md`](./false-positives.md) (`isDateLike`, `isOrderRef`, `isMeasurement`, `isHexColor`, `isYearRange`). Estimated 80 LOC. Test count +20.
2. **Phase 2 — STAGE 3 → STAGE 4 cascade refactor**. Group existing suppressors into ordered tiers; short-circuit on first hit. No behavior change beyond perf.
3. **Phase 3 — STAGE 1 dedicated detectors**. Start with the dispositive ones (Card PAN, IBAN, ETH wallet, ISBN suppressor). Add `consumed` ranges + `runDetector` helper.
4. **Phase 4 — STAGE 2 context-gated detectors**. Add page-country signal capture. Roll out NHS, SSN, NPI, postal codes per country, phone numbers.
5. **Phase 5 — settings expansion**. New `auto_detect_pii.settings` sub-keys + popup UI.

Land each phase as a separate PR with green tests; measure FP rate on a curated sample of real pages between phases.

---

## Quick reference — when does each thing fire?

```
INPUT                                MATCHED BY              STAGE   ACTION
────────────────────────────────────────────────────────────────────────────
"4111 1111 1111 1111"                CARD_PAN                  1     emit type=card
"DE89 3704 0044 0532 0130 00"        IBAN                      1     emit type=iban
"0x742d35Cc6634C0532925a3b8...4e"    ETH_WALLET                1     emit type=crypto
"123 456 789 012"                    AADHAAR (Verhoeff pass)   1     emit type=aadhaar
"978-3-16-148410-0"                  ISBN_13                   1     suppress (anti-PII)
"123-45-6789" + "SSN"                SSN_US                    2     emit type=ssn
"943 476 5919" + "NHS"               NHS_UK                    2     emit type=nhs
"+1 555 123 4567"                    E164_PHONE                2     emit type=phone
"40.7128, -74.0060"                  GPS_DEC                   2     emit type=geo
"$1,234.56"                          CURRENCY_PREFIX           3→4   emit type=numeric (no suppressor)
"2026-04-29"                         PHONE_SHAPE → isDateLike  3→4   suppress
"1920x1080"                          BARE_DIGITS → isResolution 3→4  suppress
"#FF5733"                            BARE_DIGITS → isHexColor  3→4   suppress
"5 min read"                         BARE_DIGITS → isMeasurement 3→4 suppress
"Order #4567823"                     BARE_DIGITS → isOrderRef  3→4   suppress
"1.0.0+20130313144700"               BARE_DIGITS → isVersion   3→4   suppress
inside <code>                        — STAGE 0 drop —          0     skip
inside #bl-si-picker-toolbar         — STAGE 0 drop —          0     skip
```

---

## Open decisions

1. **Should STAGE 1 detectors run when their `types.*` flag is OFF?** Argument FOR: ISBN suppression always useful even when user only wants `numeric`. Argument AGAINST: extra cost. Recommendation: ISBN/anti-PII suppressors always run; positive detectors gate on flag.

2. **Where does the page-country signal cache live?** Per-scan local is simplest. Could promote to module-level if SPAs do many scans per locale. Start local; promote on profile.

3. **Detector load order within a stage.** Sources cited in this catalog imply a priority (Card before generic numeric, IBAN before SWIFT, etc.). Document the order explicitly in `pii_detector.js` rather than relying on iteration order of an object.

4. **Cross-stage consumption.** What if STAGE 2 fires a low-confidence emit and a STAGE 1 detector would have matched a wider span? Solution: detectors sorted by max-match-length within a stage; longer wins.

5. **Re-entry on `handleMutations`.** Stage 0 already runs per-text-node. The `consumed` array is per-call; mutation handler doesn't need to persist state.
