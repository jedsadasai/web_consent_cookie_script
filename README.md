# Cookie Consent (PDPA / GDPR) — Widget + API

ระบบขอความยินยอมการใช้คุกกี้ ประกอบด้วย:
1. **Widget**: เขียนด้วย TypeScript ใช้ได้ด้วย `<script>` แท็กเดียว ขนาดประมาณ 10 KB (gzip) ไม่ต้องพึ่ง Bootstrap หรือ jQuery
2. **API**: Node.js + Fastify ที่บันทึกประวัติความยินยอมลง SQL Server 2016 ขึ้นไป
3. **Docker**: สำหรับ deploy

A PDPA/GDPR cookie-consent banner made of three parts:
1. **Widget**: a one-tag TypeScript widget, about 10 KB gzipped, with no Bootstrap or jQuery.
2. **API**: a hardened Node.js + Fastify consent-log API backed by SQL Server 2016+.
3. **Docker**: packaging for deployment.

```
packages/widget/   browser widget  → dist/consent.min.js
apps/server/       Fastify API     → /consent.js, POST /api/v1/consent, /healthz, /readyz
apps/server/migrations/  SQL schema (SQL Server 2016, compat level 130)
demo/              demo page (strict CSP) served at /demo when ENABLE_DEMO=true
```

## Features

| | |
|---|---|
| **Consent by category** | necessary (always on), preferences, analytics, marketing |
| **Fair choice** | "Accept all" and "Reject all" have equal visual weight. You can withdraw consent at any time (floating button or `CookieConsent.open()`). |
| **Real blocking** | `<script type="text/plain" data-consent="analytics">` and `<iframe data-consent data-src>` run only after the matching consent is given. If consent is revoked, the page reloads. |
| **Google Consent Mode v2** | Everything starts as denied, then updates to match the visitor's choice. |
| **Accessibility (WCAG 2.1 AA)** | Keyboard support, focus trap, Esc to close, `role="dialog"`/`role="switch"`, 44 px touch targets, contrast ≥ 4.5:1 |
| **UX** | Thai and English (detected automatically, with a toggle), dark mode, `prefers-reduced-motion`, mobile bottom sheet |
| **Isolation** | Closed Shadow DOM, so page CSS can't break the widget and its CSS can't leak out. Works with a strict CSP (no `unsafe-inline`). |
| **Privacy** | Records keep only origin + path (no query string), the client's public IP (full, plus a truncated /24 or /48 copy and an HMAC) and the user agent. No other PII is stored; there is an optional pseudonymous `subjectId`. Behind a reverse proxy, set `TRUST_PROXY` so the public IP comes from `X-Forwarded-For` instead of the proxy's address. |
| **Audit trail** | Every choice (accept / reject / custom / withdraw) is an append-only row with the policy version. |

## Embed on your website

Replace the old `#popupAlert` + `cookiealertT.js` + `cookiealert.css` with:

```html
<script src="https://consent.example.com/consent.js"
        data-site="rjh"
        data-policy-version="2026-10"
        defer></script>
```

The cookie-policy link (opens in a new tab) comes from the server's `POLICY_URL`, and the color theme from `THEME` (`auto` / `light` / `dark`). Add `data-policy-url` or `data-theme` only to override them on a page.

With SRI (recommended): take `url` and `integrity` from `GET /consent.manifest.json`. The server bakes `POLICY_URL` and `THEME` into the served script, so they change whenever either does:

```html
<script src="https://consent.example.com/v/<hash>/consent.js"
        integrity="sha384-…" crossorigin="anonymous" data-site="rjh" … defer></script>
```

### Options (`data-*` or `window.CookieConsentConfig = {…}` before the script)

| attribute | config key | default | description |
|---|---|---|---|
| `data-site` | `siteKey` | `default` | Must match a key in `SITES` on the server |
| `data-policy-url` | `policyUrl` | server `POLICY_URL` | Link to the cookie policy, opened in a new tab (http/https only) |
| `data-policy-version` | `policyVersion` | `1` | Change this when the policy changes, so visitors are asked again |
| `data-lang` | `language` | auto | `th` / `en` / `auto` |
| `data-categories` | `categories` | all | e.g. `analytics,marketing` |
| `data-accent` | `accentColor` | `#12805c` | Hex color |
| `data-theme` | `theme` | server `THEME` (`auto`) | `auto` / `light` / `dark` |
| `data-position` | `position` | `bottom` | `bottom` / `bottom-left` / `bottom-right` |
| `data-settings-button` | `settingsButton` | `true` | Floating button to reopen the settings |
| `data-google-consent-mode` | `googleConsentMode` | `false` | Turns on GCM v2 (load the script without `defer`, before gtag) |
| `data-subject-id` | `subjectId` | – | Pseudonymous ID (e.g. an HMAC of the HN). **Never send raw PII.** |
| `data-accept-days` / `data-reject-days` | | 365 / 180 | How long the choice is remembered |
| `data-cookie-domain` | `cookieDomain` | – | Share the choice across subdomains (`.example.com`) |
| – | `texts` | – | Override any text, e.g. `{ th: { acceptAll: 'ยอมรับ' } }` |

### Gating third-party scripts

