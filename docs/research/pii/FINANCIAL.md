# FINANCIAL Amount PII — Research Document

Depth research for the `AUTO_DETECT.FINANCIAL` feature of the Blurry Site extension.
Companion to: `docs/RESEARCH_PII_DETECTION.md` (general PII overview).

---

## Section 1 — Sensitive vs. Non-Sensitive Financial Amounts

### The Core Design Question

Financial amounts are the only PII type where the *value itself* is not the secret — the *context* is.
`$12.50` on a restaurant menu is public. `$12.50` as a personal checking account balance is sensitive.
The number is identical. The detector cannot know which it is without context.

This is fundamentally different from SSN (`123-45-6789` is always private) or email (`user@example.com`
is always a personal identifier). Financial detection is inherently probabilistic.

### What SHOULD Be Detected (High Sensitivity Targets)

| Category | Example text | Why sensitive |
|---|---|---|
| Bank account balances | `Account Balance: $14,523.67` | Reveals personal wealth, account activity |
| Savings / checking balances | `Available Balance $8,200.00` | Same as above |
| Salary / compensation | `Annual Salary: $95,000` | Reveals income; can affect negotiations, relationships |
| Bonus / commission | `Q3 Bonus: $12,500` | Same as salary |
| Investment portfolio values | `Total Portfolio: $1,234,567.89` | Reveals personal net worth |
| Wire transfer amounts | `Wire Amount: $50,000.00` | Reveals financial transaction details |
| Tax figures (AGI, refund) | `Adjusted Gross Income: $123,456` | Reveals income, tax situation |
| Net worth figures | `Net Worth: $425,000` | Reveals financial standing |
| Mortgage principal / balance | `Outstanding Balance: $287,500` | Reveals debt level |
| Loan amounts | `Personal Loan: $15,000` | Reveals debt level |
| Brokerage holdings | `AAPL Position Value: $23,400` | Reveals personal investments |
| Credit line available | `Available Credit: $4,500` | Reveals personal credit access |
| 401(k) / pension balances | `Vested Balance: $87,650` | Reveals retirement savings |
| Invoice totals (B2B) | `Invoice Total: $34,500.00` | May reveal business finances |
| Payroll / pay stub totals | `Gross Pay: $4,166.67` | Reveals income |

### What Should NOT Be Detected (Low Sensitivity — False Positive Sources)

| Category | Example text | Why NOT sensitive |
|---|---|---|
| E-commerce product prices | `$29.99`, `$149.00`, `Add to cart – $49` | Public, listed intentionally |
| Subscription / SaaS prices | `$9.99/month`, `$99/year` | Public pricing |
| Restaurant / food prices | `Margherita Pizza $12.50` | Public menu |
| Shipping / delivery fees | `Shipping: $5.99` | Public, transactional |
| Stock share prices | `AAPL $185.42` | Public market data |
| Crypto spot prices | `BTC $67,234` | Public market data |
| Exchange rates | `1 USD = 0.92 EUR` | Public, not personal |
| News statistics | `$2.3B in Series C funding` | Public news fact |
| Government/public budgets | `Federal budget: $6.8 trillion` | Public information |
| Sports contracts (public) | `Contract: $300M over 10 years` | Public reporting |
| Airline / hotel prices | `Economy seat from $189` | Public pricing |
| Reward points as currency | `Redeem 5,000 pts = $50` | Not real currency |
| Mileage rates | `$0.655/mile reimbursement rate` | Public government rate |
| Historical prices in articles | `Gold hit $2,000/oz in 2020` | Public historical data |

### Is the Distinction Achievable Without Context?

**No — not reliably.**

The best a pure-regex approach can do is:
1. Raise the magnitude floor (e.g., only match > $1,000) — eliminates small prices but misses salaries
   that round to `$95,000` and also catches airline business-class fares `$1,200`
2. Require an explicit currency code suffix (`USD`, `EUR`) — raises precision but misses most real
   bank UI which uses symbol-only formatting (`$14,523.67`)
3. Use contextual label words near the amount — the most effective mitigation, detailed in Section 4

**Minimum viable approach recommendation**: Tier 1 from Section 9 — context-label-anchored detection.
Detect only when an explicit financial label word (balance, salary, portfolio, etc.) appears within
N characters before or after the amount. Default N = 100 chars. This achieves ~15–25% FP rate,
down from ~60%+ for a pure currency-symbol matcher.

---

## Section 2 — Format Taxonomy

### Currency Symbol Prefix

| Symbol | Currency | Notes |
|---|---|---|
| `$` | USD, CAD, AUD, HKD, SGD, NZD, MXN | Most ambiguous — which dollar? |
| `€` | EUR | Common in European financial UIs |
| `£` | GBP | UK / British pound sterling |
| `¥` | JPY / CNY | Yen and Yuan share symbol; no decimal in JPY |
| `₹` | INR | Indian Rupee; lakh/crore number format |
| `₩` | KRW | Korean Won; very large numbers (no decimals) |
| `₿` | BTC | Bitcoin; up to 8 decimal places |
| `₴` | UAH | Ukrainian hryvnia |
| `Fr` | CHF | Swiss Franc prefix; `Fr1'234.56` |
| `R$` | BRL | Brazilian Real; `R$1.234,56` |
| `kr` | SEK/DKK/NOK/ISK | Scandinavian prefix; `kr1.234,56` |
| `zł` | PLN | Polish złoty |
| `₺` | TRY | Turkish lira |
| `₦` | NGN | Nigerian naira |
| `₫` | VND | Vietnamese dong; very large numbers |

**Recommendation for Phase 1**: Cover `$€£¥₹₩₿₴`. This captures USD/EUR/GBP/JPY/INR/KRW/BTC/UAH.
Add `Fr` and `R$` in Phase 2 (multi-char prefixes need anchoring to avoid matching names like "Frank").

### Currency Code Suffix

Trailing ISO 4217 codes: `USD`, `EUR`, `GBP`, `JPY`, `INR`, `CAD`, `AUD`, `CHF`, `CNY`, `KRW`,
`BTC`, `ETH`, `USDT`.

These appear in:
- Bank statements: `1,000.00 USD`
- Forex tables: `142.35 JPY`
- API responses rendered in UI: `"amount": 50000, "currency": "USD"` (rendered as `50,000 USD`)

Code-suffix amounts typically appear in formal financial contexts, making them higher-precision targets.

### Number Format Variants

| Locale | Format | Example | Notes |
|---|---|---|---|
| US/UK | comma thousands, period decimal | `1,234,567.89` | Default assumption |
| European (DE/FR/IT/ES) | period thousands, comma decimal | `1.234.567,89` | `$1.234` is ambiguous — US $1.234 or EU €1,234 |
| Swiss | apostrophe thousands | `1'234'567.89` | Unique; apostrophe is safe anchor |
| Indian | lakh/crore | `1,23,456.78` | Group of 2 after first group of 3 |
| Japanese/Korean | no decimals | `1,234,567` | Symbol + no decimal point |
| No separator | bare | `1234567.89` | Riskiest — matches any number |

**Ambiguity case**: `$1.234` — in US format this is one dollar and 23.4 cents (unusual display).
In European context it's $1,234. The regex cannot know which locale applies without additional signals.

**Recommendation**: For the decimal separator, require either:
- comma thousands + period decimal (`1,234.56`) — US format, most common in English-language apps
- OR explicit currency code suffix (catches European format amounts)
- Skip bare numbers entirely (too noisy)

