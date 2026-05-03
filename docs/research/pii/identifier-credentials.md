# Identifier-Context Sub-pass — Gaps & Provider Coverage

> Audit date: 2026-05-02. Covers `src/pii/pii_detectors.js` identifier sub-pass (PREFIX_RE + DISPOSITIVE_RES + _validateValue).

---

## 1. Remaining False-Positive Risks (after pure-alpha fix)

The `_validateValue` fix (reject pure-alpha strings) eliminated English words like "responsibilities". But the regex `[A-Za-z0-9][A-Za-z0-9._\-]{3,63}` still captures values containing hyphens/dots/underscores — which overlap with natural language and non-credential patterns.

| Pattern | Example context | Risk | Notes |
|---------|----------------|------|-------|
| Hyphenated English compound | `key: self-determination` | MEDIUM | `-` satisfies non-alpha gate |
| Underscore variable names | `ref: my_variable_name` | LOW | Looks credential-like; acceptable FP |
| Domain-like strings | `ref: auth.staging.internal` | LOW | `.` satisfies gate; plausible credential |
| Version-like near keyword | `license: 2024.1.0-rc` | MEDIUM | `isVersion` suppressor doesn't run on PREFIX_RE path |
| Bare hex (6+ chars) | `id: a1b2c3d4` | LOW | Has digits — always passed; acceptable |

**Key insight:** Suppressors (`isVersion`, `isHexColor`, etc.) run on the Stage 3 NUMERIC_RE path only. PREFIX_RE captures bypass the suppressor cascade entirely. Version strings and hex colors adjacent to keywords will wrap.

### Possible mitigations (not yet implemented)

1. Run a lightweight suppressor check on PREFIX_RE values (version, hex)
2. Add a "dictionary word" heuristic (English-word-shaped hyphenated compounds)
3. Accept as low-FP tradeoff — PREFIX_RE fires only when a credential keyword is adjacent

---

## 2. DISPOSITIVE_RES — Provider Coverage

### Currently covered (8 patterns)

| # | Provider | Pattern | Prefix/Shape |
|---|----------|---------|-------------|
| 1 | Generic | Bearer/Basic auth header | `Bearer ` / `Basic ` + 20+ chars |
| 2 | AWS | Access key ID | `AKIA` + 16 uppercase alphanum |
| 3 | GitHub | Fine-grained PAT | `github_pat_` + 82 chars |
| 4 | GitHub | Classic PAT | `ghp_` + 36 chars |
| 5 | Stripe | Secret/publishable key | `[sp]k_(live|test)_` + 24+ chars |
| 6 | Google | API key | `AIza` + 35 chars |
| 7 | Slack | Bot/user/app token | `xox[bpoars]-` + 10+ chars |
| 8 | Generic | JWT (3-segment base64url) | `eyJ` + `.` + `.` structure |

### NOT covered — prioritized by prevalence

#### Tier A — High prevalence, fixed prefix (easy wins)

| Provider | Format | Regex sketch | Notes |
|----------|--------|-------------|-------|
| **GitLab** | Personal access token | `glpat-[A-Za-z0-9_\-]{20,}` | Very common in CI/CD configs |
| **OpenAI** | API key | `sk-[A-Za-z0-9]{20,}` | Collides with Stripe `sk_` but uses `-` not `_`; needs disambiguation |
| **Anthropic** | API key | `sk-ant-[A-Za-z0-9_\-]{90,}` | `sk-ant-` prefix is unique |
| **Twilio** | Account SID | `AC[a-f0-9]{32}` | Always 34 chars, hex after prefix |
| **Twilio** | Auth token | 32 hex chars (no prefix) | Keyword-gated only |
| **SendGrid** | API key | `SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}` | Two-segment dot-separated |
| **npm** | Access token | `npm_[A-Za-z0-9]{36}` | |
| **PyPI** | API token | `pypi-[A-Za-z0-9_\-]{100,}` | |
| **Vercel** | Token | `vercel_[A-Za-z0-9]{24}` | |
| **Supabase** | Service role key | `eyJ` (JWT) | Already covered by JWT pattern |
| **Cloudflare** | API token | 40 hex chars (no prefix) | Keyword-gated only |
| **Datadog** | API/app key | 32 hex chars (no prefix) | Keyword-gated only |

