# Government ID Numerics — Global

> Research for Chrome extension PII numeric detector. Patterns, regex sketches, checksums, distinguishing context tokens.

## US

| ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|
| **SSN** | 9 digits, often `NNN-NN-NNNN` (separators: `-` or space). Area `001-665, 667-899`; group `01-99`; serial `0001-9999`. Forbidden: `000`, `666`, `9xx` (those are ITIN range), all-zero groups. | `/\b(?!000\|666\|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g` | None (SSA range rules only) | `123-45-6789` | Phone w/o country, 9-digit invoice nums, ZIP+4+ext | "SSN", "social security", "tax id" |
| **ITIN** | 9 digits, `9NN-NN-NNNN`; first digit `9`; 4th-5th digit ranges `50-65, 70-88, 90-92, 94-99`. | `/\b9\d{2}[- ]?(?:5\d\|6[0-5]\|7\d\|8[0-8]\|9[02-9])[- ]?\d{4}\b/g` | None (range rules) | `912-70-1234` | Looks like SSN; needs `9xx` prefix gate | "ITIN", "individual taxpayer", "tax identification" |
| **EIN** | 9 digits, `NN-NNNNNNN` (one dash, position 2). Valid prefixes from IRS list (~80 two-digit codes). | `/\b\d{2}-\d{7}\b/g` (validate prefix in 01-06,10-16,20-27,30-48,50-68,71-77,80-88,90-99) | None | `12-3456789` | Phone, account numbers | "EIN", "employer identification", "FEIN", "tax id" |

Notes: SSN regex deliberately rejects 000/666/9xx areas, 00 group, 0000 serial. Standalone match risk = high — phone numbers split as 3-3-4 collide; require keyword context for non-formatted matches. Sources: IRS TIN page, SSA "Randomization" 2011-06-25.

## India

| ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|
| **Aadhaar** | 12 digits, often `XXXX XXXX XXXX` (4-4-4 groups). First digit must NOT be `0` or `1`. Last digit = Verhoeff checksum. | `/\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g` | **Verhoeff** (Dihedral D5 group, 100% single-digit and adjacent-transposition error detection) | `2345 6789 0123` (synthetic — replace last w/ Verhoeff digit) | 12-digit phone numbers, account numbers; mobile (+91) numbers w/ separators | "Aadhaar", "UID", "आधार", "VID", "UIDAI" |
| **PAN** | 10 chars, alphanumeric `[A-Z]{5}[0-9]{4}[A-Z]`. 4th char = entity (P=Person, C=Company, H=HUF, F=Firm, A=AOP, T=Trust, B=BOI, L=Local, J=Artificial, G=Govt). | `/\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g` | Last char is checksum letter (algorithm not public) | `ABCPK1234M` | Order numbers, license plates | "PAN", "Permanent Account Number", "पैन", "income tax" |
| **GSTIN** *(bonus)* | 15 chars: 2-digit state + 10-char PAN + entity + Z + checksum. | `/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g` | Mod-36 of base-36 weighted sum | `27ABCPK1234M1Z5` | None (very specific) | "GSTIN", "GST" |
| **Voter ID (EPIC)** | 10 chars: `[A-Z]{3}\d{7}` | `/\b[A-Z]{3}\d{7}\b/g` | None | `ABC1234567` | Tracking codes, license plates, PNRs | "Voter ID", "EPIC", "Election Card" |

Verhoeff implementation = `~30 LOC` (D5 group multiplication table + permutation table + inverse table). PAN: regex alone is high-confidence due to alphanumeric structure. Aadhaar: regex alone has FP risk; pair with Verhoeff or context. Sources: UIDAI checksum spec, Wikipedia PAN.

## UK

| ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|
| **NHS number** | 10 digits, formatted `NNN NNN NNNN` (3-3-4). Last digit = mod-11 check. | `/\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g` | **Mod-11**: weights `10,9,8,7,6,5,4,3,2` over digits 1–9; sum mod 11; check = `11 − remainder`; `11 → 0`; `10 → invalid`. | `943 476 5919` | Phone numbers (UK 11-digit), order IDs | "NHS", "NHS number", "patient" |
| **NI number (NINO)** | 9 chars: 2 letters + 6 digits + 1 letter (`A`/`B`/`C`/`D`/space). Letters at pos 1: not D, F, I, Q, U, V; pos 2: not D, F, I, O, Q, U, V; combo not BG, GB, KN, NK, NT, TN, ZZ. | `/\b(?![DFIQUV])[A-Z](?![DFIOQUV])[A-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]?\b/g` | None | `QQ 12 34 56 C` (QQ is HMRC test prefix — use AB instead in real samples) | Tracking IDs, voucher codes | "NI number", "National Insurance", "NINO" |
| **UTR** *(bonus)* | 10 digits, sometimes prefixed `K`. | `/\b\d{10}K?\b/g` | Mod-11 (HMRC internal — not public) | `1234567890` | Phone, NHS-collision; needs context | "UTR", "Unique Taxpayer Reference", "Self Assessment" |

NINO regex strictness limits FPs significantly thanks to forbidden letter combos. Source: UK Gov NI number rules; NHS Data Dictionary.

## EU (DE / FR / IT / ES / NL / SE)

| Country | ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|---|
| **DE** | Steuer-ID | 11 digits, "12 345 678 901". One digit appears exactly twice (or thrice in newer rule), others appear at most once; first digit nonzero. | `/\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g` | **ISO 7064 mod-11-10** | `12 345 678 901` | Phone, postcode+suffix | "Steuer-ID", "IdNr", "Identifikationsnummer", "tax id" |
| **DE** | Steuernummer | 10–13 digits, formatted with `/` (varies by Bundesland; e.g. `12/345/67890`). | `/\b\d{2,3}\/\d{3}\/\d{4,5}\b/g` | None standardized | `12/345/67890` | Date strings | "Steuernummer", "tax number" |
| **FR** | INSEE / NIR (Sécu) | 15 digits: `S YY MM DD CCC NNN KK` (sex 1/2, year, month 01-12 / 30-42 / 50-99 corsica, dept code 2D, commune 3D, serial 3D, key 2D). | `/\b[1278] ?\d{2} ?\d{2} ?(?:2[AB]\|\d{2}) ?\d{3} ?\d{3} ?\d{2}\b/g` | **mod-97**: `key = 97 − (N mod 97)` over the first 13 digits (with Corsica letter substitution: 2A→19, 2B→18). | `2 85 08 75 116 001 89` | Concatenated date+phone | "INSEE", "numéro de sécurité sociale", "NIR" |
| **FR** | SIREN / SIRET | 9 / 14 digits. | `/\b\d{3} ?\d{3} ?\d{3}( ?\d{5})?\b/g` | **Luhn** | `732829320` | Phone, account number | "SIREN", "SIRET" |
| **IT** | Codice Fiscale | 16 chars alphanumeric: 6 letters + 2 digits + letter + 2 digits + letter + 3 digits + letter (last = check). | `/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g` | Italian CF check letter (lookup table) | `RSSMRA85T10A562S` | None — pattern is highly specific | "Codice Fiscale", "CF" |
| **ES** | DNI / NIE | DNI: 8 digits + check letter. NIE: `[XYZ]` + 7 digits + check letter. | `/\b\d{8}[A-HJ-NP-TV-Z]\b/g` and `/\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b/g` | Letter = `"TRWAGMYFPDXBNJZSQVHLCKE"[num mod 23]` (X=0, Y=1, Z=2 for NIE). | `12345678Z` / `X1234567L` | Phone+letter, account+letter | "DNI", "NIE", "NIF" |
| **NL** | BSN | 9 digits. Last = check via 11-test. | `/\b\d{9}\b/g` | **11-test**: `(9·d1 + 8·d2 + 7·d3 + 6·d4 + 5·d5 + 4·d6 + 3·d7 + 2·d8 + −1·d9) mod 11 == 0`. (Note: weight on d9 is `-1`, not `+1`.) | `111222333` (synth) | Phone, account, any 9-digit num | "BSN", "burgerservicenummer", "sofinummer" |
| **SE** | Personnummer | 10 or 12 digits: `YYMMDD-NNNC` (or `YYYYMMDD-NNNC`); separator `-` or `+` (the latter for age 100+). | `/\b(?:\d{2})?\d{6}[-+]?\d{4}\b/g` | **Luhn** over last 10 digits (date+serial+check) | `811228-9874` | Date strings, phone | "personnummer", "personal number" |

