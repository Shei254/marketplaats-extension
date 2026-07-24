# ADR-0007: Quota enforcement — backend-authorized per relist

**Status:** Accepted (2026-07-25)
**Scope:** Full app only.

## Context
Relists run client-side in the user's own browser and Marktplaats session (ADR-0001). This makes hard enforcement impossible: a determined user can always relist manually or with their own script, and anything the extension enforces can be reverse-engineered out. The only "hard" path — routing relists through our server — is the cloud-execution model already rejected. So enforcement is inherently soft; the real product being gated is the convenience/automation, not the raw ability to relist.

## Decision
**Backend-authorized per relist.** Before performing a relist, the extension requests authorization from the backend, which checks the user's tier/entitlement, decrements/records usage, and returns a short-lived signed OK. The **backend is the source of truth** for usage counts and tier limits. Subscription state flows from Stripe (ADR-0006).

## Consequences
- **Positive:** Reliable billing/usage numbers; clean tie between identity, subscription, and metering; the 99% of users who won't reverse-engineer are cleanly metered; a bypasser gains nothing they couldn't already do by hand.
- **Negative (accepted):** Enforcement is soft — determined bypass is possible and not worth engineering against. We gate the automation (popup panel, bulk, scheduling, multi-account), not the underlying action.
- Requires the extension to be online and authenticated to relist via the gated path.

## Refinement (2026-07-25): subscription gating semantics
An expired/cancelled user must be unable to use **our repost feature** (icon/popup). This is a *feature gate*, not prevention of any-possible-relist — the latter would require server-side execution and reverse ADR-0001, which we explicitly declined.

- **Action-time authorization only.** The extension holds **no usable cached grant**. Every relist calls `POST /api/relist/authorize`; the backend checks **live subscription status** (mirrored from Stripe webhooks, ADR-0006), quota, and SafetyPolicy, then returns a **short-lived, single-use signed token** or a typed denial.
- **Immediate revocation.** Because status is checked on every authorize call, a cancel/expire denies the *next* click. Short token TTL + single-use `jti` prevent stockpiling authorizations while subscribed for later use.
- **Fail-closed.** If the extension cannot reach the backend (offline / outage), the icon **refuses** — no offline grace. Guarantees an expired user can never slip through; accepted cost is that a paying user offline or during an outage also cannot relist until reconnected.
- **Denial UX.** Icon may render but is non-functional: `SUBSCRIPTION_INACTIVE` → upsell; `QUOTA_EXCEEDED` → upgrade prompt; `RATE_LIMITED` → cooldown; `UNREACHABLE` → retry.

See [enforcement contract](../enforcement-contract.md).

## Revisit if
Bypass/abuse becomes materially common → increase friction (e.g., server-signed action nonces bound to identity), never full hard enforcement without reversing ADR-0001.