```html
<script type="text/plain" data-consent="analytics" src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script type="text/plain" data-consent="marketing">/* inline pixel */</script>
<iframe data-consent="marketing" data-src="https://www.youtube-nocookie.com/embed/…"></iframe>
```

### JavaScript API

```js
CookieConsent.get();               // { necessary, preferences, analytics, marketing } | null
CookieConsent.has('analytics');    // boolean
CookieConsent.onChange(({ categories, action }) => {});
CookieConsent.open();              // open settings (e.g. from a footer link)
CookieConsent.reset();             // withdraw consent and ask again
CookieConsent.setSubjectId('a1b2c3');
window.addEventListener('cookieconsent:change', (e) => e.detail);
```

## Run locally

Requires Docker Desktop.

```bash
cp .env.example .env    # fill in IP_HASH_SECRET, DB_PASSWORD, MIGRATE_DB_PASSWORD, MSSQL_SA_PASSWORD
docker compose --profile dev up -d --build
```

This starts SQL Server 2022 (Developer), creates `ConsentDB`, sets compatibility level 130 (2016), runs the migration, creates the least-privilege `consent_app` login, and starts the API.

- Demo: http://localhost:8080/demo
- Health: http://localhost:8080/healthz, http://localhost:8080/readyz

Inspect the stored records:

```bash
docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -d ConsentDB -Q "SELECT TOP 10 * FROM dbo.ConsentRecord ORDER BY Id DESC"
```

Without Docker (Node ≥ 24.22.1, see `.nvmrc`):

```bash
npm ci && npm run build && npm test
npm run dev   # uses ../../.env
```

## Production deploy (SQL Server 2016)

1. A DBA creates the database, then runs `apps/server/migrations/001_consent_record.sql` (or `docker compose run --rm migrate` with a login that has DDL rights).
2. Create the API login with only `INSERT, SELECT` on `dbo.ConsentRecord` (see `apps/server/migrations/grants.example.sql`).
3. Set `.env`:
   - `NODE_ENV=production`
   - `ENABLE_DEMO=false`
   - `HSTS=true`
   - `TRUST_PROXY=1` (or the proxy IP)
   - `SITES=rjh=https://www.rajthanee.com,https://rajthanee.com`
   - `POLICY_URL=https://www.rajthanee.com/policy/privacy-policy-cookie`
   - `THEME=auto` (or `light` / `dark` to force one)
   - `DB_*` pointing at the real server
   - `DB_TRUST_SERVER_CERT=false` (install a trusted certificate on SQL Server)
   - Leave out `MIGRATE_CREATE_DB`, `MIGRATE_APP_LOGIN` and `MSSQL_SA_PASSWORD`.
4. Run `docker compose up -d app`.
5. Put it behind a reverse proxy with TLS, for example nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name consent.example.com;
  # ssl_certificate …; ssl_certificate_key …;
  gzip on; gzip_types text/javascript application/json;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, don't append client-supplied values
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> SQL Server 2016 needs TLS 1.2 enabled (the SP/CU updates that add TLS 1.2), because Node 24 / OpenSSL 3 no longer allow TLS 1.0/1.1.

## Security design

- **The old `LoginToken` was removed.** It used username `TokenRJH` with today's date as the password, so anyone could get a token. A script running in the browser cannot keep any secret, so the API is protected this way instead:
  - an Origin allowlist per site, enforced on the server
  - CORS
  - rate limiting per IP (`RATE_LIMIT_MAX`)
  - a 4 KB body limit
  - a strict zod schema (unknown keys are rejected)
  - an idempotent `eventId`
- The IP comes from the TCP connection or a trusted proxy only (`TRUST_PROXY`), never from the client. The old version got it from Cloudflare in the browser.
- All SQL is parameterized. The API login has only INSERT/SELECT; migrations use a separate login.
- Helmet sets these headers:
  - `default-src 'none'` CSP
  - HSTS
  - `nosniff`
  - CORP
  - Referrer-Policy
  - Permissions-Policy
- Errors never include a stack trace. Logs redact IP, cookie and authorization.
- The container:
  - is pinned by digest
  - runs as non-root (`node`)
  - has a read-only root filesystem
  - drops all capabilities and sets `no-new-privileges`
  - has npm removed from the runtime image
  - has a healthcheck and resource limits
- The widget:
  - never uses `innerHTML`/`eval` (there is a test that checks this)
  - only allows http(s) URLs
  - validates every config value against a regex
  - runs in a closed Shadow DOM
  - uses `credentials: 'omit'` and sends no query string

## Database schema

`dbo.ConsentRecord` stores:
- `EventId` (unique)
- `ConsentId`
- `SiteKey`
- `SubjectId`
- `Action`
- one bit per category: `Necessary`, `Preferences`, `Analytics`, `Marketing`
- `PolicyVersion`
- `Language`
- `PageUrl`
- `IpAddress` (full client IP, resolved through `TRUST_PROXY`)
- `IpTruncated`
- `IpHash`
- `UserAgent`
- `CreatedAt` (UTC)

Look up the consent history of one browser:

```sql
SELECT * FROM dbo.ConsentRecord WHERE ConsentId = @id ORDER BY CreatedAt DESC;
```