### Abbreviated Suffixes

| Suffix | Meaning | Example |
|---|---|---|
| `K` | Thousand | `$500K` = $500,000 |
| `M` | Million | `$1.2M` = $1,200,000 |
| `B` | Billion | `$2.5B` = $2,500,000,000 |
| `T` | Trillion | `$6.8T` (rare in personal finance) |
| `L` | Lakh (India) | `₹10L` = ₹1,000,000 |
| `Cr` | Crore (India) | `₹2.5Cr` = ₹25,000,000 |

Abbreviated amounts are common in:
- Investment dashboards: `Portfolio Value: $1.2M`
- Pay stubs with annual projections: `Annual: $95K`
- Summary cards: `Total Assets: $450K`

These are high-signal for financial context (news uses them too, but see FP analysis in Section 6).

### Negative Amounts

Financial statements commonly show losses / debits in negative form:
- Parentheses: `($1,234.56)` — US accounting convention
- Minus prefix: `-$1,234.56`
- Red color (CSS, not detectable by regex)

Parentheses form requires a separate regex branch. Negative numbers in losses are sensitive.

### Ranges

`$50,000 – $75,000` (salary range in job postings) — may contain two separate matches.
Both should be detected or neither; the range context is actually a signal (salary range).

---

## Section 3 — Regex Approaches

### Setup Note (from RESEARCH_PII_DETECTION.md)

All regexes must be reconstructed fresh per call (or cloned with `new RegExp(pattern.source, 'g')`)
to prevent `lastIndex` bleed on stateful `/g` patterns.

---

### Pattern A — Currency Symbol + Any Amount (Maximum Recall)

```javascript
// Matches: $29.99  €1,234.56  ¥500  ₹1,23,456  $1.2M  €2.5B
const FINANCIAL_A = /(?<![A-Za-z\d])[$€£¥₹₩₿₴]\s{0,2}(?:\d{1,3}(?:[,.\u2019']\d{2,3})*|\d+)(?:\.\d{1,2})?(?:\s?[KMBT](?:n|il(?:lion)?)?)?/g;
```

**Breakdown**:
- `(?<![A-Za-z\d])` — negative lookbehind prevents matching inside identifiers like `USD$value`
- `[$€£¥₹₩₿₴]` — currency symbol set
- `\s{0,2}` — optional space between symbol and number (`$ 1,234` is valid in some locales)
- `(?:\d{1,3}(?:[,.\u2019']\d{2,3})*|\d+)` — integer part: either grouped (1,234,567) or bare (1234)
- `(?:\.\d{1,2})?` — optional decimal (cents)
- `(?:\s?[KMBT]...)?` — optional abbreviation suffix

**FP rate**: Very high (~60–70%). Fires on every e-commerce price, every subscription fee,
every stock ticker widget, every currency mention in articles.

**FN rate**: Low (~5%). Misses: European format (`1.234,56`), parenthetical negatives, code-suffix-only.

**Performance**: Fast — single pass, no backtracking risk. No nested quantifiers.

**Backtracking risk**: Low. The alternation `(?:\d{1,3}...|\d+)` backtracks at most once per position.

**Verdict**: Too noisy to use alone. Baseline for recall measurement.

---

### Pattern B — Currency Symbol + Amount Above Threshold

Detection is done in two steps: (1) match with Pattern A, (2) extract numeric value and filter.

```javascript
const FINANCIAL_B_RE = /(?<![A-Za-z\d])([$€£¥₹₩₿₴])\s{0,2}((?:\d{1,3}(?:[,]\d{3})*|\d+)(?:\.\d{1,2})?)(\s?[KMBT])?/g;

function extractNumericValue(match) {
  // match[2] = number string, match[3] = suffix
  const raw = match[2].replace(/,/g, '');
  let val = parseFloat(raw);
  const suffix = (match[3] || '').trim().toUpperCase();
  if (suffix === 'K') val *= 1_000;
  else if (suffix === 'M') val *= 1_000_000;
  else if (suffix === 'B') val *= 1_000_000_000;
  else if (suffix === 'T') val *= 1_000_000_000_000;
  return val;
}

const MIN_AMOUNT_USD = 1000; // configurable
// filter: only keep matches where extractNumericValue(m) >= MIN_AMOUNT_USD
```

**FP rate with $1,000 threshold**: ~30–35% (flights, hotels, electronics, B2B software pricing
all regularly exceed $1,000. A MacBook Pro at $1,499 would fire).

**FP rate with $10,000 threshold**: ~15–20% (luxury goods, real estate listings, contractor quotes).

**FP rate with $100,000 threshold**: ~5–10% (mostly salaries in job listings, news articles about
large deals). But misses most personal balances under $100K.

**FN rate**: Moderate. Misses personal accounts under threshold (a college student's $2,400 balance
would not match at $10K threshold).

**Performance**: Two passes — regex match + numeric extraction. parseFloat per match is negligible.

**Verdict**: Useful as one signal among several. Best combined with context labels.

---

### Pattern C — Context-Anchored Regex (Lookahead/Lookbehind for Label Words)

```javascript
// Matches amounts preceded within ~80 chars by a financial label keyword.
// Implemented as a two-step in code (regex doesn't support variable-length lookbehind
// in all engines — JS ES2018 supports it but with performance caveats for large windows).
const LABEL_RE = /\b(?:balance|salary|income|compensation|portfolio|holdings|net\s+worth|transfer|deposit|withdrawal|payment\s+(?:amount|due)|tax|agi|adjusted\s+gross|gross\s+pay|net\s+pay|invoice|quote|estimate|credit\s+limit|available\s+credit|loan\s+(?:amount|balance)|mortgage|principal|vested|retirement|401[kK]|pension|bonus|commission|dividend|payout|wire|remittance|reimbursement|stipend|tuition|due\s+amount|outstanding\s+balance|account\s+balance|closing\s+balance|opening\s+balance|current\s+balance|minimum\s+(?:payment|due))\b/i;

function hasFinancialContext(textWindow) {
  return LABEL_RE.test(textWindow);
}
```

**Implementation**: For each text node, before applying Pattern A, extract a context window:
```javascript
function buildContextWindow(textNode, charsBefore, charsAfter) {
  const text = textNode.textContent;
  // Also check previous and next sibling text content
  const prev = textNode.previousSibling ? (textNode.previousSibling.textContent || '') : '';
  const next = textNode.nextSibling ? (textNode.nextSibling.textContent || '') : '';
  return prev.slice(-charsBefore) + text + next.slice(0, charsAfter);
}
```

**FP rate**: ~15–25% (news articles about company salaries, public pension fund reports,
news about bank balances — these contain label words + amounts but are public data).

**FN rate**: ~30–40% (many bank UI designs show the balance number without a nearby text label —
e.g., a large hero number on a dashboard card where the label is in a separate `<div>` that
is not a text sibling). This is the main weakness.

**Performance**: Two regex tests per text node (label scan + amount match). Label regex with
many alternations has linear cost. Should be negligible compared to DOM traversal.

**Backtracking risk**: The `\s+` inside alternations (`net\s+worth`, `gross\s+pay`) with alternation
could cause quadratic backtracking on adversarial input. Mitigate: anchor the `\b` on both sides.
No nested quantifiers, so actual risk is low.

**Verdict**: Best precision of pure-text approaches. Combine with Pattern A or B.

---

### Pattern D — Large Round-Number Heuristic

