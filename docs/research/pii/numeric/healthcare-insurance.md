# Healthcare & Insurance Numerics — Global

> Health system IDs, insurance member numbers, MRN, prescription refs, NDC.

## US

### Medicare Beneficiary Identifier (MBI)

- **Format**: 11 alphanumeric chars, no separators (sometimes hyphenated on the card for readability — `1EG4-TE5-MK73`).
- **Composition (positional)**:
  - Pos 1, 4, 7, 10, 11 — always digit `[0-9]`
  - Pos 2, 5, 8, 9 — always letter (excluding `S L O I B Z`)
  - Pos 3, 6 — alphanumeric (digit OR same restricted letter set)
  - Allowed letter set: `[A-HJ-KMNP-RT-Y]` (i.e. A–Z minus `B I L O S Z`)
- **Replaced**: legacy SSN-based HICN (format `\d{9}[A-Z]\d?`) — fully retired Jan 2020. Treat HICN regex as a fallback only on archive/legacy pages.
- **Checksum**: none (designed as a non-intelligent random ID).
- **Regex sketch**:
  ```js
  const MBI = /\b\d[A-HJ-KMNP-RT-Y][0-9A-HJ-KMNP-RT-Y]\d[A-HJ-KMNP-RT-Y][0-9A-HJ-KMNP-RT-Y]\d[A-HJ-KMNP-RT-Y]{2}\d{2}\b/g;
  ```
