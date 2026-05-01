# Address / Postal / Location Numerics — Global

> Postal codes by country, geocoordinates, IP, address fragments.

## Postal codes — top 25 countries

> All regexes below are sketches with `/g` for in-page detection. Tighten/loosen to taste.
> "Tier" is sensitivity when the match is *alone* (no city/street context).

### US ZIP / ZIP+4
- Format: `NNNNN` or `NNNNN-NNNN` (the +4 adds delivery sector/segment).
- Regex: `/\b\d{5}(?:-\d{4})?\b/g`
- Example: `94103`, `94103-1234`
- FP: any 5-digit number — date components, OTP digits, prices in cents, German PLZ, Spanish/Italian/Mexican CP, French CP. Disambiguate with US-context tokens.
- Context tokens (EN): `ZIP`, `ZIP code`, `Zip`, `Postal Code`, `USA`, US state abbrev (`CA 94103`).
- Tier: LOW alone; MEDIUM with city; HIGH with street + house#.
- Source: USPS publication.

### Canada (alphanumeric)
- Format: `A1A 1A1` — Forward Sortation Area + Local Delivery Unit. The letters `D F I O Q U` never appear; `W Z` never lead.
- Regex (loose): `/\b[A-CEGHJ-NPR-TV-Z]\d[A-CEGHJ-NPR-TV-Z][ -]?\d[A-CEGHJ-NPR-TV-Z]\d\b/gi`
- Example: `M5H 2N2`, `K1A0B1`
- FP: very low — alphanumeric mix is rare in plain text. Any "letter-digit-letter digit-letter-digit" is overwhelmingly Canadian postcode.
- Context tokens (EN/FR): `Postal Code`, `Code postal`, `Canada`, province abbrev (`ON`, `QC`).
- Tier: MEDIUM alone (geographic precision is high — first 3 chars = ~7000 households).
- Source: Canada Post addressing standards.

### UK postcode (alphanumeric)
- Format: outward `A9 9AA`, `A99 9AA`, `AA9 9AA`, `AA99 9AA`, `A9A 9AA`, `AA9A 9AA`. Excludes `Q V X` in first letter; second letter excludes `I J Z`.
- Regex (pragmatic): `/\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b/gi`
- Example: `SW1A 1AA`, `EC1A 1BB`, `M1 1AE`
- FP: low — distinctive shape, uncommon in non-UK text.
- Context tokens (EN): `Postcode`, `Post code`, `UK`, `United Kingdom`, county names.
- Tier: HIGH — UK postcodes resolve to ~15 households on average; finest postal granularity globally.
- Source: Royal Mail PAF.

### Europe 5-digit (DE / FR / IT / ES)
- Format: `NNNNN` for Germany (PLZ), France (CP), Italy (CAP), Spain (CP), Mexico (CP), Turkey, Finland, Croatia.
- Regex: `/\b\d{5}\b/g`
- Examples: DE `10115`, FR `75001`, IT `00184`, ES `28001`, MX `01000`.
- FP: HIGH — same regex as US ZIP. See collision table below.
- Context tokens:
  - DE: `PLZ`, `Postleitzahl`, German city after digits (`10115 Berlin`).
  - FR: `CP`, `Code postal`, French city.
  - IT: `CAP`, Italian city.
  - ES: `CP`, `Código Postal`, Spanish province (`28001 Madrid`).
- Tier: LOW alone (collision risk too high); MEDIUM with country/city.
- Source: country postal authorities (Deutsche Post, La Poste, Poste Italiane, Correos).

### Europe 4-digit + 2-letter (NL)
- Format: `NNNN AA` — distinctive shape (digits + space + 2 uppercase letters).
- Regex: `/\b\d{4}[ ]?[A-Z]{2}\b/g`
- Example: `1011 AC` (Amsterdam centre), `2511CV` (The Hague).
- FP: very low — alphanumeric tail makes this unique among postal codes.
- Context tokens (NL): `Postcode`, Dutch city after.
- Tier: HIGH — NL postcode + house number pinpoints individual addresses.
- Source: PostNL.

### Europe 4-digit (BE / AT / CH / DK / NO / SE / HU / LU / NZ / AU / ZA)
- Format: `NNNN` — Belgium, Austria, Switzerland (with no leading 0 sometimes), Denmark, Norway, Hungary, Luxembourg, NZ, AU, South Africa.
- Regex: `/\b\d{4}\b/g`
- Examples: BE `1000` (Brussels), AT `1010` (Vienna), CH `8001` (Zurich), DK `1050`, AU `2000` (Sydney), NZ `0010` (Auckland CBD), ZA `0001` (Pretoria).
- FP: extreme — 4-digit numbers everywhere (years, prices, OTPs).
- Context tokens: country name, city name. **Never blur on regex alone.**
- Tier: LOW alone; MEDIUM with city.