#### Tier B — Medium prevalence or no fixed prefix (keyword-gated)

| Provider | Format | Notes |
|----------|--------|-------|
| **Azure** | Connection strings | `DefaultEndpointsProtocol=...` — structural, not regex-friendly |
| **Azure** | Client secret | Variable format, no fixed prefix |
| **Firebase** | API key | `AIza` already covered by Google pattern |
| **Heroku** | API key | UUID format, no prefix — keyword-gated |
| **DigitalOcean** | Personal token | `dop_v1_` + 64 hex chars |
| **Docker Hub** | PAT | `dckr_pat_` + variable |
| **Mailgun** | API key | `key-` + 32 hex chars |
| **Postmark** | Server token | UUID format — keyword-gated |
| **PagerDuty** | API key | 20 chars, no prefix — keyword-gated |
| **HuggingFace** | Token | `hf_[A-Za-z0-9]{34}` |
| **Mapbox** | Token | `pk.eyJ` / `sk.eyJ` (JWT-like) |

#### Tier C — Low prevalence or covered by existing patterns

| Provider | Notes |
|----------|-------|
| **Supabase** | JWT (covered), `service_role` key is a JWT |
| **Firebase** | Uses Google `AIza` format (covered) |
| **Netlify** | No fixed prefix; keyword-gated |
| **Render** | No fixed prefix; keyword-gated |

---

## 3. KEYWORDS List — Missing Entries

### High priority (database/infra credentials)

- `database` / `db` — connection strings, passwords
- `connection` — connection_string, connection_url
- `dsn` — Data Source Name (universal DB config)
- `mongo` / `redis` / `postgres` / `mysql` — DB-specific
- `webhook` — webhook_secret, webhook_url
- `endpoint` — api_endpoint

### Medium priority (email/messaging)

- `smtp` — smtp_password, smtp_host
- `imap` — imap credentials
- `sendgrid` / `mailgun` / `twilio` — provider names as context keywords

### Low priority (already partially covered)

- `host` — too generic, high FP risk
- `url` — too generic
- `callback` — too generic

---

## 4. Implementation Roadmap

### Phase next: Dispositive providers (Tier A)

Add 6-8 prefix-anchored patterns to `DISPOSITIVE_RES`. Zero FP risk — these prefixes are unambiguous. Estimated: 1 session.

Candidates (in order): `glpat-`, `sk-ant-`, `SG.`, `npm_`, `pypi-`, `AC` (Twilio SID), `dop_v1_`, `dckr_pat_`, `hf_`.

**OpenAI `sk-` disambiguation:** OpenAI keys use `sk-` (dash), Stripe uses `sk_` (underscore). Current Stripe regex `[sp]k_` uses underscore — OpenAI won't collide. Safe to add `sk-[A-Za-z0-9]{20,}` separately, but must sort longer prefix first to prevent Stripe from eating OpenAI matches.

### Phase next+1: Keywords expansion

Add database/webhook keywords to `KEYWORDS` array. Low risk — PREFIX_RE still requires a value after the keyword.

### Phase next+2: PREFIX_RE suppressor integration

Evaluate running `isVersion` on PREFIX_RE captures. Low priority — the FP rate is small since PREFIX_RE requires keyword adjacency.

---

## 5. Test gaps to close alongside implementation

- Dispositive: one positive test per new provider pattern
- Keywords: one positive test per new keyword category (db, webhook, smtp)
- False-positive: hyphenated English word near keyword (negative test)
- Suppressor bypass: version string after keyword (document as known gap or fix)