```javascript
// Matches amounts that are round numbers (multiples of 100, 1000, 10000)
// Rationale: salaries and balances tend to be round; prices tend to be .99 or .95
const FINANCIAL_D = /[$€£¥₹₩₿₴]\s{0,2}(\d{1,3}(?:,\d{3})*|\d+)(?:\.(?:00|50))?(?:\s?[KMB])?/g;
// Post-filter: value must be a round number (no cents, or exactly .00 or .50)
```

**Rationale**: E-commerce prices cluster at `.99`, `.95`, `.49`. Financial figures tend to be
exact (salary = `$95,000.00`, balance = `$14,523.67` — not round, but the `.00` form is common
for annual amounts).

**FP rate**: ~25–30%. Subscription prices (`$9.99/month` not matched), but annual subscriptions
often round (`$99.00/year` would fire). Not reliable enough alone.

**FN rate**: High (~40%). Account balances almost always have cents (`$14,523.67` is not round).
Salaries in job listings use round numbers (`$95,000`) — correct match. But real payroll statements
show exact cents.

**Verdict**: Useful as a secondary score factor, not as a primary filter. Best for Tier 2 scoring.

---

### Pattern E — Amount with Explicit Currency Code Suffix (High Precision)

```javascript
// Matches: 1,000.00 USD   50000 EUR   142.35 JPY
const FINANCIAL_E = /\b(\d{1,3}(?:[,]\d{3})*|\d+)(?:\.\d{1,4})?\s{1,3}(USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|CNY|KRW|BTC|ETH|USDT|MXN|BRL|ZAR|SGD|HKD|NOK|SEK|DKK)\b/gi;
```

**FP rate**: ~10–15%. Explicit ISO 4217 codes appear on forex pages (high FP there),
cryptocurrency exchanges (extreme FP), and financial news. But on personal banking portals,
`USD` suffixes are common and meaningful.

**FN rate**: ~50–60%. Most consumer bank UIs use symbol prefix only (`$14,523.67`), not code suffix.
Currency codes appear mainly in: wire transfer UIs, brokerage platforms, multi-currency accounts.

**Performance**: Fast. No lookbehind needed — the suffix acts as an anchor.

**Verdict**: High precision but low recall. Best used as an OR condition alongside a context-anchored
symbol pattern to boost recall on wire-transfer / brokerage UIs.

---

### Pattern F — Combination (Recommended Base Pattern)

Combines Pattern A (symbol) + Pattern C (context) + Pattern B (threshold) + Pattern E (code suffix):

```javascript
// Step 1: Match all currency amounts
const AMOUNT_RE = /(?<![A-Za-z\d])([$€£¥₹₩₿₴])\s{0,2}((?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?)(\s?[KMBT])?|(\b(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\s{0,3}(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|CNY|KRW|BTC|ETH)\b)/gi;

// Step 2: For each match, check context window for financial label words
// Step 3: OR apply numeric threshold ($1,000+)
// Accept match if: (has context label) OR (value >= threshold AND no price-context signals)
```

**FP rate (context OR threshold)**: ~20–30%
**FP rate (context AND threshold)**: ~5–10% (but high FN rate ~40%)
**FP rate (context label only, no threshold)**: ~15–25%

**Verdict**: Pattern F with context-label-only (no threshold) is the recommended Tier 1 approach.
Add threshold as secondary signal for Tier 2.

---

## Section 4 — Context Signals (Critical Section)

Financial amounts almost always appear near semantic label words. This is the key insight that
separates sensitive amounts from public prices.

### 4.1 Label Word Taxonomy

#### Tier A — Strong signals (almost always financial PII)

```
balance           account balance     available balance     current balance
closing balance   opening balance     outstanding balance   total balance
salary            annual salary       base salary           gross salary
net salary        take-home pay       gross pay             net pay
compensation      total compensation  base compensation
income            gross income        net income            adjusted gross
agi               taxable income      annual income
portfolio         total portfolio     portfolio value       holdings value
net worth         total net worth     estimated net worth
transfer amount   wire amount         wire transfer         remittance amount
deposit amount    withdrawal amount   transfer to/from
vested balance    retirement balance  401(k) balance        pension value
ira balance       roth balance        hsa balance
loan balance      outstanding loan    loan amount           principal balance
mortgage balance  home equity         heloc balance
credit limit      available credit    credit line
invoice total     amount due          balance due           amount owed
```

#### Tier B — Moderate signals (often financial PII, context-dependent)

```
payment           payment amount      total payment         minimum payment
minimum due       payment due
bonus             annual bonus        signing bonus         performance bonus
commission        earned commission
dividend          dividend payment    quarterly dividend
refund            tax refund          expected refund
reimbursement     expense reimbursement
stipend           monthly stipend
estimate          project estimate
quote             project quote       total quote
```

#### Tier C — Weak signals (sometimes financial, often not)

```
total             amount              value                 cost
price             fee                 charge                rate
budget            expense             spending
```

Tier C words alone should NOT trigger detection (too many false positives on pricing pages).
Only use Tier A and Tier B for context matching.

### 4.2 Look-Behind Window Approach

Scan N characters before (and optionally after) the matched amount for label words.

```javascript
const FINANCIAL_LABELS_RE = /\b(?:balance|salary|income|net\s+pay|gross\s+pay|compensation|portfolio|holdings|net\s+worth|transfer|deposit|withdrawal|wire|vested|retirement|401[kK]|pension|loan\s+(?:amount|balance)|mortgage|credit\s+limit|available\s+credit|invoice|amount\s+due|balance\s+due|amount\s+owed|bonus|commission|dividend|reimbursement|stipend|agi|adjusted\s+gross)\b/i;

function matchesFinancialContext(textNode, matchStart, windowSize) {
  const text = textNode.textContent;
  // Build context window: N chars before and N chars after
  const start = Math.max(0, matchStart - windowSize);
  const end = Math.min(text.length, matchStart + windowSize);
  const window = text.slice(start, end);
  return FINANCIAL_LABELS_RE.test(window);
}
```

**Window size tradeoffs**:
| Window (chars each side) | False positive rate | False negative rate | Notes |
|---|---|---|---|
| 30 | ~10% | ~45% | Too tight — misses label-amount on separate lines |
| 60 | ~15% | ~30% | Acceptable for short table rows |
| 100 | ~20% | ~20% | Balanced — catches most `<th>Balance</th><td>$14K</td>` patterns |
| 200 | ~25% | ~10% | Wider — catches summary cards but starts picking up article text |
| Whole text node | ~30% | ~5% | Full scan — catches max but risks paragraph-level contamination |

**Recommendation**: 100 chars each side for text within the same node.
For cross-element context (see 4.3), scan parent/sibling elements separately.

### 4.3 Parent Element Scan

When the amount is in a `<td>` or `<span class="value">`, the label is often in a sibling element.
The look-behind window within a single text node misses these.

```javascript
function hasFinancialContextElement(amountElement) {
  // Strategy 1: Check parent's textContent (entire row/card)
  const parent = amountElement.parentElement;
  if (parent && FINANCIAL_LABELS_RE.test(parent.textContent)) return true;

  // Strategy 2: Check grandparent (one level up — catches <tr> containing <th>+<td>)
  const grandparent = parent && parent.parentElement;
  if (grandparent && FINANCIAL_LABELS_RE.test(grandparent.textContent)) return true;

  return false;
}
```

**Performance**: `element.textContent` triggers a DOM property access but is already cached by
the browser's render tree. Not a reflow trigger. Cost is O(chars in subtree).

