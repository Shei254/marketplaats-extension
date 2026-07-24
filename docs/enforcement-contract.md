# Quota Enforcement — Contract & Flow

Concrete design for the subscription/quota gate. Implements ADR-0007 (backend-authorized
per relist, action-time, fail-closed) with ADR-0005 (Keycloak), ADR-0006 (Stripe), ADR-0008 (safety).

## Principle
The repost feature is **gated at action time by the backend**. The extension can never relist
without a fresh, backend-issued, single-use authorization. Expired/cancelled → every attempt denied.
This gates *our feature*; it does not (and cannot) prevent a user relisting by other means (ADR-0001).

## Subscription status (source of truth)
- Stripe is authoritative for subscription state; our backend mirrors it via **webhooks** into a
  `Subscription` record with a normalized status.
- **Allowed** statuses: `active`, `trialing`. **Denied**: `past_due`, `canceled`, `unpaid`,
  `incomplete`, `incomplete_expired`, or no subscription.
- The authorize check reads this mirrored status — no live Stripe call on the hot path.

## Endpoints

### `POST /api/relist/authorize`
- **Auth:** `Authorization: Bearer <Keycloak access token>` → identifies the User (ADR-0005).
- **Body:** `{ "marktplaatsAccountId": "...", "adId": "..." }`
- **Checks, in order (first failure wins):**
  | Check | Fail response |
  |---|---|
  | Valid Keycloak token | `401 UNAUTHENTICATED` |
  | MarktplaatsAccount belongs to this User | `403 NOT_YOUR_ACCOUNT` |
  | Subscription status is Allowed | `402 SUBSCRIPTION_INACTIVE` |
  | Entitlement quota remaining this period | `429 QUOTA_EXCEEDED` (+ `resetAt`) |
  | SafetyPolicy rate/pacing OK | `429 RATE_LIMITED` (+ `retryAfter`) |
- **Success `200`:** reserve one usage unit, then return
  `{ "authToken": "<JWT>", "expiresAt": "<~45s out>", "jti": "..." }`.
  The `authToken` is a backend-signed JWT embedding `{ sub, marktplaatsAccountId, adId, jti, exp }`.

### `POST /api/relist/complete`
- **Body:** `{ "jti": "...", "outcome": "SUCCESS" | "FAILED_BEFORE_DELETE" | "FAILED_AFTER_DELETE" }`
- Finalizes the reserved usage into an authoritative **RelistEvent**.
  - `SUCCESS` / `FAILED_AFTER_DELETE` → usage stands (the destructive action happened).
  - `FAILED_BEFORE_DELETE` → **refund** the reserved unit (nothing was consumed on Marktplaats).
- Idempotent on `jti`; a never-completed reservation expires and auto-refunds after a grace window.

## Anti-stockpiling
- `authToken` TTL ≈ 45s and **single-use** (`jti` burned on `complete`, or on first internal-API use).
- Reservation happens at authorize time, so pre-fetching many tokens while subscribed both burns
  quota and expires quickly — no usable stockpile.

## Fail-closed behavior (ADR-0007)
The extension performs a relist **only** on a fresh `200` from `authorize`. Any of {network error,
timeout, non-200} → **abort, do not relist**, surface the typed reason. No cached/offline grant exists.

## Extension gating states (UI)
| Backend result | Icon state |
|---|---|
| `200` OK | active → proceeds with delete-first relist (ADR-0003) |
| `402 SUBSCRIPTION_INACTIVE` | shown but locked → **upsell** modal |
| `429 QUOTA_EXCEEDED` | shown → **upgrade** prompt + `resetAt` |
| `429 RATE_LIMITED` | shown → cooldown timer (`retryAfter`) |
| `401` / unreachable / timeout | shown → "unavailable, retry" (fail-closed) |

## Sequence
```
Extension                         Backend                    Stripe
   │  authorize(adId, mpAcct) ─────▶│                           │
   │                                │ verify Keycloak token     │
   │                                │ read mirrored Subscription │◀─ webhooks keep it fresh
   │                                │ check quota + SafetyPolicy │
   │                                │ reserve 1 unit            │
   │  ◀───── 200 {authToken,jti} ───│                           │
   │  delete ad → create ad (internal-API, delete-first) …      │
   │  complete(jti, outcome) ──────▶│ finalize/refund RelistEvent│
```

## Open build questions (to confirm before coding)
- Build tool / Java version (default: **Gradle, Java 21**) and package base name.
- JWT signing key management for `authToken` (default: backend-held asymmetric key, rotated).
- Whether `complete` is required for POC-of-enforcement or usage is counted at `authorize` only
  (simpler, no refund path) for a first cut.
