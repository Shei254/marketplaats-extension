# Spec: Quota & Subscription Enforcement for Relisting

> Status: ready-for-agent (pending issue-tracker setup — see Further Notes)
> Implements: ADR-0001, ADR-0005, ADR-0006, ADR-0007, ADR-0008. Contract: `docs/enforcement-contract.md`. Terms: `docs/glossary.md`.

> ## ⚠️ Partly superseded (2026-08-13)
> `docs/enforcement-contract.md` is the authority where this spec disagrees with it. Changes:
> - **`marktplaatsAccountId` is removed from `authorize`**, and with it the `403 NOT_YOUR_ACCOUNT` check —
>   the extension cannot produce the value and the backend cannot verify it. Quota and pacing are per-User.
>   **Voids user stories 9 and 17.**
> - **Entitlements come from our own `Tier` table**, not from the Stripe tier (ADR-0014). Every User always
>   has a Subscription — the free tier is an ordinary Tier row — so `SUBSCRIPTION_INACTIVE` now only ever
>   means a lapsed payer, and free users are denied by `QUOTA_EXCEEDED`.
> - **`GET /api/me` is added** for display state, and **`/complete` returns the updated quota** (satisfying
>   user story 16 without a second call).
> - **Login gates the whole extension**; subscription and quota gate the action (ADR-0007 refinement).
> - Backend specifics settled: Gradle, Java 21, Flyway, Spring Modulith, package base `com.mprelist`
>   (ADR-0012).
> Everything else — reserve/refund, idempotency per `jti`, auto-reconciliation, fail-closed, the two test
> seams — stands as written.

## Problem Statement

Relisting is the paid value of the product, but the relist action runs client-side in the user's own browser and Marktplaats session (ADR-0001). Nothing today ties the ability to use the repost feature to whether the user is actually paying. A user whose Subscription has expired or been cancelled can currently keep using the repost icon indefinitely, and there is no reliable record of how many relists a user has consumed. The business needs the repost feature to be usable **only** by users with an active, in-quota Subscription, and needs trustworthy usage numbers for billing.

## Solution

Every relist is gated at action time by the backend. When a user triggers a relist (from the popup panel or an in-page icon), the extension must first obtain a fresh, single-use authorization from the backend. The backend checks the user's live Subscription status, remaining quota for the period, and SafetyPolicy (rate/pacing), and either issues a short-lived signed RelistAuthorization or returns a typed denial. The extension performs the relist **only** on a successful authorization and **fails closed** on any error — so an expired/cancelled user, an out-of-quota user, or a user who cannot reach the backend simply cannot use the repost feature. The denial reason drives the icon's UI state (upsell, upgrade prompt, cooldown, or retry).

This gates *our feature*; it does not attempt to prevent a user relisting by other means, which is impossible under client-side execution and was explicitly declined (ADR-0001, ADR-0007).

## User Stories

