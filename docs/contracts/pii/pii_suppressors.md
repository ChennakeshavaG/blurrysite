# pii_suppressors Contract

## Overview

Stage 4 false-positive suppressor cascade. Holds every `(matchText, text, matchIndex) => boolean` check that decides whether a candidate match should be dropped before wrapping. Phase 1 ships 13 checks total in the `precise` profile, ordered cheap-to-expensive so the cascade short-circuits on the first hit:

1. **Structural** (match-self, ~1µs): `isYear`, `isVersion`, `isHexColor`, `isYearRange`, `isPercentage`, `isScientificNotation`
2. **Trailing-char** (next 4–10 chars, ~1µs): `isMeasurement`, `isResolution`
3. **Preceding-word** (back 30 chars, ~3µs): `isOrdinalLabel`
4. **Keyword-window ±50** (~10µs): `isDateLike`, `isOrderRef`
5. **Keyword-window ±100/150** (~20µs): `isPublicPrice`, `isCountNoise`

Profile switch is developer-facing only; users see on/off in the popup.

Multilingual keyword regexes cover EN + ES + FR + DE + JA + ZH + HI per `docs/research/pii/numeric/INDEX.md` context-token table.

## Module State

| Variable | Description |
|---|---|
| `NUMERIC_PROFILE` | `'precise'` (default) or `'aggressive'` — developer-only constant. `precise` runs all 13 checks; `aggressive` runs only `isVersion`. |

## Public API

### NUMERIC_PROFILE

Read-only constant exposed for tests and observability. Currently `'precise'`.

### FALSE_POSITIVE_CHECKS

Frozen `{ aggressive: Function[], precise: Function[] }` — the ordered cascade lists keyed by profile. `precise` runs 13 checks in cheap-to-expensive order (see Overview). Order matters: `falsePositivesCheck` short-circuits on the first hit.

### Tier 1 — structural (match-self, ~1µs)

#### isYear(matchText, text?, matchIndex?)

**Returns**: `true` if `matchText` is exactly 4 digits and the integer value is in `[1000, 2099]`.
**Use**: suppresses bare 4-digit year matches.

#### isVersion(matchText, text, matchIndex)

**Returns**: `true` if either:
- character at `matchIndex - 1` is `'v'` or `'V'` (e.g. `v1234`), or
- character at `matchIndex + matchText.length` is `'.'` followed by a digit (e.g. `1.2.3`).

**Use**: suppresses semver build numbers and version strings.

#### isHexColor(matchText, text, matchIndex)

**Returns**: `true` if `matchIndex > 0`, character at `matchIndex - 1` is `'#'`, `matchText` is all hex digits, AND length is 3, 6, or 8.
**Use**: suppresses CSS / design-token hex color codes (`#FF5733`, `#abc`, `#FF5733FF`).

#### isYearRange(matchText, ...)

**Returns**: `true` if `matchText` matches `^(\d{4})[ \-–—](\d{4})$` and both endpoints are in `[1000, 2099]`. Separator class: ASCII space, ASCII hyphen-minus, en-dash, em-dash. The space alternative covers phone-shape matches like `2020 2024` that arrive as one match via the NUMERIC sub-pattern 4 (digit groups separated by space/hyphen).
**Use**: suppresses inline year ranges (`2020-2024`, `2020–2024`, `2020 2024`).

#### isPercentage(matchText, text, matchIndex)

**Returns**: `true` if the character immediately after the match is `'%'`.
**Use**: suppresses percentages (`50%`, `99.9%`).

#### isScientificNotation(matchText, text, matchIndex)

**Returns**: `true` if the next 4 chars after the match match `^e[+-]?\d` (case-insensitive).
**Use**: suppresses scientific notation (`1.5e10`, `2.5e+8`).

### Tier 2 — trailing-char (next 4–10 chars, ~1µs)

#### isMeasurement(matchText, text, matchIndex)

**Returns**: `true` if the next 10 chars match a unit token: `KB|MB|GB|TB|PB|KiB|MiB|GiB|bps|Mbps|Gbps|Hz|GHz|MHz|fps|°C|°F|°K|km|cm|mm|nm|mi|ft|in|yd|kg|lb|oz|mg|t|sec|min|hr|hours?|days?|weeks?|months?|years?|mL|gal|kWh|mAh|Pa|bar|sqft|m²` (case-insensitive; optional leading space/NBSP). Word-boundary at end.
**Use**: suppresses measurements (`1024 MB`, `5 GHz`, `60 fps`, `25°C`, `100 km`, `5 min read`).

#### isResolution(matchText, text, matchIndex)

**Returns**: `true` if the surrounding text (6 chars before + 8 chars after match) contains `\d+\s?[x×:]\s?\d+`.
**Use**: suppresses resolutions (`1920x1080`, `3840×2160`, `16:9`).

### Tier 3 — preceding-word (back 30 chars, ~3µs)

#### isOrdinalLabel(matchText, text, matchIndex)

**Returns**: `true` if the 30 chars before `matchIndex` end with a multilingual ordinal precursor: `section/chapter/page/article/step/item/question/lecture/exercise/lesson/number/no.?/row/line/entry/paragraph/verse/figure/table/appendix` and ES/FR/DE/JA/ZH/HI equivalents (`sección`/`capítulo`/`página`/`paso`/`pregunta`/`chapitre`/`étape`/`Abschnitt`/`Kapitel`/`Seite`/`Schritt`/`Frage`/`Nummer`/`Nr.?`/`章`/`節`/`ページ`/`ステップ`/`問`/`页`/`步骤`/`题`/`अध्याय`/`पृष्ठ`/`चरण`/`प्रश्न`) followed by `[\s.:#]+`.
**Use**: suppresses doc/manual/quiz numbering (`Section 1234`, `Chapter 12`, `Page 4567`, `Step 12`).