**Risk**: Over-broad scanning. If the grandparent is a large container (e.g., entire sidebar),
a label word anywhere in the sidebar would qualify any amount in it. Limit to max 500 chars
from ancestor text scan.

```javascript
function hasFinancialContextElement(amountElement) {
  const MAX_CONTEXT_CHARS = 500;
  const parent = amountElement.parentElement;
  if (!parent) return false;
  const parentText = parent.textContent.slice(0, MAX_CONTEXT_CHARS);
  if (FINANCIAL_LABELS_RE.test(parentText)) return true;
  const gp = parent.parentElement;
  if (!gp) return false;
  const gpText = gp.textContent.slice(0, MAX_CONTEXT_CHARS);
  return FINANCIAL_LABELS_RE.test(gpText);
}
```

### 4.4 Sibling Element Scan

For `<dt>/<dd>` definition lists and `<th>/<td>` table structures, a direct sibling scan is
more precise than ancestor text:

```javascript
function checkSiblings(amountSpan) {
  // Walk backward through previous siblings (look for label element)
  let sib = amountSpan.parentElement && amountSpan.parentElement.previousElementSibling;
  let depth = 0;
  while (sib && depth < 3) {
    if (FINANCIAL_LABELS_RE.test(sib.textContent)) return true;
    sib = sib.previousElementSibling;
    depth++;
  }
  return false;
}
```

This handles the canonical financial table pattern:
```html
<tr>
  <th>Account Balance</th>  <!-- sibling — label here -->
  <td>$14,523.67</td>       <!-- amount here -->
</tr>
```

### 4.5 CSS Class Heuristics

Many bank and finance apps use predictable class names. These are fragile (site-specific) but
can boost confidence when combined with other signals.

**Positive class signals** (amount element or ancestor):
- `balance`, `account-balance`, `acct-balance`
- `portfolio-value`, `portfolio-total`
- `net-worth`, `networth`
- `salary`, `compensation`
- `transfer-amount`, `wire-amount`
- `amount-due`, `balance-due`

```javascript
const FINANCIAL_CLASS_RE = /\bbalance|portfolio|net.?worth|salary|compensation|transfer.?amount|wire.?amount|amount.?due|balance.?due\b/i;

function hasFinancialClass(element) {
  // Check element and up to 3 ancestors
  let el = element;
  for (let i = 0; i < 4; i++) {
    if (!el) break;
    const cls = (el.className || '') + ' ' + (el.id || '');
    if (FINANCIAL_CLASS_RE.test(cls)) return true;
    el = el.parentElement;
  }
  return false;
}
```

**Risk**: Brittle. `balance` appears in `work-life-balance`, `color-balance`, etc. Use `\bbalance\b`
word boundary carefully.

**Improvement**: Test specifically for hyphenated patterns that are common in component frameworks:
`balance-amount`, `salary-field`, `portfolio-value`.

### 4.6 Schema.org / Microdata

Structured data in HTML provides unambiguous context signals when present.

**Signals that indicate financial PII**:
- `itemprop="accountBalance"` — schema.org BankAccount
- `itemprop="amount"` inside a `schema:MoneyTransfer`
- `data-field="balance"`, `data-field="salary"` (non-standard but common in SPA frameworks)

**Signals that indicate public pricing** (should suppress detection):
- `itemprop="price"` — schema.org Product/Offer
- `itemprop="priceCurrency"` — same context

```javascript
function hasSchemaOrgSuppression(element) {
  // If any ancestor has itemprop="price", this is a product price — suppress
  let el = element;
  while (el) {
    const prop = el.getAttribute('itemprop');
    if (prop === 'price' || prop === 'priceCurrency') return true;
    el = el.parentElement;
  }
  return false;
}

function hasSchemaOrgFinancial(element) {
  let el = element;
  while (el) {
    const prop = el.getAttribute('itemprop');
    if (prop === 'accountBalance') return true;
    el = el.parentElement;
  }
  return false;
}
```

**Coverage**: Low (~2–5% of pages use schema.org). But when present, it's zero-FP signal.
Worth including as a bonus signal — when `itemprop="price"` is found, suppress the match.

### 4.7 Context Signal Scoring Summary

| Signal | Precision gain | Performance cost | Notes |
|---|---|---|---|
| Look-behind window (100 chars) | High | Negligible | Primary signal |
| Parent element text scan | Medium-High | Low | Essential for table/card layouts |
| Sibling element scan | High | Low | Best for `<th>/<td>`, `<dt>/<dd>` |
| CSS class heuristics | Medium | Low | Fragile but zero extra DOM cost |
| Schema.org suppression | Very high (when found) | Very low | Rare but reliable |
| Numeric threshold | Medium | Negligible | Catches cases with no label |

---

## Section 5 — DOM-Specific Challenges

### 5.1 Financial Table Rows

The canonical bank statement layout:

```html
<table class="account-summary">
  <tr>
    <th>Account Balance</th>
    <td class="balance-value">$14,523.67</td>
  </tr>
  <tr>
    <th>Available Balance</th>
    <td>$12,000.00</td>
  </tr>
</table>
```

**Challenge**: The label (`Account Balance`) and the amount (`$14,523.67`) are in separate text nodes
inside separate elements. The TreeWalker processes them independently. When the walker reaches
`$14,523.67`, the lookbehind window within that text node contains no label.

**Solution**: Sibling element scan (Section 4.4). When processing the text node inside `<td>`,
check the previous `<th>` in the same `<tr>` for label keywords. This is the most reliable pattern.

**Implementation note**: After wrapping the text node in `<span data-bl-si-pii="FINANCIAL">`,
the element passed to context checks is the `<span>`, not the original text node. The parent
chain is: `span → td → tr → table`. The sibling `<th>` is `span.parentElement.previousElementSibling`.

### 5.2 Dashboard Cards

SPA-style financial dashboard components:

```html
<div class="card balance-card">
  <span class="card-label">Total Portfolio Value</span>
  <span class="card-value">$1,234,567</span>
  <span class="card-change">+$12,345 today</span>
</div>
```

**Challenge**: Label and value are siblings, not text-siblings within the same node.

**Solution**: Ancestor text scan — `card-value`'s grandparent (`div.card`) contains both label and
value text. `grandparent.textContent` includes `Total Portfolio Value $1,234,567` which matches
the label regex.

**Performance note**: `grandparent.textContent` is the full card text. Keep ancestor scan shallow
(max 2 levels) and cap at 500 chars.

### 5.3 JSON Embedded in HTML

```html
<script type="application/json">{"balance": 14523.67, "currency": "USD"}</script>
<script type="application/ld+json">{"@type": "BankAccount", "accountBalance": {"@type": "MonetaryAmount", "value": 14523.67}}</script>
```

**Challenge**: These are `<script>` tags, not text nodes visited by the TreeWalker.

**Decision**: Skip for Phase 1. The `SKIP_TAGS` set in `RESEARCH_PII_DETECTION.md` already excludes
`SCRIPT`. JSON-embedded amounts are not rendered visible to the user anyway — the rendered DOM
will have a separate display element if the app renders the value.

**Edge case**: Server-side-rendered pages may inline JSON data that is also displayed. In these
cases the value appears in both the `<script>` block and a display `<span>` — the display `<span>`
will be caught normally.

### 5.4 SVG Text Nodes

```html
<svg class="balance-chart">
  <text x="10" y="50" class="y-axis-label">$14,000</text>
  <text x="10" y="100">$12,000</text>
</svg>
```