### Asia 6-digit (IN / CN / SG / RU / BY / KZ)
- Format: `NNNNNN` — India PIN, China youbian, Singapore (6-digit), Russia, Belarus, Kazakhstan.
- Regex: `/\b\d{6}\b/g`
- Examples: IN `110001` (Delhi), CN `100000` (Beijing), SG `238801` (Orchard), RU `101000` (Moscow).
- FP: HIGH — colliding with employee IDs, transaction refs, OTPs (6-digit OTP is the worst FP source).
- Context tokens:
  - IN: `PIN`, `Pincode`, `PIN Code`, Indian state (`Mumbai 400001`).
  - CN: `邮编`, `邮政编码`, `youbian`.
  - SG: `Singapore` literally + 6 digits.
  - RU: `Индекс`, Russian city.
- Tier: LOW alone; MEDIUM with country/city.
- Source: India Post PIN, China Post, SingPost, Russian Post.

### Asia 7-digit (JP)
- Format: `NNN-NNNN` (Japan 〒). The `〒` symbol often precedes.
- Regex: `/(?:〒\s?)?\b\d{3}-\d{4}\b/g`
- Example: `〒100-0001` (Chiyoda), `150-0002` (Shibuya).
- FP: phone numbers in some formats (`555-1234` is 7 digits with hyphen) — context required.
- Context tokens (JP): `〒` symbol, `郵便番号`, `〶`, Japanese city after.
- Tier: HIGH — JP postcodes resolve to ~1 city block.
- Source: Japan Post.

### Asia 5-digit (KR / TH / MY / ID / TW)
- Format: `NNNNN` — South Korea (since 2015), Thailand, Malaysia, Indonesia, Taiwan (also 3+2 hybrid).
- Regex: `/\b\d{5}\b/g`
- Examples: KR `04524` (Seoul), TH `10110` (Bangkok), MY `50050` (KL), ID `10110` (Jakarta).
- FP: identical to US ZIP / DE PLZ — see collision table.
- Context tokens: `우편번호` (KR), `รหัสไปรษณีย์` (TH), `Poskod` (MY), `Kode Pos` (ID).
- Tier: LOW alone; MEDIUM with country.

### LATAM (BR CEP, MX, AR, CL)
- Brazil CEP: `NNNNN-NNN` — distinctive 5+3 with hyphen.
  - Regex: `/\b\d{5}-\d{3}\b/g`
  - Example: `01310-100` (Av. Paulista, SP).
  - Context: `CEP`, Brazilian state.
  - Tier: HIGH — CEP + house # = building precision.
- Mexico CP: `NNNNN` — collides with US ZIP.
  - Regex: `/\b\d{5}\b/g` — see collision table.
  - Context: `CP`, `C.P.`, Mexican state.
- Argentina CPA: `A####AAA` (8 chars) — letter + 4 digits + 3 letters.
  - Regex: `/\b[A-Z]\d{4}[A-Z]{3}\b/g`
  - Example: `C1425CLA` (Palermo, BA).
  - Tier: HIGH — distinctive.
- Chile: `NNNNNNN` (7 digits, no separator).
  - Regex: `/\b\d{7}\b/g`
  - FP: extreme — 7 plain digits collide with phones, IDs.

### Oceania (AU 4-digit, NZ 4-digit)
- Australia: `NNNN` — first digit = state. NSW 1xxx-2xxx, VIC 3xxx-8xxx, etc.
  - Regex: `/\b\d{4}\b/g`
  - Examples: `2000` (Sydney CBD), `3000` (Melbourne CBD), `4000` (Brisbane CBD).
  - Context: `Postcode`, AU state abbrev (`NSW 2000`).
- NZ: `NNNN`.
  - Examples: `0010` (Auckland Central), `6011` (Wellington).
  - Context: `Postcode`, NZ city.
- Tier: LOW alone (4 digits); MEDIUM with city.

### Africa (ZA 4-digit)
- South Africa: `NNNN`. Box codes also exist (different from street codes).
  - Regex: `/\b\d{4}\b/g`
  - Example: `2000` (Johannesburg), `8001` (Cape Town).
- Egypt: `NNNNN` (5 digits) — collides with ZIP/PLZ.
- Nigeria: `NNNNNN` (6 digits) — collides with PIN.
- Tier: LOW alone.

