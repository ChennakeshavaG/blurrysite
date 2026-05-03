/**
 * pii/pii_detectors.js — Pattern catalog + match finder.
 *
 * One generic descriptor type — `{ id, regex, checksum?, dispositive?,
 * countries?, keywordRe?, keywordWindow?, action, preScreen? }`. A single
 * `_runDescriptor` runner walks every descriptor in a list and emits/suppresses
 * matches according to the descriptor's gates. Adding a new detector is a
 * data-row change — no new code unless the detector needs a new checksum.
 *
 * Layers (executed inside `findMatches` when types.numeric is on):
 *
 *   Stage 1 — Dispositive detectors (shape-bound or shape+checksum).
 *     Card PAN, IBAN, ETH wallet, ISBN-13 (suppress), Aadhaar, CN ID,
 *     NRIC SG, CURP MX, Emirates ID, NIE ES, Codice Fiscale,
 *     UK / CA / NL / BR postal, US ZIP+4, Eircode IE, IPv6, GPS DMS,
 *     Plus Code. All have `dispositive: true`; `checksum` runs first
 *     when present.
 *
 *   Identifier-context sub-pass — `DISPOSITIVE_RES` (Bearer / AKIA / ghp_ /
 *     sk_/pk_ / AIza / xox- / JWT) + `PREFIX_RE` keyword-prefix value capture.
 *     Stays as bespoke logic — its capture-group semantics don't fit the
 *     generic descriptor.
 *
 *   Stage 2 — Context-gated detectors. Validators consult `PiiState.getCountry()`
 *     and/or keyword windows. MAC address, IPv4, IMEI, E.164 phone, SSN US,
 *     NHS UK, BSN NL, NPI US, DNI ES, ABN AU, MRN, Postal JP/AU.
 *
 *   Stage 3 — Generic NUMERIC_RE (7 alternations) + Stage 4 FP suppressors.
 *
 * All four layers share a per-call `consumed[]` overlap tracker. SUPPRESS
 * detectors (ISBN-13) push to `consumed[]` without emitting → Stage 3
 * bare-numeric overlap is dropped without blurring (anti-PII).
 *
 * Exposed as blsi.PiiDetectors (IIFE — no ES module syntax).
 */