**Challenge**: SVG `<text>` elements contain text nodes. The TreeWalker with `NodeFilter.SHOW_TEXT`
does visit these. CSS `filter: blur()` on SVG text nodes has inconsistent behavior across browsers —
blur on SVG content requires the SVG filter element, which `blur_engine.js` already handles via
`ensureSvgFilter()`.

**PII in SVG text**: Chart axis labels showing dollar amounts are typically aggregated/rounded data,
not personally identifying. But a balance graph's Y-axis labels showing exact balance values could
be sensitive.

**Recommendation**: Include SVG text nodes in the scan (they are visited naturally by TreeWalker
when `root` is the document). But apply a higher context-signal threshold for SVG text — require
both a label match AND amount >= $1,000 to avoid blurring chart axis labels.

**Implementation**: Check `textNode.parentElement.closest('svg')` to identify SVG context.

### 5.5 Amounts in Input Fields

```html
<input type="text" value="$14,523.67" placeholder="Account balance">
<input type="number" value="95000">
```

**Challenge**: `<input>` and `<textarea>` are in `SKIP_TAGS` — the TreeWalker skips them.
Input values are not text nodes; they're DOM properties.

**Decision**: Out of scope for Phase 1 (same as all other PII types). See `RESEARCH_PII_DETECTION.md §8`.

**Important exception**: The PLACEHOLDER text of an input (`placeholder="Current Balance: $14,523"`)
IS in an attribute, also not a text node. Skip.

### 5.6 Multi-Currency Forex / Crypto Pages

```html
<!-- A currency conversion widget -->
<div class="rates-table">
  <div>USD/EUR: <span>$1.08</span></div>
  <div>USD/GBP: <span>$1.27</span></div>
  <!-- 100+ rows of exchange rates -->
</div>
```

**Challenge**: Every row contains a currency symbol + amount. Even with a `$1,000` threshold,
crypto exchange pages show values like `BTC $67,234` that would fire. At threshold `$10,000`,
many portfolio rows on crypto exchanges still match.

**Context signals failure**: The word "rate" appears near amounts, but "rate" is a Tier C weak
signal. "USD/EUR" does not contain a Tier A financial label.

**Recommended handling**: Detect forex/crypto page patterns by hostname or page-level signals
before running the walker:
```javascript
const FOREX_HOSTNAMES = /\b(?:forex|crypto|exchange|coinbase|binance|kraken|tradingview|fx|oanda)\b/i;
if (FOREX_HOSTNAMES.test(location.hostname)) {
  // Disable FINANCIAL detection or require Tier A labels only
}
```

This is a practical mitigation. Not in scope for the initial regex design, but document as a
known limitation.

### 5.7 Abbreviated Values in Context

`$1.2M` in an article: `"The startup raised $1.2M in seed funding."`
`$1.2M` in a portfolio: `"Total Holdings: $1.2M"`

Both use the same format. Context signals differentiate them:
- Article: "raised ... in seed funding" — no Tier A label near the amount
- Portfolio: "Total Holdings" — Tier B signal (moderate), "holdings" specifically is Tier A

The abbreviated form `$1.2M` does trigger a large-amount threshold filter, but $1.2M seed rounds
are public news. Context label is the required discriminator here.

### 5.8 Parenthetical Negative Amounts

```html
<td class="loss">(</td><td>$1,234.56</td><td>)</td>
```

Or more commonly in the same text node:
```
Net Income: ($12,500.00)
```

The parenthesis convention for debits/losses is a specific financial accounting format. Its presence
is a strong signal that the context is a formal financial statement.

```javascript
// Negative parenthetical amount pattern
const FINANCIAL_NEG_RE = /\([$€£¥₹₩₿₴]\s{0,2}(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\)/g;
```

This pattern almost never appears in e-commerce or news contexts — it is a strong high-precision
indicator of accounting/financial data. Include as a high-confidence match (no threshold needed).

---

## Section 6 — False Positive Analysis

### 6.1 E-Commerce Product Pages

**Page type**: Amazon, eBay, Shopify storefronts, electronics retailers.

**What fires**: Every product price (`$29.99`, `$1,499.00`), subtotals (`$3,241.47`),
shipping costs, sales/promotions.

**Scale**: A product listing page has 20–100+ prices visible.

**Context signals**: No Tier A labels. "Price" and "Cost" are Tier C only.
Price elements often have `itemprop="price"` — schema.org suppression applies.

**Mitigation effectiveness**: 
- Context-label approach: ~80% reduction (price elements lack label words)
- `itemprop="price"` suppression: ~50% coverage of structured retailers (Amazon uses it)
- Threshold ($1,000): Only eliminates cheap items; MacBook Pro `$1,499` still fires

**Residual FP risk**: Electronics price pages. An RTX 4090 GPU at `$1,599` with no schema.org
markup, on a page with no Tier A labels = fired incorrectly.

**Recommended mitigation**: URL pattern. Pages with `cart`, `shop`, `product`, `store`, `buy`
in the URL path are likely e-commerce. Apply extra-conservative threshold ($5,000) or require
both label AND threshold.

### 6.2 SaaS / Subscription Pages

**Page type**: Pricing pages for software products (`/pricing`, `/plans`).

**What fires**: Monthly/annual pricing, feature-gated plans (`$9.99/mo`, `$99/year`, `$500/month`).

**Context signals**: Words like "plan", "per month", "per user" — none are Tier A labels.
Threshold: Most SaaS prices are under $500/month ($6,000/year). A $1,000 threshold misses most
but catches enterprise tiers.

**Mitigation**: "per month" and "per user" suppressors. Add to a suppression list:
```javascript
const PRICE_SUPPRESSORS_RE = /\bper\s+(?:month|mo|year|yr|user|seat|license|device)\b|\b\/(?:mo|yr|month|year|user)\b|\bmonthly\b|\bannually\b/i;
```
If this pattern appears within 50 chars of an amount, suppress the match.

### 6.3 News Articles with Financial Statistics

**Page type**: Financial news (Bloomberg, Reuters, CNBC), general news with economic statistics.

**What fires**: Deal sizes (`The company raised $50M`), revenue figures (`Q3 revenue: $4.2B`),
economic data (`GDP: $25 trillion`).

**Context signals**: "revenue" is a moderate signal but refers to corporate data, not personal.
"raised", "funding", "budget" are not Tier A. Most problematic: `$50M` fundraise rounds use
the word "investment" (a Tier A word!) near the amount.

**Mitigation failure case**: "The company's investment portfolio grew by $50M" — fires correctly
but this is news about a company, not personal data.

**Assessment**: News articles are a known-hard case. Cannot reliably distinguish personal vs.
corporate financial data from text alone. Document as limitation.

### 6.4 Restaurant / Food Delivery Apps

**Page type**: DoorDash, Uber Eats, OpenTable, Yelp.

**What fires**: Menu item prices (`$12.50`, `$8.99`), order totals (`Total: $47.83`),
delivery fees (`Delivery: $3.99`).

**Context signals**: "Total" is Tier C. "Delivery" is not a financial label.
However, "Order Total" and "Payment Due" are borderline Tier B.

**Mitigation**: Amounts under `$100` are almost never personal financial PII. The $100 threshold
eliminates most restaurant prices. Occasional high-end restaurant bill may be `$250+` but this
is a publicly-visible receipt, not private financial data.

**Residual FP**: Order totals on food apps (e.g., a catered office lunch `$450 total`).

### 6.5 Stock Quote Widgets

