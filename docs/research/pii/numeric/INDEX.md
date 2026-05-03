# Numeric PII Research — Index

> Cross-cutting synthesis of the six numeric-PII research files. Use this as the entry point. The detailed material lives in the per-topic files; this index summarizes signal density, prioritizes implementation work, and maps each finding back to the current `src/pii_detector.js` regex set.

---

## Files

| File | Lines | Scope |
|---|---|---|
| [`PIPELINE.md`](./PIPELINE.md) | — | **Architecture.** Consolidated regex catalog + 5-stage state machine + short-circuit semantics + implementation sketch. Read first if implementing. |
| [`PERF.md`](./PERF.md) | — | **Performance.** Cost model on heavy pages (Amazon-class), pre-screen / regex-cache / type-gate / idle mitigations, per-stage budgets, backtracking audit. |
| [`PLAN.md`](./PLAN.md) | — | **Rewrite plan.** 6-phase migration to `src/pii/` folder structure. Phase 0 (refactor), 1 (Tier-A suppressors), 2 (cascade), 3 (Stage 1 detectors), 4 (Stage 2 + country), 5 (popup), 6 (perf). |
| [`government-ids.md`](./government-ids.md) | 166 | National IDs (SSN, Aadhaar, NHS, etc.) — 25+ countries, checksum algorithms, context tokens. |
| [`financial-global.md`](./financial-global.md) | 421 | Cards, IBAN, bank accounts, SWIFT, crypto, tax IDs, investment IDs. Extends `../financial-detection.md` (US). |
| [`telecom-devices.md`](./telecom-devices.md) | 253 | Phone numbers per country, IMEI, ICCID, IMSI, MAC, IPv4/IPv6, disambiguation matrix. |
| [`healthcare-insurance.md`](./healthcare-insurance.md) | 313 | Health-system IDs (NHS, MBI, NPI, IHI, ABHA, CNS), MRN, Rx, NDC, private insurance. |
| [`address-location.md`](./address-location.md) | 350 | Postal codes (25 countries), house numbers, geocoordinates, IP, sensitivity tiers, 5-digit collision table. |
| [`false-positives.md`](./false-positives.md) | 552 | Date/time, version, identifiers-by-design, units, counts, ordinals, statistics, hex, code-block, sports, math. **Most actionable file.** |
| [`../identifier-credentials.md`](../identifier-credentials.md) | — | **Identifier sub-pass.** PREFIX_RE FP risks, DISPOSITIVE_RES provider coverage (8/50+), missing KEYWORDS, Tier A/B/C provider roadmap. |

---

## Current detector — quick recap

`src/pii_detector.js` runs five regex patterns:

1. **CURRENCY_PREFIX** — `$1,234.56`
2. **CURRENCY_SUFFIX** — `1234 USD`
3. **GROUPED_THOUSANDS** — `1,234,567`
4. **PHONE_SHAPE** — digit groups separated by `[\s-]`, ≥3 per group, ≥2 groups
5. **BARE_DIGITS** — bare 4+ digit run

Active FP suppressors (`precise` profile):

- `isYear` (1000–2099 standalone)
- `isVersion` (`v` prefix or `.digit` suffix)
- `isPublicPrice` (±100 char keyword window)
- `isCountNoise` (±150 char keyword window)

Together these cover ~30% of real-world FPs. The other 70% is what this research enumerates.

---

## Master findings table

Sorted by **(impact × prevalence × cost-to-implement)**, where impact = FP rate reduction, prevalence = how often the FP appears in the wild, cost = LOC + tests + locale data.

### Tier 1 — implement now (high-impact, low-cost)