### Russia (6-digit)
- Format: `NNNNNN`. Same regex shape as IN PIN, CN, SG.
  - Regex: `/\b\d{6}\b/g`
  - Example: `101000` (Moscow centre).
- Context: `Индекс`, `Почтовый индекс`, Cyrillic city name preceding.
- Tier: LOW alone.

### Sweden / Norway / Denmark / Finland (3+2 with space)
- SE/NO: `NNN NN` — 3 digits, space, 2 digits.
  - Regex: `/\b\d{3}[ ]?\d{2}\b/g`
  - Example: SE `114 35` (Stockholm), NO `0150` (Oslo, no space).
  - Context: `Postnummer`.
- DK/FI: `NNNN` — 4 digits.
- Tier: MEDIUM with city.

### Switzerland / Belgium / Austria
- All `NNNN` 4-digit (already covered above). Switzerland first digit = postal region (1-9).
## Address fragments (house numbers, apt, PO Box)

### House numbers

- **Format**: 1–5 digits, optional letter suffix (`123A`, `123-A`, `12½`).
- **Regex sketch**: `/\b\d{1,5}[A-Z]?\b/g` — far too generic to flag standalone.
- **Detection strategy**: house numbers are NEVER blurred standalone — only inside `<address>` blocks or near street keywords.
- **Context tokens**: `Street`, `St.`, `Ave`, `Avenue`, `Blvd`, `Road`, `Rd`, `Lane`, `Drive`, `Calle`, `Rue`, `Straße`, `通り`.
- **Tier**: LOW alone, HIGH when paired with street name.

### Apartment / unit / suite numbers

- **Format**: `Apt 12`, `#12`, `Unit 3B`, `Suite 100`.
- **Regex sketch**: `/(?:Apt\.?|Apartment|Unit|Suite|Ste\.?|#)\s?\w{1,5}/gi`
- **Detection strategy**: keyword-prefixed only.
- **Tier**: LOW alone.

### PO Box

- **Format**: `PO Box 123`, `P.O. Box 123`, `Postfach 123` (DE), `Apartado 123` (ES), `Boîte postale 123` (FR), `BP 123` (FR shorthand).
- **Regex sketch**: `/(?:P\.?O\.? Box|Postfach|Apartado|Boîte postale|BP)\s?\d+/gi`
- **Tier**: MEDIUM (often public for businesses; HIGH for individuals).

### Asia-specific block formats

- **JP**: `中央区銀座1-2-3` (`ward, neighborhood block-house-room`).
- **SG HDB**: `Block 12 #08-123 Sample St`.
- **KR**: `강남구 역삼동 5-6` (district + neighborhood + block-unit).

These rarely surface as bare numbers — entire address pattern is needed.

---

## Geocoordinates

### Decimal degrees

- **Format**: `lat, lon` where lat ∈ [-90, 90], lon ∈ [-180, 180]. Decimal precision 4–8 digits.
- **Regex sketch**:
  ```js
  const DD = /\b-?(?:90(?:\.0+)?|[1-8]?\d(?:\.\d+)?)\s*,\s*-?(?:180(?:\.0+)?|1[0-7]\d(?:\.\d+)?|[1-9]?\d(?:\.\d+)?)\b/g;
  ```