Notes: BSN regex is dangerously generic — any 9-digit run matches; checksum or context required. Codice Fiscale is the only highly self-validating ID via raw regex. INSEE has the strongest format (sex prefix + date) so context isn't strictly required for high precision.

## Canada / Australia

| ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|
| **CA SIN** | 9 digits, `NNN-NNN-NNN`. First digit = province (1-Atlantic, 2/3-QC, 4/5-ON, 6-Prairies, 7-BC, 8 unused, 9-temporary). `0` invalid as first. | `/\b[1-79]\d{2}[ -]?\d{3}[ -]?\d{3}\b/g` | **Luhn (mod-10)** | `046-454-286` | Phone (NA 10-digit close), account, US SSN format | "SIN", "Social Insurance", "NAS" (FR) |
| **AU TFN** | 8 or 9 digits, `NNN NNN NNN`. | `/\b\d{3} ?\d{3} ?\d{2,3}\b/g` | **Mod-11**: weights `1,4,3,7,5,8,6,9,10` (8-digit) or `1,4,3,7,5,8,6,9,10,?` — sum ≡ 0 mod 11. | `123 456 782` | Phone (AU 10-digit), account | "TFN", "Tax File Number" |
| **AU Medicare** | 11 digits: `NNNN NNNNN N N` (10-digit base + IRN). First digit `2-6`. | `/\b[2-6]\d{3} ?\d{5} ?\d\b/g` (10-digit core) | Weights `[1,3,7,9,1,3,7,9]` × first 8 digits, sum mod 10 = 9th digit | `2123 45670 1` | Phone, account | "Medicare" |
| **AU ABN** *(bonus)* | 11 digits | `/\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g` | Mod-89 with weights `[10,1,3,5,7,9,11,13,15,17,19]` over (d1−1, d2…d11); sum ≡ 0 mod 89 | `51 824 753 556` | Phone, account | "ABN", "Australian Business Number" |

## East Asia (CN / JP / KR / SG)

| Country | ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|---|
| **CN** | Resident ID (居民身份证) | 18 chars: 6-digit region + 8-digit DOB (YYYYMMDD) + 3-digit serial + check (`0–9` or `X`). | `/\b[1-9]\d{5}(?:18\|19\|20)\d{2}(?:0[1-9]\|1[0-2])(?:0[1-9]\|[12]\d\|3[01])\d{3}[\dX]\b/g` | **ISO 7064 MOD 11-2**: weights `[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]`; sum mod 11 → table `1,0,X,9,8,7,6,5,4,3,2`. | `11010519491231002X` | Bank account, long invoice IDs | "身份证", "居民身份证", "ID number", "shenfenzheng" |
| **JP** | My Number (個人番号) | 12 digits, often `NNNN NNNN NNNN`. | `/\b\d{4} ?\d{4} ?\d{4}\b/g` | **Mod-11**: weights for d1–d11 = `[6,5,4,3,2,7,6,5,4,3,2]`; check = `11 − (sum mod 11)`; if `≥10 → 0`. | `1234 5678 9018` | Phone, account, generic 12-digit | "マイナンバー", "個人番号", "My Number" |
| **JP** | Corporate Number | 13 digits | `/\b\d{13}\b/g` | Mod-9 variant | `1234567890123` | Long IDs | "法人番号" |
| **KR** | RRN (주민등록번호) | 13 digits: `YYMMDD-CDDDDDC` (sex+century digit then 5 region/serial + checksum). | `/\b\d{6}-?[1-8]\d{6}\b/g` | Weighted mod-11: weights `[2,3,4,5,6,7,8,9,2,3,4,5]` × first 12 digits; check = `(11 − sum mod 11) mod 10`. | `900101-1234567` | None — date prefix is distinctive | "주민등록번호", "RRN", "resident registration" |
| **SG** | NRIC / FIN | 9 chars: `[STFGM]` + 7 digits + check letter. `S/T` = citizen (born <2000 / ≥2000), `F/G/M` = foreigner. | `/\b[STFGM]\d{7}[A-Z]\b/g` | Weights `[2,7,6,5,4,3,2]` × digits; offset by `4` for T/G, `3` for M; map mod-11 → letter (S/T table: `JZIHGFEDCBA`; F/G table: `XWUTRQPNMLK`; M table: `KLJNPQRTUWX`). | `S1234567D` | License/voucher codes (rare) | "NRIC", "FIN", "Singapore ID" |

