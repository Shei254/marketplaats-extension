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

## Refinement (2026-08-13): gating depth, display state, and account scope
Three amendments to the above, all reflected in the enforcement contract.

**1. Login gates everything; subscription and quota gate the action.**
The 2026-07-25 refinement said the icon "may render but is non-functional". That is now scoped to
*authenticated* users. Signed out: the popup shows a sign-in screen only, and nothing is injected into
marktplaats.nl. Signed in: ads and search work, and every Repost control renders **locked with its typed
reason**, preserving the denial-as-conversion-surface intent.

Note honestly what this is worth: `listMyAds`, `searchAd` and `captureAd` all run client-side against the
user's own Marktplaats session and cost us nothing. **Any lock on them is a client-side courtesy lock**,
trivially removed from a modified extension. Only the backend-authorized relist has teeth. The login gate is
a product decision, not a security control.

**2. Display state comes from `GET /api/me`, which is not a grant.**
The UI must render locked-vs-active *before* any click, which the "no cached grant" rule forbids solving with
a stored authorization. `/api/me` returns unsigned display data — subscription status, tier, quota remaining,
`resetAt`, features — cached in the service worker and refreshed on **login, popup open, and off the
`/complete` response**. No timers, no polling. The relist path ignores it entirely, so a stale "active"
snapshot can never cause a relist; the click still authorizes live and the denial carries the real reason.
Fail-closed applies to display too: unreachable renders "unavailable", never "active".

**3. `marktplaatsAccountId` is dropped from `authorize`; `NOT_YOUR_ACCOUNT` is removed.**
Nothing in the extension can produce a Marktplaats account identifier — the only seller-identifying data
available is `contactInformation.{name, postcode}` from an ad capture. More fundamentally the check was
**unverifiable**: the backend cannot confirm which MP account a browser session belongs to, only the client
can assert it, and under this ADR the client is the adversary. Quota and SafetyPolicy are therefore
**per-User** for now. `MarktplaatsAccount` remains in the domain model, and "find a stable MP account
identifier" is an open spike that also blocks `maxMpAccounts` as a sellable entitlement.

## Refinement (2026-09-16): the lock reads the grant, never the remainder
The amendment above asks the UI to render locked-vs-active **before any click**. That is only honest about a
fact which cannot move under it, and of the two numbers `/api/me` carries, exactly one qualifies.

**`relistQuotaPerPeriod === 0` locks every Repost control, before anything is clicked.** A grant is the
Tier's own property: nothing its holder does changes it, only an operator editing the catalog or a purchase.
A control locked on it is still right a minute later, and the prompt beside the list says what would change
it.

**`quotaRemaining === 0` locks nothing.** That number goes back *up* without the user acting — a
`FAILED_BEFORE_DELETE` report hands its unit back, and so does reconciliation — so a button disabled on it is
one a refund has already made wrong, until somebody presses Refresh. It stays live, the click costs a round
trip, and `authorize` refuses it **before any delete**. That is the fail-closed rule above doing its job
rather than a hole in it: display state decides how a control looks and never whether a relist may happen.

The denial cannot draw this distinction for us. `QUOTA_EXCEEDED` is one refusal for both, and its `resetAt`
is real on a zero-grant tier too — the period still rolls, it just rolls to 0 — so the copy is split on the
grant from `/api/me` rather than on the reason code.
[T32](https://github.com/Shei254/marketplaats-extension/issues/41) is the work, and `../backlog.md` carries
the reasoning in full.

## Revisit if
Bypass/abuse becomes materially common → increase friction (e.g., server-signed action nonces bound to identity), never full hard enforcement without reversing ADR-0001.