**Page type**: Finance portals (Yahoo Finance, Google Finance), brokerage dashboards.

**What fires**: Share price (`AAPL $185.42`), volume (`$2.3B traded today`), market cap (`$2.9T`).

**Context signals**: "Price" (Tier C), "Market Cap" (not Tier A), "Volume" (not Tier A).
However, on a brokerage dashboard, "Position Value" and "Today's Gain" ARE Tier A signals.

**Key distinction**: Stock quote widgets (public data) vs. personal brokerage holdings (private).
A stock price feed is public; a personal position value is private.

**Mitigation**: On brokerage account pages, both types of amounts appear. The personal position
values (`Position: $23,400`) have label words; the public prices (`AAPL $185.42`) may not.

**Assessment**: Brokerage pages are the hardest case — they contain both public and private amounts
interleaved. Context labels provide partial help (personal position labels are present), but
some false positives on public prices within the same UI are unavoidable.

### 6.6 Cryptocurrency Exchange Pages

**Page type**: Coinbase, Binance, Kraken, Uniswap.

**What fires**: Everything — every trading pair, order book price, balance, P&L, fee.
These pages have hundreds of `$` and `BTC`/`ETH` amounts.

**Assessment**: Cryptocurrency exchanges are a category where FINANCIAL detection should be
explicitly suppressed or where only very-high-confidence matches (balance label + amount +
large threshold) should fire. The volume of legitimate balances mixed with public prices makes
precision very difficult.

**Recommendation**: For crypto exchanges, require ALL THREE: Tier A label + amount ≥ $1,000 +
no price suppressor. Or: user explicitly opts into crypto page detection (separate setting).

### 6.7 Government / Public Data Pages

**Page type**: IRS.gov, Treasury.gov, CBO reports, Wikipedia economic articles.

**What fires**: Budget figures (`$6.8 trillion`), grant amounts, public expenditures.