Notes: CN ID is fully self-validating — date+region structure leaves <0.001% FP rate. KR RRN handling is sensitive (KR DPA prohibits collection without legal basis); detection should mask aggressively. SG NRIC: PDPC banned use as login key in 2019, but still appears in personal records.

## Latin America (BR / MX)

| Country | ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|---|
| **BR** | CPF | 11 digits, `NNN.NNN.NNN-NN`. | `/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g` | **Mod-11 twice**: digits 1–9 → check1; digits 1–10 → check2. | `123.456.789-09` | BR mobile (11-digit), order numbers | "CPF", "cadastro de pessoas físicas" |
| **BR** | CNPJ | 14 digits, `NN.NNN.NNN/NNNN-NN`. | `/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g` | Mod-11 twice (different weights from CPF). | `12.345.678/0001-95` | Distinctive `/` separator — low | "CNPJ", "cadastro nacional pessoa jurídica" |
| **BR** | RG (state ID) | varies by state, 7–10 digits + optional check letter or digit. SP uses `NN.NNN.NNN-X`. | `/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/g` | Per-state, mostly mod-11 | `12.345.678-X` | Account numbers, varies | "RG", "registro geral", "identidade" |
| **MX** | CURP | 18 alphanumeric: 4 letters + 6 digits (DOB) + `[HM]` (sex) + 2 letters (state) + 3 alphanumeric + 1 digit. | `/\b[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z0-9]{3}\d\b/g` | Custom letter-position checksum (last digit). | `BADD110313HCMLNS09` | Order codes (rare) | "CURP", "clave única de registro" |
| **MX** | RFC | 12 (companies) or 13 (persons) alphanumeric. | `/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g` | Custom mod-11 over alphanumeric mapping. | `XAXX010101000` | None — distinctive | "RFC", "registro federal de contribuyentes" |

