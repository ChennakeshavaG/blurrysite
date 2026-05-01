# Telecom & Device IDs — Global

> Phones global, IMEI, ICCID, IMSI, MAC, IPv4/IPv6. Extends `../../prototypes/pii/phone-detection.md` (US-centric).

Phone numbers are the most common numeric PII on consumer pages: account profiles, address books, contact forms, SMS verification UIs, ecommerce checkout. The 5-pattern numeric matcher in `pii_detector.js` already catches phone-shape via `PHONE_SHAPE`, but globally formats vary — single regex won't catch all, single regex risks high FP. This doc enumerates per-country structure plus the device-identifier siblings that share digit-shape ambiguity (IMEI / ICCID).

---

## Phone numbers — global formats

### E.164 standard

ITU-T E.164 is the global numbering plan: a phone number is at most 15 digits, optionally prefixed `+` and a country code (1–3 digits). National conventions add formatting (parens, hyphens, dots, spaces) on top of the bare digits.

- **Format**: `+<CC><NSN>` where CC = 1–3 digits, NSN ≤ (15 − CC) digits. Total ≤ 15 digits.
- **Regex sketch (loose)**:
  ```js
  const E164 = /\+\d{1,3}[ .\-]?\d[\d .\-]{6,14}/g;
  ```
- **Synthetic example**: `+1 555-123-4567`, `+44 20 7123 4567`, `+91 98765 43210`, `+86 138 0013 8000`.
- **FP collision**: any leading `+` mitigates collision a lot; bare-digit local numbers without `+` collide heavily with order numbers, dates, IDs.
- **Context tokens**: `phone`, `tel`, `mobile`, `cell`, `call`.
- **Source**: [ITU-T E.164](https://www.itu.int/rec/T-REC-E.164/), [Wikipedia E.164](https://en.wikipedia.org/wiki/E.164).

### NANP (US / Canada / Caribbean)

- **Format**: 10 digits — 3-digit area + 3-digit exchange + 4-digit subscriber. Common displays: `(555) 123-4567`, `555-123-4567`, `555.123.4567`, `+1 555 123 4567`.
- **Constraints**: area code first digit `[2-9]`, exchange first digit `[2-9]`. `555-01XX` reserved for fictional. `N11` codes (`411`, `911`) reserved.
- **Regex sketch**:
  ```js
  const NANP = /(?:\+?1[ .\-]?)?\(?[2-9]\d{2}\)?[ .\-]?[2-9]\d{2}[ .\-]?\d{4}/g;
  ```
- **FP collision**: 9-digit SSN (collide as 3-2-4 not 3-3-4 — different shape but similar). 10-digit account numbers, NPI, order numbers. `XXX-XX-XXXX` is SSN, `XXX-XXX-XXXX` is phone — different separator counts disambiguate.
- **Context tokens**: `phone`, `tel`, `mobile`, `fax`, `cell`, `call us`, `text`, `téléphone` (FR-CA), `teléfono` (ES-MX), `numéro`.
- **Source**: [NANPA — North American Numbering Plan](https://www.nationalnanpa.com/).

### EU — UK / DE / FR / ES / IT / NL

| Country | CC | National length | Common format | Notes |
|---|---|---|---|---|
| UK | +44 | 10 (mobile starts `7`), 9–10 (landline) | `07700 900123`, `+44 7700 900123`, `020 7946 0123` | Mobile prefix `07`; geographic landlines `01`/`02`; non-geographic `03`/`08`/`09`. `01632 0xxxxx` reserved-fictitious. |
| DE | +49 | 7–11 variable | `+49 30 12345678`, `030 12345678`, `0151 23456789` (mobile) | Highly variable area-code length (2–5 digits); strict regex impossible. Mobile prefixes: `015x`, `016x`, `017x`. |
| FR | +33 | 9 | `01 23 45 67 89`, `+33 1 23 45 67 89` | 5 pairs of 2 digits. Mobile `06`/`07`. National form `0X XX XX XX XX`. |
| ES | +34 | 9 | `+34 612 345 678`, `912 345 678` | Mobile `6XX`/`7XX`; landline `8XX`/`9XX`. No leading `0` in national form. |
| IT | +39 | 9–11 variable | `+39 02 1234 5678`, `334 1234567` (mobile) | Mobile starts `3`; landline area codes 2–4 digits. |
| NL | +31 | 9 | `+31 6 12345678` (mobile), `020 1234567` | Mobile `06`; landline `0XX`/`0XXX`. |

**Regex sketch (UK mobile)**: `/(?:\+44 ?|0)7\d{3} ?\d{6}/g`

**Regex sketch (FR)**: `/(?:\+33 ?|0)[1-9](?:[ .-]?\d{2}){4}/g`

**FP collision**: order numbers, dates (DE 2024-12-31 collides with phone-shape regex), invoice numbers.

**Context tokens** (per-language):
- DE: `Telefon`, `Tel.`, `Mobil`, `Handy`, `Festnetz`, `Fax`
- FR: `téléphone`, `tél.`, `mobile`, `portable`, `fixe`
- ES: `teléfono`, `tel.`, `móvil`, `celular`, `fijo`
- IT: `telefono`, `cellulare`, `fisso`
- NL: `telefoon`, `mobiel`, `vast`

**Sources**:
- [Ofcom — UK numbering plan](https://www.ofcom.org.uk/phones-telecoms-and-internet/information-for-industry/numbering)
- [BNetzA — German numbering plan](https://www.bundesnetzagentur.de/EN/Areas/Telecommunications/Companies/NumberManagement/numbermanagement-node.html)
- [ARCEP — French numbering](https://en.arcep.fr/professional-area/manage-the-numbering-resources/national-numbering-plan.html)

### Asia — IN / CN / JP / KR / SG

| Country | CC | National length | Common format | Notes |
|---|---|---|---|---|
| India | +91 | 10 (mobile), 7–8 (landline) | `+91 98765 43210`, `098765 43210`, `(022) 1234 5678` (Mumbai) | Mobile: 10-digit, first digit `[6-9]`. STD code 2–4 digits + subscriber. |
| China | +86 | 11 (mobile), 7–8 (landline) | `+86 138 0013 8000`, `138-0013-8000`, `010-1234 5678` (Beijing) | Mobile: 11-digit, prefix `1[3-9]X`. Major-city codes `010`/`021`/`022`/`023`/`024`/`025`/`027`/`028`/`029`. |
| Japan | +81 | 10 (mobile), 9 (landline) | `+81 90-1234-5678`, `090-1234-5678`, `03-1234-5678` (Tokyo) | Mobile: `070`/`080`/`090` + 8 digits. Format usually 3-4-4 or 4-4-4. |
| Korea | +82 | 10–11 (mobile), 9 (landline) | `+82 10-1234-5678`, `010-1234-5678`, `02-123-4567` (Seoul) | Mobile: `010` + 8 digits. Older: `011`/`016`/`017`/`018`/`019`. |
| Singapore | +65 | 8 | `+65 9123 4567`, `9123 4567` | 8 digits, no area code. Mobile starts `8`/`9`; landline `6`. |

**Regex sketch (India mobile)**: `/(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}/g`

**Regex sketch (China mobile)**: `/(?:\+?86[ -]?|0)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}/g`

**FP collision**: India 10-digit mobiles collide with Aadhaar-fragments and order numbers; China 11-digit mobiles collide with bare 11-digit IDs.

**Context tokens**:
- Hindi: `मोबाइल`, `फ़ोन`, `फोन नंबर`, `संपर्क`
- Chinese (Simp): `电话`, `手机`, `联系方式`, `号码`
- Japanese: `電話`, `携帯`, `モバイル`, `TEL`, `FAX`, `連絡先`
- Korean: `전화`, `핸드폰`, `휴대폰`, `연락처`

**Sources**:
- [TRAI — Indian telecom numbering plan](https://www.trai.gov.in/)
- [MIIT China numbering allocations](https://en.wikipedia.org/wiki/Telephone_numbers_in_China) (Wikipedia summary)
- [総務省 (MIC) Japan numbering](https://www.soumu.go.jp/main_sosiki/joho_tsusin/eng/)
- [IMDA Singapore numbering](https://www.imda.gov.sg/)

### Other — BR / MX / AU / ZA / AE

| Country | CC | National length | Common format | Notes |
|---|---|---|---|---|
| Brazil | +55 | 10–11 (mobile 11) | `+55 11 91234-5678`, `(11) 91234-5678` | Mobile: 11-digit, 9 added 2014. Format `(AA) 9XXXX-XXXX`. |
| Mexico | +52 | 10 | `+52 55 1234 5678`, `55 1234 5678` | Mobile: prefix dropped `1` 2019; uniform 10-digit. |
| Australia | +61 | 9 (mobile starts `4`), 8 (landline) | `+61 4XX XXX XXX`, `0412 345 678`, `(02) 1234 5678` | Mobile: `04XX`. Landline area codes `02`/`03`/`07`/`08`. |
| South Africa | +27 | 9 | `+27 82 123 4567`, `082 123 4567` | Mobile: `06`/`07`/`08`. Landline `01`/`02`/`03`/`04`/`05`. |
| UAE | +971 | 8 (mobile 9) | `+971 50 123 4567`, `050 123 4567` | Mobile: `050`/`052`/`054`/`055`/`056`/`058`. |

**Context tokens**:
- PT-BR: `telefone`, `celular`, `WhatsApp`
- ES-MX: `teléfono`, `celular`, `móvil`
- AR-AE: `هاتف`, `جوال`, `موبايل`

### Toll-free / premium / fax / extension

- **Toll-free** (US/CA): `8XX` codes (`800`, `833`, `844`, `855`, `866`, `877`, `888`); UK: `0800`, `0808`; IN/AU: `1800`. Same shape as regular phone — identical regex; usually only flagged with explicit `toll-free` keyword.
- **Premium-rate**: US `900`, `976`; UK `09`; FR `08`. Charge-per-minute — context-keyword resolves intent.
- **Fax**: identical numeric format to phone — disambiguate via `fax` token.
- **Extension**: `ext. 123`, `x123`, `#123` after a phone number. Often misparsed as separate digit run by `BARE_DIGITS` regex.

---

## Device identifiers

### IMEI (15 digits, Luhn checksum)

- **Format**: 15 digits — TAC (8 digits) + serial (6 digits) + check (1 digit).
- **Display**: usually unformatted `123456789012345`; sometimes `XX-XXXXXX-XXXXXX-X`.
- **Checksum**: Luhn (mod-10) over digits 1–14.
- **Regex sketch**: `/\b\d{15}\b/g` then Luhn-validate.
- **Synthetic example**: `490154203237518` (Luhn-valid).
- **FP collision**: VERY HIGH — bare 15-digit numbers also match Aadhaar (12-digit, but adjacent), bank account ranges, transaction IDs. Luhn cuts ~90% of random sequences. Without checksum + context, regex alone is not deployable for IMEI.
- **Context tokens**: `IMEI`, `device ID`, `serial number`, `*#06#` (the dial code that displays IMEI), `equipment identity`.
- **Source**: [GSMA IMEI specification](https://www.gsma.com/solutions-and-impact/technologies/security/services/imei-database/), [3GPP TS 23.003](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=729).

### IMEISV (16 digits)

- 15-digit IMEI prefix replaced by SVN (software version) — no checksum on IMEISV form. Rarely surfaces on user pages.

### ICCID / SIM (19–22 digits, Luhn)

- **Format**: typically 19 or 20 digits, max 22. Starts `89` (telecom industry ID per ISO 7812). Digits: `89` + country code (1–3 digits) + issuer ID + account ID + check digit.
- **Display**: usually unformatted long number; sometimes grouped 4-4-4-4-4.
- **Checksum**: Luhn (mod-10) over all digits including check.
- **Regex sketch**: `/\b89\d{17,20}\b/g` then Luhn-validate.
- **Synthetic example**: `8901260000000000001F` (synthetic; SIM cards often print without the `F` filler).
- **FP collision**: bare long-digit runs collide with bank accounts, transaction logs.
- **Context tokens**: `ICCID`, `SIM`, `SIM card`, `eSIM`.
- **Source**: [ITU-T E.118 / ISO 7812](https://www.itu.int/rec/T-REC-E.118/).

### IMSI (15 digits)

- **Format**: 15 digits — MCC (3) + MNC (2 or 3) + MSIN (9 or 10).
- **Checksum**: none.
- **Regex sketch**: `/\b\d{15}\b/g` (collides with IMEI shape — only context disambiguates).
- **FP collision**: identical shape to IMEI without checksum gate. Almost never user-facing — if it appears, it's a developer dashboard.
- **Context tokens**: `IMSI`, `subscriber identity`.

### MAC address (hex, 6 octets)

- **Format**: 6 hex pairs, separated by `:` or `-`. Sometimes Cisco dot-form `1234.5678.9abc`.
- **Regex sketch**:
  ```js
  const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b|\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b/g;
  ```
- **Synthetic example**: `00:1A:2B:3C:4D:5E`, `00-1A-2B-3C-4D-5E`, `001A.2B3C.4D5E`.
- **FP collision**: hex hashes of similar length but no separators. Low FP risk in this exact format.
- **Context tokens**: `MAC`, `MAC address`, `Ethernet`, `WiFi`, `Bluetooth address`.
- **Source**: [IEEE OUI registry](https://standards.ieee.org/products-programs/regauth/).

### Serial numbers (vendor-specific)

- Apple iPhone serials: 12-char alphanumeric (e.g. `F2LMG4PHJC67`). Apple device serials are rotating to 10-char randomized 2021+.
- Samsung serials: 11-char alphanumeric.
- Generic device serials: vary widely, no universal regex.
- **Detection strategy**: vendor-specific regex per known format; rely heavily on context tokens (`Serial`, `S/N`, `Device ID`).

---

## Network identifiers

### IPv4

- **Format**: 4 octets `0–255`, dotted: `192.168.1.1`.
- **Regex sketch (precise)**:
  ```js
  const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  ```
- **Sensitivity**: usually **NOT PII**. Public IPs in user-facing security UIs ("Last login from 203.0.113.45") may be considered PII per GDPR/CCPA. Private ranges (`10.x`, `172.16-31.x`, `192.168.x`) are never PII.
- **FP collision**: version strings (`1.2.3.4`), short numeric sequences. Strict octet bounds eliminate most.
- **Context tokens**: `IP`, `IP address`, `IPv4`, `from`, `login`, `geolocation`.
- **Source**: [RFC 791](https://www.rfc-editor.org/rfc/rfc791), [RFC 1918 (private ranges)](https://www.rfc-editor.org/rfc/rfc1918).

### IPv6

- **Format**: 8 groups of 4 hex digits, separated by `:`. Compressible (`::` for runs of zero groups).
- **Regex sketch (full+compressed)**:
  ```js
  const IPV6 = /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:|\b(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}\b/g;
  ```
- **FP collision**: low (very distinctive shape).
- **Source**: [RFC 4291](https://www.rfc-editor.org/rfc/rfc4291).

### CIDR / private ranges

- CIDR: `<ip>/<prefix>` where prefix 0–32 (IPv4) or 0–128 (IPv6). Add `\/\d{1,3}` to IP regex when CIDR matters.
- **Private IPv4 ranges** (always non-PII): `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, plus link-local `169.254.0.0/16`, loopback `127.0.0.0/8`.
- Suppress private-range matches before flagging IP.

---

## Disambiguation matrix

The PHONE_SHAPE regex (digit groups separated by space/hyphen, ≥3 per group, ≥2 groups) is the highest-collision pattern in the active matcher. Common collisions:

| Source | Example | Distinguishing signal |
|---|---|---|
| Date | `2024 03 15`, `2024-03-15` | Year-shape leading group + ISO 8601 keyword window. Suppressor: `isDateLike` (see `false-positives.md`). |
| IPv4 | `192 168 1 1` (rare but happens) | Octet-bound check + `IP`/`IPv4` keywords. Suppressor: `isIPv4Like`. |
| IMEI | `123 456 789 012 345` (15-digit, regrouped) | Total digit count = 15 + Luhn pass + IMEI keyword. |
| IBAN segments | `1234 5678 9012 3456` | 4-digit grouping + leading 2-letter country code in same neighborhood. |
| Card PAN | `4111 1111 1111 1111` | 4-4-4-4 grouping + leading IIN + Luhn pass. Card detector should run first. |
| Order / tracking | `Order #1234-5678-9012` | `Order`/`Tracking`/`Ref` keyword window. Suppressor: `isOrderRef`. |
| Aadhaar | `1234 5678 9012` (4-4-4) | 12-digit total + first digit `[2-9]` + Verhoeff. Aadhaar detector runs first. |
| SKU / model | `P/N 1234-5678-9012` | `P/N`, `Part Number`, `Model`, `SKU` keyword window. Suppressor: `isPartNumber`. |

### Resolution policy

When two patterns match the same string, resolve highest-confidence first:

1. Card PAN (Luhn + IIN + 4-4-4-4 grouping)
2. IBAN (mod-97 + country-prefix-letters)
3. NHS / Aadhaar / SSN (checksum + format)
4. IMEI / ICCID (Luhn + length + context)
5. Phone (E.164 / NANP / per-country)
6. Bare digit (last resort; high FP without context)

The current `pii_detector.js` already orders by first-match-at-position-wins; for cross-pattern resolution, run validators in this confidence order before the regex returns a match.

---

## References

- ITU-T E.164 — [https://www.itu.int/rec/T-REC-E.164/](https://www.itu.int/rec/T-REC-E.164/)
- ITU-T E.118 (ICCID) — [https://www.itu.int/rec/T-REC-E.118/](https://www.itu.int/rec/T-REC-E.118/)
- 3GPP TS 23.003 (IMEI / IMSI) — [https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=729](https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=729)
- IEEE OUI registry — [https://standards.ieee.org/products-programs/regauth/](https://standards.ieee.org/products-programs/regauth/)
- NANPA — [https://www.nationalnanpa.com/](https://www.nationalnanpa.com/)
- Ofcom UK — [https://www.ofcom.org.uk/phones-telecoms-and-internet/information-for-industry/numbering](https://www.ofcom.org.uk/phones-telecoms-and-internet/information-for-industry/numbering)
- BNetzA Germany — [https://www.bundesnetzagentur.de/](https://www.bundesnetzagentur.de/)
- ARCEP France — [https://en.arcep.fr/professional-area/manage-the-numbering-resources/national-numbering-plan.html](https://en.arcep.fr/professional-area/manage-the-numbering-resources/national-numbering-plan.html)
- TRAI India — [https://www.trai.gov.in/](https://www.trai.gov.in/)
- IMDA Singapore — [https://www.imda.gov.sg/](https://www.imda.gov.sg/)
- RFC 791 (IPv4) — [https://www.rfc-editor.org/rfc/rfc791](https://www.rfc-editor.org/rfc/rfc791)
- RFC 4291 (IPv6) — [https://www.rfc-editor.org/rfc/rfc4291](https://www.rfc-editor.org/rfc/rfc4291)
- RFC 1918 (private IPv4) — [https://www.rfc-editor.org/rfc/rfc1918](https://www.rfc-editor.org/rfc/rfc1918)
- E.164 / Wikipedia — [https://en.wikipedia.org/wiki/E.164](https://en.wikipedia.org/wiki/E.164)
- Telephone numbers in China / Wikipedia — [https://en.wikipedia.org/wiki/Telephone_numbers_in_China](https://en.wikipedia.org/wiki/Telephone_numbers_in_China)