### Tier 4 — keyword-window ±50 chars (~10µs)

#### isDateLike(matchText, text, matchIndex)

**Returns**: `true` if any of:
- `matchText` is structurally a date: ISO 8601 extended (`yyyy-mm-dd`), slash dates (`yyyy/mm/dd`, `mm/dd/yyyy`), dot dates (`dd.mm.yyyy`, `yyyy.mm.dd`), ISO week (`yyyy-Www[-d]`), or ordinal date (`yyyy-DDD`).
- `matchText` is a compact 8-digit form (`yyyymmdd`) AND positions 5–6 ∈ [01, 12] AND positions 7–8 ∈ [01, 31].
- ±50 chars of `matchIndex` contain a multilingual date keyword: EN `date|posted|published|updated|created|modified|due|expires|expir(es|ation|y)|valid|as of|since` and ES/FR/DE/JA/ZH/HI equivalents.

**Use**: suppresses dates that fall through the existing `isYear` (which catches only standalone 4-digit years).

#### isOrderRef(matchText, text, matchIndex)

**Returns**: `true` if ±50 chars of `matchIndex` contain a multilingual identifier-by-design keyword: `order|tracking|invoice|case|ticket|reference|confirmation|booking|receipt|sku|model|isbn|issn|episode` and ES/FR/DE/JA/ZH/HI equivalents.
**Use**: suppresses order numbers, tracking codes, invoice IDs, ISBN, ISSN, support ticket numbers.

### Tier 5 — keyword-window ±100/150 chars (~20µs)

#### isPublicPrice(matchText, text, matchIndex)

**Returns**: `true` if ±100 chars of `matchIndex` contain a multilingual price/cart keyword. EN: `/mo`, `/month`, `/yr`, `/year`, `per month`, `per year`, `cart`, `qty`, `quantity`, `units`, `rating`, `reviews`, `stars`, `price`, `cost`, `total`, `subtotal`, `sale`, `discount`, `MRP`. ES `precio/carrito/cantidad/valoración/estrellas`. FR `prix/panier/quantité/évaluation/étoiles`. DE `Preis/Warenkorb/Menge/Bewertung/Sterne`. IT `prezzo/carrello/quantità/valutazione/stelle`. JA `価格/カート/数量/評価/星`. ZH `价格/购物车/数量/评分`. HI `कीमत/दाम/मूल्य/कार्ट/मात्रा/रेटिंग`.
**Use**: suppresses ecommerce price-adjacent and rating-adjacent numbers.

#### isCountNoise(matchText, text, matchIndex)

**Returns**: `true` if ±150 chars of `matchIndex` contain a multilingual engagement keyword: EN `unread/notifications/messages/followers/following/likes/views/comments/results/items/members/subscribers/posts/connections/shares/replies/reactions/upvotes/downvotes/stock/available/inventory/page/of/showing` and ES/FR/DE/JA/ZH/HI equivalents.
**Use**: suppresses social-engagement, stock count, search-result, and pagination noise.

### falsePositivesCheck(matchText, text, matchIndex)

**Returns**: `true` if any cascade tier produces a hit.
**Behavior**:
- When `NUMERIC_PROFILE === 'precise'` → delegates to `falsePositivesCheckCascade` (Phase 2 tier-by-tier short-circuit).
- Otherwise → runs `FALSE_POSITIVE_CHECKS[NUMERIC_PROFILE]` as a flat `Array.some` (e.g. `'aggressive'` runs only `isVersion`).

**Side effects**: none.
**Short-circuits** on first hit.

### falsePositivesCheckCascade(matchText, text, matchIndex)

**Returns**: `true` if any check across the 5 cascade tiers returns `true`.
**Behavior**: walks the tiers in cost-tier order with `||` short-circuit between tiers and `Array.some` short-circuit within each tier:
1. `_CHECKS_STRUCTURAL` — `[isYear, isVersion, isHexColor, isYearRange, isPercentage, isScientificNotation]`
2. `_CHECKS_TRAILING` — `[isMeasurement, isResolution]`
3. `_CHECKS_PRECEDING` — `[isOrdinalLabel]`
4. `_CHECKS_KEYWORD_50` — `[isDateLike, isOrderRef]`
5. `_CHECKS_KEYWORD_LARGE` — `[isPublicPrice, isCountNoise]`

**Side effects**: none.
**Short-circuits**: between tiers (cheap before expensive) AND within each tier (first hit wins).
**Note**: behaviorally identical to running `FALSE_POSITIVE_CHECKS.precise` as a single flat `Array.some`. The tier shape signals cost contracts to readers and gives Phase 3+ a hook to insert detector-specific tiers without re-tiering the existing checks.

## Adding a new suppressor

1. Write a function `(matchText, text, matchIndex) => boolean`. `true` = suppress.
2. Add to `FALSE_POSITIVE_CHECKS.precise` (and optionally `.aggressive`).
3. Add unit tests: one true-positive (suppressor fires correctly) + one false-positive (real PII still passes).
4. Update `docs/contracts/pii/pii_suppressors.tests.md`.

## Edge cases

- Empty `text` or `matchIndex` out of range — keyword-window slicers clamp via `Math.max(0, ...)` / `Math.min(text.length, ...)`.
- `text` shorter than the slicing window — returns the full text; correctness unaffected.
- Both windowed checks are case-insensitive via `/i` flag on the regex.