- **Synthetic example**: `40.7128, -74.0060` (NYC).
- **Sensitivity tier**: **HIGH** — pinpoints location to <100m at 4 decimals, <10m at 5.
- **Context tokens**: `lat`, `latitude`, `lon`, `lng`, `longitude`, `coordinates`, `GPS`, `geolocation`, `緯度`, `经度`.
- **Source**: [WGS 84 / EPSG:4326](https://epsg.io/4326).

### DMS (degrees-minutes-seconds)

- **Format**: `40°44'54.36"N 73°59'08.36"W`.
- **Regex sketch**:
  ```js
  const DMS = /\b\d{1,3}°\d{1,2}['′]\d{1,2}(?:\.\d+)?["″]\s?[NSEW]\b/g;
  ```
- **Sensitivity tier**: **HIGH**.

### UTM

- **Format**: `33T 5550000N 200000E` (zone + hemisphere + northing + easting). Rare on consumer pages.

### Plus codes (Open Location Code)

- **Format**: `7XCXP+9Q` (8 alphanumeric chars + `+` + 2–3 chars).
- **Regex sketch**: `/\b[2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,3}\b/g`
- **Synthetic example**: `87G8P3Q9+P3` (NYC area).
- **Tier**: HIGH (~14m).
- **Source**: [Plus Codes](https://maps.google.com/pluscodes/).

### What3words

- **Format**: 3 dictionary words separated by `.`, prefix `///`. e.g. `///filled.count.soap`.
- Not numeric — included for completeness.

---

## IP addresses

### IPv4

- **Format**: 4 octets `0–255`, dotted: `192.168.1.1`.
- **Regex sketch (precise)**:
  ```js
  const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  ```
- **Sensitivity**: **MEDIUM** (public IP roughly geolocates user; GDPR Recital 30 considers it an "online identifier"). Private ranges (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`) are never PII — suppress before flagging.
- **FP collision**: software version strings (`1.2.3.4`), short numeric sequences. Strict octet bounds eliminate most.
- **Context tokens**: `IP`, `IP address`, `IPv4`, `from`, `login from`, `geolocation`.
- **Source**: [RFC 791](https://www.rfc-editor.org/rfc/rfc791), [RFC 1918 (private ranges)](https://www.rfc-editor.org/rfc/rfc1918).

### IPv6

- **Format**: 8 groups of 4 hex digits separated by `:`; `::` compresses zero-runs.
- **Regex sketch**:
  ```js
  const IPV6 = /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:|\b(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}\b/g;
  ```
- **FP collision**: low (very distinctive shape).
- **Source**: [RFC 4291](https://www.rfc-editor.org/rfc/rfc4291).

### CIDR / private ranges

- CIDR: `<ip>/<prefix>` where prefix 0–32 (IPv4) or 0–128 (IPv6). Add `\/\d{1,3}` to IP regex when CIDR matters.
- **Private IPv4 ranges** (always non-PII): `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local `169.254.0.0/16`, loopback `127.0.0.0/8`.
- Suppress private-range matches before flagging IP.

---

## Other location IDs

### FIPS codes (US)

- **State FIPS**: 2 digits (`01`–`56`).
- **County FIPS**: 5 digits (state + 3-digit county).
- **Census tract**: 4–6 digits (decimal optional). Block group: 1 digit.
- **Detection**: keyword-only (`FIPS`, `census tract`, `block group`).

### Eircode (Ireland)

- **Format**: `A65 F4E2` (3-char routing key + 4-char unique identifier, alphanumeric).
- **Regex sketch**: `/\b[AC-FHKNPRTV-Y][0-9W][0-9 ][AC-FHKNPRTV-Y0-9]{4}\b/gi`
- **Synthetic example**: `D02 X285` (Dublin).
- **Tier**: HIGH — Eircode resolves to specific premises.
- **Source**: [Eircode](https://www.eircode.ie/).

### SG unit numbers

- **Format**: `#08-123` (floor-unit). Combined with HDB block + street → fully identifying.
- **Regex sketch**: `/#\d{2,3}-\d{1,4}/g`
- **Tier**: HIGH when paired with block + street.

### What3words (note)

- Not numeric, but worth flagging as HIGH-tier location identifier when `///word.word.word` shape appears.

---

## Sensitivity tiers

| Component | Alone | + city | + street name | + house # | + name |
|---|---|---|---|---|---|
| Postal code (5–7 digit) | LOW | MEDIUM | HIGH | HIGH | HIGH |
| Postal code (UK / NL / IE / CA) | MEDIUM | HIGH | HIGH | HIGH | HIGH |
| House number | LOW | LOW | HIGH | HIGH | HIGH |
| GPS coordinates (decimal) | HIGH | HIGH | HIGH | HIGH | HIGH |
| Plus code / Eircode | HIGH | HIGH | HIGH | HIGH | HIGH |
| IP address | MEDIUM | — | — | — | HIGH |
| Country/state name | LOW | LOW | LOW | MEDIUM | MEDIUM |

The detector should support **per-tier opt-in** in the popup: by default flag HIGH only; user can opt in to MEDIUM/LOW (e.g. for screen-share scenarios where IP visibility matters).

---

## 5-digit collision table

The same `\b\d{5}\b` regex matches: US ZIP, DE PLZ, FR CP, IT CAP, ES CP, MX CP, KR postcode, TH postcode, MY Poskod, ID Kode Pos, TR posta kodu, FI postinumero, HR poštanski broj. Distinguishing context:

| Country | Disambiguating tokens (within 100 chars) | Page-level signals |
|---|---|---|
| US ZIP | `ZIP`, `ZIP code`, US state 2-letter abbrev (`CA 94103`), `USA`, `United States` | `.us` TLD, USPS branding, `$` currency |
| DE PLZ | `PLZ`, `Postleitzahl`, `Straße`, `Deutschland` | `.de` TLD, EUR currency, German UI |
| FR CP | `code postal`, `département`, `France`, French city after | `.fr` TLD |
| IT CAP | `CAP`, `Codice Avviamento Postale`, `Italia`, Italian city | `.it` TLD |
| ES CP | `CP`, `código postal`, `España`, Spanish province | `.es` TLD |
| MX CP | `CP`, `C.P.`, `código postal`, `México`, `CDMX`, `D.F.` | `.mx` TLD |
| KR Postcode | `우편번호`, `대한민국` | `.kr` TLD, Hangul nearby |
| TH Postcode | `รหัสไปรษณีย์`, Thai city | `.th` TLD |
| TR posta kodu | `posta kodu`, `Türkiye`, Turkish city | `.tr` TLD |
| FI postinumero | `postinumero`, `Suomi`, Finnish city | `.fi` TLD |

### Implementation strategy

1. **Capture page-level country signal once** (TLD + `<html lang>` attribute + currency symbol + meta tags + nearby country name). Cache per page-load.
2. **Pass that signal into the postal regex match decision**: 5-digit numbers only flag if a postal-code keyword in the local language is in the 100-char window OR the page-level country signal aligns.
3. **Without country signal, fall back to safe-only flagging**: `\d{5}-\d{4}` (ZIP+4) is unambiguously US; `XXXXX-XXX` is BR CEP; `\d{3}-\d{4}` with `〒` is JP. Bare `\d{5}` standalone is too risky to blur globally.

### Why this matters for the detector

The current `pii_detector.js` 5-pattern matcher will hit every 5-digit run via the BARE_DIGITS regex. Without country-aware suppression, blurring postal codes globally produces noise on every product page (price-cents components like `1234.56` strip ok, but `12345` order numbers, OTP codes, port numbers, etc. get blurred).

Recommended posture: **postal codes are LOW-tier by default; only flag the high-precision national variants (UK postcode, NL postcode, JP postcode, BR CEP, AR CPA, IE Eircode) where regex shape itself is distinctive enough to avoid country disambiguation.**

---

## References

- USPS — DMM: [https://pe.usps.com/text/dmm300/Notice123.htm](https://pe.usps.com/text/dmm300/Notice123.htm)
- Royal Mail PAF: [https://www.royalmail.com/business/services/marketing/data-optimisation/paf](https://www.royalmail.com/business/services/marketing/data-optimisation/paf)
- Canada Post — postal codes: [https://www.canadapost-postescanada.ca/](https://www.canadapost-postescanada.ca/)
- Deutsche Post — PLZ: [https://www.deutschepost.de/de/p/postleitzahlensuche.html](https://www.deutschepost.de/de/p/postleitzahlensuche.html)
- Japan Post — postcodes: [https://www.post.japanpost.jp/zipcode/](https://www.post.japanpost.jp/zipcode/)
- India Post — PIN: [https://www.indiapost.gov.in/](https://www.indiapost.gov.in/)
- Correios Brasil — CEP: [https://www.correios.com.br/](https://www.correios.com.br/)
- Australia Post — postcodes: [https://auspost.com.au/postcode/](https://auspost.com.au/postcode/)
- WGS 84 / EPSG:4326: [https://epsg.io/4326](https://epsg.io/4326)
- Plus Codes (OLC): [https://maps.google.com/pluscodes/](https://maps.google.com/pluscodes/)
- Eircode IE: [https://www.eircode.ie/](https://www.eircode.ie/)
- RFC 791 (IPv4): [https://www.rfc-editor.org/rfc/rfc791](https://www.rfc-editor.org/rfc/rfc791)
- RFC 4291 (IPv6): [https://www.rfc-editor.org/rfc/rfc4291](https://www.rfc-editor.org/rfc/rfc4291)
- RFC 1918 (private IPv4): [https://www.rfc-editor.org/rfc/rfc1918](https://www.rfc-editor.org/rfc/rfc1918)
- GDPR Recital 30 (online identifiers): [https://gdpr-info.eu/recitals/no-30/](https://gdpr-info.eu/recitals/no-30/)
- ISO 3166 (country codes): [https://www.iso.org/iso-3166-country-codes.html](https://www.iso.org/iso-3166-country-codes.html)
- Universal Postal Union (UPU) postal-format database: [https://www.upu.int/en/Postal-Solutions/Programmes-Services/Addressing-Solutions](https://www.upu.int/en/Postal-Solutions/Programmes-Services/Addressing-Solutions)
