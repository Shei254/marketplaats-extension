# Backlog — full app

Derived from the 2026-08-13 grilling session. Decisions live in [`adr/`](adr/README.md); the wire contract
is [`enforcement-contract.md`](enforcement-contract.md). This file is the work breakdown, not a decision
record — if it disagrees with an ADR, the ADR wins.

**47 tickets.** GitHub issues #9–#55.

**Sizes:** S ≈ under a day · M ≈ 1–3 days · L ≈ 3+ days.

## Critical path

```
T47 typecheck ──▶ T01 golden tests ──▶ T03 monorepo ──┬──▶ T07 API skeleton ──▶ T08 schema ──▶ T12 entitlements ──▶ T13 authorize
                                    │                                                                │
                                    └──▶ T28 design system ──▶ T29 popup shell ──▶ T30 list ──▶ T26 gate wiring
                                                                                                     │
T05 docker-compose ──▶ T06 Keycloak realm ──▶ T23 PKCE auth ─────────────────────────────────────────┘
```

**T01 must land before T03.** Once files have moved you no longer have a baseline proving the move was
byte-neutral, which is the entire point of ADR-0015.

---

## Milestone 0 — Freeze and restructure

Blocks everything. Nothing here changes behaviour.

### T01 · Golden-payload characterization tests for the internal-API layer · **L** · no deps
Capture the exact request every operation emits, with `fetch` stubbed and no network.
- Covers `listMyAds`, `searchAd`, `captureAd`, `deleteAd`, `uploadPhoto`, `createAd`, `getBuckets`, `getBucketCategories`, `getCreateFormAttributes`.
- Asserts method, URL, **every header**, and body **byte-for-byte including form field order**.
- `createAd` fixtures cover: with/without photos, bidding on/off, with/without shipping options, buyer protection on/off.
- CSRF acquisition and the 403/419 retry path are covered.
- Refs: [ADR-0015](adr/0015-frozen-internal-api-golden-tests.md).

### T02 · Collapse the duplicated endpoint config · **S** · T01
`EMPTY_ENDPOINT_CONFIG` exists in both `src/shared/endpoint-config.ts` and `src/content/marktplaats-api.ts`, and the shared copy declares `getBucket` where the type says `getBuckets` — so a stored config can't reach that endpoint.
- One definition, one `EndpointName` union, no drift.
- Golden tests unchanged and green.