1. As the business, I want every relist to require a backend authorization, so that only paying users get value from the repost feature.
2. As the business, I want an expired Subscription to block the very next relist attempt, so that access ends when payment ends.
3. As the business, I want a cancelled Subscription to block relisting immediately, so that cancellation is honored without delay.
4. As the business, I want relist usage counted server-side, so that billing and quota decisions rest on trustworthy numbers.
5. As a paying user with an active Subscription and remaining quota, I want the repost icon to work normally, so that I get the value I pay for.
6. As a user whose Subscription is inactive, I want the repost icon to show an upsell instead of working, so that I understand why it's blocked and how to fix it.
7. As a user who has hit my quota for the period, I want the icon to show an upgrade prompt and when my quota resets, so that I know my options.
8. As a user relisting too fast, I want the icon to show a cooldown with the remaining wait, so that I understand the pacing limit (SafetyPolicy).
9. As a user acting on a MarktplaatsAccount that isn't associated with me, I want the action refused, so that I cannot relist ads that aren't mine.
10. As a user who is offline or hits a backend outage, I want the icon to refuse rather than silently do nothing or proceed unmetered, so that behavior is predictable (fail-closed).
11. As the business, I want authorizations to be short-lived and single-use, so that a user cannot stockpile authorizations while subscribed and spend them after cancelling.
12. As the business, I want a relist that fails before the destructive delete to refund the reserved quota unit, so that users aren't charged quota for actions that never touched Marktplaats.
13. As the business, I want a relist that fails after the delete to still consume the quota unit, so that quota reflects that a Marktplaats-side change occurred.
14. As the business, I want the `complete` step to be idempotent per authorization, so that retries or duplicate reports don't double-count usage.
15. As the business, I want an authorization that is never completed to auto-reconcile after a grace window, so that abandoned reservations don't permanently consume quota.
16. As a user, I want my remaining quota and reset date visible in the extension, so that I can plan my relists.
17. As a user with multiple MarktplaatsAccounts, I want quota and rate limits applied correctly per the rules of my Entitlement, so that multi-account use behaves as my plan defines.
18. As the business, I want Subscription state kept current from Stripe via webhooks, so that the authorize check reads fresh status without a live Stripe call on the hot path.
19. As the business, I want authorization to require a valid Keycloak identity, so that only authenticated users can request relists.
20. As a developer, I want each denial to carry a typed reason code, so that the extension can render the correct UI state without guessing.
21. As a security reviewer, I want authorization decisions to be unforgeable client-side, so that a modified extension cannot fabricate an "allowed" verdict for the metered path.
22. As the business, I want the repost icon to be able to render even when blocked, so that denial states double as conversion surfaces (upsell/upgrade).
23. As a user, when a relist is authorized, I want the existing delete-first + durable-snapshot flow (ADR-0003) to run unchanged, so that enforcement doesn't compromise data safety.

## Implementation Decisions

- **New backend module: `enforcement`** (Spring Boot) exposing the relist authorization API. It is the single source of truth for allow/deny verdicts and usage counting.
- **API contract** (full detail in `docs/enforcement-contract.md`):
  - `POST /api/relist/authorize` — authenticated via Keycloak bearer token (ADR-0005). Body identifies the target MarktplaatsAccount and ad. Checks run in fixed order, first failure wins: authenticated → account-ownership → Subscription active → quota remaining → SafetyPolicy. Success **reserves one usage unit** and returns a short-lived (~45s), single-use signed `authToken` carrying `{ sub, marktplaatsAccountId, adId, jti, exp }`.
  - `POST /api/relist/complete` — reports outcome `SUCCESS | FAILED_BEFORE_DELETE | FAILED_AFTER_DELETE` against the `jti`. Resolves the reservation the `jti` names — settling it, or refunding it on `FAILED_BEFORE_DELETE` — and records a RelistEvent against it either way; idempotent per `jti`; unreconciled reservations auto-refund after a grace window.
- **Verdict → HTTP mapping:** `401 UNAUTHENTICATED`, `403 NOT_YOUR_ACCOUNT`, `402 SUBSCRIPTION_INACTIVE`, `429 QUOTA_EXCEEDED` (+ `resetAt`), `429 RATE_LIMITED` (+ `retryAfter`), `200` allow. Every denial body includes a typed `reason` code.
- **Subscription status source:** a mirrored `Subscription` record updated by Stripe webhooks (ADR-0006). Allowed statuses: `active`, `trialing`. All others deny. No live Stripe call on the authorize path.
- **Entitlement** derives quota-per-period, max-MarktplaatsAccounts, and feature flags from the Subscription tier; the authorize check reads Entitlement, not the raw tier.
- **RelistAuthorization** is a backend-signed JWT (asymmetric key held server-side, rotatable). It is the unforgeable verdict — the extension cannot mint one. Single-use enforced by burning the `jti` on `complete`/use.
- **New extension module: authorization gate** — a pure decision function `(backendResponse) -> Proceed | Refuse(uiState)`. It sits in front of the existing internal-API relist engine (ADR-0004): the engine runs only when the gate returns `Proceed`. On `200` it proceeds to the unchanged delete-first flow (ADR-0003); on any non-200/network-error/timeout it returns `Refuse` (fail-closed). It maps `SUBSCRIPTION_INACTIVE → upsell`, `QUOTA_EXCEEDED → upgrade`, `RATE_LIMITED → cooldown`, others/unreachable → `retry`.
- **Boundary rule preserved (ADR-0001/0005):** no Marktplaats credentials or sessions cross to the backend; the backend only ever sees MarktplaatsAccount identifiers, never the MP session. The `authorize` body references the account by our identifier.
- **Fail-closed is a property of the extension gate, not the backend:** the backend simply returns verdicts; the client's refusal-on-any-failure delivers the "not in any way possible to use the icon" guarantee.

