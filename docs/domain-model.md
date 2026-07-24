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
  list" and multi-account extensibility.
- **Subscription** — the User's current plan, mirrored from Stripe via webhooks. Carries tier,
  status, and billing period. Source of truth for *state* is Stripe; backend mirrors it.
- **Entitlement** — the limits/features derived from the Subscription's tier: e.g. relists per
  period, max MarktplaatsAccounts, feature flags (bulk, scheduling). The thing quotas check.
- **RelistEvent (UsageRecord)** — one recorded relist attempt: which User, which MarktplaatsAccount,
  ad reference, timestamp, outcome. Backend-owned; the authoritative usage count (ADR-0007).
- **RelistAuthorization** — a short-lived, signed backend OK the extension must obtain *before*
  a gated relist (ADR-0007). Transient, not persisted long-term.
- **SafetyPolicy** — per-account rate limits, pacing/jitter, and caps applied by the extension
  and enforced/audited by the backend (ADR-0008).
- **AdSnapshot** — *client-side only* (`chrome.storage.local`): the full pre-delete capture
  (fields + photo blobs) enabling delete-first restore (ADR-0003). **Not** a backend entity.

## Relationships

```
User 1───* MarktplaatsAccount
User 1───1 Subscription (current)  ──derives──▶ Entitlement
User 1───* RelistEvent            *───1 MarktplaatsAccount
User      ──requests──▶ RelistAuthorization ──checked against──▶ Entitlement + SafetyPolicy
(AdSnapshot lives in the browser, keyed to a MarktplaatsAccount's ad — never server-side)
```

## Relist flow (full app, gated)

1. Extension requests a **RelistAuthorization** from the backend for a given MarktplaatsAccount + ad.
2. Backend checks **Entitlement** (quota left) and **SafetyPolicy** (rate/pacing) → signed OK or deny.
3. On OK, extension captures the **AdSnapshot** (durable, client-side), then **delete-first**:
   delete the ad → create the identical ad via the internal-API engine, with retry/restore.
4. Extension reports the outcome; backend records a **RelistEvent** (authoritative usage).
