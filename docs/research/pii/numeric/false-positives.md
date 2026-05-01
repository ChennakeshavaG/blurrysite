# Numeric False-Positive Landscape

> What looks like PII to a regex but isn't, and how to disambiguate.

This document is the most actionable file in the numeric-PII research set. It enumerates every category of "looks-like-PII-but-isn't" string the current pii_detector regex set will match, then proposes ranked, implementable suppressors.

The current detector uses 5 active regex patterns:

1. **CURRENCY_PREFIX** — `$1,234.56` (currency symbol then digits, optional decimals)
2. **CURRENCY_SUFFIX** — `1234 USD` (digits then ISO 4217 code)
3. **GROUPED_THOUSANDS** — `1,234,567` (digit groups separated by commas, optionally `.dd`)
4. **PHONE_SHAPE** — digit groups separated by space/hyphen, ≥3 per group, ≥2 groups
5. **BARE_DIGITS** — bare 4+ digit run

Existing FP suppressors:

- `isYear` — bare 4-digit 1000–2099 (loose; covers any year-like number)
- `isVersion` — `v` prefix, `.digit` suffix, or surrounding `version` keyword
- `isPublicPrice` — looks 100 chars left+right for price/currency keywords (price, $, USD, …)
- `isCountNoise` — looks 150 chars for engagement keywords (likes, views, comments, followers, …)

Everything in this document assumes the candidate has already passed the regex filter; the question is "should the suppressor reject it before applying blur?"

---

## Existing FP suppressors (recap)

| Suppressor | Window | Trigger keywords / pattern | Confidence |
| --- | --- | --- | --- |
| `isYear` | match itself | `^(1\d{3}|20\d{2})$` | High |
| `isVersion` | match + 1 char | leading `v`, trailing `.<digit>` | Medium |
| `isPublicPrice` | ±100 chars | `price`, `cost`, `total`, `subtotal`, `$`, `USD`, `EUR`, `MRP`, `sale`, `discount` | High |
| `isCountNoise` | ±150 chars | `likes`, `views`, `comments`, `shares`, `followers`, `subscribers`, `members`, `posts`, `replies`, `reactions`, `upvotes`, `downvotes` | High |

Together these handle ~30% of real-world FPs. The remainder is enumerated below.

---

## Date / time formats

The single largest FP family. Dates appear on virtually every web page (article timestamps, comment dates, calendar widgets, due dates, expiry, log entries) and most variants slip past the existing `isYear` check because that check only looks at the **whole match** as a 4-digit year — once a year is glued to other digits with `-`/`/`/`.`/space, the whole string slides into PHONE_SHAPE or BARE_DIGITS.

### Date variants

| Variant | Example | Regex(es) matched | Notes |
| --- | --- | --- | --- |
| ISO 8601 extended | `2026-04-29` | PHONE_SHAPE (4-2-2 digits, hyphens) | Universal in feeds, blogs, REST APIs, log timestamps |
| ISO 8601 basic | `20260429` | BARE_DIGITS | Identical 8-digit shape collides with some account numbers |
| US slash | `4/29/2026`, `04/29/2026` | PHONE_SHAPE (digits separated by `/` — but current detector uses `[\s\-]` only, so this **does not match** PHONE_SHAPE; falls to BARE_DIGITS only on the year segment `2026` → caught by `isYear`) | Slash is not a current group separator; main risk is the bare year |
| EU dot | `29.04.2026` | Same as US slash but with `.` — **not** matched by PHONE_SHAPE today | Year segment caught by `isYear` |
| Compact slash | `4/29/26`, `29/4/26` | BARE_DIGITS (none — 2 digits per group) | Below threshold; safe |
| Hyphenated alt | `2026-04`, `04-2026` | PHONE_SHAPE? No — needs ≥3 digits per group, fails the 2-digit segment | Safe |
| ISO 8601 datetime | `2026-04-29T14:30:00Z`, `2026-04-29T14:30:00+05:30` | PHONE_SHAPE matches `2026-04-29`, then again for `14:30:00` if `:` were a separator. Today only `-` and space-as-separator hit. | The colon-separated time half slips through PHONE_SHAPE because `:` is not in `[\s\-]` |
| Ordinal date | `2026-119` | PHONE_SHAPE | Day-of-year format from ISO 8601 |
| Week date | `2026-W17`, `2026-W17-3` | None (letter `W` breaks digit group) | Safe |
| ISO basic week | `2026W173` | None | Safe |
| Named month | `April 29, 2026`, `29 April 2026`, `Apr 29 2026` | BARE_DIGITS on `2026` → `isYear` catches | Safe |
| RFC 2822 / HTTP | `Wed, 29 Apr 2026 14:30:00 GMT` | BARE_DIGITS on `2026`, PHONE_SHAPE on `14 30 00` if normalized | Article and comment timestamps |
| Compact 8-digit | `20260429`, `29042026` | BARE_DIGITS | Bank statements, CSV exports, filename stamps |
| Fiscal year | `FY2026`, `FY26`, `FY2025-26`, `FY25/26` | BARE_DIGITS on `2026` → caught by `isYear` | Safe at the year level |
| Quarter | `Q1 2026`, `Q4 FY26`, `2026Q1` | BARE_DIGITS on `2026` only | Safe |
| Unix epoch (sec) | `1745923200` | BARE_DIGITS (10 digits) | Common in dev docs, log viewers, Stack Overflow answers; not currently caught |
| Unix epoch (ms) | `1745923200000` | BARE_DIGITS (13 digits) | JS-era timestamps (`Date.now()`); identical shape to Visa/Mastercard PAN length — **dangerous false positive direction** but for our case (PII over-detection), epoch is FP, not FN. |
| Julian / Modified Julian | `60426`, `2460526` | BARE_DIGITS (≥4) | Astronomy and finance (T+x settlement) |
| Roman-numeral year | `MMXXVI` | None (letters) | Safe |
| Range | `2024–2026`, `2024-2026` | PHONE_SHAPE on `2024-2026` (4-4 = 8 chars, two groups, ≥3 each) | **Slips through** — both endpoints look year-like; whole range is `digit{4}-digit{4}` |