## Testing Decisions

- **What makes a good test here:** exercise only externally observable behavior — the HTTP verdict/response for a given state on the backend, and the proceed/refuse+UI-state decision for a given backend response on the extension. Tests must not assert on internal service/repository calls, private helpers, or JWT internals beyond what a client can observe.
- **Seam 1 — Backend HTTP boundary (primary).** Tests hit `POST /api/relist/authorize` and `POST /api/relist/complete` via Spring Boot `@SpringBootTest` with MockMvc/WebTestClient. Inputs are arranged as state: Subscription status, remaining quota, rate/pacing history, MarktplaatsAccount ownership, and a test Keycloak JWT. Assertions cover: allow on active+in-quota+within-rate; each denial verdict and its HTTP code + reason + `resetAt`/`retryAfter`; check ordering (first failure wins); reserve-on-authorize; refund on `FAILED_BEFORE_DELETE`; usage stands on `SUCCESS`/`FAILED_AFTER_DELETE`; idempotency of `complete` per `jti`; auto-refund of abandoned reservations. Keycloak is exercised as a resource-server with test tokens (no live IdP). This single seam covers the whole enforcement guarantee.
- **Seam 2 — Extension authorization-gate module.** Unit tests drive the pure gate with faked backend responses (mocked fetch). Assertions: proceeds only on `200`; fails closed (refuse) on every non-200, network error, and timeout; each denial code maps to the correct UI state. The DOM and the internal-API relist engine are behind the seam and not invoked.
- **Prior art:** none yet (greenfield). Seam 1 establishes the pattern for API-boundary tests; Seam 2 establishes the pattern for pure-logic extension tests. Both should be referenced by future features rather than introducing lower seams.

## Out of Scope

- Building the Stripe checkout/subscribe flow and the customer billing portal (only the webhook-fed `Subscription` status mirror is in scope here; assume records can be seeded for tests).
- Full Keycloak deployment/hardening and the login UX (assume a validated bearer token is available; test with test tokens).
- The web dashboard SPA (ADR-0009) and any dashboard-side quota display.
- The relist mechanic itself — delete + re-create, snapshot/restore, internal-API engine, CSRF/token and photo-fidelity spikes (ADR-0002/0003/0004) — is assumed present behind the gate and is not re-specified here.
- Defining concrete pricing tiers and their numeric quotas (Entitlement is read abstractly; specific numbers are configuration, decided elsewhere).
- Hard prevention of relisting by means other than our extension — impossible under client-side execution and explicitly declined (ADR-0001/0007).
- Firefox port (ADR-0009).

## Further Notes

- **Publishing blocked:** no issue tracker is configured (no git remote, no `gh`, no `setup-matt-pocock-skills`), so this spec is committed to the repo instead of an issue and the `ready-for-agent` label is not yet applied. Once the tracker is set up (or provided), publish this as an issue and apply `ready-for-agent`.
- **Sequencing note:** this feature is full-app, not POC. It presumes the Spring Boot backend, Keycloak resource-server config, and a Subscription mirror exist or are scaffolded as part of this work. The pure-POC extension has no enforcement.
- **Guarantee summary:** "expired → cannot use the repost icon" is delivered by the combination of action-time authorization (Seam 1) and client fail-closed behavior (Seam 2); neither alone is sufficient.
