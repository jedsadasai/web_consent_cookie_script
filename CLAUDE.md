# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PDPA/GDPR cookie-consent system: a one-tag browser widget (`packages/widget`), a Fastify API that logs consent to SQL Server 2016+ (`apps/server`), and Docker packaging. It replaces the legacy `cookiealertT.js` / `public function cookie().txt` in the repo root. Those files are reference only, so don't modify them or ship them (`.dockerignore` excludes them).

## Commands

npm workspaces (`@consent/widget`, `@consent/server`), Node ≥ 24.22.1 (`.nvmrc`). Run these from the repo root:

```bash
npm ci
npm run typecheck        # widget (src + test tsconfig) then server
npm test                 # vitest run in both workspaces
npm run build            # widget → packages/widget/dist, then server → apps/server/dist
npm run dev              # builds widget, then tsx watch on the server using ./.env
npm run migrate          # node apps/server/dist/db/migrate.js (needs build first)
```

Run a single test file or test name:

```bash
npm test -w @consent/server -- test/consent.test.ts
npm test -w @consent/widget -- -t "round-trips consent"
```

There is no linter configured. "Lint" is `npm run typecheck`, which runs strict TS with `noUncheckedIndexedAccess`.

Docker:

```bash
docker compose --profile dev up -d --build   # app + SQL Server 2022 (compat 130) + migrate; demo at http://localhost:8080/demo
docker compose run --rm migrate              # production: one-shot migration with a privileged login
docker compose up -d app                     # production: app only, DB_* points at the real SQL Server 2016
```

- The Docker build stage runs `typecheck` and `test`, so a failing test fails the image build.
- The dev SQL Server is published on host port **14333**, because 1433 is taken on the dev machine.

## Architecture

### Widget (`packages/widget`)

- **Build.** `build.mjs` uses esbuild to bundle `src/index.ts` into a single ES2019 IIFE, `dist/consent.min.js`. It imports `src/ui/styles.css` as a minified text string through a plugin. It also writes `dist/consent.manifest.json` (`version`, `hash`, sha384 `integrity`), which the server reads.
- **Bootstrap.** `src/index.ts` finds its own `<script>` tag. `config.ts` merges `window.CookieConsentConfig`, which wins, over `data-*` attributes and validates every value against the regexes in `types.ts`. `apiUrl` defaults to `/api/v1/consent` resolved against the script's own `src`.
- **Flow.** A user choice goes through `commit()`/`withdraw()` → `record()`, which does the following:
  1. Writes the `cc_consent` cookie (`storage.ts`, base64url JSON `{v,id,cats,ts}`).
  2. Activates gated elements (`gating.ts`).
  3. Updates Google Consent Mode (`consent-mode.ts`).
  4. POSTs the choice (`api.ts`, fire-and-forget).
  5. Dispatches `cookieconsent:change`.
- **Re-prompting and legacy cookies.** A change in `policyVersion` makes stored consent invalid, so the visitor is asked again. Legacy cookies (`acceptCookies`, `_atk`, `_ipd`) are deleted.
- **Gating.** `<script type="text/plain" data-consent="cat">` and `<iframe data-consent data-src>` are turned live by cloning them, and the page `nonce` is copied onto the clone. Revoking a category that has already run triggers a page reload.
- **UI.** `ui/view.ts` (`ConsentView`) renders the UI into a **closed Shadow DOM**:
  - Styles go through `adoptedStyleSheets`, with a nonce'd `<style>` fallback, so it works under a strict CSP.
  - DOM is built only with the `h()` helper in `ui/dom.ts`.
  - `focus-trap.ts` handles the modal.
  - Texts live in `i18n/th.ts` and `i18n/en.ts`.
- **`test/security.test.ts` fails the build** if anything under `src` uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`.
- **Tests** run under happy-dom (`vitest.config.ts`, page URL `https://www.hospital.example/th/`), with resource loading disabled.

### Server (`apps/server`)