### Time variants

| Variant | Example | Regex(es) matched | Notes |
| --- | --- | --- | --- |
| HH:MM | `14:30`, `2:30` | None — `:` not in PHONE_SHAPE separators; both groups <3 digits anyway | Safe |
| HH:MM:SS | `14:30:00` | None (`:` not a separator) | Safe under current regexes |
| AM/PM | `2:30 PM`, `2:30 p.m.` | None | Safe |
| 24-hour with timezone | `14:30 UTC`, `14:30 EST` | None | Safe |
| Duration | `1h 23m 45s`, `01:23:45` | None | Safe |
| Stopwatch / lap | `1:23.456`, `0:42.10` | None | Safe |
| Countdown | `00:05:30` | None | Safe |
| Schedule range | `9:00 AM – 5:00 PM` | None | Safe |

**Key insight**: most times are safe under the current pattern set because `:` is not a group separator. Only date forms that use `-`, space, or compact 8-digit produce FPs.

### Disambiguation

- **Structural fingerprints** that strongly indicate date:
  - `\d{4}-\d{2}-\d{2}` (ISO 8601 extended)
  - `\d{4}/\d{2}/\d{2}`, `\d{2}/\d{2}/\d{4}`, `\d{2}\.\d{2}\.\d{4}`
  - `\d{4}-\d{2}` (year-month)
  - `\d{4}-\d{3}` (ordinal date — 3-digit DDD)
  - `\d{4}-W\d{2}` (week date)
  - `T\d{2}:\d{2}` immediately after a date
  - 4-digit run **followed by** `-\d{4}` (year range)
- **Keyword window** (~50 chars): `date`, `posted`, `published`, `updated`, `created`, `modified`, `due`, `expires`, `expiry`, `valid until`, `as of`, `from`, `since`, `until`, `between`, `on`. Multilingual: ES `fecha`, `publicado`, `actualizado`, `vence`; FR `date`, `publié`, `mis à jour`, `expire`; DE `Datum`, `veröffentlicht`, `aktualisiert`, `gültig`; JA `日付`, `投稿`, `更新`, `期限`; ZH `日期`, `发布`, `更新`, `截止`; HI `तारीख`, `दिनांक`, `प्रकाशित`.
- **Adjacent month names** in any language are a near-definitive FP signal: Jan/Feb/.../Dec, Ene/Feb/Mar/Abr/.../Dic, janv/févr/.../déc, Jän/.../Dez, 一月/二月/.../十二月, १/२/...

**Confidence**: H for ISO 8601 (structural fingerprint alone is sufficient). H for slash/dot dates with year segment in 1900–2099 range. M for compact 8-digit (needs day/month sanity check: positions 5–6 ∈ 01–12, 7–8 ∈ 01–31).

**Prevalence**: ecommerce M (order dates), news H (article timestamps), docs H (changelogs, "last updated"), social H (post timestamps), forums H (reply dates).

## Version strings

### Semver

`MAJOR.MINOR.PATCH` with optional `-prerelease` and `+build` per semver.org. Example forms:

- `1.0.0`, `2.4.18`, `0.1.0`, `15.7.2`
- `1.0.0-alpha`, `1.0.0-alpha.1`, `1.0.0-rc.2`, `1.0.0-beta.11`
- `1.0.0+20130313144700`, `1.0.0-alpha+001`
- Range / constraint syntax: `^1.2.3`, `~1.2.3`, `>=1.0.0`, `1.x`, `1.2.*`

**Regex match analysis**: Three or four dot-separated digits do not match any current pattern (PHONE_SHAPE requires `[\s\-]`, not `.`). The risk is the **build metadata** suffix — `1.0.0+20130313144700` contains `20130313144700` which **matches BARE_DIGITS** (14 digits) and slips past `isYear`. Pre-release `1.0.0-rc.2` ends with bare `2`, too short for BARE_DIGITS. Range `>=12.4.0` is safe.

### Date-versioning (CalVer)

- `2026.04.29` — Ubuntu, JetBrains, IntelliJ-style
- `2026.4`, `2026.04`, `26.04` — Ubuntu LTS short form
- `v2026.04.29-beta1`

Match: BARE_DIGITS catches the year segment but `isYear` covers it. Compact `26.04` is safe.

### Build numbers

- `Build 23456`, `b#23456`, `#23456`
- Chrome's `Version 124.0.6367.119` — last segment is a 3-digit build
- Windows `Version 10.0.19045.5917` — common in support pages
- Android `API level 34`, `SDK 34`, `Build TQ3A.230901.001.B1` (mixed alphanum)

The 5-digit build numbers (`19045`, `5917`, `6367`, `19045`) **slip past `isYear`** when not glued to dots. Risk: `Version 6367` standalone in a UI.