| Finding | File | Suppressor | Slot |
|---|---|---|---|
| Code-block ancestor (`<pre>`/`<code>`/`<kbd>`/`<samp>`) | false-positives.md | `_isInsideCodeBlock(node)` — DOM check | early-exit alongside `_isExtensionUI` |
| ISO 8601 dates + slash dates + compact 8-digit | false-positives.md | `isDateLike(matchText, text, idx)` | `FALSE_POSITIVE_CHECKS.precise` |
| Order / tracking / invoice / case keyword | false-positives.md | `isOrderRef(matchText, text, idx)` | `FALSE_POSITIVE_CHECKS.precise` |
| Trailing-unit measurement | false-positives.md | `isMeasurement(matchText, text, idx)` | `FALSE_POSITIVE_CHECKS.precise` |
| Hex colors (`#FFFFFF`) | false-positives.md | `isHexColor(matchText, text, idx)` | `FALSE_POSITIVE_CHECKS.precise` |
| Year ranges `YYYY-YYYY` | false-positives.md | `isYearRange(matchText)` | `FALSE_POSITIVE_CHECKS.precise` |

**Estimated combined gain**: ~50% reduction in remaining FP rate after Tier 1 only. Total LOC: ~80.

### Tier 2 — high-precision PII patterns to ADD

| Finding | File | New detector | Validator |
|---|---|---|---|
| Card PAN | financial-global.md | network-prefix + length + Luhn | mandatory Luhn |
| IBAN | financial-global.md | country prefix + length table + mod-97 | self-validating |
| Aadhaar | government-ids.md | 12 digits, first ≠ 0/1 + Verhoeff | Verhoeff (~30 LOC) |
| NHS Number | government-ids.md, healthcare-insurance.md | 10 digits + mod-11 | mod-11 (mandatory; collides with phone) |
| BR CPF/CNPJ | government-ids.md | format + mod-11 twice | mod-11 |
| ETH wallet `0x` + 40 hex | financial-global.md | literal prefix + length | optional EIP-55 |