- **Startup.** `src/index.ts` loads env via `env.ts` (zod, fails fast), builds the mssql repository and calls `buildApp(cfg, repo)` in `app.ts`. `buildApp` takes an injected `ConsentRepository` (`domain.ts`). Tests use the in-memory `MemoryRepository` and `makeApp()` from `test/helpers.ts` with `fastify.inject`, so no DB is needed.
- **Route scopes.** `routes/consent.ts` is registered under the `/api/v1` prefix. CORS and the rate limit are registered **inside that encapsulated scope only**, not globally.
- **`POST /consent`:**
  - Checks the request `Origin` against `SITES`. The format is `key=origin,origin;key2=…`, parsed by `lib/sites.ts`. An origin may be `https://*.example.com`, which matches any subdomain (not the apex) on the same scheme and port. This check runs in our own code, not only via CORS.
  - Then validates the body against a strict zod schema with a 4 KB limit.
  - Strips `pageUrl` down to origin + path.
  - Derives the IP from `req.ip`, which honours `TRUST_PROXY`, then stores it in full (`IpAddress`, migration 002), truncated (v4 /24, v6 /48) and as an HMAC with `IP_HASH_SECRET` (`lib/ip.ts`).
  - Inserts the record. A unique `EventId` makes the endpoint idempotent: SQL errors 2627/2601 map to `'duplicate'`, which returns 200; a new record returns 201.
- **`TRUST_PROXY`** accepts a hop count, IP or CIDR. The value `true` is rejected on purpose. A hop count is converted into a trust function in `app.ts`.
- **Widget serving.** `routes/widget.ts` serves the widget from `WIDGET_DIR`, which defaults to `packages/widget/dist`; build the widget first or `/consent.js` 404s.
  - `/consent.js` is cached for 1h with an ETag.
  - `/v/:hash/consent.js` is immutable.
  - `/consent.manifest.json` is also served.
- **Demo and headers.** `routes/demo.ts` serves `demo/*.html` only when `ENABLE_DEMO=true`, replacing `__NONCE__` with a per-request nonce under a strict CSP. Everything else gets Helmet with `default-src 'none'`. Errors are returned as `{error:{code,message}}` without stack traces.
- **Migrations.**
  - `db/migrate.ts` applies `migrations/NNN_*.sql` in order. Each file is split on `GO` lines, run in a transaction and tracked in `dbo.SchemaMigrations`.
  - The `MIGRATE_*` env vars are **dev conveniences**: create the DB, set the compatibility level, and create the least-privilege `consent_app` login with INSERT/SELECT only. They aren't used in production.
  - Dynamic SQL there must use `DECLARE @sql NVARCHAR(MAX) = … QUOTENAME(@param) …; EXEC sys.sp_executesql @sql;`. `QUOTENAME()` can't be used inline as an `EXEC(...)` argument.
  - Migrations must stay SQL Server **2016-compatible (compatibility level 130)** and re-runnable, using `IF OBJECT_ID(...) IS NULL` guards.

## Constraints to preserve

- **No raw PII.** The legacy system stored decrypted patient data (`pde`). The new one accepts only an opaque `subjectId`, for example an HMAC of the HN. Don't add fields that carry names, emails, phones or full URLs with query strings.
- **No client secrets.** The old date-as-password `LoginToken` JWT was removed deliberately. API protection is the origin allowlist, rate limit, body limit, strict schema and idempotency, so don't reintroduce a browser-held token.
- **The API DB login only has INSERT/SELECT** on `dbo.ConsentRecord`. Schema changes belong in migrations run with the separate `MIGRATE_DB_USER`.
- **Container hardening.** The runtime image is `node:24.22.1-alpine` pinned by digest, runs as non-root `node` and has npm removed. Compose runs it with `read_only`, `cap_drop: ALL` and `no-new-privileges`. Keep runtime writes to `/tmp` (tmpfs).
- **`.env` holds real local secrets.** Never print its values. `.env.example` documents every variable.