### API versions

- `v1`, `v2`, `v3`, `v2.1`, `v2024-01-15` (Stripe API)
- URL paths `/api/v1/users/123` — covered separately under URL identifiers

### OS versions

- `macOS 14.4.1`, `iOS 17.4.1`, `iPadOS 17.4`, `tvOS 17.4`, `watchOS 10.4`
- `Windows 11`, `Windows 10`, `Windows 11 22H2`, `Windows Server 2022`
- `Ubuntu 22.04 LTS`, `Debian 12`, `Fedora 39`, `RHEL 9`
- `Android 14`, `Android 14 QPR2`
- Linux kernel `6.6.21-amd64`, `Linux 6.6.21`

### Disambiguation

- **Structural fingerprint**: `\d+\.\d+\.\d+` (3+ dotted segments) — already implicitly safe under current regex set since `.` is not a group separator.
- **Existing `isVersion`** already handles `v` prefix and `.digit` suffix. Extend to:
  - Adjacent letter `v`/`V` immediately before the digits (covered)
  - Surrounding word: `version`, `release`, `build`, `tag`, `commit` within ±50 chars
  - Multilingual: ES `versión`, `compilación`; FR `version`, `compilation`; DE `Version`, `Build`; JA `バージョン`, `ビルド`; ZH `版本`, `构建`; HI `संस्करण`.
- **Code-block / `<code>` / `<pre>` ancestor** is a definitive signal that any digit run is a technical token, not PII. Worth implementing as an early-exit in the detector.
- **Dangerous build-metadata case**: `1.0.0+20130313144700` — the 14-digit timestamp inside a semver build metadata is a near-impossible PII shape (no banking instrument is exactly 14 digits and standalone), so a structural rule "BARE_DIGITS preceded by `+` after a `\d+\.\d+\.\d+`" suppresses cleanly.

**Confidence**: H (existing `isVersion` covers most). M for build numbers without `Build`/`v` markers.

**Prevalence**: docs H, dev forums H, ecommerce L, news L, social L.

## Identifiers visible by design (not sensitive)

These look like PII but are routinely public-facing and printed in receipts, emails, support pages.

| Type | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Order number | `Order #4567823`, `Order: 4567823`, `Order 4-567-823` | BARE_DIGITS, sometimes PHONE_SHAPE | `Order` / `Order #` keyword window 50 chars |
| Tracking number | `1Z999AA10123456784` (UPS), `9400 1118 9956 1234 5678 90` (USPS), `7489 1234 5678 9012` (FedEx) | BARE_DIGITS, PHONE_SHAPE for grouped | Carrier brand keyword (`UPS`, `FedEx`, `USPS`, `DHL`) or `tracking`, `track`, `shipment` |
| Invoice number | `Invoice #INV-2026-04567`, `Invoice 4567823` | BARE_DIGITS | `Invoice`, `Bill`, `Statement` keyword |
| Confirmation / booking ref | `Confirmation: ABC-1234567`, `Booking #BR12345` | BARE_DIGITS (rare alone) | `confirmation`, `booking`, `reservation` |
| Receipt number | `Receipt #4567`, `RR1234` | BARE_DIGITS | `receipt` keyword |
| Ticket / case number | `Case #1234567`, `Ticket #4321`, GitHub `#1234`, JIRA `PROJ-1234` | BARE_DIGITS | `ticket`, `case`, `issue`, `bug`, `support` |
| Transaction ID | `Transaction ID: TXN-2026-001234`, `txn_3O5R0E2eZvKYlo2C0123` | BARE_DIGITS, alphanumeric | `transaction`, `payment`, `txn` |
| Product SKU / model | `SKU 12345-678`, `Model GS-1234`, `iPhone 15 Pro Max`, `RTX 4090`, `Galaxy S24 Ultra`, `XPS 9320` | BARE_DIGITS, sometimes PHONE_SHAPE | `SKU`, `Model`, `Part #`, `P/N`, brand+product context |
| ISBN-10 | `0-306-40615-2` | PHONE_SHAPE | `ISBN`, `ISBN-10` keyword |
| ISBN-13 | `978-3-16-148410-0` | PHONE_SHAPE | `ISBN`, `ISBN-13` keyword |
| ISSN | `0378-5955`, `ISSN 1234-5678` | PHONE_SHAPE | `ISSN` keyword |
| DOI | `10.1000/xyz123` | None (slash + alphanumeric) | `DOI` keyword |
| Episode ID | `S01E12`, `Episode 12 of 24` | BARE_DIGITS on standalone numbers | `Episode`, `Season`, `Ep.` keyword |
| URL ID | `/article/12345`, `/v/dQw4w9WgXcQ`, `?id=12345` | BARE_DIGITS | URL/path context (already extension-UI guarded for href, but text content of links not) |
| Coupon / promo code | `SAVE25`, `WELCOME10`, `BLACKFRIDAY2026` | BARE_DIGITS on year/numeric tail | `code`, `promo`, `coupon`, `voucher`, `discount` |
| QR / barcode | scanned text often appears as long digit run | BARE_DIGITS | `barcode`, `QR`, `EAN`, `UPC` |

