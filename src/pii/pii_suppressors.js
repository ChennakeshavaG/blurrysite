/**
 * pii/pii_suppressors.js — Stage 4 false-positive suppressor cascade.
 *
 * Holds every (matchText, text, matchIndex) => boolean check that decides
 * whether a candidate match should be dropped before wrapping. Today's set
 * (precise profile): isYear, isVersion, isPublicPrice, isCountNoise. Phase 1
 * extends with isHexColor / isYearRange / isPercentage / isScientificNotation /
 * isMeasurement / isResolution / isOrdinalLabel / isDateLike / isOrderRef.
 *
 * Profile switch is developer-facing only; users see on/off in popup.
 *
 * Exposed as blsi.PiiSuppressors (IIFE — no ES module syntax).
 */

const BlurrySitePiiSuppressors = (() => {
  "use strict";

  // 'precise' runs all false-positive checks.
  // 'aggressive' runs only high-confidence checks (isVersion).
  const NUMERIC_PROFILE = "precise"; // 'aggressive' | 'precise'

  function isYear(matchText /*, _text, _index */) {
    if (!/^\d{4}$/.test(matchText)) return false;
    const n = Number(matchText);
    return n >= 1000 && n <= 2099;
  }

  function isVersion(matchText, text, matchIndex) {
    const before = matchIndex > 0 ? text[matchIndex - 1] : "";
    if (before === "v" || before === "V") return true;
    const afterIdx = matchIndex + matchText.length;
    return text[afterIdx] === "." && /\d/.test(text[afterIdx + 1] || "");
  }

  // Multilingual price/cart context — EN + ES + FR + DE + JA + ZH + HI.
  const _PUBLIC_PRICE_RE =
    /\/mo(?:nth)?|\/y(?:r|ear)|per month|per year|\bcart\b|\bqty\b|\bquantity\b|\bunits\b|\brating\b|\breviews?\b|\bstars?\b|\bprice\b|\bcost\b|\btotal\b|\bsubtotal\b|\bsale\b|\bdiscount\b|\bMRP\b|precio|carrito|cantidad|valoración|valoraci[oó]n|estrellas|prix|panier|quantité|évaluation|étoiles|Preis|Warenkorb|Menge|Bewertung|Sterne|prezzo|carrello|quantità|valutazione|stelle|価格|カート|数量|評価|星|价格|购物车|数量|评分|कीमत|दाम|मूल्य|कार्ट|मात्रा|रेटिंग/i;

  function isPublicPrice(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 100);
    const end = Math.min(text.length, matchIndex + 100);
    return _PUBLIC_PRICE_RE.test(text.slice(start, end));
  }

  // Multilingual engagement / count-noise context.
  const _COUNT_NOISE_RE =
    /unread|notifications?|messages?|followers?|following|likes?|views?|comments?|results?|items?|members?|subscribers?|posts?|connections?|shares?|replies|replies?|reactions?|upvotes?|downvotes?|stock|available|inventory|page|of|showing|seguidores|comentarios|me gusta|vistas|disponibles|resultados|página|abonnés|commentaires|mentions j'aime|vues|disponibles|résultats|page|Follower|Kommentare|Likes|Aufrufe|verfügbar|Ergebnisse|Seite|フォロワー|コメント|いいね|視聴回数|在庫|件|ページ|粉丝|评论|点赞|浏览|库存|结果|页|फॉलोअर|टिप्पणियां|लाइक|दृश्य|स्टॉक|परिणाम|पृष्ठ/i;

  function isCountNoise(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 150);
    const end = Math.min(text.length, matchIndex + 150);
    return _COUNT_NOISE_RE.test(text.slice(start, end));
  }

  // ── Tier-A suppressors (Phase 1) ─────────────────────────────────────────

  // #-prefixed 3/6/8 hex chars — hex colors. Match must be the bare hex run
  // (BARE_DIGITS won't catch hex letters; this still applies via the # gate).
  function isHexColor(matchText, text, matchIndex) {
    if (matchIndex === 0) return false;
    if (text[matchIndex - 1] !== "#") return false;
    if (!/^[0-9A-Fa-f]+$/.test(matchText)) return false;
    const n = matchText.length;
    return n === 3 || n === 6 || n === 8;
  }

  // YYYY-YYYY where both endpoints are in 1000–2099 (year ranges in prose).
  function isYearRange(matchText /*, text, matchIndex */) {
    const m = matchText.match(/^(\d{4})[ \-–—](\d{4})$/);
    if (!m) return false;
    const a = +m[1];
    const b = +m[2];
    return a >= 1000 && a <= 2099 && b >= 1000 && b <= 2099;
  }

  // Trailing % — percentages.
  function isPercentage(matchText, text, matchIndex) {
    return text[matchIndex + matchText.length] === "%";
  }

  // Trailing e[+-]?\d — scientific notation exponent.
  function isScientificNotation(matchText, text, matchIndex) {
    const after = text.slice(
      matchIndex + matchText.length,
      matchIndex + matchText.length + 4,
    );
    return /^e[+-]?\d/i.test(after);
  }

  // Trailing unit token — KB/MB/GB, Hz, fps, °C/F, km, kg, sec/min/hr, etc.
  const _UNIT_TRAIL_RE =
    /^[  ]?(?:[KMGTPE]i?B|[KkMmGg]?bps|[MGmg]?Hz|fps|°[CFK]|°|km|cm|mm|nm|mi|ft|in|yd|kg|lb|oz|mg|tons?|sec|min|hr|hours?|days?|weeks?|months?|years?|mL|gal|kWh|mAh|Pa|bar|sqft|m²|m\^2)\b/i;

  function isMeasurement(matchText, text, matchIndex) {
    const after = text.slice(
      matchIndex + matchText.length,
      matchIndex + matchText.length + 10,
    );
    return _UNIT_TRAIL_RE.test(after);
  }

  // Resolution / aspect — digit x/× digit (1920x1080, 3840×2160, 16:9 also).
  function isResolution(matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 6);
    const end = Math.min(text.length, matchIndex + matchText.length + 8);
    return /\d+\s?[x×:]\s?\d+/.test(text.slice(start, end));
  }

  // Preceding word: Section / Chapter / Page / Step / Item / Question /
  //                 Lecture / Exercise / No. / Number / Row / Line / Entry —
  //                 multilingual (EN / ES / FR / DE / JA / ZH / HI).
  const _ORDINAL_PRECURSOR_RE =
    /(?:section|chapter|page|article|step|item|question|lecture|exercise|lesson|number|no\.?|row|line|entry|paragraph|verse|figure|table|appendix|sección|capítulo|página|paso|pregunta|chapitre|étape|Abschnitt|Kapitel|Seite|Schritt|Frage|Nummer|Nr\.?|章|節|ページ|ステップ|問|页|步骤|题|अध्याय|पृष्ठ|चरण|प्रश्न)[\s.:#]+$/i;

  function isOrdinalLabel(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 30);
    return _ORDINAL_PRECURSOR_RE.test(text.slice(start, matchIndex));
  }

  // Date — structural fingerprint OR keyword window.
  // Structural patterns: ISO 8601 extended, ISO 8601 basic (8-digit compact),
  // slash dates (mm/dd/yyyy, yyyy/mm/dd), dot dates (dd.mm.yyyy, yyyy.mm.dd),
  // ordinal date (yyyy-DDD), week date (yyyy-Www[-d]).
  const _DATE_STRUCTURAL_RES = [
    /^\d{4}-\d{2}-\d{2}$/, // ISO 8601 extended
    /^\d{4}\/\d{2}\/\d{2}$/, // yyyy/mm/dd
    /^\d{2}\/\d{2}\/\d{4}$/, // mm/dd/yyyy
    /^\d{2}\.\d{2}\.\d{4}$/, // dd.mm.yyyy
    /^\d{4}\.\d{2}\.\d{2}$/, // yyyy.mm.dd
    /^\d{4}-W\d{2}(?:-\d)?$/, // ISO week
    /^\d{4}-\d{3}$/, // ordinal date
  ];

  // Multilingual date keywords for the windowed path (EN/ES/FR/DE/JA/ZH/HI).
  const _DATE_KEYWORD_RE =
    /\b(?:date|posted|published|updated|created|modified|due|expires|expir(?:es|ation|y|ed)|valid(?: until)?|as of|since|fecha|publicado|actualizado|vence|date|publié|mis à jour|expire|Datum|veröffentlicht|aktualisiert|gültig|fällig|日付|投稿|更新|期限|更新|日期|发布|更新|截止|तारीख|दिनांक|प्रकाशित)\b/i;

  // Match-shape gate for the keyword fallback. A real date written near a
  // date keyword is short (≤4 bare digits like "2024", or 1–4 digit groups
  // joined by `/`, `.`, `-`, or space — "11/12", "01/15/2024", "2024-01-15").
  // Phone numbers, credit cards, account numbers — anything ≥10 digits with
  // separators, or ≥5 bare digits — must NOT be killed by a stray
  // "created"/"updated" nearby. The `length > 10` guard plus the explicit
  // separator-required structure catch both `+91 94909 73391` (15 chars, has
  // `+`) and `9876543210` (10 bare digits, no separator).
  const _DATE_SHAPE_FOR_KEYWORD_RE =
    /^(?:\d{1,4}|\d{1,4}[ /.\-]\d{1,4}(?:[ /.\-]\d{1,4})?)$/;

  function _isDateShapedForKeyword(matchText) {
    if (matchText.length > 10) return false;
    if (matchText.indexOf("+") !== -1) return false;
    return _DATE_SHAPE_FOR_KEYWORD_RE.test(matchText);
  }

  function isDateLike(matchText, text, matchIndex) {
    // Structural fast-path — separator-bearing forms (ISO 8601 / slash / dot / week / ordinal).
    for (const re of _DATE_STRUCTURAL_RES) {
      if (re.test(matchText)) return true;
    }
    // Compact 8-digit form — only suppress with month/day sanity check.
    if (/^\d{8}$/.test(matchText)) {
      const m = parseInt(matchText.slice(4, 6), 10);
      const d = parseInt(matchText.slice(6, 8), 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
    }
    // Windowed keyword fallback — gated on match shape so phone-shaped /
    // account-shaped numbers near "created"/"updated"/etc. are NOT suppressed.
    if (!_isDateShapedForKeyword(matchText)) return false;
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, matchIndex + matchText.length + 50);
    return _DATE_KEYWORD_RE.test(text.slice(start, end));
  }

  // Order / tracking / invoice / case / receipt / SKU / ISBN / ISSN /
  // episode keyword window — multilingual.
  const _ORDER_REF_RE =
    /\b(?:order|tracking|invoice|case|ticket|reference|confirmation|booking|receipt|sku|model|isbn|issn|episode|pedido|factura|recibo|seguimiento|caso|commande|facture|reçu|suivi|dossier|Bestellung|Rechnung|Quittung|Sendungsverfolgung|Fall|注文|請求書|領収書|追跡|チケット|订单|发票|收据|跟踪|工单|आदेश|बीजक|रसीद)\b/i;

  function isOrderRef(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, matchIndex + 50);
    return _ORDER_REF_RE.test(text.slice(start, end));
  }

  // Statistics keyword window — papers / reports / dashboards leak numbers
  // adjacent to `p<`, `n=`, `CI`, `SD`, `SE`, `R²`, `r=`, `cohort`,
  // `confidence interval`, `sample size`, etc. ±30-char window.
  const _STATS_RE =
    /\b(?:p\s*[<=>]|n\s*=|sample\s+size|cohort|CI|confidence\s+interval|95%|99%|SD|SE|σ|R²|R\^2|r\s*=)\b/i;

  function isStatistic(_matchText, text, matchIndex) {
    const start = Math.max(0, matchIndex - 30);
    const end = Math.min(text.length, matchIndex + 30);
    return _STATS_RE.test(text.slice(start, end));
  }

  // ── Cascade tiers (Phase 2) ──────────────────────────────────────────────
  // Cheap-to-expensive ordering — falsePositivesCheckCascade short-circuits
  // on the first tier that produces a hit. Tier boundaries are documented
  // cost contracts: structural is O(1) per check, keyword-large is O(window).
  const _CHECKS_STRUCTURAL = Object.freeze([
    isYear,
    isVersion,
    isHexColor,
    isYearRange,
    isPercentage,
    isScientificNotation,
  ]);
  const _CHECKS_TRAILING = Object.freeze([isMeasurement, isResolution]);
  const _CHECKS_PRECEDING = Object.freeze([isOrdinalLabel]);
  const _CHECKS_KEYWORD_50 = Object.freeze([isDateLike, isOrderRef, isStatistic]);
  const _CHECKS_KEYWORD_LARGE = Object.freeze([isPublicPrice, isCountNoise]);

  // Flat list preserved for back-compat (tests / aggressive profile).
  const FALSE_POSITIVE_CHECKS = Object.freeze({
    aggressive: [isVersion],
    precise: [
      ..._CHECKS_STRUCTURAL,
      ..._CHECKS_TRAILING,
      ..._CHECKS_PRECEDING,
      ..._CHECKS_KEYWORD_50,
      ..._CHECKS_KEYWORD_LARGE,
    ],
  });

  // Phase 2: explicit tier-by-tier cascade. Each tier short-circuits via
  // Array.some; the cascade short-circuits between tiers via `||`.
  // Behaviorally identical to running FALSE_POSITIVE_CHECKS.precise as a
  // single flat list; the tier shape signals cost contracts to readers and
  // gives Phase 3+ a hook to insert detector-specific tiers later.
  function falsePositivesCheckCascade(matchText, text, matchIndex) {
    return (
      _CHECKS_STRUCTURAL.some((fn) => fn(matchText, text, matchIndex)) ||
      _CHECKS_TRAILING.some((fn) => fn(matchText, text, matchIndex)) ||
      _CHECKS_PRECEDING.some((fn) => fn(matchText, text, matchIndex)) ||
      _CHECKS_KEYWORD_50.some((fn) => fn(matchText, text, matchIndex)) ||
      _CHECKS_KEYWORD_LARGE.some((fn) => fn(matchText, text, matchIndex))
    );
  }

  function falsePositivesCheck(matchText, text, matchIndex) {
    if (NUMERIC_PROFILE === "precise") {
      return falsePositivesCheckCascade(matchText, text, matchIndex);
    }
    const checks = FALSE_POSITIVE_CHECKS[NUMERIC_PROFILE] || [];
    return checks.some((fn) => fn(matchText, text, matchIndex));
  }

  return Object.freeze({
    NUMERIC_PROFILE,
    FALSE_POSITIVE_CHECKS,
    isYear,
    isVersion,
    isHexColor,
    isYearRange,
    isPercentage,
    isScientificNotation,
    isMeasurement,
    isResolution,
    isOrdinalLabel,
    isDateLike,
    isOrderRef,
    isStatistic,
    isPublicPrice,
    isCountNoise,
    falsePositivesCheck,
    falsePositivesCheckCascade,
  });
})();

blsi.PiiSuppressors = BlurrySitePiiSuppressors;
