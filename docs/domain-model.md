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
- **Tier** — a plan in **our** catalog: quota per period, max MarktplaatsAccounts, feature flags,
  an `isDefault` flag, and a nullable `stripePriceId`. Admin-managed; the free tier is an ordinary row
  with a null price (ADR-0014).
- **Subscription** — the User's current plan: a reference to a Tier, a normalized status mirrored from
  Stripe via webhooks, and `periodStart`/`periodEnd`. Stripe is the source of truth for **status and
  lifecycle**; the Tier and its limits are ours. **Every User always has one** — first login
  auto-provisions onto the default Tier, so "no subscription" is not a reachable state.
- **Entitlement** — the limits/features resolved from the Subscription's **Tier**: relists per period,
  max MarktplaatsAccounts, feature flags (bulk, scheduling). The thing quotas check. Read from Postgres,
  never from Stripe on the hot path.
- **RelistEvent (UsageRecord)** — one recorded relist attempt: which User, ad reference, timestamp,
  outcome. Backend-owned; the authoritative usage count (ADR-0007), and the telemetry that reveals a
  Marktplaats-side breakage.
- **RelistAuthorization** — a short-lived, signed backend OK the extension must obtain *before*
  a gated relist (ADR-0007). Transient, not persisted long-term.
- **SafetyPolicy** — per-account rate limits, pacing/jitter, and caps applied by the extension
  and enforced/audited by the backend (ADR-0008).
- **AdSnapshot** — *client-side only* (`chrome.storage.local`): the full pre-delete capture
  (fields + photo blobs) enabling delete-first restore (ADR-0003). **Not** a backend entity.

## Relationships

```
User 1───1 Subscription (always exists) ───1 Tier ──resolves──▶ Entitlement
                          │                        │
                    periodStart/End          stripePriceId ──▶ Stripe Price (money only)
User 1───* RelistEvent   (counted within [periodStart, periodEnd))
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
4. Extension reports the outcome; backend finalizes the reservation into a **RelistEvent**, or refunds it if
   the relist failed *before* the delete, and returns the updated quota.

## Invariants
- **Every User has exactly one current Subscription.** "No subscription" is unreachable; free users hold an
  `active` Subscription on the default Tier. Nothing in the code branches on "is this user free?".
- **`authorize` never calls Stripe.** Status is read from the webhook-fed mirror; limits from our Tier table.
- **Nothing about a Marktplaats session or credential ever reaches the backend** (ADR-0001/0005). The backend
  sees ad references only.