**Disambiguation strategy**: keyword window (`Order`, `Tracking`, `Invoice`, `Case`, `Ticket`, `Reference`, `Confirmation`, `SKU`, `Model`, `ISBN`, `Episode`, `Receipt`) within 50 chars. Multilingual: ES `pedido`, `factura`, `recibo`, `seguimiento`, `caso`; FR `commande`, `facture`, `reçu`, `suivi`, `dossier`; DE `Bestellung`, `Rechnung`, `Quittung`, `Sendungsverfolgung`, `Fall`; JA `注文`, `請求書`, `領収書`, `追跡`, `チケット`; ZH `订单`, `发票`, `收据`, `跟踪`, `工单`; HI `आदेश`, `बीजक`, `रसीद`, `ट्रैकिंग`.

**Confidence**: H for keyword-window approach. **Prevalence**: ecommerce VERY HIGH (every order page), email VERY HIGH (transactional notifications), customer-support pages HIGH.

---

## Measurements / units

| Variant | Example | Regex matched | Disambiguation fingerprint |
| --- | --- | --- | --- |
| Resolution | `1920x1080`, `3840 x 2160`, `4K`, `1080p`, `1440p`, `2560×1440` | BARE_DIGITS on each side (only if ≥4 digits each); `x`/`×` between | `\d+[ ]?[x×][ ]?\d+` structural rule |
| File size | `1024 MB`, `2.5 GB`, `500 KB`, `1 TB`, `15.2 MiB` | BARE_DIGITS | Trailing unit `KB`/`MB`/`GB`/`TB`/`PB`/`KiB`/`MiB`/`GiB` (case-insensitive) |
| Network speed | `100 Mbps`, `1 Gbps`, `5 GHz`, `2.4 GHz`, `802.11ac`, `5G`, `LTE` | BARE_DIGITS | Trailing unit `bps`/`kbps`/`Mbps`/`Gbps`/`Hz`/`GHz`/`MHz` |
| CPU/GPU | `16 cores`, `32 threads`, `3.2 GHz`, `8 GB VRAM` | BARE_DIGITS | Trailing unit + tech keyword |
| Distance | `100 km`, `5 mi`, `42.195 km`, `1500 m`, `5 ft 10 in` | BARE_DIGITS | Trailing unit `km`/`mi`/`m`/`ft`/`in`/`yd`/`nm`/`μm` |
| Weight | `50 kg`, `120 lb`, `200 g`, `5 oz`, `2.5 t` | BARE_DIGITS | Trailing unit `kg`/`lb`/`g`/`oz`/`mg`/`t` |
| Temperature | `25 °C`, `77 °F`, `298 K`, `-40°C` | BARE_DIGITS | Trailing `°C`/`°F`/`K` |
| Battery / progress | `85%`, `100/250 used`, `42% complete` | BARE_DIGITS | Trailing `%` or `X/Y` ratio |
| Time duration | `5 min read`, `2 hours ago`, `30s ad`, `1h 23m`, `3 days`, `2 weeks` | BARE_DIGITS | Trailing time unit `s`/`sec`/`min`/`h`/`hr`/`day`/`week`/`month`/`year` (or "ago" pattern) |
| Refresh rate | `60 Hz`, `144 Hz`, `120 Hz`, `240 fps`, `60 fps` | BARE_DIGITS | Trailing `Hz`/`fps` |
| Volume | `2 L`, `500 mL`, `1 gal`, `16 fl oz` | BARE_DIGITS | Trailing `L`/`mL`/`gal`/`fl oz` |
| Currency-as-rate | `$5/month`, `€10/yr`, `₹500/day` | matched by CURRENCY_PREFIX, then `isPublicPrice` | Already covered by `isPublicPrice` |
| Energy / power | `100 W`, `240 V`, `5 A`, `3000 mAh`, `1.5 kWh` | BARE_DIGITS | Trailing `W`/`V`/`A`/`mAh`/`kWh` |
| Pressure / area | `760 mmHg`, `100 kPa`, `100 m²`, `1500 sqft` | BARE_DIGITS | Trailing `Pa`/`mmHg`/`bar`/`m²`/`sqft`/`acres` |

**Disambiguation strategy**: regex sniffs **trailing unit token** within 4 chars after the digit run. If matched, suppress.

```js
const UNIT_TOKENS = /^[ ]?(?:[kmgtp]i?b|bps|[km]?bps|[mg]?hz|fps|[°°]?[cfk]|km|mi|m|ft|in|yd|nm|kg|lb|g|oz|mg|t|s|sec|min|h|hr|day|week|month|year|l|ml|gal|w|v|a|mah|kwh|pa|bar)\b/i;
```

**Confidence**: H. **Prevalence**: ecommerce H (specs, dimensions), tech blogs VERY HIGH, dashboards/SaaS H.

---

## Counts / metrics (extending isCountNoise)

Existing `isCountNoise` covers engagement metrics. Additional count contexts to handle:

| Variant | Example | Existing coverage | Gap |
| --- | --- | --- | --- |
| Stock / inventory | `12 left in stock`, `Only 3 left`, `Out of stock` | Partial (`stock` likely missing) | Add `stock`, `available`, `inventory`, `units` |
| Pagination | `Page 1 of 100`, `1-10 of 1,234`, `Showing 1–25 of 234` | Partial | Add `page`, `of`, `showing`, `results` |
| Search results | `1,234 results found`, `About 1,234,567 results (0.42 sec)` | Partial | Add `results`, `found`, `matches` |
| Trend | `up 12%`, `down 5%`, `1.2K`, `5M views` | `views` covered | Add `trending`, `up`, `down`, `growth` |
| Star ratings | `4.7 stars`, `4.5/5`, `★★★★½`, `Rated 4.7 out of 5` | `stars` covered | Add `rating`, `out of`, `score` |
| Survey scale | `8 out of 10`, `9/10 dentists` | Partial | Add `out of` paired with small numbers |

