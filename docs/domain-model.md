# Domain Model

The core concepts of the full app and how they relate. Derived from ADR-0001..0009.
The **POC has no server-side domain** — it manipulates only a client-side ad snapshot
(`chrome.storage.local`) and Marktplaats's own data via the internal-API engine.

## Boundary rule (from ADR-0001 / ADR-0005)
We model **Marktplaats-account identities**, never Marktplaats **credentials or sessions**.
MP sessions live only in the user's browser. Nothing here holds them server-side.

## Entities

- **User** — an app account; identity subject issued by Keycloak. One human = one User.
- **MarktplaatsAccount** — a Marktplaats account *associated with* a User (label + MP account
  id/handle only — **no credentials/session**). A User may have many. Enables the "managed user
  list" and multi-account extensibility. **Not yet realised:** no stable MP account identifier has been
  found, so it appears in no wire contract today (ADR-0007, 2026-08-13 refinement).
- **Tier** — an entry in **our** catalog: quota per period, max MarktplaatsAccounts, feature flags,
  an `isDefault` flag, a `published` flag, and a nullable `stripePriceId`. Admin-managed; the free tier is
  an ordinary row with a null price (ADR-0014). A Tier is **not** a Plan — see below. A `price.created`
  webhook syncs one in on `metadata.tier_code`, unpublished and at quota 0 if the code is new, and never
  overwrites a quota (ADR-0019).
- **Plan** — a **Tier joined with the Stripe Price** its `stripePriceId` names: quota and flags ours,
  amount and currency and interval Stripe's. Derived, never stored — `GET /api/plans` composes it and caches
  the Stripe half. Only a *published* Tier with a price id is one, so the free tier is a Tier and never a
  Plan (ADR-0019).
- **Subscription** — the User's current standing: a reference to a Tier, a normalized status mirrored from
  Stripe via webhooks, and `periodStart`/`periodEnd`. Stripe is the source of truth for **status and
  lifecycle**; the Tier and its limits are ours. **Every User always has one** — first login
  auto-provisions onto the default Tier, so "no subscription" is not a reachable state. When Stripe reports a
  **terminal** end the webhook returns it to the default Tier, `active`, with the period back on our monthly
  roll; **dunning** does not (ADR-0018). `SUBSCRIPTION_INACTIVE` therefore means a failing card and nothing
  else.
- **Entitlement** — the limits/features resolved from the Subscription's **Tier**: relists per period,
  max MarktplaatsAccounts, feature flags (bulk, scheduling). The thing quotas check. Read from Postgres,
  never from Stripe on the hot path.
- **UsageReservation** — one quota unit, held from `authorize` until `complete` settles or refunds it, for
  a User and an ad reference. Backend-owned; usage in a period is the reservations in it that were not
  refunded, so a relist still in flight already counts (ADR-0007).
- **RelistEvent (UsageRecord)** — what the extension reported about a relist it was authorized for:
  outcome and timestamp, against the reservation that carries the User and the ad. Backend-owned; recorded
  for refunds too, which is what makes it the telemetry that reveals a Marktplaats-side breakage.
- **RelistAuthorization** — a short-lived, signed backend OK the extension must obtain *before*
  a gated relist (ADR-0007). The token is transient; its `jti` is the id of the reservation it was issued
  against, which is what `complete` settles and how a second report for it is refused.
- **SafetyPolicy** — per-account rate limits, pacing/jitter, and caps applied by the extension
  and enforced/audited by the backend (ADR-0008).
- **AdSnapshot** — *client-side only* (`chrome.storage.local`): the full pre-delete capture
  (fields + photo blobs) enabling delete-first restore (ADR-0003). **Not** a backend entity.

## Relationships

```
User 1───1 Subscription (always exists) ───1 Tier ──resolves──▶ Entitlement
                          │                        │
                    periodStart/End          stripePriceId ──▶ Stripe Price (money only)
                          │                        └──────────┬─────────┘
              terminal end ▼ (ADR-0018)                       ▼
                     default Tier, active                   Plan (derived, GET /api/plans)
User 1───* UsageReservation  (the unit; counted within [periodStart, periodEnd) unless refunded)
                 └──1 RelistEvent   (the outcome reported for it, at most one)
User      ──requests──▶ RelistAuthorization ──checked against──▶ Entitlement + SafetyPolicy

User 1───* MarktplaatsAccount   ── modelled, not yet realised (no stable MP identifier)
(AdSnapshot lives in the browser, keyed to the ad — never server-side)
```

## Relist flow (full app, gated)

1. Extension requests a **RelistAuthorization** from the backend for an ad. Requires a signed-in User.
2. Backend checks Subscription status, **Entitlement** (quota left in this period) and **SafetyPolicy**
   (rate/pacing), **reserves one usage unit**, and returns a short-lived single-use signed OK or a typed deny.
3. On OK, extension captures the **AdSnapshot** (durable, client-side), then **delete-first**:
   delete the ad → create the identical ad via the internal-API engine, with retry/restore.
4. Extension reports the outcome; backend settles the reservation and records a **RelistEvent** against it,
   or refunds the unit if the relist failed *before* the delete — the event is written either way — and
   returns the updated quota.

## Invariants
- **Every User has exactly one current Subscription.** "No subscription" is unreachable; free users hold an
  `active` Subscription on the default Tier. Nothing in the code branches on "is this user free?".
- **There is always exactly one default Tier.** The partial index `tier_single_default` makes it at most one;
  `TierCatalog.defaultTier()` throwing makes it at least one. So "no free tier" is that tier's quota set to
  **0**, never the flag unset — which would provision nobody (ADR-0019).
- **A subscription that ends is a downgrade, never a lockout.** Nobody who has paid ends up with less than
  somebody who never did (ADR-0018).
- **A webhook is applied at most once, and never out of order.** Stripe delivers at least once and retries for
  three days, in no guaranteed order, so a Subscription remembers how far through Stripe's telling it is: a
  redelivery writes the same row again and an event older than what is mirrored is dropped. Otherwise a retry
  of Monday's cancellation could undo Tuesday's resubscription.
- **Money is never stored here.** Amount, currency and interval live in Stripe alone; a Plan holds a cache of
  them and never a second copy of record (ADR-0014/0019).
- **`authorize` never calls Stripe.** Status is read from the webhook-fed mirror; limits from our Tier table.
- **Nothing about a Marktplaats session or credential ever reaches the backend** (ADR-0001/0005). The backend
  sees ad references only.