const BlurrySitePiiDetectors = (() => {
  "use strict";

  // ── Regex patterns ───────────────────────────────────────────────────────
  // /g flag — findMatches retrieves cached instances via
  // blsi.PiiState.getCachedRegex so lastIndex is reset per call.

  // EMAIL: standard RFC-ish local@domain.tld
  const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  // NUMERIC: seven sub-patterns — see contract for ordering rationale.
  // Phone-form separator class is `[ \- ]` — ASCII space, hyphen-minus,
  // and U+00A0 NO-BREAK SPACE.
  const NUMERIC_RE = new RegExp(
    [
      "[$€£¥₹₩₿₺₨₱฿]\\s*\\d(?:[\\d,.' ]*\\d)?",
      "\\b\\d[\\d,.' ]*\\s*(?:USD|EUR|GBP|JPY|INR|BTC|ETH)\\b",
      "\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?\\b",
      "\\+?(?:\\d{1,3}[ \\-\\u00A0])?\\(\\d{1,4}\\)[ \\-\\u00A0]?\\s*\\d{2,}(?:[ \\-\\u00A0]\\d{2,})*",
      "\\+?\\d{1,3}(?:[ \\-\\u00A0]\\d{2,}){2,}",
      "\\b\\d{3,}(?:[ \\-\\u00A0]\\d{3,})+\\b",
      "\\b\\d{4,}\\b",
    ].join("|"),
    "g",
  );

  // ── Stage 1 regexes ─────────────────────────────────────────────────────

  // Card PAN — 13–19 digits with optional `[ \-]` between digits.
  const CARD_PAN_RE = /(?<![A-Za-z\d])(?:\d[ \-]?){11,18}\d(?![A-Za-z\d])/g;

  // IBAN — 2-letter country + 2-digit check + 11..30 alphanumeric body.
  const IBAN_RE = /(?<![A-Za-z\d])[A-Z]{2}\d{2}[A-Z0-9 \-]{11,42}(?![A-Za-z\d])/g;

  // ETH wallet — 0x + 40 hex chars.
  const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;

  // ISBN-13 — 978/979 prefix + dashed/spaced groups.
  const ISBN13_RE = /\b97[89][\- ]?\d[\- ]?\d{3}[\- ]?\d{5}[\- ]?\d\b/g;

  // Aadhaar — UIDAI 12-digit ID.
  const AADHAAR_RE = /\b[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}\b/g;

  // CN resident ID — 18 chars, 17 digits + check digit (0-9 or X).
  const CN_ID_RE = /\b\d{17}[\dXx]\b/g;

  // NRIC SG — letter prefix + 7 digits + check letter.
  const NRIC_SG_RE = /\b[STFGM]\d{7}[A-Z]\b/g;

  // CURP MX — 18-char positional: 4 letters (name initials) + 6 digits
  // (YYMMDD) + 1 [HM] (sex) + 2 letters (state) + 3 letters (consonants) +
  // 1 alphanumeric (homoclave; digit pre-2000, letter post-2000) + 1 digit
  // (check). Per RENAPO spec.
  const CURP_MX_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d\b/g;

  // Emirates ID — `784` prefix + 12 digits with hyphens.
  const EMIRATES_ID_RE = /\b784[ \-]?\d{4}[ \-]?\d{7}[ \-]?\d\b/g;

  // NIE ES — `[XYZ]` prefix + 7 digits + check letter (excludes vowels).
  const NIE_ES_RE = /\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b/g;

  // Codice Fiscale (IT) — 16-char positional alphanumeric.
  const CODICE_FISCALE_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;

  // Postal codes (Stage 1 — shape-dispositive on each country's unique form).
  const POSTAL_UK_RE =
    /\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b/g;
  const POSTAL_CA_RE =
    /\b[ABCEGHJ-NPR-TV-Z]\d[ABCEGHJ-NPR-TV-Z][ \-]?\d[ABCEGHJ-NPR-TV-Z]\d\b/g;
  const POSTAL_NL_RE = /\b[1-9]\d{3} ?[A-Z]{2}\b/g;
  const POSTAL_BR_RE = /\b\d{5}-\d{3}\b/g;
  const US_ZIP4_RE = /\b\d{5}-\d{4}\b/g;
  const EIRCODE_IE_RE =
    /\b[AC-FHKNPRTV-Y][0-9W][0-9 ][AC-FHKNPRTV-Y0-9]{4}\b/g;

  // IPv6 — full 8-group form + double-colon compressed form. Conservative
  // shape: requires at least one `:` and at least one hex digit on each side.
  const IPV6_RE =
    /\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b|\b(?:[0-9A-Fa-f]{1,4}:){1,7}:|\b(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}\b/g;

  // GPS coordinates — DMS form with hemisphere letter.
  const GPS_DMS_RE = /\b\d{1,3}°\d{1,2}['′]\d{1,2}(?:\.\d+)?["″]\s?[NSEW]\b/g;

  // Plus Code (Open Location Code).
  const PLUS_CODE_RE = /\b[2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,3}\b/g;

  // ── Stage 2 regexes ─────────────────────────────────────────────────────

  const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g;

  const IPV4_RE =
    /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

  const IMEI_RE = /\b\d{15}\b/g;

  // E.164 phone — `+` prefix dispositive. NBSP via ` ` escape.
  const E164_RE = new RegExp(
    [
      "\\+\\d{1,3}[ .\\-\\u00A0]?",
      "\\d[\\d .\\-\\u00A0]{6,14}\\d\\b",
    ].join(""),
    "g",
  );

  const SSN_US_RE =
    /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

  const NHS_UK_RE = /\b\d{3}[ \-]?\d{3}[ \-]?\d{4}\b/g;

  // BSN NL — 9 digits.
  const BSN_NL_RE = /\b\d{9}\b/g;

  // NPI US — 10 digits.
  const NPI_US_RE = /\b\d{10}\b/g;

  // DNI ES — 8 digits + check letter (excludes vowels).
  const DNI_ES_RE = /\b\d{8}[A-HJ-NP-TV-Z]\b/g;

  // ABN AU — 11 digits with optional spaces (2-3-3-3 grouping).
  const ABN_AU_RE = /\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g;

  // MRN — 4..10 digit medical record numbers (high FP without keyword).
  const MRN_RE = /\b\d{4,10}\b/g;

  // Postal JP — `〒` prefix optional; without it, requires JP country gate.
  const POSTAL_JP_RE = /(?:〒\s?)?\b\d{3}-\d{4}\b/g;

  // Postal AU — 4 digits (high FP without country/keyword gate).
  const POSTAL_AU_RE = /\b\d{4}\b/g;

  // ── IBAN country length table (ISO 13616 registry, 2024-12 snapshot). ──
  const _IBAN_LENGTHS = Object.freeze({
    AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28,
    BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28,
    CH: 21, CR: 22, CY: 28, CZ: 24,
    DE: 22, DK: 18, DO: 28,
    EE: 20, EG: 29, ES: 24,
    FI: 18, FO: 18, FR: 27,
    GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
    HR: 21, HU: 28,
    IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27,
    JO: 30,
    KW: 30, KZ: 20,
    LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25,
    MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
    NL: 18, NO: 15,
    PK: 24, PL: 28, PS: 29, PT: 25,
    QA: 29,
    RO: 24, RS: 22,
    SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
    TL: 23, TN: 24, TR: 26,
    UA: 29,
    VA: 22, VG: 24,
    XK: 20,
  });

  // ── Validators (Stage 1 + Stage 2) ───────────────────────────────────────

  function _classifyPan(d) {
    const len = d.length;
    if (len < 13 || len > 19) return null;
    const f1 = d[0];
    const f2 = +d.slice(0, 2);
    const f4 = +d.slice(0, 4);
    if (f1 === "4" && (len === 13 || len === 16 || len === 19)) return "visa";
    if (len === 16 && f2 >= 51 && f2 <= 55) return "mastercard";
    if (len === 16 && f4 >= 2221 && f4 <= 2720) return "mastercard";
    if (len === 15 && (f2 === 34 || f2 === 37)) return "amex";
    if (len === 16 && f4 === 6011) return "discover";
    if (len === 16 && f2 === 65) return "discover";
    if (len === 16 && f4 >= 6440 && f4 <= 6499) return "discover";
    if ((len === 14 || len === 16 || len === 19) &&
        (f2 === 36 || f2 === 38 || (f2 >= 30 && f2 <= 35))) return "diners";
    if (len >= 16 && len <= 19 && f4 >= 3528 && f4 <= 3589) return "jcb";
    if (len >= 16 && len <= 19 && f2 === 62) return "unionpay";
    return null;
  }

  function _checksumCardPan(matchText) {
    const digits = matchText.replace(/[ \-]/g, "");
    if (!/^\d{13,19}$/.test(digits)) return false;
    if (_classifyPan(digits) === null) return false;
    return blsi.PiiChecksums.luhn(digits);
  }

  function _checksumIban(matchText) {
    const stripped = matchText.replace(/[ \-]/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(stripped)) return false;
    const country = stripped.slice(0, 2);
    const expected = _IBAN_LENGTHS[country];
    if (!expected || stripped.length !== expected) return false;
    return blsi.PiiChecksums.mod97(stripped);
  }

  function _checksumIsbn13(matchText) {
    const digits = matchText.replace(/[ \-]/g, "");
    return blsi.PiiChecksums.isbn13(digits);
  }

  function _checksumAadhaar(matchText) {
    const digits = matchText.replace(/[ \-]/g, "");
    if (!/^\d{12}$/.test(digits)) return false;
    return blsi.PiiChecksums.verhoeff(digits);
  }

  function _checksumCnId(matchText) {
    return blsi.PiiChecksums.iso7064Mod11_2(matchText.toUpperCase());
  }

  function _checksumNhsUk(matchText) {
    const digits = matchText.replace(/[ \-]/g, "");
    if (!/^\d{10}$/.test(digits)) return false;
    const r = blsi.PiiChecksums.mod11Weighted(
      digits.slice(0, 9),
      [10, 9, 8, 7, 6, 5, 4, 3, 2],
    );
    if (r === -1) return false;
    let check = 11 - r;
    if (check === 11) check = 0;
    if (check === 10) return false;
    return check === digits.charCodeAt(9) - 48;
  }

  function _checksumBsnNl(matchText) {
    if (!/^\d{9}$/.test(matchText)) return false;
    // BSN 11-test: weights 9..2 on first 8 + weight -1 on the 9th. Sum mod 11
    // must be 0. Implement via mod11Weighted on first 8 digits + manual last.
    const r = blsi.PiiChecksums.mod11Weighted(
      matchText.slice(0, 8),
      [9, 8, 7, 6, 5, 4, 3, 2],
    );
    if (r === -1) return false;
    const last = matchText.charCodeAt(8) - 48;
    return (r - last) % 11 === 0;
  }

  function _checksumNpiUs(matchText) {
    // NPI Luhn variant: prefix `80840` + npi, then run Luhn over the 15-char
    // string. The prefix is the issuer-ID per ISO/IEC 7812.
    return blsi.PiiChecksums.luhn("80840" + matchText);
  }

  function _checksumImei(matchText) {
    return blsi.PiiChecksums.luhn(matchText);
  }

  // IPv4 — suppress private/loopback/link-local/multicast ranges.
  // Returns true when octets are valid AND public-routable.
  function _checksumIpv4Public(matchText) {
    const parts = matchText.split(".").map((s) => parseInt(s, 10));
    if (parts.length !== 4) return false;
    if (parts.some((p) => p < 0 || p > 255 || isNaN(p))) return false;
    if (parts[0] === 0) return false;
    if (parts[0] === 10) return false;
    if (parts[0] === 127) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] >= 224) return false;
    return true;
  }

  // ── Generic helpers ─────────────────────────────────────────────────────

  function _hasKeywordIn(re, text, start, end, window) {
    const win = window || 50;
    return re.test(
      text.slice(
        Math.max(0, start - win),
        Math.min(text.length, end + win),
      ),
    );
  }

  function _overlapsAny(consumed, start, end) {
    for (const range of consumed) {
      if (range[0] < end && start < range[1]) return true;
    }
    return false;
  }

  // ── Detector descriptors ────────────────────────────────────────────────
  //
  // Shape:
  //   id             — diagnostic label
  //   regex          — /g RegExp prototype; cached per call via PiiState
  //   checksum?      — (matchText, text, start) => bool; runs first when present
  //   dispositive?   — bool; if true skip country/keyword checks (shape +
  //                    optional checksum is enough)
  //   countries?     — string[]; ISO alpha-2 codes that bypass keyword check
  //   keywordRe?     — RegExp; tested against ±keywordWindow chars around the match
  //   keywordWindow? — number; default 50
  //   action         — 'emit' | 'suppress'
  //   preScreen?     — (text) => bool; cheap whole-text early-out
  //
  // Decision flow per match (see `_runDescriptor`):
  //   1. preScreen on whole text — early-out if false.
  //   2. consumed[] overlap check — skip if range already claimed.
  //   3. checksum (if any) — skip on fail.
  //   4. context gate: dispositive ? PASS : (country in countries) ? PASS
  //      : (keywordRe matches window) ? PASS : SKIP.
  //   5. push to consumed[]; emit/suppress per action.

  const STAGE1_DETECTORS = Object.freeze([
    Object.freeze({
      id: "card_pan",
      regex: CARD_PAN_RE,
      checksum: _checksumCardPan,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /\d{4}/.test(t),
    }),
    Object.freeze({
      id: "iban",
      regex: IBAN_RE,
      checksum: _checksumIban,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[A-Z]{2}\d{2}/.test(t),
    }),
    Object.freeze({
      id: "eth_wallet",
      regex: ETH_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf("0x") !== -1,
    }),
    Object.freeze({
      id: "isbn_13",
      regex: ISBN13_RE,
      checksum: _checksumIsbn13,
      dispositive: true,
      action: "suppress",
      preScreen: (t) => t.indexOf("978") !== -1 || t.indexOf("979") !== -1,
    }),
    Object.freeze({
      id: "e164_phone",
      regex: E164_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf("+") !== -1,
    }),
    Object.freeze({
      id: "aadhaar",
      regex: AADHAAR_RE,
      checksum: _checksumAadhaar,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /\d{4}/.test(t),
    }),
    Object.freeze({
      id: "cn_id",
      regex: CN_ID_RE,
      checksum: _checksumCnId,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /\d{17}/.test(t),
    }),
    Object.freeze({
      id: "nric_sg",
      regex: NRIC_SG_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[STFGM]\d/.test(t),
    }),
    Object.freeze({
      id: "curp_mx",
      regex: CURP_MX_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[A-Z]{4}\d{6}/.test(t),
    }),
    Object.freeze({
      id: "emirates_id",
      regex: EMIRATES_ID_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf("784") !== -1,
    }),
    Object.freeze({
      id: "nie_es",
      regex: NIE_ES_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[XYZ]\d/.test(t),
    }),
    Object.freeze({
      id: "codice_fiscale",
      regex: CODICE_FISCALE_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[A-Z]{6}\d{2}/.test(t),
    }),
    Object.freeze({
      id: "postal_uk",
      regex: POSTAL_UK_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[A-Z]\d/.test(t),
    }),
    Object.freeze({
      id: "postal_ca",
      regex: POSTAL_CA_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => /[A-Z]\d[A-Z]/.test(t),
    }),
    // postal_nl / postal_br / us_zip4 / eircode_ie moved to Stage 2 — their
    // shapes overlap with common non-PII patterns (`1024 MB`, `12345-678`
    // account numbers, phone-like `\d{5}-\d{4}`, version strings like
    // `V01A123`). Country gate restores precision; keyword window is the
    // backup signal.
    Object.freeze({
      id: "ipv6",
      regex: IPV6_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf(":") !== -1,
    }),
    Object.freeze({
      id: "gps_dms",
      regex: GPS_DMS_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf("°") !== -1,
    }),
    Object.freeze({
      id: "plus_code",
      regex: PLUS_CODE_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf("+") !== -1,
    }),
  ]);

  const STAGE2_DETECTORS = Object.freeze([
    Object.freeze({
      id: "mac_address",
      regex: MAC_RE,
      dispositive: true,
      action: "emit",
      preScreen: (t) => t.indexOf(":") !== -1 || t.indexOf("-") !== -1,
    }),
    Object.freeze({
      id: "ipv4",
      regex: IPV4_RE,
      checksum: _checksumIpv4Public,
      keywordRe:
        /\b(?:ip|ipv4|address|server|host|client|connect(?:ed|ion|ing|s)?|from)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d\.\d/.test(t),
    }),
    Object.freeze({
      id: "imei",
      regex: IMEI_RE,
      checksum: _checksumImei,
      keywordRe: /\b(?:imei|device(?:\s+id)?)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{15}/.test(t),
    }),
    Object.freeze({
      id: "ssn_us",
      regex: SSN_US_RE,
      countries: ["US"],
      keywordRe: /\b(?:ssn|social\s+security|social\s+sec)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{3}-\d{2}-\d{4}/.test(t),
    }),
    Object.freeze({
      id: "nhs_uk",
      regex: NHS_UK_RE,
      checksum: _checksumNhsUk,
      countries: ["GB"],
      keywordRe: /\b(?:nhs|national\s+health|patient)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{3}/.test(t),
    }),
    Object.freeze({
      id: "bsn_nl",
      regex: BSN_NL_RE,
      checksum: _checksumBsnNl,
      countries: ["NL"],
      keywordRe: /\b(?:bsn|burgerservicenummer|sofinummer)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{9}/.test(t),
    }),
    Object.freeze({
      id: "npi_us",
      regex: NPI_US_RE,
      checksum: _checksumNpiUs,
      keywordRe: /\b(?:npi|provider(?:\s+id)?|national\s+provider)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{10}/.test(t),
    }),
    Object.freeze({
      id: "dni_es",
      regex: DNI_ES_RE,
      countries: ["ES"],
      keywordRe: /\b(?:dni|d\.n\.i\.|documento\s+nacional)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{8}[A-Z]/.test(t),
    }),
    Object.freeze({
      id: "abn_au",
      regex: ABN_AU_RE,
      countries: ["AU"],
      keywordRe: /\b(?:abn|australian\s+business\s+number)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{2} ?\d{3}/.test(t),
    }),
    Object.freeze({
      id: "mrn",
      regex: MRN_RE,
      keywordRe:
        /\b(?:mrn|medical\s+record(?:\s+number)?|chart(?:\s+(?:no|number))?|patient(?:\s+(?:id|no|number))?)\b/i,
      keywordWindow: 50,
      action: "emit",
      preScreen: (t) => /\d{4}/.test(t),
    }),
    Object.freeze({
      id: "postal_jp",
      regex: POSTAL_JP_RE,
      countries: ["JP"],
      keywordRe: /〒|postal\s+code|郵便番号/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /\d{3}-\d{4}/.test(t) || t.indexOf("〒") !== -1,
    }),
    Object.freeze({
      id: "postal_au",
      regex: POSTAL_AU_RE,
      countries: ["AU"],
      keywordRe: /\b(?:postal|postcode|po\s+box|po\.?\s+box)\b/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /\d{4}/.test(t),
    }),
    Object.freeze({
      id: "postal_nl",
      regex: POSTAL_NL_RE,
      countries: ["NL"],
      keywordRe: /\b(?:postcode|postbus)\b/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /\d{4}/.test(t),
    }),
    Object.freeze({
      id: "postal_br",
      regex: POSTAL_BR_RE,
      countries: ["BR"],
      keywordRe: /\b(?:cep|c\.e\.p\.)\b/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /\d{5}-\d{3}/.test(t),
    }),
    Object.freeze({
      id: "us_zip4",
      regex: US_ZIP4_RE,
      countries: ["US"],
      keywordRe: /\b(?:zip|zipcode|zip\s+code|postal\s+code)\b/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /\d{5}-\d{4}/.test(t),
    }),
    Object.freeze({
      id: "eircode_ie",
      regex: EIRCODE_IE_RE,
      countries: ["IE"],
      keywordRe: /\b(?:eircode|eir\s+code)\b/i,
      keywordWindow: 30,
      action: "emit",
      preScreen: (t) => /[A-Z]\d/.test(t),
    }),
  ]);

  // ── Identifier-context detection (sub-pass inside types.numeric) ─────────

  const KEYWORDS = Object.freeze([
    "user[ _-]?id",
    "account[ _-]?id",
    "customer[ _-]?id",
    "employee[ _-]?id",
    "member[ _-]?id",
    "patient[ _-]?id",
    "tenant[ _-]?id",
    "org[ _-]?id",
    "device[ _-]?id",
    "session[ _-]?id",
    "request[ _-]?id",
    "trace[ _-]?id",
    "correlation[ _-]?id",
    "transaction[ _-]?id",
    "txn[ _-]?id",
    "client[ _-]?id",
    "client[ _-]?secret",
    "api[ _-]?key",
    "api[ _-]?secret",
    "access[ _-]?key",
    "access[ _-]?token",
    "refresh[ _-]?token",
    "private[ _-]?key",
    "public[ _-]?key",
    "verification[ _-]?code",
    "security[ _-]?code",
    "confirmation[ _-]?(?:code|no|number|id)",
    "serial[ _-]?(?:no|number)",
    "license[ _-]?(?:key|no|number)",
    "policy[ _-]?(?:no|number)",
    "ref[ _.\\-]?(?:no|num)",
    "authentication",
    "authorization",
    "verification",
    "confirmation",
    "credentials",
    "identifier",
    "membership",
    "reference",
    "passcode",
    "username",
    "password",
    "employee",
    "customer",
    "security",
    "license",
    "licence",
    "account",
    "session",
    "request",
    "private",
    "tracking",
    "invoice",
    "serial",
    "policy",
    "access",
    "secret",
    "bearer",
    "client",
    "member",
    "ticket",
    "token",
    "order",
    "auth",
    "cred",
    "pass",
    "user",
    "case",
    "uid",
    "emp",
    "acct",
    "num",
    "no",
    "key",
    "ref",
    "pwd",
    "pin",
    "otp",
    "database",
    "connection",
    "webhook",
    "endpoint",
    "dsn",
    "mongo",
    "redis",
    "postgres",
    "mysql",
    "smtp",
    "imap",
    "id",
  ]);

  const KEYWORD_ALT =
    "(?:" +
    [...KEYWORDS].sort((a, b) => b.length - a.length).join("|") +
    ")";

  const PREFIX_RE = new RegExp(
    "\\b" +
      KEYWORD_ALT +
      "\\b" +
      "\\s*[:=#\\-\\u2014]?\\s*" +
      "(?:is\\s+|of\\s+)?" +
      "[\"']?" +
      "([A-Za-z0-9][A-Za-z0-9._\\-]{3,63})" +
      "[\"']?",
    "gid",
  );

  // Single alternation — longer/more-specific prefixes first to prevent
  // shorter alternatives from winning at the same position.
  const DISPOSITIVE_RE = new RegExp(
    "\\b(?:" +
      "(?:Bearer|Basic)\\s+[A-Za-z0-9._\\-+/=]{20,}" +
      "|github_pat_[A-Za-z0-9_]{82}" +
      "|dckr_pat_[A-Za-z0-9_\\-]{20,}" +
      "|dop_v1_[a-f0-9]{64}" +
      "|sk-ant-[A-Za-z0-9_\\-]{90,}" +
      "|[sp]k_(?:live|test)_[A-Za-z0-9]{24,}" +
      "|glpat-[A-Za-z0-9_\\-]{20,}" +
      "|pypi-[A-Za-z0-9_\\-]{100,}" +
      "|AKIA[0-9A-Z]{16}" +
      "|AIza[A-Za-z0-9_\\-]{35}" +
      "|xox[bpoars]-[A-Za-z0-9\\-]{10,}" +
      "|eyJ[A-Za-z0-9_\\-]{10,}\\.[A-Za-z0-9_\\-]{10,}\\.[A-Za-z0-9_\\-]{10,}" +
      "|SG\\.[A-Za-z0-9_\\-]{22}\\.[A-Za-z0-9_\\-]{43}" +
      "|npm_[A-Za-z0-9]{36}" +
      "|ghp_[A-Za-z0-9]{36}" +
      "|sk-[A-Za-z0-9]{20,}" +
      "|AC[a-f0-9]{32}" +
      "|hf_[A-Za-z0-9]{34}" +
    ")\\b",
    "g",
  );

  function _validateValue(val) {
    if (val.length < 4) return false;
    if (!/[^a-zA-Z]/.test(val)) return false;
    if (/^(.)\1+$/.test(val)) return false;
    return true;
  }

  // ── Generic descriptor runner ───────────────────────────────────────────

  function _runDescriptor(text, det, matches, consumed) {
    if (det.preScreen && !det.preScreen(text)) return;
    const re = blsi.PiiState.getCachedRegex(det.regex);
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const advanceFallback = m[0].length === 0;
      if (_overlapsAny(consumed, start, end)) {
        if (advanceFallback) re.lastIndex++;
        continue;
      }
      // Step 1: checksum gate (always run if specified).
      if (det.checksum && !det.checksum(m[0], text, start)) {
        if (advanceFallback) re.lastIndex++;
        continue;
      }
      // Step 2: context gate — dispositive | country | keyword.
      let pass = !!det.dispositive;
      if (!pass && det.countries) {
        const c = blsi.PiiState.getCountry();
        if (c && det.countries.indexOf(c) !== -1) pass = true;
      }
      if (!pass && det.keywordRe) {
        pass = _hasKeywordIn(
          det.keywordRe,
          text,
          start,
          end,
          det.keywordWindow || 50,
        );
      }
      if (!pass) {
        if (advanceFallback) re.lastIndex++;
        continue;
      }
      consumed.push([start, end]);
      if (det.action === "emit") {
        matches.push({ start, end, type: "numeric" });
        blsi.PiiState.recordEmit();
      }
      if (advanceFallback) re.lastIndex++;
    }
  }

  function _runStage1(text, matches, consumed) {
    for (const det of STAGE1_DETECTORS) {
      _runDescriptor(text, det, matches, consumed);
    }
  }

  function _runStage2(text, matches, consumed) {
    for (const det of STAGE2_DETECTORS) {
      _runDescriptor(text, det, matches, consumed);
    }
  }

  function _runIdentifierPass(text, matches, consumed) {
    const r = blsi.PiiState.getCachedRegex(DISPOSITIVE_RE);
    let dm;
    while ((dm = r.exec(text)) !== null) {
      const start = dm.index;
      const end = dm.index + dm[0].length;
      if (!_overlapsAny(consumed, start, end)) {
        matches.push({ start, end, type: "numeric" });
        consumed.push([start, end]);
        blsi.PiiState.recordEmit();
      }
      if (dm[0].length === 0) r.lastIndex++;
    }

    const re = blsi.PiiState.getCachedRegex(PREFIX_RE);
    let m;
    while ((m = re.exec(text)) !== null) {
      const advanceFallback = m[0].length === 0;
      if (m.indices && m.indices[1]) {
        const start = m.indices[1][0];
        const end = m.indices[1][1];
        const value = m[1];
        if (
          _validateValue(value) &&
          !_overlapsAny(consumed, start, end)
        ) {
          matches.push({ start, end, type: "numeric" });
          consumed.push([start, end]);
          blsi.PiiState.recordEmit();
        }
      }
      if (advanceFallback) re.lastIndex++;
    }
  }

  const PATTERNS = Object.freeze({
    EMAIL: { regex: EMAIL_RE, label: "email" },
    NUMERIC: { regex: NUMERIC_RE, label: "numeric" },
  });

  function findMatches(text, types) {
    const matches = [];

    if (types.email && text.includes("@")) {
      const re = blsi.PiiState.getCachedRegex(EMAIL_RE);
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          type: "email",
        });
        blsi.PiiState.recordEmit();
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    if (types.numeric) {
      const consumed = [];
      const hasDigit = /\d/.test(text);

      if (hasDigit) _runStage1(text, matches, consumed);
      _runIdentifierPass(text, matches, consumed);
      if (hasDigit) _runStage2(text, matches, consumed);

      if (hasDigit) {
        const re = blsi.PiiState.getCachedRegex(NUMERIC_RE);
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = m.index;
          const end = start + m[0].length;
          const advanceFallback = m[0].length === 0;
          blsi.PiiState.recordCandidate();
          if (_overlapsAny(consumed, start, end)) {
            blsi.PiiState.recordSuppress();
            if (advanceFallback) re.lastIndex++;
            continue;
          }
          if (!blsi.PiiSuppressors.falsePositivesCheck(m[0], text, start)) {
            matches.push({ start, end, type: "numeric" });
            blsi.PiiState.recordEmit();
          } else {
            blsi.PiiState.recordSuppress();
          }
          if (advanceFallback) re.lastIndex++;
        }
      }
    }

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const filtered = [];
    let lastEnd = -1;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filtered.push(match);
        lastEnd = match.end;
      }
    }
    return filtered;
  }

  // Cross-node keyword check — matches a keyword + separator at the end of
  // preceding text. Used by the facade when a digit-only text node in its own
  // DOM element wasn't caught by the per-node findMatches (keyword is in a
  // sibling/parent element).
  const _KEYWORD_TRAIL_RE = new RegExp(
    KEYWORD_ALT +
      "\\s*[:=#\\-\\u2014]?\\s*$",
    "i",
  );

  function hasKeywordTrail(text) {
    return _KEYWORD_TRAIL_RE.test(text);
  }

  function getPatterns() {
    return PATTERNS;
  }

  return Object.freeze({
    EMAIL_RE,
    NUMERIC_RE,
    PATTERNS,
    STAGE1_DETECTORS,
    STAGE2_DETECTORS,
    findMatches,
    hasKeywordTrail,
    getPatterns,
  });
})();

blsi.PiiDetectors = BlurrySitePiiDetectors;