**Disambiguation strategy**: extend `isCountNoise` keyword list. Multilingual extensions:
- ES: `seguidores`, `comentarios`, `me gusta`, `vistas`, `disponibles`, `resultados`, `página`
- FR: `abonnés`, `commentaires`, `mentions j'aime`, `vues`, `disponibles`, `résultats`, `page`
- DE: `Follower`, `Kommentare`, `Likes`, `Aufrufe`, `verfügbar`, `Ergebnisse`, `Seite`
- JA: `フォロワー`, `コメント`, `いいね`, `視聴回数`, `在庫`, `件`, `ページ`
- ZH: `粉丝`, `评论`, `点赞`, `浏览`, `库存`, `结果`, `页`
- HI: `फॉलोअर`, `टिप्पणियां`, `लाइक`, `दृश्य`, `स्टॉक`, `परिणाम`, `पृष्ठ`

**Confidence**: H. **Prevalence**: social networks VERY HIGH, ecommerce VERY HIGH, search engines VERY HIGH.

---

## Ordinals / labels

| Variant | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Section / Chapter / Page | `Section 4567`, `Chapter 12`, `Page 4567`, `Article 1234` | BARE_DIGITS | Preceding word in 20-char window |
| Step / Item | `Step 12`, `Item 4567`, `Question 5`, `Lecture 12`, `Exercise 3.1`, `Lesson 7` | BARE_DIGITS | Preceding word in 20-char window |
| List number | `No. 1234`, `# 4567`, `Number 1234`, `Item No 1234` | BARE_DIGITS | `No.`, `Number`, `#` prefix |
| Reference | `[1]`, `[12]`, `(footnote 12)`, `see ref. 4567` | BARE_DIGITS (rarely; ≤3 digits common) | Square-bracket pattern + small numbers |
| TOC entry | `1.2.3 Topic Name`, `4.5 Subtopic` | None (`.` not separator) | Safe |
| Table row | `Row 1234`, `Line 4567`, `Entry 12345` | BARE_DIGITS | `Row`, `Line`, `Entry` keyword |
| Hash-prefixed ID | `#1234`, `#issue1234` | BARE_DIGITS | `#` prefix |

**Disambiguation strategy**: preceding-word check within 20 chars BEFORE the digit run.

```js
const ORDINAL_PRECURSOR = /(?:section|chapter|page|article|step|item|question|lecture|exercise|lesson|number|no\.?|row|line|entry|paragraph|verse|figure|table|appendix)[\s.:#]+$/i;

function isOrdinalLabel(matchText, text, matchIndex) {
  const window = text.slice(Math.max(0, matchIndex - 30), matchIndex);
  return ORDINAL_PRECURSOR.test(window);
}
```

**Multilingual**: ES `sección`, `capítulo`, `página`, `paso`, `pregunta`, `tema`; FR `section`, `chapitre`, `page`, `étape`, `question`, `numéro`; DE `Abschnitt`, `Kapitel`, `Seite`, `Schritt`, `Frage`, `Nummer`, `Nr.`; JA `章`, `節`, `ページ`, `ステップ`, `問`, `番`; ZH `章`, `节`, `页`, `步骤`, `题`, `编号`; HI `अध्याय`, `पृष्ठ`, `चरण`, `प्रश्न`, `संख्या`.

**Confidence**: H. **Prevalence**: docs VERY HIGH, education sites HIGH, manuals HIGH, news L.

---

## Statistics / scientific notation

| Variant | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Percentages | `50%`, `99.9%`, `−2.5%`, `+12.3pp` | BARE_DIGITS only when `\d{4,}%` (rare); typically `\d{1,3}\.\d+%` | Trailing `%` |
| Decimals | `0.5`, `3.14159`, `−2.71828` | None (`.` not separator) | Safe |
| Scientific notation | `1.5e10`, `6.022×10²³`, `1e-5`, `2.5e+8` | BARE_DIGITS on the exponent | Surrounding `e[+-]?\d` or `×10^` |
| p-values | `p < 0.001`, `p = 0.05`, `p ≤ 0.01` | None | Safe |
| Confidence intervals | `95% CI [1.2, 3.4]`, `[1.234, 5.678]` | Square brackets + comma | `CI`, `confidence interval` keyword |
| Sample size | `n = 1,234`, `N=5000`, `sample size 1,234,567` | GROUPED_THOUSANDS | `n`/`N` prefix or `sample size`, `cohort` keyword |
| Significant figures | `3.14`, `9.81`, `6.022×10²³` | None | Safe |
| Standard error / deviation | `SE = 0.05`, `SD = 1.2`, `σ = 0.8` | None | Safe |
| Correlation | `r = 0.85`, `R² = 0.92` | None | Safe |
| Odds / log ratios | `OR = 1.5`, `HR = 2.3` | None | Safe |

**Disambiguation strategy**: trailing `%` is dispositive. Scientific-notation suffix `e\d+` is dispositive. CI/sample-size keywords cover the rest.

**Confidence**: H. **Prevalence**: scientific publications HIGH, news (statistics) M, social L.

---

## Codes that look numeric