- **Synthetic example**: `1EG4TE5MK73`, `2W4GH7XJ921`.
- **FP collision**: low — the strict positional letter/digit pattern rarely matches other IDs. Could clash with malformed serials or product SKUs of identical shape.
- **Context tokens**: `Medicare`, `MBI`, `Medicare ID`, `Beneficiary`, `Medicare Card`, `CMS`.
- **Source**: [CMS — Understanding the MBI Format (PDF)](https://www.cms.gov/medicare/new-medicare-card/understanding-the-mbi.pdf), [CMS Medicare Card](https://www.cms.gov/training-education/partner-outreach-resources/new-medicare-card/medical-beneficiary-identifiers-mbis).

### National Provider Identifier (NPI)

- **Format**: 10-digit numeric. Last digit is a check digit.
- **Checksum**: Luhn (mod-10), but the standard prepends `"80840"` (ISO 7812 health industry prefix `80` + US country `840`) before applying Luhn over all 15 digits. Implementation shortcut: prepend `80840`, then standard Luhn; or apply Luhn to the 10 digits and add the constant `24` to the partial sum (offset of doubling `8+0+8+4+0` from the right).
- **Regex sketch**: `/\b\d{10}\b/g` then validate Luhn over `"80840"+npi`.
- **Synthetic example**: `1234567893` (valid Luhn with 80840 prefix).
- **FP collision**: HIGH — bare 10-digit numbers are everywhere (US phone, order numbers, timestamps). MUST require Luhn pass AND nearby context token.
- **Context tokens**: `NPI`, `Provider ID`, `Rendering Provider`, `Billing NPI`, `Type 1 NPI`, `Type 2 NPI`, `Group NPI`.
- **Source**: [CMS — NPI Check Digit (PDF)](https://www.cms.gov/regulations-and-guidance/administrative-simplification/nationalprovidentstand/downloads/npicheckdigit.pdf), [Wikipedia — NPI](https://en.wikipedia.org/wiki/National_Provider_Identifier).

### Medicaid ID

- **Format**: state-assigned, not federally standardized. Most states use 8–13 digit numeric IDs; some use alphanumeric (e.g. NY uses 8 chars `LL\d{5}L`, TX uses 9 digit, CA uses 14 digit including `9` BIN prefix).
- **No common checksum** — varies per state.
- **Regex sketch**: `/\b[A-Z0-9]{8,14}\b/g` — far too broad alone; rely on context.
- **Context tokens**: `Medicaid`, `Recipient ID`, `Member ID`, `Case Number`, `MAGI`, plus state names.
- **Source**: [Medicaid TMSIS data dictionary](https://www.medicaid.gov/tmsis/dataguide/data-elements/clt002168/).

### Health Insurance Claim Number (HICN — legacy)

- **Format**: 9 digits + 1–2 alphabetic suffix (BIC code), e.g. `123-45-6789A`, `123456789B1`.
- **Status**: replaced by MBI as of 2020. Still appears in archives/EOBs.
- **Regex sketch**: `/\b\d{3}-?\d{2}-?\d{4}[A-Z]\d?[A-Z]?\b/g` — collides with SSN; require `HICN` / `Medicare claim number` context.

### NDC (National Drug Code)

- **Format**: 10 or 11 digits, hyphenated as `4-4-2`, `5-3-2`, `5-4-1`, or `5-4-2` (11-digit billing form pads with leading zero in one segment).
  - Labeler-Product-Package, e.g. `0078-0357-15` (Novartis, Diovan).
- **Checksum**: none.
- **Regex sketch**:
  ```js
  const NDC = /\b\d{4,5}-\d{3,4}-\d{1,2}\b|\b\d{10,11}\b(?=[\s,.;)]|$)/g;
  ```
- **FP collision**: HIGH for the unhyphenated form (10/11 digit run = phone, account). Hyphenated form is fairly distinctive.
- **Context tokens**: `NDC`, `Drug Code`, `Rx`, `Prescription`, `pharmacy`, `Labeler`.
- **Source**: [FDA NDC Directory](https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory).

## UK

### NHS Number (England, Wales, IoM)

- **Format**: 10 digits, conventionally displayed `3-3-4` (`485 777 3456`). Stored unhyphenated.
- **Checksum**: Modulus 11.
  - Multiply digits 1–9 by weights `[10,9,8,7,6,5,4,3,2]`.
  - Sum, take `% 11`, then `check = 11 - remainder`.
  - `check == 11` → `0`. `check == 10` → number INVALID (cannot be issued).
- **Regex sketch**:
  ```js
  const NHS = /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g;
  // post-validate mod-11 over digits[0..8] vs digits[9]
  ```
- **Synthetic example**: `943 476 5919` (valid). `400 000 0004` (valid test range — NHS uses `999 xxx xxxx` for synthetic test only since 2020+).
- **FP collision**: VERY HIGH unhyphenated against UK phone, order numbers. With `3-3-4` separators it's distinctive but still collides with grouped phone/landline. Mod-11 check eliminates ~91% of random sequences.
- **Context tokens**: English: `NHS number`, `NHS no`, `Patient number`, `GP`. Welsh: `Rhif y GIG`.
- **Source**: [NHS Data Dictionary — NHS Number](https://www.datadictionary.nhs.uk/attributes/nhs_number.html), [Wikipedia — NHS number](https://en.wikipedia.org/wiki/NHS_number).

### CHI Number (Scotland) / H&C Number (Northern Ireland)

- **CHI (Community Health Index)**: 10 digits, format `DDMMYY####`. First 6 = DOB. 9th digit even = female, odd = male. Last digit = mod-11 check.
- **Northern Ireland H&C**: 10 digits, no DOB encoding, mod-11 check.
- **Regex / context**: same as NHS but `CHI`, `Health and Care number`, `HCN`.
- **Source**: [NHS Scotland CHI guidance](https://www.ndc.scot.nhs.uk/Data-Dictionary/SMR-Datasets/Patient-Identification-and-Demographic-Information/Community-Health-Index-Number/).

## Canada

Health is provincial; each province issues its own card with its own format. There is no federal health-card number.

### Ontario — OHIP / Health Card Number

- **Format**: 10 digits, displayed `4-3-3` (`1234-567-890`), plus a 2-letter version code (`AB`) on cards issued since 1995. So full text on card: `1234-567-890-AB`.
- **Checksum**: mod-10 over the 10 digits (Luhn variant — Ontario uses a custom weighted scheme; CMS-style Luhn does not validate Ontario HCNs reliably).
- **Regex sketch**: `/\b\d{4}[-\s]?\d{3}[-\s]?\d{3}(?:[-\s]?[A-Z]{2})?\b/g`
- **Context tokens**: `OHIP`, `Health Card`, `Health Number`, `HCN`, `Ontario Health`.

### British Columbia — PHN (Personal Health Number)

- **Format**: 10 digits. First digit always `9` for BC-issued PHNs (`9XXXXXXXXX`). Often displayed `4-3-3` like Ontario.
- **Checksum**: mod-11 (BC PHN uses weights `[2,4,8,5,10,9,7,3]` over digits 2–9, etc. — see HL7 Canada and BC Ministry docs).
- **Regex sketch**: `/\b9\d{9}\b/g` (numeric) or `/\b9\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g`.
- **Context tokens**: `PHN`, `BC Services Card`, `MSP`, `Personal Health Number`.

### Quebec — RAMQ / NAM (Numéro d'Assurance Maladie)

- **Format**: 4 letters + 8 digits, total 12 chars. Encodes name + DOB.
  - Letters 1–3: first 3 letters of family/last name (uppercase, A–Z, padded with `X` if shorter).
  - Letter 4: first letter of given name.
  - Digits 5–6: birth year (last 2 digits).
  - Digits 7–8: birth month — **+50 for female** (so range `01–12` male, `51–62` female).
  - Digits 9–10: birth day.
  - Digits 11–12: sequence + check digit.
- **Regex sketch**: `/\b[A-Z]{4}[\s-]?\d{4}[\s-]?\d{4}\b/g`
- **Synthetic example**: `TREM JK 7501 0112` → Tremblay, Jean-something, born 1975-Jan-01.
- **FP collision**: low — letter+digit shape is distinctive.
- **Context tokens**: `RAMQ`, `NAM`, `numéro d'assurance maladie`, `carte soleil`, `Régie de l'assurance maladie`.

### Alberta — Personal Health Number

- **Format**: 9 digits (`#####-####`), Luhn-validated.

### Other provinces (brief)

- MB: 9 digits. SK: 9 digits. NS: 10 digits. NB: 9 digits. NL: 12 digits. PEI: 8 digits. YT/NT/NU: 9 digits. All numeric, mostly Luhn or mod-11.

- **Source**: [Canada.ca — Health cards](https://www.canada.ca/en/health-canada/services/health-cards.html), [ClinicAid — OOP HCN format](https://help.clinicaid.ca/s/article/out-of-province-oop-health-card-number-format).

## Australia

### Medicare Number

- **Format**: 10 digits printed as `XXXX XXXXX X` (4-5-1) on the card, plus a 1-digit IRN (Individual Reference Number) per family member, giving 11 digits total when transmitted.
  - Digits 1–8: identifier
  - Digit 9: check digit
  - Digit 10: card issue number
  - Digit 11: IRN (1–9, position of person on the family card)
- **First digit constraint**: always `2`–`6`.
- **Checksum**: weighted sum mod 10.
  - Multiply digits 1–8 by weights `[1, 3, 7, 9, 1, 3, 7, 9]`.
  - Sum, then `% 10` = check digit (digit 9).
- **Regex sketch**:
  ```js
  const AU_MEDICARE = /\b[2-6]\d{3}[\s-]?\d{5}[\s-]?\d[\s-]?\d?\b/g;
  ```
- **Synthetic example**: `2123 45670 1 1` (validate weighted-mod-10 to pass).
- **FP collision**: medium — 10 digits starting `2-6` overlaps Australian phone formats. Weighted check eliminates ~90%.
- **Context tokens**: `Medicare`, `Medicare card`, `IRN`, `Reference Number`, `Services Australia`.
- **Source**: [Services Australia — Medicare](https://www.servicesaustralia.gov.au/individual-healthcare-identifiers), [HL7 Australia — Medicare Number](https://confluence.hl7australia.com/display/PA/Medicare+Number), [Clearwater AU validator](https://clearwater.com.au/code/medicare/).

### IHI (Individual Healthcare Identifier)

- **Format**: 16 digits, always starts with `8003 6` (HI Service prefix). Full form: `8003 6XXX XXXX XXXX`.
- **Checksum**: ISO/IEC 7812 Luhn over all 16 digits.
- **Regex sketch**: `/\b8003\s?6\d{3}\s?\d{4}\s?\d{4}\b/g`
- **Context tokens**: `IHI`, `Individual Healthcare Identifier`, `My Health Record`, `HI Service`.
- **Source**: [Services Australia — IHI](https://www.servicesaustralia.gov.au/how-to-get-individual-healthcare-identifier).

## India

### ABHA / Health ID (Ayushman Bharat Health Account)

- **Format**: 14 digits, displayed `XX-XXXX-XXXX-XXXX`. Last digit is a Verhoeff check.
- **Checksum**: Verhoeff (same algorithm as Aadhaar).
- **Regex sketch**: `/\b\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g`
- **Synthetic example**: `91-7373-2854-1234`.
- **FP collision**: 14-digit IDs are uncommon — distinctive shape lowers FP. Card PANs (14-digit Diners) and CNPJ (BR, 14-digit) collide.
- **Context tokens**: `ABHA`, `Health ID`, `आभा`, `स्वास्थ्य ID`, `NDHM`, `Ayushman Bharat`.
- **Source**: [National Health Authority — ABHA](https://abha.abdm.gov.in/), [NDHM Health ID Spec](https://ndhm.gov.in/).

### Other Indian health IDs

- **PMJAY beneficiary ID**: state-specific, 11–13 digits.
- **CGHS card number**: 7-digit beneficiary ID + dependent code.
- Detection: context-only (`PMJAY`, `Ayushman`, `CGHS`).

## Asia other (JP, SG, KR)

| Country | ID | Format | Regex | Checksum | Context tokens |
|---|---|---|---|---|---|
| **JP** | Health Insurance Card Number (健康保険被保険者番号) | 6–8 digits + 8-digit branch + 7-digit insured | `/\b\d{6,8}[- ]?\d{6,8}\b/g` | none | `健康保険`, `保険者番号`, `被保険者番号` |
| **SG** | Healthcare Services Number | uses NRIC (`[STFGM]\d{7}[A-Z]`) — not separate | (NRIC) | NRIC checksum | `NRIC`, `MediShield`, `MediSave` |
| **KR** | National Health Insurance number | uses RRN (`\d{6}-?\d{7}`) — not separate | (RRN) | RRN mod-11 | `건강보험`, `국민건강보험` |
| **TH** | National Health Coverage ID | 13 digits (matches Thai national ID) | `/\b\d{13}\b/g` | mod-11 | `บัตรทอง`, `30 บาท`, `national ID` |

In most Asian markets, the national ID *is* the health ID — detection logic for government IDs (CN ID, JP My Number, KR RRN, SG NRIC) covers healthcare too. See `government-ids.md`.

## Europe other (DE Krankenversicherten, FR Carte Vitale, SE personnummer-as-health, IT)

| Country | ID | Format | Regex | Checksum | Context tokens |
|---|---|---|---|---|---|
| **DE** | Krankenversichertennummer | 10 chars: 1 letter + 9 digits, last = check | `/\b[A-Z]\d{9}\b/g` | mod-10 weighted | `Krankenversichertennummer`, `KVNR`, `Versicherungsnummer` |
| **FR** | Carte Vitale | uses INSEE/NIR (15 digits) — see `government-ids.md` | (NIR) | mod-97 | `Carte Vitale`, `numéro de sécu`, `NIR` |
| **SE** | Health uses personnummer | (10/12 digit, see government-ids) | (Luhn) | `personnummer`, `Försäkringskassan` |
| **IT** | Tessera Sanitaria | uses Codice Fiscale (16 alphanumeric) — see `government-ids.md` | (CF) | letter check | `Tessera Sanitaria`, `Codice Fiscale`, `SSN` (Servizio Sanitario Nazionale) |
| **NL** | BSN used as health ID | (9 digits, see government-ids) | (11-test) | `BSN`, `Zorgverzekering` |
| **CH** | AHV / AVS Number | 13 digits, format `756.XXXX.XXXX.XX` | `/\b756\.?\d{4}\.?\d{4}\.?\d{2}\b/g` | EAN-13 | `AHV-Nummer`, `numéro AVS`, `numero AVS` |

**Note**: most EU countries use the national ID for healthcare lookup — separate health-ID detectors are mostly redundant if government-ID detectors run.

## Latin America (BR CNS)

### Brazil — CNS (Cartão Nacional de Saúde)

- **Format**: 15 digits. First digit determines variant:
  - `1` or `2`: definitive CNS
  - `7`, `8`, `9`: provisional CNS
- **Checksum**: weighted mod-11 over first 14 digits (different formulae for definitive vs provisional).
- **Regex sketch**: `/\b[12789]\d{14}\b/g`
- **Context tokens**: `CNS`, `Cartão Nacional de Saúde`, `Cartão SUS`, `SUS`.
- **Source**: [DATASUS — CNS](https://datasus.saude.gov.br/cadastro-nacional-do-cns).

### Other LATAM

- **MX (IMSS)**: NSS (Número de Seguridad Social) — 11 digits. Context: `NSS`, `IMSS`, `Seguro Social`.
- **AR (Obras Sociales)**: typically uses CUIL/CUIT.

## Private insurance (member ID conventions, group, claim, policy)

- **Format**: highly variable by insurer. Common shapes:
  - 9–12 digits (alphanumeric variants).
  - Letter prefix + 8–10 digits (e.g. BCBS prefix `XYZ123456789` where `XYZ` is plan code).
  - Group numbers usually 3–6 digits or alphanumeric.
- **Checksum**: rarely standardized.
- **Regex sketch**: too generic alone — `/\b[A-Z]{0,4}\d{6,12}\b/g` or `/\b[A-Z]{2,4}\d{6,10}\b/g`.
- **Detection strategy**: **context-only**. Require nearby keywords from this list:

| Token | Use |
|---|---|
| `Member ID`, `Member Number`, `Subscriber ID`, `Policy Number`, `Policy ID`, `Group #`, `Group Number`, `Plan ID`, `Beneficiary` | English |
| `Versichertennummer`, `Mitgliedsnummer`, `Versicherungsnummer` | German |
| `numéro d'adhérent`, `numéro de police` | French |
| `número de póliza`, `número de afiliado` | Spanish |
| `número da apólice`, `carteirinha` | Portuguese |

**Source**: AMA insurance card formats vary; no standard.

## Clinical (MRN, lab accession, Rx number, NDC)

### MRN (Medical Record Number)

- **Format**: facility-specific, no national standard. Typically 6–10 digits, sometimes alphanumeric.
- **Detection strategy**: context-only. Nearby `MRN`, `Medical Record`, `Patient ID`, `Chart #`, `EMR ID`.

### Rx Number (Prescription Number)

- **Format**: typically 7–10 digits, pharmacy-specific.
- **Detection strategy**: context-only. Nearby `Rx`, `Rx #`, `prescription number`, `Receta`, `处方编号`.

### NDC (National Drug Code, US)

- See US section above. 10/11 digits with `4-4-2`/`5-3-2`/`5-4-1`/`5-4-2` hyphenation.

### Lab accession numbers

- **Format**: lab-specific, alphanumeric, typically 8–14 chars.
- **Context-only**: `Accession`, `Lab #`, `Specimen ID`, `Order Number`.

### ICD-10 / ICD-11 codes (alphanumeric — context for PII, not PII themselves)

- ICD-10: `A00`–`Z99` + `.0`–`.9` (e.g. `J45.901` for asthma).
- Not PII, but appears alongside MRN — used as a CONTEXT signal that the surrounding text is medical.

---

## Detection priority table

Sorted by (precision × prevalence on consumer healthcare portals).

| ID | Region | Tier | Recommended validator |
|---|---|---|---|
| **NHS Number** | UK | Tier 1 | mod-11 (mandatory — collides w/ phone) |
| **MBI** | US | Tier 1 | positional letter/digit pattern (very distinctive) |
| **NPI** | US | Tier 1 | Luhn over `80840`+npi + `NPI` keyword |
| **AU IHI** | AU | Tier 1 | Luhn + `8003 6` prefix gate |
| **AU Medicare** | AU | Tier 1 | weighted mod-10 + first-digit gate |
| **CN ID (health context)** | CN | Tier 1 | (delegated to government-ids) |
| **CH AVS** | CH | Tier 1 | EAN-13 + `756` prefix gate |
| **DE Krankenversicherten** | DE | Tier 2 | letter+9-digit + mod-10 |
| **CA OHIP / BC PHN / RAMQ** | CA | Tier 2 | per-province check + province keyword |
| **BR CNS** | BR | Tier 2 | mod-11 + first-digit prefix gate |
| **ABHA** | IN | Tier 2 | Verhoeff + 14-digit shape |
| **NDC** | US | Tier 2 | hyphenated 4-4-2 / 5-3-2 / 5-4-1 / 5-4-2 + `Rx`/`drug` keyword |
| **HICN (legacy)** | US | Tier 3 | SSN-shape + letter suffix + `Medicare claim` keyword |
| **Medicaid ID** | US | Tier 3 | context-only (per-state varies) |
| **MRN / lab accession / Rx#** | global | Tier 3 | context-only (`MRN`, `Rx`, `Lab`, `Accession`) |
| **Private insurance member ID** | global | Tier 3 | context-only (`Member ID`, `Subscriber`, `Policy #`) |

### Implementation guidance

1. **Most EU/Asian healthcare detection is delegated.** National ID (NIR, BSN, Codice Fiscale, RRN, NRIC, CN ID) is the health ID — don't duplicate.
2. **MRN and Rx need context.** Bare 6–10 digit numbers are everywhere; without `MRN`/`Rx` keyword in 100-char window, suppress.
3. **Surrounding ICD-10 codes raise the trust score.** If text near a digit run contains `A00–Z99.\d` shape, treat the area as medical context — apply weaker FP suppression.
4. **HIPAA scope**: in the US, MBI/MRN/NPI are HIPAA-protected when paired with a name. The detector flags the number; it doesn't make legal determinations.

---

## References

- CMS — MBI Format: [https://www.cms.gov/medicare/new-medicare-card/understanding-the-mbi.pdf](https://www.cms.gov/medicare/new-medicare-card/understanding-the-mbi.pdf)
- CMS — NPI Check Digit: [https://www.cms.gov/regulations-and-guidance/administrative-simplification/nationalprovidentstand/downloads/npicheckdigit.pdf](https://www.cms.gov/regulations-and-guidance/administrative-simplification/nationalprovidentstand/downloads/npicheckdigit.pdf)
- FDA NDC Directory: [https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory](https://www.fda.gov/drugs/drug-approvals-and-databases/national-drug-code-directory)
- NHS Data Dictionary — NHS Number: [https://www.datadictionary.nhs.uk/attributes/nhs_number.html](https://www.datadictionary.nhs.uk/attributes/nhs_number.html)
- NHS Scotland — CHI: [https://www.ndc.scot.nhs.uk/](https://www.ndc.scot.nhs.uk/)
- Canada.ca — Health Cards: [https://www.canada.ca/en/health-canada/services/health-cards.html](https://www.canada.ca/en/health-canada/services/health-cards.html)
- Services Australia — Medicare/IHI: [https://www.servicesaustralia.gov.au/individual-healthcare-identifiers](https://www.servicesaustralia.gov.au/individual-healthcare-identifiers)
- HL7 Australia — Medicare Number: [https://confluence.hl7australia.com/display/PA/Medicare+Number](https://confluence.hl7australia.com/display/PA/Medicare+Number)
- ABHA / NDHM India: [https://abha.abdm.gov.in/](https://abha.abdm.gov.in/)
- DATASUS Brazil — CNS: [https://datasus.saude.gov.br/cadastro-nacional-do-cns](https://datasus.saude.gov.br/cadastro-nacional-do-cns)
- ICD-10 (WHO): [https://icd.who.int/browse10/](https://icd.who.int/browse10/)
- HIPAA Privacy Rule: [https://www.hhs.gov/hipaa/for-professionals/privacy/](https://www.hhs.gov/hipaa/for-professionals/privacy/)