### T03 · Monorepo restructure · **M** · T01
- `apps/extension` (today's `src/`, `public/`, `scripts/`), `apps/api`, `apps/dashboard`, `packages/contracts`, `packages/ui`, `infra/`. `docs/` stays put.
- `npm run build`, `typecheck`, `test` work from the root.
- Golden tests green after the move — the proof the move was byte-neutral.
- Refs: [ADR-0011](adr/0011-repository-layout.md).

### T04 · Remove the POC Options page and dev console hooks · **S** · T03
- Delete `src/options/*` and its manifest entry.
- Decide per hook whether `__relist`/`__setEndpoints`/etc. survive behind a dev-build flag or go.
- Refs: [ADR-0013](adr/0013-remote-client-configuration.md).

### T45 · Findings note for the internal-API spikes · **S** · T01
Write `docs/internal-api-findings.md`: endpoints and which are HTML-scraped, CSRF extraction and its retry path, the `createAd` form-order dependency, the category→bucket fan-out, and the **photo fidelity limit** (`downloadPhoto`'s canvas fallback re-encodes to JPEG q0.95 and rewrites the mime type).
- Carried over from POC spikes #3/#4, whose documentation criterion was never met.
- This is what someone needs to author a client-config fix (T27) under time pressure.

### T47 · Fix `MarktplaatsClient` type drift so typecheck passes · **S** · blocks T01
`npm run typecheck` fails with 9 errors; neither esbuild nor vitest typechecks, so it went unnoticed. **No runtime bugs** — the declared types just don't describe what the code does.
- `MarktplaatsClient.captureAd` is declared `Promise<CapturedAd>`, but `CapturedAd` has no `draft`/`photos` (those are on `AdSnapshot`); the API really returns `{ draft, photos }`.
- `FakeMarktplaatsClient` never implemented `searchAd`.
- Also: `searchAd` is plumbed but dead — `content-script.ts` returns `undefined`, the orchestrator only logs. T31 depends on it.
- Not here: `getBucket`→`getBuckets` is T02; `options.ts` errors vanish with T04.

### T44 · Pin the extension ID · **S** · runbook, do before any shared environment
Create an **unpublished draft** Web Store item, copy its public key into `manifest.json` as `"key"`. Until then, register each developer's path-derived ID in the dev Keycloak client.
- Refs: [ADR-0010 § Obtaining the extension ID](adr/0010-extension-authentication.md).

---

## Milestone 1 — Local platform and identity

### T05 · `infra/docker-compose.yml` — Postgres + Keycloak · **S** · T03
One command brings up a working local stack; documented in the README.

### T06 · Keycloak realm, clients, and roles · **M** · T05
- Realm exported to `infra/` as version-controlled config, not hand-clicked.
- Three clients: extension (**public**, PKCE, `chromiumapp.org` redirect), dashboard, API (resource server).
- `ADMIN` realm role defined.
- Refs: [ADR-0005](adr/0005-identity-and-auth.md), [ADR-0010](adr/0010-extension-authentication.md).

### T07 · Spring Boot skeleton with enforced module boundaries · **M** · T03
- Gradle, Java 21, package base `com.mprelist`.
- Empty modules: `identity`, `catalog`, `subscription`, `enforcement`, `admin`.
- **A Spring Modulith boundary test that fails the build** when a module reaches into another's `internal/`. This ticket is not done without that test.
- Refs: [ADR-0012](adr/0012-backend-modular-monolith.md).

### T08 · Flyway schema · **M** · T07
`app_user`, `tier`, `subscription`, `relist_event`, `usage_reservation`.
- `tier`: quota per period, max MP accounts, features, `is_default`, **nullable** `stripe_price_id`.
- `subscription`: user, tier, normalized status, `period_start`, `period_end`, Stripe ids.
- Exactly one tier may be `is_default` (enforced by a partial unique index).
- Refs: [ADR-0014](adr/0014-tier-catalog-and-entitlements.md).

### T09 · Seed the tier catalog · **S** · T08
Flyway seed: Free (default, null price), Pro, Power. Stripe price ids filled from T22.

### T10 · OAuth2 resource server + `identity` module · **M** · T06, T07
- Keycloak JWT validation; `CurrentUser` resolved from the token.
- Test tokens for the test suite; no live IdP in tests.
- `401 UNAUTHENTICATED` shape matches the contract.

### T11 · Auto-provision a Subscription on first login · **M** · T08, T10
Every User gets a Subscription on the `is_default` tier, status `active`, with a period.
- **"No subscription" is unreachable** — assert it.
- Free-user `period_end` rolls monthly from provisioning.
- Refs: [ADR-0014](adr/0014-tier-catalog-and-entitlements.md).

---

## Milestone 2 — Entitlements and enforcement

### T12 · `catalog` module: Tier → Entitlement resolution · **M** · T09
Resolve quota, max accounts and feature flags from our table. **No Stripe dependency in this module.**

### T13 · `POST /api/relist/authorize` · **L** · T11, T12
- Checks in fixed order, first failure wins: token → status → quota → SafetyPolicy.
- Reserves one usage unit; returns a ~45s single-use signed JWT `{ sub, adId, jti, exp }`.
- Body is `{ adId }` — **no `marktplaatsAccountId`, no `NOT_YOUR_ACCOUNT`**.
- Verdict → HTTP mapping and typed reason codes per the contract.
- Tested at the HTTP boundary (`@SpringBootTest` + MockMvc), state arranged as data.
- Refs: [enforcement-contract.md](enforcement-contract.md), [ADR-0007](adr/0007-quota-enforcement.md).

### T14 · `POST /api/relist/complete` · **M** · T13
- `SUCCESS`/`FAILED_AFTER_DELETE` → usage stands. `FAILED_BEFORE_DELETE` → refund.
- Idempotent per `jti`; burns the `jti`.
- **Returns updated `{ quotaRemaining, resetAt }`.**

### T15 · Reservation reconciliation job · **M** · T14
Abandoned reservations auto-refund after a grace window; idempotent, safe to run concurrently.

### T16 · SafetyPolicy rate and pacing check · **M** · T13
Per-User rate limits and pacing; `429 RATE_LIMITED` with `retryAfter`. Refs: [ADR-0008](adr/0008-safety-and-consent.md).

### T17 · `GET /api/me` · **S** · T12
Returns `{ subscriptionStatus, tier, quotaRemaining, resetAt, features }`. Unsigned, carries no authorization.

### T18 · `admin` module skeleton + role guard · **S** · T10
Endpoints guarded by `hasRole('ADMIN')`. **No CRUD screens** — deferred by [ADR-0014](adr/0014-tier-catalog-and-entitlements.md).

---

## Milestone 3 — Billing

### T22 · Create Stripe Products and Prices · **S** · runbook
By hand in the Stripe dashboard, with iDEAL and SEPA enabled and trial days set on the Price. Record the ids for T09. Refs: [ADR-0006](adr/0006-billing.md).

### T19 · Stripe Checkout session endpoint · **M** · T12
Creates a Checkout session for a chosen tier's `stripe_price_id`; returns the redirect URL.

### T20 · Stripe webhook receiver → Subscription mirror · **L** · T11
- Signature verification; idempotent on event id; out-of-order events handled.
- Maps Stripe status → normalized status; copies `current_period_*` into `period_start`/`period_end`.
- `trialing` mirrors through with no special-casing.

### T21 · Customer Portal session endpoint · **S** · T20
Returns a portal redirect URL for the current user.

---

## Milestone 4 — Extension auth and the gate

### T23 · `launchWebAuthFlow` + PKCE sign-in · **L** · T06
Authorization Code + PKCE against Keycloak; sign-out clears tokens. Refs: [ADR-0010](adr/0010-extension-authentication.md).

### T24 · Token storage and on-demand refresh · **M** · T23
- **Refresh at call time, never on a timer** — the MV3 worker sleeps.
- Concurrent callers share one in-flight refresh (the pattern `ensureCsrfToken` already uses).
- Refresh failure surfaces as signed-out, not as an error state.

### T25 · Authorization gate — pure decision function · **M** · contract only
`(backendResponse) -> Proceed | Refuse(uiState)`. No DOM, no fetch, no Chrome APIs.
- **Fails closed** on every non-200, network error, and timeout.
- Maps `SUBSCRIPTION_INACTIVE → upsell`, `QUOTA_EXCEEDED → upgrade`, `RATE_LIMITED → cooldown`, else `retry`.

### T26 · Wire the gate into `RelistOrchestrator` · **M** · T13, T14, T24, T25
`authorize` → existing delete-first flow **unchanged** → `complete` with the mapped outcome.
- `failed-before-delete` → `FAILED_BEFORE_DELETE`; `failed-recoverable` → `FAILED_AFTER_DELETE`.
- The engine runs **only** on `Proceed`.
- `resumeAll()` on startup re-authorizes rather than assuming a prior grant.

### T27 · `GET /api/client-config` + extension consumption · **M** · T03
Backend endpoint plus worker-side cache and hardcoded fallback.
- Schema-versioned; an unknown version falls back to built-ins rather than failing.
- **Data only** — assert nothing executable can be delivered.
- Refs: [ADR-0013](adr/0013-remote-client-configuration.md).

---

## Milestone 5 — Popup (the priority surface)

### T28 · `packages/ui` foundation · **M** · T03
Tokens (colour, spacing, type scale, motion) and base components. Consumed by popup and dashboard. Light and dark, since today's popup already supports both.

### T29 · React popup shell and state routing · **M** · T24, T28
Routes between signed-out / loading / list / unavailable. Signed out shows **only** sign-in. Refs: [ADR-0007 refinement](adr/0007-quota-enforcement.md).

### T30 · Ad list and per-row relist state machine · **M** · T26, T29
Port the existing idle/busy/done/failed behaviour, including the one-relist-at-a-time lock that stops a distracted click fanning out into several deletes.

### T31 · Debounced server-side searchbar · **M** · T30
`searchAd` with 400ms debounce and a 2-character minimum; in-flight results superseded correctly.
- Fixes today's dead path: `content-script.ts` returns `undefined` and the orchestrator only logs.

### T32 · Quota display and locked states · **S** · T17, T30
Remaining quota and `resetAt`; locked buttons carry upsell/upgrade/cooldown per the reason code.

---

## Milestone 6 — Dashboard (thin shell)

### T33 · React SPA shell + Keycloak login · **M** · T06, T28
### T34 · Plans page → Stripe Checkout · **M** · T19, T33
### T35 · Account page — tier, usage, → Customer Portal · **M** · T17, T21, T33
### T36 · Privacy and terms pages · **S** · T33 — required for the Web Store listing

---

## Milestone 7 — Spikes

Cheap, high-information, and they unblock Milestone 8. **T37 first** — it feeds three features.

### T37 · SPIKE: is `listMyAds` paginated? · **S**
Today's client does `data.ads ?? []` with no paging, and `searchAd` hits the same path with a `query` param. Test with an account holding many ads. Feeds the popup list, the search fallback, and ownership detection.

### T38 · SPIKE: is there a stable Marktplaats account identifier? · **M**
Blocks `maxMpAccounts` as a sellable entitlement and any return of an ownership check to the contract. Must not require sending personal data to our backend ([ADR-0001](adr/0001-execution-model.md)/[0005](adr/0005-identity-and-auth.md) boundary rule).

### T39 · SPIKE: ownership detection on marktplaats.nl · **M**
How to know an ad is the user's own, on every page type where one appears. **Pin against the real DOM.**

### T40 · SPIKE: injected-UI runtime · **S** · T39
React may be the wrong choice inside a content script on every page load. Decide with T41's real requirements in hand.

---

## Milestone 8 — In-page injection (last)

### T41 · Injection framework · **L** · T39, T40
- **Shadow DOM** so page CSS cannot deform our control and ours cannot leak.
- Ordered fallback anchor strategies; `MutationObserver` for client-side route changes (the site is a SPA).
- **Silent degradation:** no anchor found → render nothing, throw nothing, never a broken control.
- Anchors delivered via client config (T27) so a DOM change is a config fix, not a release.

### T42 · Inject the Repost control with gate states · **M** · T26, T41
Reads the worker's cached `/api/me` snapshot — **zero extra requests per button**. Nothing injected when signed out.

### T46 · Client-side pacing and jitter between relists · **M** · T26
Today there is **no delay or jitter anywhere** — only serialisation (`popup.ts:186`), which is not the same thing.
- Randomised, not fixed, delay between consecutive relists; parameters delivered via client config (T27).
- **Not covered by backend SafetyPolicy (T16):** the backend can only *deny*, it cannot make timing look human. ADR-0008 wants human-like pacing because internal-API calls already lack the interaction signals of real clicks ([ADR-0004](adr/0004-surfaces-and-internal-api.md)).
- Carried over from POC issue #7, whose pacing criterion was never met. Stakes rise sharply with bulk relisting.

---

## Cross-cutting

### T43 · API backward-compatibility policy · **S**
Extension releases take days, API deploys take minutes. Decide the version header and the minimum-supported-version response, plus how the extension prompts an upgrade. Refs: [ADR-0011](adr/0011-repository-layout.md).

---

## Deferred, deliberately

| Item | Blocked by / decided in |
|---|---|
| Admin tier CRUD screens | [ADR-0014](adr/0014-tier-catalog-and-entitlements.md) — seed migrations suffice for three tiers |
| What happens to existing subscribers when a tier quota is edited | Deferred with the admin UI |
| `maxMpAccounts` as a sellable entitlement | T38 |
| Multi-Marktplaats-account support | T38 |
| Firefox port | [ADR-0009](adr/0009-tech-stack.md) |
| Relist history / outcome analytics screens | Dashboard is a thin shell for the first cut |