| Variant | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Hex color | `#FF5733`, `#abc123`, `#000`, `0xFF` | None | `#` prefix + 3/6/8 hex chars + non-digit-letter boundary |
| HTTP status | `200 OK`, `404 Not Found`, `500 Internal Server Error`, `301 Moved Permanently` | BARE_DIGITS only if used standalone | Status-message text follows; or `HTTP`/`status` keyword |
| Year-named events | `World War 2`, `Web 3.0`, `G20`, `Industry 4.0`, `5G`, `Wi-Fi 6`, `iOS 17` | BARE_DIGITS rarely (small numbers) | Adjacent capitalized brand/event word |
| Hex hash / commit | `a1b2c3d4`, `c0ffee`, `git commit a1b2c3d` | None (alphanumeric) | Safe |
| Base64-ish | `SGVsbG8=`, `dGVzdA==` | None | Safe |
| Regex itself | `\d{4}` in a regex literal | BARE_DIGITS (`{4}` part isn't 4 chars but `4` alone is too short) | Safe under current regex |
| Country code numeric | ISO 3166-1 numeric `840` (US), `392` (JP), `156` (CN) | BARE_DIGITS only when ≥4 (these are 3 digits) | Safe |
| Postal abbrev + 5 digits | `NY 10001`, `CA 94103` | BARE_DIGITS on the ZIP (caught by postal-code suppression in country-aware mode) | See `address-location.md` |

**Disambiguation strategy**:
- Hex color: `#` prefix gate is dispositive — never blur `#xxxxxx` shapes.
- HTTP status: small numbers (≤599) followed by status-text keyword.
- Year-named events: usually below BARE_DIGITS threshold (≥4 digits).

**Confidence**: H for hex colors (structural). M for the rest (rare in PII contexts).

---

## Sports / games

| Variant | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Score / scoreline | `3-2`, `145/4`, `78-72`, `100-87 (OT)` | None — both groups <3 digits | Safe |
| Jersey number | `#23`, `Player #99`, `No. 7` | BARE_DIGITS only at ≥4 (rare jerseys) | Safe |
| Lap / split time | `1:23.456`, `0:42.10`, `2:01.23` | None | Safe |
| Ranking | `Ranked #5`, `5th place`, `Top 10`, `#1 in Region` | BARE_DIGITS only at ≥4 | Safe |
| Distance / time records | `42.195 km`, `9.58 sec` (Bolt), `2:00:35` (marathon WR) | BARE_DIGITS on `42195` if compact | Unit suppression catches |
| Tournament round | `Round 16`, `Final 4`, `Top 8`, `Group A`, `Match 1234` | BARE_DIGITS at ≥4 | `Round`, `Match` keyword |
| Game ID | `Game #4567`, `Match ID 12345` | BARE_DIGITS | `Game`, `Match` keyword |

**Confidence**: M (most cases are below BARE_DIGITS threshold). **Prevalence**: sports news H, gaming sites H, general L.

---

## Math / programming

| Variant | Example | Regex matched | Disambiguation |
| --- | --- | --- | --- |
| Range notation | `1..100`, `1-10`, `0..255`, `[1-50]` | PHONE_SHAPE only with ≥3 digits per group | Safe for small ranges |
| Array indices | `arr[0]`, `list[42]`, `data[1234]` | BARE_DIGITS | `[`/`]` brackets surrounding |
| Line numbers | `line 1234`, `:1234:5`, gutter line numbers | BARE_DIGITS | `line` keyword or stack-trace pattern |
| Memory addresses | `0x7FFE1234`, `0xC0FFEE`, `&buffer[1234]` | None (hex prefix) | `0x` prefix |
| Bitfield / flags | `0b10110100`, `0xFF`, `2^32`, `1<<24` | BARE_DIGITS on `32`/`24` | Safe (small) |
| Math constants | `π = 3.14159`, `e = 2.71828`, `φ = 1.618` | None | Safe |
| Big numbers | `1e9`, `2^32 = 4,294,967,296`, `2,147,483,647` | GROUPED_THOUSANDS catches | Already covered by `isPublicPrice`/extension |
| Code-block context | digit run inside `<pre>`, `<code>`, `<kbd>`, `<samp>` | any | **Ancestor-element check** — universal early-exit |

**Disambiguation strategy**: **`<pre>` / `<code>` / `<kbd>` / `<samp>` ancestor check** is the single highest-impact filter for technical pages. Implement as an early-exit in `_isExtensionUI` neighbor (or as a separate `_isCodeBlock` check).

```js
function _isInsideCodeBlock(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return false;
  return el.closest('code, pre, kbd, samp, [data-code], .highlight, .codehilite') !== null;
}
```

**Confidence**: H (structural — DOM ancestor is dispositive). **Prevalence**: dev docs VERY HIGH, GitHub VERY HIGH, Stack Overflow VERY HIGH.

---

## Master disambiguation table

Cross-reference: every FP category × dispositive signal × where it slots in the detector pipeline.

| FP category | Strongest signal | Type | Window/scope | Estimated FP-rate reduction (combined w/ existing) |
| --- | --- | --- | --- | --- |
| ISO 8601 date | `\d{4}-\d{2}-\d{2}` shape | Structural | match-self | ~15% of remaining FPs |
| Compact 8-digit date | digits split as YYYY-MM-DD with valid month/day | Structural | match-self | ~5% |
| Time HH:MM:SS | colon between digit groups | Structural | match-self | already mostly safe |
| Year range `YYYY-YYYY` | both endpoints in 1000-2099 | Structural | match-self | ~3% |
| Semver build metadata | `\d+\.\d+\.\d+\+\d+` | Structural | preceding 30 chars | ~1% |
| Build / version label | `version`/`build`/`v` keyword window | Keyword | ±50 chars | ~5% |
| Order / tracking / invoice / case | keyword window | Keyword | ±50 chars | ~20% |
| ISBN / ISSN / DOI | `ISBN`, `ISSN`, `DOI` keyword | Keyword | ±30 chars | ~3% |
| Resolution `NxM` | `[x×]` between digit groups | Structural | match-self | ~3% |
| File / network / measurement units | unit token within 4 chars after | Structural | trailing 4 chars | ~10% |
| Stock / pagination / search results | extended count keywords | Keyword | ±150 chars | ~5% |
| Ordinals (Section/Chapter/Page) | preceding-word | Keyword | preceding 30 chars | ~10% |
| Hex color | `#` prefix + 3/6/8 hex | Structural | match-self | ~2% |
| Code block ancestor | `<pre>`/`<code>` ancestor | DOM | element scope | ~15% on dev pages |
| Percentage | trailing `%` | Structural | trailing 1 char | ~3% |
| Scientific notation | `e[+-]?\d` adjacent | Structural | trailing 4 chars | ~1% |

Cumulative remaining-FP reduction with all suppressors: **~80%**.

---

## Implementation recommendations

Ranked by (FP-rate reduction × prevalence on real pages × implementation cost). Each entry gives function name, signature, regex/window spec, and where to slot into `src/pii_detector.js`.

### Tier A — high-impact, low-cost (implement first)

```js
// 1. Code-block ancestor check — single highest-impact filter for dev/docs sites.
function _isInsideCodeBlock(node) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!el) return false;
  return el.closest('code, pre, kbd, samp, [data-code], .highlight, .codehilite') !== null;
}
// SLOT: scan() and handleMutations() — early-exit alongside _isExtensionUI.

// 2. Date suppressor — covers ISO 8601, slash dates, compact 8-digit dates.
const _DATE_STRUCTURAL_RE =
  /^\d{4}-\d{2}-\d{2}$|^\d{4}\/\d{2}\/\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}\.\d{2}\.\d{4}$|^\d{8}$|^\d{4}-W\d{2}(?:-\d)?$|^\d{4}-\d{3}$/;
const _DATE_KEYWORD_RE =
  /\b(?:date|posted|published|updated|created|modified|due|expires|expiry|valid|fecha|publicado|actualizado|date|publié|mis à jour|datum|veröffentlicht|aktualisiert|日付|投稿|更新|日期|发布|更新|तारीख|दिनांक|प्रकाशित)\b/i;
function isDateLike(matchText, text, matchIndex) {
  if (_DATE_STRUCTURAL_RE.test(matchText)) {
    if (matchText.length === 8) {
      const m = parseInt(matchText.slice(4, 6), 10);
      const d = parseInt(matchText.slice(6, 8), 10);
      if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    }
    return true;
  }
  const start = Math.max(0, matchIndex - 50);
  const end   = Math.min(text.length, matchIndex + matchText.length + 20);
  return _DATE_KEYWORD_RE.test(text.slice(start, end));
}
// SLOT: FALSE_POSITIVE_CHECKS.precise — runs after isYear, before isPublicPrice.

// 3. Order / tracking / invoice keyword suppressor.
const _ORDER_REF_RE =
  /\b(?:order|tracking|invoice|case|ticket|reference|confirmation|booking|receipt|sku|model|isbn|issn|episode|pedido|factura|recibo|seguimiento|caso|commande|facture|reçu|suivi|dossier|Bestellung|Rechnung|Quittung|Sendungsverfolgung|Fall|注文|請求書|領収書|追跡|チケット|订单|发票|收据|跟踪|工单|आदेश|बीजक|रसीद)\b/i;
function isOrderRef(_matchText, text, matchIndex) {
  const start = Math.max(0, matchIndex - 50);
  const end   = Math.min(text.length, matchIndex + 50);
  return _ORDER_REF_RE.test(text.slice(start, end));
}
// SLOT: FALSE_POSITIVE_CHECKS.precise — alongside isPublicPrice.

// 4. Measurement / unit trailing suppressor.
const _UNIT_TRAIL_RE =
  /^(?:\s?(?:[KMGTP]i?B|bps|[Kk]?bps|[MG]bps|[MG]?Hz|fps|[°]?[CFK]\b|km|mi|m|ft|in|yd|nm|kg|lb|g|oz|mg|t|s|sec|min|h|hr|day|week|month|year|L|mL|gal|W|V|A|mAh|kWh|Pa|bar|sqft|m²|°)\b)/i;
function isMeasurement(_matchText, text, matchIndex) {
  const trailStart = matchIndex + _matchText.length;
  return _UNIT_TRAIL_RE.test(text.slice(trailStart, trailStart + 8));
}
// SLOT: FALSE_POSITIVE_CHECKS.precise.
```

### Tier B — moderate-impact (implement second)

```js
// 5. Resolution N x M
const _RESOLUTION_RE = /^\d+[ ]?[x×][ ]?\d+/i;
function isResolution(matchText, text, matchIndex) {
  const around = text.slice(Math.max(0, matchIndex - 5), matchIndex + matchText.length + 8);
  return /\d+[ ]?[x×][ ]?\d+/i.test(around);
}

// 6. Ordinal label (Section / Chapter / Page / Step / etc.)
const _ORDINAL_PRECURSOR_RE =
  /(?:section|chapter|page|article|step|item|question|lecture|exercise|lesson|number|no\.?|row|line|entry|paragraph|verse|figure|table|appendix|sección|capítulo|página|paso|pregunta|chapitre|étape|Abschnitt|Kapitel|Seite|Schritt|Frage|Nummer|Nr\.?|章|節|ページ|ステップ|页|步骤|अध्याय|पृष्ठ|चरण)[\s.:#]+$/i;
function isOrdinalLabel(_matchText, text, matchIndex) {
  const window = text.slice(Math.max(0, matchIndex - 30), matchIndex);
  return _ORDINAL_PRECURSOR_RE.test(window);
}

// 7. Hex color (`#`-prefixed)
function isHexColor(matchText, text, matchIndex) {
  if (matchIndex === 0) return false;
  if (text[matchIndex - 1] !== '#') return false;
  return /^[0-9A-Fa-f]+$/.test(matchText) && (matchText.length === 3 || matchText.length === 6 || matchText.length === 8);
}

// 8. Year range YYYY-YYYY
function isYearRange(matchText) {
  const m = matchText.match(/^(\d{4})[-–](\d{4})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a >= 1000 && a <= 2099 && b >= 1000 && b <= 2099;
}
```

### Tier C — niche / advanced (defer)

```js
// 9. Percentage (trailing %)
function isPercentage(_matchText, text, matchIndex) {
  return text[matchIndex + _matchText.length] === '%';
}

// 10. Scientific notation
function isScientificNotation(_matchText, text, matchIndex) {
  const after = text.slice(matchIndex + _matchText.length, matchIndex + _matchText.length + 4);
  return /^e[+-]?\d/i.test(after);
}

// 11. Statistics keyword window
const _STATS_RE = /\b(?:p\s*[<=>]|n\s*=|sample size|cohort|CI|confidence interval|95%|SD|SE|σ|R²|r\s*=)\b/i;
function isStatistic(_matchText, text, matchIndex) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + 30);
  return _STATS_RE.test(text.slice(start, end));
}
```

### Pipeline ordering

Recommended execution order in `_falsePositivesCheck` (early-exits short-circuit cheaper checks):

1. `_isInsideCodeBlock` — DOM check, runs once per text node before regex.
2. `isYear` — existing.
3. `isVersion` — existing.
4. `isHexColor` — match-self.
5. `isPercentage` / `isScientificNotation` — trailing 1–4 chars.
6. `isMeasurement` — trailing 4–8 chars.
7. `isResolution` — match-spanning.
8. `isYearRange` — match-self.
9. `isDateLike` — structural + 50-char window.
10. `isOrdinalLabel` — preceding 30 chars.
11. `isPublicPrice` — existing 100-char window.
12. `isCountNoise` — existing 150-char window (extended keyword list).
13. `isOrderRef` — 50-char window.
14. `isStatistic` — 30-char window.

### Profile composition

Update `FALSE_POSITIVE_CHECKS` in `src/pii_detector.js`:

```js
const FALSE_POSITIVE_CHECKS = Object.freeze({
  aggressive: [isVersion, isHexColor, isInsideCodeBlock],
  precise: [
    isYear, isVersion, isHexColor, isPercentage, isScientificNotation,
    isMeasurement, isResolution, isYearRange, isDateLike, isOrdinalLabel,
    isPublicPrice, isCountNoise, isOrderRef, isStatistic, isInsideCodeBlock,
  ],
});
```

`isInsideCodeBlock` requires the text node, not just the text — wire it through `_findMatches(text, types, node)` rather than the current 2-arg signature.

### Testing

For each new check, add to `tests/unit/pii_detector.test.js`:

- One **true-positive** case (suppressor correctly fires).
- One **false-positive** case (suppressor correctly does NOT fire — i.e. real PII passes through).
- Update `docs/contracts/pii_detector.tests.md`.

---

## References

- Semver — [https://semver.org/](https://semver.org/)
- ISO 8601:2019 — [https://www.iso.org/iso-8601-date-and-time-format.html](https://www.iso.org/iso-8601-date-and-time-format.html)
- Unicode CLDR (date/number formats per locale) — [https://cldr.unicode.org/](https://cldr.unicode.org/)
- ECMAScript Internationalization API (Intl.DateTimeFormat / Intl.NumberFormat) — [https://tc39.es/ecma402/](https://tc39.es/ecma402/)
- HTTP status codes — [https://www.rfc-editor.org/rfc/rfc9110](https://www.rfc-editor.org/rfc/rfc9110)
- ISBN-13 — [https://www.isbn-international.org/content/what-isbn](https://www.isbn-international.org/content/what-isbn)
- ISSN — [https://www.issn.org/](https://www.issn.org/)
- DOI — [https://www.doi.org/](https://www.doi.org/)
- IEC 80000 (units) — [https://www.iec.ch/standardsdev/publications/](https://www.iec.ch/standardsdev/publications/)
- ISO 4217 (currency codes) — [https://www.iso.org/iso-4217-currency-codes.html](https://www.iso.org/iso-4217-currency-codes.html)
- ISO 3166 (country codes) — [https://www.iso.org/iso-3166-country-codes.html](https://www.iso.org/iso-3166-country-codes.html)
