# Quota Enforcement — Contract & Flow

Concrete design for the subscription/quota gate. Implements ADR-0007 (backend-authorized per relist,
action-time, fail-closed) with ADR-0005/0010 (Keycloak + PKCE), ADR-0006/0014 (Stripe money, our
entitlements), and ADR-0008 (safety).

**Revised 2026-08-13** — see [ADR-0007's second refinement](adr/0007-quota-enforcement.md).

## Principle
The repost feature is **gated at action time by the backend**. The extension can never relist without a
fresh, backend-issued, single-use authorization. Expired/cancelled → every attempt denied. This gates *our
feature*; it does not (and cannot) prevent a user relisting by other means (ADR-0001).

## Gating depth
| State | Popup | marktplaats.nl injection | Relist |
|---|---|---|---|
| Signed out | Sign-in screen only | none | denied |
| Signed in, quota remaining | Full: ads, search, quota | active buttons | allowed |
| Signed in, quota exhausted | Full: ads, search | buttons **locked + upgrade** | denied |
| Signed in, payment lapsed | Full: ads, search | buttons **locked + upsell** | denied |

The ad list and search are **not** subscription-gated: they run client-side against the user's own
Marktplaats session and cost us nothing, and a locked button beside the user's own ads is the strongest
conversion surface available. The login gate is a product decision, not a security control — see ADR-0007.

## Subscription status (source of truth)
- Stripe is authoritative for **status and lifecycle**; our backend mirrors it via **webhooks** into a
  `Subscription` record with a normalized status. Entitlements come from **our** `Tier` table (ADR-0014).
- **Allowed** statuses: `active`, `trialing`. **Denied**: `past_due`, `canceled`, `unpaid`, `incomplete`,
  `incomplete_expired`.
- **Every user always has a Subscription** (ADR-0014): first login auto-provisions one on the `isDefault`
  tier with status `active`. "No subscription" is not a reachable state, so free users are denied by
  `QUOTA_EXCEEDED`, never by `SUBSCRIPTION_INACTIVE`.
- The authorize check reads the mirrored status and our Tier — **no Stripe call on the hot path**.

## Quota period
`periodStart`/`periodEnd` are stored on the `Subscription`: copied from Stripe's current period for paid
subscriptions, rolled monthly from the provisioning date for free ones. `resetAt = periodEnd`, always
answerable. Usage is `count(RelistEvent) in [periodStart, periodEnd)`.

## Endpoints

### `GET /api/me` — display state, **never a grant**
- **Auth:** `Authorization: Bearer <Keycloak access token>`.
- **Returns:** `{ subscriptionStatus, tier, quotaRemaining, resetAt, features }`.
- Unsigned. The relist path ignores it completely — a stale `active` cannot cause a relist.
- **Refreshed on:** login, popup open, and from the `/complete` response. No timers, no polling. The service
  worker holds one cached copy, so N injected buttons on a page cost zero extra requests.
- Unreachable → the UI renders "unavailable", never "active" (fail-closed applies to display too).

### `POST /api/relist/authorize`
- **Auth:** `Authorization: Bearer <Keycloak access token>` → identifies the User (ADR-0005/0010).
- **Body:** `{ "adId": "..." }`
  > `marktplaatsAccountId` was **removed** (2026-08-13): the extension cannot produce one, and the backend
  > cannot verify one. Quota and pacing are per-User. See ADR-0007.
- **Checks, in order (first failure wins):**
  | Check | Fail response |
  |---|---|
  | Valid Keycloak token | `401 UNAUTHENTICATED` |
  | Subscription status is Allowed | `402 SUBSCRIPTION_INACTIVE` |
  | Entitlement quota remaining this period | `429 QUOTA_EXCEEDED` (+ `resetAt`) |
  | SafetyPolicy rate/pacing OK | `429 RATE_LIMITED` (+ `retryAfter`) |
- **Success `200`:** reserve one usage unit, then return
  `{ "authToken": "<JWT>", "expiresAt": "<~45s out>", "jti": "..." }`.
  The `authToken` is a backend-signed JWT embedding `{ sub, adId, jti, exp }`.

### `POST /api/relist/complete`
- **Body:** `{ "jti": "...", "outcome": "SUCCESS" | "FAILED_BEFORE_DELETE" | "FAILED_AFTER_DELETE" }`
- Finalizes the reserved usage into an authoritative **RelistEvent**.
  - `SUCCESS` / `FAILED_AFTER_DELETE` → usage stands (the destructive action happened).
  - `FAILED_BEFORE_DELETE` → **refund** the reserved unit (nothing was consumed on Marktplaats).
- Idempotent on `jti`; a never-completed reservation expires and auto-refunds after a grace window.
- **Returns the updated `{ quotaRemaining, resetAt }`**, so a relist needs no follow-up `/api/me` call.

> **Outcome reporting is the breakage canary.** We drive private, unversioned endpoints that ADR-0004 says
> will change without notice. A spike in `FAILED_BEFORE_DELETE` is the signal that Marktplaats moved
> something — and the trigger for a remote-config hotfix (ADR-0013). Without `/complete` we are blind until
> support tickets arrive. This is the primary reason it exists, beyond quota accounting.

### `GET /api/client-config`
Endpoint paths, CSRF extraction rules, and DOM anchors, overriding the extension's hardcoded defaults
(ADR-0013). **Strictly data** — never anything the extension executes, per MV3's remotely-hosted-code ban.

## Anti-stockpiling
- `authToken` TTL ≈ 45s and **single-use** (`jti` burned on `complete`, or on first internal-API use).
- Reservation happens at authorize time, so pre-fetching many tokens while subscribed both burns quota and
  expires quickly — no usable stockpile.

## Fail-closed behavior (ADR-0007)
The extension performs a relist **only** on a fresh `200` from `authorize`. Any of {network error, timeout,
non-200} → **abort, do not relist**, surface the typed reason. No cached/offline grant exists.

## Extension gating states (UI)
| Backend result | Control state |
|---|---|
| `200` OK | active → proceeds with delete-first relist (ADR-0003) |
| `402 SUBSCRIPTION_INACTIVE` | shown but locked → **upsell** (lapsed payer only) |
| `429 QUOTA_EXCEEDED` | shown → **upgrade** prompt + `resetAt` |
| `429 RATE_LIMITED` | shown → cooldown timer (`retryAfter`) |
| `401` / unreachable / timeout | shown → "unavailable, retry" (fail-closed) |
| not signed in | sign-in screen; nothing injected |

## Sequence
```
Extension                         Backend                    Stripe
   │  GET /api/me  (login, popup) ──▶│  display state only     │
   │  authorize(adId) ─────────────▶│                          │
   │                                │ verify Keycloak token    │
   │                                │ read mirrored Subscription│◀─ webhooks keep it fresh
   │                                │ read Tier → Entitlement  │   (ours, not Stripe)
   │                                │ check quota + SafetyPolicy│
   │                                │ reserve 1 unit           │
   │  ◀───── 200 {authToken,jti} ───│                          │
   │  delete ad → create ad (internal-API, delete-first) …     │
   │  complete(jti, outcome) ──────▶│ finalize/refund RelistEvent
   │  ◀── {quotaRemaining, resetAt}─│                          │
```

## Resolved build questions
- **Build tool / Java version:** Gradle, Java 21, Flyway migrations (ADR-0012). Package base `com.mprelist`.
- **`complete` required?** Yes — reserve/complete with refund, for the telemetry reason above as much as for
  quota accuracy. Counting at authorize alone would charge users for relists that never touched Marktplaats,
  which is punishing on a 3-relist free tier.
- **JWT signing key management:** backend-held asymmetric key, rotated.

## Open spikes
- **Stable Marktplaats account identifier** — blocks `maxMpAccounts` as a sellable entitlement and the return
  of any ownership check to this contract.
- **`listMyAds` pagination** — unverified. The current client does `data.ads ?? []` with no paging, and
  `searchAd` hits the same path with a `query` param, which is weak evidence the endpoint is paged.
- **Tier quota edited under existing subscribers** — deferred with the admin CRUD UI.