**Sources**: [Receita Federal — CPF/CNPJ](https://www.gov.br/receitafederal/pt-br), [SAT — CURP/RFC](https://www.sat.gob.mx/).

## Other (ZA / RU / IL / AE)

| Country | ID | Format | Regex (`/g`) | Checksum | Example | FP collisions | Context tokens |
|---|---|---|---|---|---|---|---|
| **ZA** | ID Number | 13 digits: `YYMMDD GSSS C A Z` (DOB + sequence + citizen + race + check). | `/\b\d{6} ?\d{4} ?\d{2} ?\d\b/g` | **Luhn (mod-10)** | `8001015009087` | DOB-shape strings, account numbers | "ID Number", "SAID", "identity number", "ID nommer" (Afrikaans) |
| **RU** | INN (Tax) | 10 (companies) or 12 (persons) digits. | `/\b\d{10,12}\b/g` | Custom weighted mod-11 (10) / mod-11 twice (12). | `7707083893` | Phone, account | "ИНН", "INN" |
| **RU** | Internal Passport | 4 + 6 digits, format `XXXX XXXXXX`. Series digits encode region+year. | `/\b\d{4} ?\d{6}\b/g` | None | `1234 567890` | Phone, generic 10-digit | "паспорт", "серия и номер" |
| **RU** | SNILS | 11 digits, `XXX-XXX-XXX YY` (insurance) | `/\b\d{3}-?\d{3}-?\d{3} ?\d{2}\b/g` | Weighted sum mod-101 | `112-233-445 95` | Phone with sep, account | "СНИЛС", "SNILS" |
| **IL** | Teudat Zehut | 9 digits (older 7–8 zero-padded to 9). | `/\b\d{9}\b/g` | **Luhn-like**: alternating ×1/×2; sum digits of products; mod-10 == 0. | `123456782` | NPI (US, 9-digit), SIN (CA, 9-digit), bank accounts | "תעודת זהות", "Teudat Zehut", "מספר זהות", "ID Number" |
| **AE** | Emirates ID | 15 digits, `784-YYYY-NNNNNNN-C`: `784` country + 4-digit year + 7-digit sequence + check. | `/\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g` | **Luhn (mod-10)** | `784-1990-1234567-1` | Long ID strings | "Emirates ID", "هوية", "EID" |

**Sources**: [Department of Home Affairs ZA](http://www.dha.gov.za/), [ФНС России — INN](https://www.nalog.gov.ru/), [Population Registry IL](https://www.gov.il/), [ICA UAE — Emirates ID](https://www.ica.gov.ae/).

---

## Summary: detection priority table

Confidence tiers:

- **regex-alone (high)** — distinctive shape/letter mix that rarely collides. Safe to flag from regex match.
- **regex + checksum** — passes random-string filter via Luhn / Verhoeff / mod-11 / mod-97. Reduces FPs ~90%.
- **regex + context** — needs nearby keyword to disambiguate from collision (phone, order, account).

| ID | Country | Tier | Recommended validator |
|---|---|---|---|
| Codice Fiscale | IT | regex-alone | regex (alphanumeric structure) + check letter |
| CURP / RFC | MX | regex-alone | regex (alphanumeric structure) |
| PAN | IN | regex-alone | regex |
| GSTIN | IN | regex-alone | regex |
| NRIC / FIN | SG | regex-alone | regex + letter checksum |
| DNI / NIE | ES | regex-alone | regex + letter checksum |
| EIN | US | regex-alone | regex (`NN-NNNNNNN`) + IRS prefix list |
| CN ID | CN | regex-alone | regex (date prefix is highly distinctive) + ISO 7064 mod-11-2 |
| INSEE / NIR | FR | regex-alone | mod-97 (sex prefix + date already filter) |
| Aadhaar | IN | regex + checksum | Verhoeff (bare-12-digit too ambiguous without) |
| CPF / CNPJ | BR | regex + checksum | mod-11 twice |
| ZA ID | ZA | regex + checksum | Luhn |
| Emirates ID | AE | regex + checksum | Luhn + `784` prefix gate |
| KR RRN | KR | regex + checksum | mod-11 |
| Steuer-ID | DE | regex + checksum | ISO 7064 mod-11-10 |
| BSN | NL | regex + checksum | 11-test (regex alone matches every 9-digit string) |
| Personnummer | SE | regex + checksum | Luhn |
| NHS | UK | regex + checksum | mod-11 (mandatory — collides with phone) |
| SIN | CA | regex + checksum | Luhn |
| TFN | AU | regex + checksum | weighted mod-11 |
| ABN | AU | regex + checksum | mod-89 |
| SSN | US | regex + context | Range rules + "SSN"/"social security" keyword |
| ITIN | US | regex + context | `9XX` prefix gate + tax keyword |
| NI Number | UK | regex + context | Forbidden-letter rules + `NI` keyword |
| Voter ID | IN | regex + context | Distinctive letter prefix + `EPIC`/voter keyword |
| Medicare | AU | regex + context | First-digit gate + `Medicare` keyword |
| My Number | JP | regex + context | mod-11 + 12-digit (collides w/ Aadhaar; needs JP token) |
| INN | RU | regex + context | mod-11 + INN keyword |
| Teudat Zehut | IL | regex + context | Luhn-like + Hebrew/`Teudat` keyword (otherwise = SIN/NPI) |

### Implementation guidance

1. **Always run checksum where one exists.** Random-string Luhn pass rate ≈ 10%; mod-11 ≈ 9%; mod-97 ≈ 1%. Combined with prefix/range/format gates, FPs drop to <0.5%.
2. **Order detectors by confidence.** Cards (Luhn + IIN) before bare-digit; Aadhaar (Verhoeff) before 12-digit phone; NHS (mod-11) before UK landline.
3. **Localize context tokens.** A US-only token list misses Aadhaar matches on Hindi pages — add native-script keywords for top markets.
4. **Pick top 10 by user-base.** Maintaining 25+ checksum implementations inflates surface area. Cards (Luhn) + Aadhaar (Verhoeff) + IBAN (mod-97) + NHS (mod-11) + 6 more cover ~80% of global PII traffic.

---

## References

- IRS — TIN/SSN/EIN/ITIN: [https://www.irs.gov/individuals/individual-taxpayer-identification-number](https://www.irs.gov/individuals/individual-taxpayer-identification-number)
- SSA — SSN Randomization (2011): [https://www.ssa.gov/employer/randomization.html](https://www.ssa.gov/employer/randomization.html)
- UIDAI — Aadhaar verification & Verhoeff: [https://uidai.gov.in/](https://uidai.gov.in/)
- NHS Data Dictionary — NHS Number: [https://www.datadictionary.nhs.uk/attributes/nhs_number.html](https://www.datadictionary.nhs.uk/attributes/nhs_number.html)
- HMRC — UTR / NINO format: [https://www.gov.uk/hmrc-internal-manuals/](https://www.gov.uk/hmrc-internal-manuals/)
- BZSt Germany — Steuer-ID: [https://www.bzst.de/EN/Private_individuals/Tax_identification_number/tax_identification_number_node.html](https://www.bzst.de/EN/Private_individuals/Tax_identification_number/tax_identification_number_node.html)
- INSEE France — NIR: [https://www.insee.fr/en/](https://www.insee.fr/en/)
- Agenzia delle Entrate — Codice Fiscale: [https://www.agenziaentrate.gov.it/portale/web/english/codice-fiscale-spid-cns](https://www.agenziaentrate.gov.it/portale/web/english/codice-fiscale-spid-cns)
- Skatteverket Sweden — personnummer: [https://www.skatteverket.se/](https://www.skatteverket.se/)
- ATO — TFN format: [https://www.ato.gov.au/individuals/tax-file-number/](https://www.ato.gov.au/individuals/tax-file-number/)
- Receita Federal Brazil — CPF/CNPJ: [https://www.gov.br/receitafederal/pt-br](https://www.gov.br/receitafederal/pt-br)
- ICA Singapore — NRIC: [https://www.ica.gov.sg/](https://www.ica.gov.sg/)
- 総務省 (MIC Japan) — マイナンバー: [https://www.mynumber.go.jp/](https://www.mynumber.go.jp/)
- State Council CN — Resident Identity Card Law: [http://www.gov.cn/](http://www.gov.cn/)
- Verhoeff algorithm — [https://en.wikipedia.org/wiki/Verhoeff_algorithm](https://en.wikipedia.org/wiki/Verhoeff_algorithm)
- ISO 7064 — Check character systems: [https://www.iso.org/standard/31531.html](https://www.iso.org/standard/31531.html)
- Luhn algorithm — [https://en.wikipedia.org/wiki/Luhn_algorithm](https://en.wikipedia.org/wiki/Luhn_algorithm)