**Context signals**: "Budget", "appropriation", "expenditure", "grant" — these are not Tier A
personal finance labels (they're government/corporate).

**Mitigation**: The amounts are typically huge (billions/trillions), far above personal finance
range. A threshold of `$10,000` catches most personal balances while letting trillion-dollar
figures trigger — paradoxically. But billion-dollar government figures are public and unneeded.

**Assessment**: Difficult. "Federal Reserve Balance Sheet: $8.9 trillion" contains "Balance Sheet"
which would match "balance". Cannot easily distinguish "Federal Reserve's balance" from
"my account balance" purely from text.

**Recommendation**: Cap threshold at `$10 million` for context-matched amounts — personal finances
rarely exceed $10M in web UIs. Above that, amounts are almost certainly institutional/public.

### 6.8 Footnotes and Disclaimers

```
(1) All amounts in thousands of USD.
Note: Figures are pre-tax.
*Salary figures are approximate.
```

**Challenge**: These contain the word "amounts" and "salary" near dollar signs, but the sentence
is descriptive, not an actual financial value.

**Mitigation**: The regex requires a currency symbol or code adjacent to a number. Descriptive
text like "amounts in thousands" does not contain an actual dollar figure unless the disclaimer
line itself has one (e.g., `Minimum balance: $1,000` in a footnote — correct detection).

### 6.9 Sports Contracts (Public Info)

**Page type**: ESPN, sports news, Wikipedia.

**What fires**: "Contract value: $300M over 10 years", "Salary cap hit: $45M", "Signing bonus: $20M".

**Context signals**: "Salary" and "bonus" ARE Tier A labels. These would correctly fire.

**Assessment**: Sports contracts are public information, but the detection would fire correctly
from a text-classification standpoint (the text pattern is identical to private salary data).
This is an unavoidable FP for the Tier 1 approach — it requires understanding that the entity
is a celebrity athlete, not a private individual.

**Recommended handling**: Document as known limitation. The probability that a user is viewing
a sports contract page is high; they can disable FINANCIAL detection on sports sites using
the extension's per-site settings.

### 6.10 Mortgage Calculator / Loan Estimator Tools

**Page type**: Bank mortgage calculators, Zillow, NerdWallet, LendingTree.

**What fires**: Estimated monthly payment (`$2,340/month`), loan amount (`Loan Amount: $450,000`),
total interest (`Total Interest: $287,450`).

**Context signals**: "Loan Amount", "Monthly Payment", "Total Interest" ARE Tier A labels.
These are sensitive financial figures, but in a public calculator they represent hypothetical
estimates, not actual account data.

**Assessment**: The figures in a mortgage calculator ARE financially sensitive even if hypothetical
— they reveal the user's intended purchase amount, budget, and financial situation. This is
a CORRECT detection, not a false positive.

---

## Section 7 — Threshold-Based Filtering

### 7.1 Amount Bands

| Band | Range | Personal finance likelihood | E-commerce likelihood | Recommendation |
|---|---|---|---|---|
| Under $10 | `< $10` | Negligible | Very High (cheap items) | Always skip |
| $10–$100 | `$10–$100` | Low | High (most consumer goods) | Skip unless Tier A label present |
| $100–$1,000 | `$100–$1K` | Medium | Medium (electronics, subscriptions) | Require Tier A label |
| $1,000–$10,000 | `$1K–$10K` | High | Low (high-end goods, premium services) | Allow with Tier B label |
| $10,000–$1,000,000 | `$10K–$1M` | Very High | Very Low | Allow with any currency symbol |
| Over $1,000,000 | `> $1M` | Moderate | Negligible | Require context (may be news/corporate) |
| Over $100,000,000 | `> $100M` | Very Low | Negligible | Cap — likely institutional/public |

### 7.2 Extracting Numeric Value

```javascript
function extractAmount(symbolMatch, numberStr, suffixChar) {
  // numberStr: "1,234.56" or "1234" — strip commas
  const raw = numberStr.replace(/,/g, '');
  let val = parseFloat(raw);
  if (isNaN(val)) return 0;
  const sfx = (suffixChar || '').trim().toUpperCase();
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  if (multipliers[sfx]) val *= multipliers[sfx];
  return val;
}
```

**Performance**: `parseFloat` + `replace` is ~10–50 nanoseconds per call. Negligible even at
1000 matches per page scan. No concern.

### 7.3 Dynamic Threshold Strategy

Rather than a single fixed threshold, score each match:

```javascript
function scoreMatch(amount, hasContextLabel, hasSuppressor, hasPriceSchema) {
  if (hasPriceSchema) return 0;      // itemprop="price" — suppress
  if (hasSuppressor) return 0;       // "per month", "per user" — suppress
  
  let score = 0;
  if (hasContextLabel) score += 60;  // Tier A label: primary signal
  if (amount >= 10000) score += 20;  // Large amount
  if (amount >= 1000) score += 10;
  if (amount < 10) score -= 50;      // Tiny amount — almost certainly a price
  if (amount < 100) score -= 20;
  
  return score;
}

const SCORE_THRESHOLD = 60;  // Matches with score >= 60 are flagged
```

This allows small amounts to be flagged when a strong label is present (`Balance: $47.52`)
while suppressing large amounts without context (a $1,500 product price).

### 7.4 Currency Conversion for Multi-Currency

The threshold is expressed in USD. For non-USD currencies, approximate conversion is needed
to apply the threshold meaningfully.

**Problem**: Accurate conversion requires live FX rates (not available in a browser extension
with no network access during content scan).

**Solution**: Use rough static multipliers for relative magnitude:
```javascript
const ROUGH_USD_EQUIVALENTS = {
  '$': 1, '€': 1.1, '£': 1.3, '¥': 0.007, '₹': 0.012,
  '₩': 0.00075, '₿': 67000, '₴': 0.026
};
function normalizeToUSD(amount, symbol) {
  return amount * (ROUGH_USD_EQUIVALENTS[symbol] || 1);
}
```

**Accuracy**: Only used for threshold filtering (rough magnitude), not for display. A 30%
error in the rough rate doesn't matter — we're checking orders of magnitude, not exact values.

---

## Section 8 — All Solutions Matrix

| Approach | FP Rate (e-commerce) | FP Rate (news) | FP Rate (brokerage) | FN Rate | Performance | Complexity |
|---|---|---|---|---|---|---|
| Disabled (no detection) | 0% | 0% | 0% | 100% | 0 | 0 |
| Pattern A alone (symbol+any amount) | 95% | 60% | 80% | 5% | Negligible | Low |
| Pattern A + $1K threshold | 40% | 35% | 60% | 25% | Negligible | Low |
| Pattern A + $10K threshold | 15% | 20% | 40% | 50% | Negligible | Low |
| Pattern A + Tier A context label | 15% | 25% | 30% | 30% | Low | Medium |
| Pattern A + context + $1K threshold | 10% | 15% | 25% | 40% | Low | Medium |
| Pattern A + context + $10K threshold | 5% | 8% | 15% | 60% | Low | Medium |
| Pattern E alone (code suffix) | 5% | 10% | 20% | 60% | Negligible | Low |
| Pattern F (symbol OR code) + context | 12% | 20% | 28% | 20% | Low | Medium |
| Pattern F + context + suppressors | 8% | 12% | 22% | 25% | Low | Medium-High |
| Pattern F + context + score model | 6% | 10% | 18% | 28% | Low | High |
| Parenthetical negative only | 0.5% | 0.5% | 5% | 85% | Negligible | Low |

**Notes on "brokerage" FP rate**: Brokerage pages are the hardest case because they contain both
public prices (stock quotes) and private amounts (position values) on the same page. The FP rate
for brokerage refers to false positives against public stock quote prices, not personal holdings.

**Verdict**: "Pattern F + context + suppressors" at ~8% e-commerce FP and ~25% FN represents
the best balance for a default-off feature. The 25% FN rate means some personal financial amounts
are missed — acceptable for a feature that is supplementary (users can manually blur missed items).

---

## Section 9 — Recommended Approach

### Three-Tier Design

#### Tier 1 — Safe (Recommended Default)

**Trigger**: Tier A context label within 100 chars (text node or ancestor/sibling element) AND
currency symbol/code present.

**Threshold**: No amount threshold. A `Balance: $47.52` on a bank page should still be caught.

**Suppressors**: Suppress if `itemprop="price"` ancestor found, or if "per month/year/user" found
within 50 chars.

**Estimated metrics**:
- E-commerce FP rate: ~8% (some sites with "Total" Tier C words near prices)
- News FP rate: ~12% (salary/bonus news articles that name the individual)
- Brokerage FP rate: ~25% (public prices on brokerage pages)
- Personal finance pages FN rate: ~20% (dashboard values without nearby label text)

**When to use**: Default when user enables `AUTO_DETECT.FINANCIAL = true`.

**Regex core**:
```javascript
// Step 1: Find all currency amounts
const AMOUNT_RE = /(?<![A-Za-z\d])([$€£¥₹₩₿₴])\s{0,2}((?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?)(\s?[KMBT])?|(\b(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\s{1,3}(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|CNY|KRW|BTC|ETH)\b)/gi;

// Step 2: For each match, evaluate context
const TIER_A_LABELS_RE = /\b(?:balance|salary|income|net\s+pay|gross\s+pay|compensation|portfolio|holdings?|net\s+worth|transfer\s+amount|wire|deposit\s+amount|withdrawal|vested|retirement|401[kK]|ira|pension|loan\s+(?:amount|balance)|mortgage|principal|credit\s+limit|available\s+credit|invoice\s+total|amount\s+due|balance\s+due|amount\s+owed|bonus|commission|dividend|reimbursement|stipend|agi|adjusted\s+gross|closing\s+balance|opening\s+balance|outstanding\s+balance)\b/i;

const PRICE_SUPPRESSOR_RE = /\bper\s+(?:month|mo\.?|year|yr\.?|user|seat|license|device|unit)\b|\b\/(?:mo|yr|month|year|user|seat)\b|\bmonthly\b|\bannually\b|\bsubscription\b/i;
```

#### Tier 2 — Moderate

**Trigger**: (Tier A OR Tier B context label within 150 chars) AND amount >= $1,000.

**Suppressors**: Same as Tier 1 plus `itemprop="price"`, "starting from", "as low as".

**Estimated metrics**:
- E-commerce FP rate: ~15% (electronics, travel)
- News FP rate: ~20% (deals, salary articles)
- Personal finance FN rate: ~35% (misses small balances)

**When to use**: User-configurable "moderate sensitivity" option.

#### Tier 3 — Aggressive

**Trigger**: Any currency symbol + any amount. No context requirement.

**Suppressors**: `itemprop="price"` only.

**Estimated metrics**:
- E-commerce FP rate: ~70% (fires on almost all product prices)
- Personal finance FN rate: ~3% (catches almost everything)

**When to use**: User explicitly accepts high FP rate. Useful for "I'm sharing my screen and
want all financial figures hidden regardless."

### User-Facing Exposure

In popup settings, expose:
```
FINANCIAL detection: [dropdown]
  - Off (default)
  - Conservative (Tier 1 — context-required)
  - Moderate (Tier 2 — context + $1K threshold)
  - Aggressive (Tier 3 — all currency amounts)
```

Or simpler: a single toggle (Tier 1 when on), with "Advanced: lower false positives" expandable.

### Implementation Checklist

- [ ] Add `FINANCIAL_TIER` to `AUTO_DETECT` shape (or keep as boolean + separate `FINANCIAL_SENSITIVITY` setting)
- [ ] Implement `AMOUNT_RE` as the base amount finder
- [ ] Implement `TIER_A_LABELS_RE` for context check
- [ ] Implement `PRICE_SUPPRESSOR_RE` for suppression
- [ ] Context scan function: text-node window + parent scan + sibling scan
- [ ] Parenthetical negative amount pattern as always-detect (high precision)
- [ ] Schema.org suppression check on `itemprop="price"` ancestors
- [ ] SVG text node: require higher threshold (context + $1K) when inside `<svg>`

---

## Section 10 — Unit Test Cases

All tests for `tests/unit/pii_detector.test.js` — FINANCIAL type.

### True Positive Cases (should match)

| # | Input text | Context element | Expected | Notes |
|---|---|---|---|---|
| T1 | `Account Balance: $14,523.67` | plain text | MATCH | Canonical bank balance with label in same text node |
| T2 | `Annual Salary: $95,000` | plain text | MATCH | Salary label present |
| T3 | `Total Portfolio: $1,234,567.89` | plain text | MATCH | Portfolio label present |
| T4 | `Wire Amount: $50,000.00` | plain text | MATCH | Wire transfer label present |
| T5 | `AGI: $123,456` | plain text | MATCH | Tax figure, AGI label |
| T6 | `Net Pay: $4,166.67` | plain text | MATCH | Payroll label present |
| T7 | `Net Worth: $425,000` | plain text | MATCH | Net worth label |
| T8 | `Available Credit: $4,500` | plain text | MATCH | Credit label present |
| T9 | `50,000.00 USD` (no symbol) | `<td>` with `<th>Transfer Amount</th>` sibling | MATCH | Code-suffix, sibling label context |
| T10 | `Vested Balance: $87,650` | plain text | MATCH | Retirement vested amount |
| T11 | `($12,500.00)` with label context | `<td>` in table with `<th>Net Income</th>` | MATCH | Parenthetical negative amount |
| T12 | `₹1,23,456` | `<div class="salary-value">` ancestor has "salary" | MATCH | Indian rupee with lakh format |
| T13 | `Portfolio Value $1.2M` | plain text | MATCH | Abbreviated form, label present |
| T14 | `Mortgage Balance: $287,500` | plain text | MATCH | Mortgage label |
| T15 | `Invoice Total: $34,500.00` | plain text | MATCH | Invoice label |
| T16 | `$8,200` in `<td>` | `<th>Available Balance</th>` in same `<tr>` | MATCH | DOM-sibling label detection |
| T17 | `Commission: $12,500` | plain text | MATCH | Commission is Tier B label |
| T18 | `Adjusted Gross Income: $123,456` | plain text | MATCH | AGI long form |
| T19 | `0.15342 BTC` | text near "wallet balance" label | MATCH | Bitcoin, context present |
| T20 | `Balance Due: $2,340` | plain text | MATCH | Invoice/bill context |

### True Negative Cases (should NOT match)

| # | Input text | Context | Expected | Notes |
|---|---|---|---|---|
| N1 | `$29.99` | product listing, no label | NO MATCH | E-commerce price, no context |
| N2 | `$9.99/month` | subscription page | NO MATCH | Price suppressor (/month) |
| N3 | `$12.50` | menu item, no financial label | NO MATCH | Restaurant price, no context |
| N4 | `AAPL $185.42` | stock ticker widget, no label | NO MATCH | Public stock price |
| N5 | `1 USD = 0.92 EUR` | forex widget | NO MATCH | Exchange rate — no symbol prefix |
| N6 | `$2.3B in Series C funding` | news article, no personal label | NO MATCH | Public news statistic |
| N7 | `Federal budget: $6.8 trillion` | government page | NO MATCH | Public institutional data — check cap logic |
| N8 | `$0.655 per mile` | reimbursement rate notice | NO MATCH | Rate per unit, suppressor fires |
| N9 | `Starting from $199` | pricing page | NO MATCH | Starting-from suppressor |
| N10 | `v2.1.0 costs $0` | software version string | NO MATCH | No financial context, tiny amount |
| N11 | `5,000 pts = $50 credit` | rewards page | NO MATCH | Reward points conversion, small amount, no label |
| N12 | `$149.00 per seat per year` | SaaS pricing | NO MATCH | Per-seat/year suppressors fire |
| N13 | `€2.99` | app store price | NO MATCH | Small amount, no context |
| N14 | `¥1,500` | Japanese product price, no label | NO MATCH | Small amount (< $10 USD equivalent), no label |
| N15 | `BTC $67,234` | crypto exchange ticker, no label | NO MATCH | Public market price, no label |

### Edge Cases

| # | Input text | Expected | Notes |
|---|---|---|---|
| E1 | `$1,234` (US) vs `€1.234` (EU) | Locale-dependent — no match without label | European format ambiguity |
| E2 | `Balance: $14,523.67` in SVG text node | MATCH with higher threshold check | SVG context rule |
| E3 | `Salary range: $80,000 – $120,000` | 2 MATCHes | Range produces two separate spans |
| E4 | `Net worth: -$5,000` (negative) | MATCH | Negative with minus prefix |
| E5 | Amount in `<input value="$14,523">` | NO MATCH | Input values are out of scope |
| E6 | `Balance` label in `<th>`, `$14,523.67` in `<td>` | MATCH via sibling scan | DOM structure test |
| E7 | Text node > 2000 chars containing a balance | Skipped (MAX_NODE_CHARS limit) | Performance guard |
| E8 | `Contract: $300M` on ESPN sports page | MATCH (FP — known limitation) | Salary label, public data |
| E9 | `$5.00` with Tier A label `Balance: $5.00` | MATCH | Small amount, strong label overrides |
| E10 | `50000 EUR` with `Transfer Amount` sibling | MATCH | Code suffix, no symbol prefix |

---

## Appendix A — Label Regex Reference

Final recommended label regex for Phase 1 (Tier 1 implementation):

```javascript
const FINANCIAL_TIER_A_RE = /\b(?:balance|account\s+balance|available\s+balance|current\s+balance|closing\s+balance|opening\s+balance|outstanding\s+balance|total\s+balance|salary|annual\s+salary|base\s+salary|gross\s+salary|net\s+salary|take-?home\s+pay|gross\s+pay|net\s+pay|compensation|total\s+compensation|base\s+compensation|income|gross\s+income|net\s+income|adjusted\s+gross|taxable\s+income|annual\s+income|agi|portfolio|total\s+portfolio|portfolio\s+value|holdings?|net\s+worth|total\s+net\s+worth|transfer\s+amount|wire(?:\s+amount|\s+transfer)?|deposit\s+amount|withdrawal(?:\s+amount)?|vested\s+balance|retirement\s+(?:balance|savings)|401[kK](?:\s+balance)?|ira\s+balance|roth\s+(?:ira\s+)?balance|hsa\s+balance|pension(?:\s+value)?|loan\s+(?:amount|balance)|outstanding\s+loan|mortgage(?:\s+balance)?|principal\s+balance|home\s+equity|heloc\s+balance|credit\s+limit|available\s+credit|credit\s+line|invoice\s+total|amount\s+due|balance\s+due|amount\s+owed|payment\s+(?:amount|due)|minimum\s+(?:payment|due)|bonus|annual\s+bonus|signing\s+bonus|commission|earned\s+commission|dividend|reimbursement|stipend|amount\s+owed)\b/i;
```

## Appendix B — Price Suppressor Reference

```javascript
const PRICE_SUPPRESSOR_RE = /\bper\s+(?:month|mo\.?|year|yr\.?|user|seat|license|device|unit|hour|hr\.?)\b|\b\/(?:mo|yr|month|year|user|seat|hr|hour)\b|\bmonthly\b|\bannually\b|\bsubscription\b|\bstarting\s+(?:from|at)\b|\bfrom\s+(?:only\s+)?[$€£¥₹]\b|\bas\s+low\s+as\b|\bprice(?:d)?\b(?!\s+(?:of|for|on))/i;
// Note: the last negative lookahead allows "price of the loan" but rejects standalone "price:" labels
```

## Appendix C — Full Phase 1 Detection Flow

```
For each text node T in TreeWalker output:
  1. Test AMOUNT_RE against T.textContent
     → If no matches: skip
  2. For each match M:
     a. Check PRICE_SUPPRESSOR_RE in window [M.start-50, M.start+50]
        → If suppressor found: skip M
     b. Check schema.org: any ancestor with itemprop="price"?
        → If found: skip M
     c. Check FINANCIAL_TIER_A_RE against:
        - Text window [M.start-100, M.start+100] within T.textContent
        - parent.textContent (capped at 500 chars)
        - grandparent.textContent (capped at 500 chars)
        - Previous 3 element siblings' textContent
        → If any check passes: flag M as FINANCIAL
     d. [Tier 2 only]: if no label found but extractAmount(M) >= 1000: flag M
  3. Collect flagged matches, pass to splitTextNode()
```