**Estimated combined gain**: ~15% increase in true-positive rate (these don't currently fire under the bare-digit/phone-shape regexes alone).

### Tier 3 — extended FP suppressors (moderate cost)

| Finding | File | Suppressor |
|---|---|---|
| Resolution `NxM` | false-positives.md | `isResolution` |
| Ordinal label (Section/Chapter/Page/Step) | false-positives.md | `isOrdinalLabel` (preceding-word window) |
| Percentage / scientific notation | false-positives.md | `isPercentage`, `isScientificNotation` |
| Statistics keywords (n=, p<, CI) | false-positives.md | `isStatistic` |

### Tier 4 — country-aware postal-code suppression

| Finding | File | Strategy |
|---|---|---|
| 5-digit postal code disambiguation (US/DE/FR/IT/ES/MX/KR/TH/MY/...) | address-location.md | Capture page-level country signal (TLD + lang attr + meta + currency) once per page; pass into postal regex decision |

Implementation cost: medium (need page-level signal cache + country-keyword table). Defer until ZIP/PIN false-positive complaints come in.

### Tier 5 — extended `isCountNoise` keyword list

| Finding | File | Strategy |
|---|---|---|
| Stock / pagination / search-result keywords | false-positives.md | Append to existing `isCountNoise` regex |
| Multilingual (ES/FR/DE/JA/ZH/HI) | false-positives.md | Append translations to all keyword regexes |

Implementation cost: low. Just enlarge the regexes.

---

## True-positive detector additions (sketch)

If extending the detector beyond the 5 generic patterns to dedicated PII detectors, recommended priority:

1. **Card PAN with Luhn + IIN** — `financial-global.md`
2. **IBAN with mod-97** — `financial-global.md`
3. **Aadhaar + Verhoeff** (India market is huge) — `government-ids.md`
4. **NHS Number + mod-11** (UK) — `government-ids.md`
5. **SSN with range gates + context** (US) — `government-ids.md`
6. **CPF / CNPJ + mod-11 twice** (BR) — `government-ids.md`
7. **ETH/BTC wallet** — `financial-global.md`
8. **GPS decimal coordinates** — `address-location.md`

These together cover ~80% of global numeric PII traffic by user-population × prevalence.

---

## Multilingual context-token table

Cross-cutting summary — keywords by language for each PII intent. Use these to extend keyword-window regexes in `pii_detector.js`. Sources cited in the per-topic files.

| Intent | EN | ES | FR | DE | JA | ZH | HI |
|---|---|---|---|---|---|---|---|
| Card | card, credit card, PAN | tarjeta, crédito | carte, crédit | Karte, Kreditkarte | カード, クレジット | 信用卡, 卡号 | कार्ड, क्रेडिट कार्ड |
| Phone | phone, mobile, cell | teléfono, móvil, celular | téléphone, mobile, portable | Telefon, Mobil, Handy | 電話, 携帯, モバイル | 电话, 手机 | फोन, मोबाइल |
| Tax ID | SSN, tax ID, EIN | DNI, NIE, RFC, RUT | NIR, sécu | Steuer-ID, IdNr | マイナンバー, 個人番号 | 身份证 | पैन, आधार |
| Address | street, ZIP, postal | calle, CP, código postal | rue, code postal | Straße, PLZ | 住所, 郵便番号 | 街, 邮编, 邮政编码 | पता, पिन कोड |
| Order / receipt | order, invoice, receipt, tracking | pedido, factura, recibo, seguimiento | commande, facture, reçu, suivi | Bestellung, Rechnung, Quittung, Sendungsverfolgung | 注文, 請求書, 領収書, 追跡 | 订单, 发票, 收据, 跟踪 | आदेश, बीजक, रसीद, ट्रैकिंग |
| Date | date, posted, updated, expires | fecha, publicado, actualizado, vence | date, publié, mis à jour, expire | Datum, veröffentlicht, aktualisiert, gültig | 日付, 投稿, 更新, 期限 | 日期, 发布, 更新, 截止 | तारीख, दिनांक, प्रकाशित |
| Version | version, build, release | versión, compilación | version, compilation | Version, Build | バージョン, ビルド | 版本, 构建 | संस्करण |
| Section/Chapter | section, chapter, page, step | sección, capítulo, página, paso | section, chapitre, page, étape | Abschnitt, Kapitel, Seite, Schritt | 章, 節, ページ, ステップ | 章, 节, 页, 步骤 | अध्याय, पृष्ठ, चरण |
| Counts (engagement) | likes, views, followers, comments | me gusta, vistas, seguidores, comentarios | mentions j'aime, vues, abonnés, commentaires | Likes, Aufrufe, Follower, Kommentare | いいね, 視聴回数, フォロワー, コメント | 点赞, 浏览, 粉丝, 评论 | लाइक, दृश्य, फॉलोअर, टिप्पणियां |

---

## Disambiguation cheat-sheet (5-digit collision)

The single most error-prone pattern: bare 5-digit numbers match US ZIP, DE PLZ, FR CP, IT CAP, ES CP, MX CP, KR postcode, TH postcode, FI postinumero, TR posta kodu, and more — all from the same `\b\d{5}\b` regex. Disambiguation **requires page-level country signal**:

| Signal source | What to capture |
|---|---|
| TLD (`.de`, `.fr`, `.it`, `.es`, `.mx`, `.kr`, `.th`, ...) | one-time at page load |
| `<html lang="…">` attribute | one-time at page load |
| `<meta name="…">` country/locale tags | one-time at page load |
| Currency symbol (`$`, `€`, `£`, `¥`, `₹`, `₩`, `R$`) prevalent on page | sample first 1000 chars of body |
| Country name in `<title>` or top-of-page text | one-time |

Combine into a single `_pageCountrySignal` value (e.g. `"DE"`, `"US"`, `null`). Postal regex matches only flag when:

- Page-level country signal is set AND match position has the matching country's postal-keyword in 100-char window.
- OR the structural shape is unambiguously single-country (`12345-6789` ZIP+4 → US only; `XXXXX-XXX` → BR only; `〒XXX-XXXX` → JP only; `1234 AB` → NL only; `A1A 1A1` → CA only).

See [`address-location.md`](./address-location.md#5-digit-collision-table) for the full keyword table.

---

## Detector pipeline ordering (recommended)

```
[scan(rootEl, types)]
  └─ for each text node:
        ├─ _isExtensionUI → skip
        ├─ _isInsideCodeBlock → skip                           (Tier 1 add)
        ├─ _isInsidePiiSpan → skip
        └─ _findMatches(text, types, node):
              └─ for each candidate match:
                   ├─ DEDICATED PII DETECTORS (run in confidence order)
                   │    1. Card PAN (Luhn + IIN)               (Tier 2 add)
                   │    2. IBAN (mod-97)                       (Tier 2 add)
                   │    3. Aadhaar (Verhoeff)                  (Tier 2 add)
                   │    4. NHS / SSN / SIN / etc.              (Tier 2 add)
                   │    5. ETH wallet (0x prefix)              (Tier 2 add)
                   │  └─ on match: emit {type: 'card'|...}
                   │
                   └─ GENERIC NUMERIC MATCH (current 5 regexes):
                        └─ FALSE_POSITIVE_CHECKS.precise:
                             ├─ isYear                          (existing)
                             ├─ isVersion                       (existing)
                             ├─ isHexColor                      (Tier 1 add)
                             ├─ isPercentage / isScientificNotation (Tier 3 add)
                             ├─ isMeasurement                   (Tier 1 add)
                             ├─ isResolution                    (Tier 3 add)
                             ├─ isYearRange                     (Tier 1 add)
                             ├─ isDateLike                      (Tier 1 add)
                             ├─ isOrdinalLabel                  (Tier 3 add)
                             ├─ isPublicPrice                   (existing, extended)
                             ├─ isCountNoise                    (existing, extended)
                             ├─ isOrderRef                      (Tier 1 add)
                             └─ isStatistic                     (Tier 3 add)
                          └─ on suppress: drop match
                          └─ otherwise: emit {type: 'numeric'}
```

---

## Open questions / non-blocking gaps

These came up during research but don't block implementation:

1. **Locale-aware date parsing** — current `isDateLike` is structural; `Intl.DateTimeFormat` could parse named-month forms in any locale. Nice-to-have, not critical.
2. **Country-signal cache invalidation** — for SPAs that change `<html lang>` mid-session. Probably re-sample on each `applyState()`.
3. **Custom-element / shadow-DOM contexts** — code blocks inside Web Components might escape the `_isInsideCodeBlock` ancestor check. The current shadow-aware engine already iterates roots; PII detector subscribes via `subscribeMutations` so this should work. Verify in tests.
4. **Privacy: should we EVER blur an IP address by default?** GDPR Recital 30 says yes (online identifier). CCPA leans no (not standalone PII). Current call: gate behind explicit user toggle, default off — matches the existing `auto_detect_pii.settings.numeric` design pattern.
5. **Country-list maintenance** — IIN ranges change (Mastercard added `2-series` 2017; Visa added 19-digit 2020s). Schedule a yearly research refresh.

---

## Cross-references

- Existing PII contracts: [`docs/contracts/pii_detector.md`](../../contracts/pii_detector.md), [`docs/contracts/pii_detector.tests.md`](../../contracts/pii_detector.tests.md)
- Existing US-focused finance: [`docs/research/pii/financial-detection.md`](../financial-detection.md)
- Existing email research: [`docs/research/pii/email-detection.md`](../email-detection.md)
- Existing OVERVIEW: [`docs/research/pii/OVERVIEW.md`](../OVERVIEW.md) — this index complements it for the numeric branch only.

---

## Recommended next step

Open a small implementation PR that adds the **Tier 1 suppressors** plus the **`_isInsideCodeBlock` early-exit**, with one true-positive and one false-positive test per check. Land that, measure FP-rate reduction on a sample of real pages, then decide whether to invest in Tier 2 PII detectors (cards, IBAN, Aadhaar, NHS, etc.).
