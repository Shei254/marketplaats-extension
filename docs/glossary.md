# Glossary

Domain terms for the Marktplaats relisting extension. Kept current as the design is grilled.

| Term | Definition |
|---|---|
| **Marktplaats** | Large Dutch online classifieds marketplace (owned by Adevinta). Our target platform. Site: marktplaats.nl. |
| **Advertentie (Listing / Ad)** | A single item a seller has posted for sale on Marktplaats. |
| **Relist / "Opnieuw plaatsen"** | Marktplaats action that refreshes a listing's timestamp so it re-appears near the top of recency-sorted results. The core action our product automates. |
| **Bump** | Generic term for any action that pushes a listing back up in ranking (relist is the free form; paid promotion is another). |
| **Verkopen Omhoog / Topper / Dagtopper** | Marktplaats's *paid* promotion products that raise a listing's visibility. Distinct from the free relist. |
| **dotb.io** | Reference competitor: a Chrome browser extension automating Vinted (repost/bump, multi-account, AI). Client-side, subscription-based. Our stated inspiration. |
| **POC (Proof of Concept)** | First deliverable: an icon next to a user's own listing that lets them relist it once. |
| **Execution model** | *Undecided.* Whether relists run client-side (browser extension in the user's session) or server-side (cloud backend acting on the user's behalf). See ADR-0001. |
| **Content script** | Extension code injected into the marktplaats.nl page DOM; how we would render the icon and read listing data client-side. |
| **App account** | A user's identity *in our product* (for auth + subscription). Distinct from their Marktplaats account. |
| **Marketplace session** | The user's authenticated Marktplaats login (cookies/tokens) that any relist action must ride on. |

| **Mijn Advertenties** | The seller's own ad-management view on Marktplaats, where they see and control (edit/delete/post) their own listings. |
| **Internal-API replay** | The extension calling Marktplaats's own private endpoints (list my ads, delete ad, create ad) in the background using the user's logged-in session cookies — the engine behind both relist surfaces (ADR-0004). |
| **Popup panel** | The extension's toolbar-triggered UI listing all of the user's ads with a per-ad relist action; no page navigation. |
| **Durable snapshot** | The full pre-delete capture of an ad (all fields + photo blobs) stored in `chrome.storage.local`, enabling retry/restore in the delete-first flow (ADR-0003). |
| **CSRF/session token** | A token Marktplaats may require on internal write calls; replaying it correctly is an open POC spike. |

| **User (App account)** | An identity in our product, issued by Keycloak. One human = one User. Separate from any Marktplaats account. |
| **CurrentUser** | The caller of the request being handled, resolved from the validated access token: the IdP subject and nothing else. Distinct from **User (App account)**, which is a row — a CurrentUser exists on the first authenticated request, before any row does. _Avoid_: principal, session user. |
| **UserRef** | The **User (App account)** row behind a CurrentUser. Asking for one is what provisions it, so a handler that declares it cannot run before the account and its Subscription exist (T11); one that only needs to know who is calling declares a CurrentUser and touches no database. _Avoid_: user id, account id. |
| **First login** | The first request carrying an IdP subject no `app_user` row holds. This API is a resource server and nobody signs in *to* it, so there is no login event of its own — this is the moment T11 provisions the account and its default-tier Subscription, in one transaction. _Avoid_: signup, registration. |
| **MarktplaatsAccount (association)** | A Marktplaats account associated with a User — label + MP id only, **never credentials/session**. Supports multi-account. |
| **Subscription** | The User's plan, mirrored from Stripe via webhooks; carries tier/status/period. |
| **Tier** | A named plan in **our** catalog (Postgres): quota-per-period, max MarktplaatsAccounts, feature flags, plus a `stripePriceId` linking it to the Stripe Price that carries amount/currency/interval. Admin-managed. _Avoid_: Plan, Package, Product. |
| **Entitlement** | Limits/features derived from a Subscription's Tier (relists per period, max MP accounts, feature flags) — what quota checks read. Resolved from our Tier table, **never** from Stripe on the hot path. Resolved from a **Tier**, not from a User (T12): which tier somebody is on is the Subscription's to say. Carries no window and no rate — the **Quota period** is on the Subscription and pacing is the **SafetyPolicy**'s. _Avoid_: plan limits, quota (which is one field of it). |
| **RelistEvent (UsageRecord)** | The backend's record of what a relist it authorized turned out to be — one per reservation a report resolved, refunds included, which is what makes it the breakage canary rather than the count. Its unique `reservationId` is also what makes `/complete` idempotent: the second report for one authorization conflicts there, and the **first report decides** (T14). _Avoid_: usage row (the unit is on the UsageReservation). |
| **UsageReservation** | The quota unit itself, held from `authorize` until `complete` settles or refunds it. Usage in a period is the reservations in it that were not refunded, so an in-flight relist already counts. Taken only after every check has passed, and under the lock on the caller's Subscription that makes checking and spending one decision (T13). _Avoid_: hold, pending usage, in-flight relist. |
| **Settle / Refund** | What a report does to the reservation it names (T14). `SUCCESS` and `FAILED_AFTER_DELETE` **settle** it — the ad was deleted, so the unit stays spent — and `FAILED_BEFORE_DELETE` **refunds** it, since nothing was consumed on Marktplaats. Both are terminal, and a *report* writes a RelistEvent either way; a **Reconciliation** refund writes none. _Avoid_: commit, cancel, void. |
| **Reconciliation** | The scheduled job that refunds a UsageReservation nothing ever reported on, once its RelistAuthorization has been expired longer than the **grace window** (T15). The one guess in the enforcement path, and the weaker claim of the two: a report arriving afterwards settles the unit back, because it is the only account of what happened on Marktplaats. Writes no RelistEvent — the three outcomes are things the extension observed, and this observed only silence. _Avoid_: expiry sweep, cleanup, garbage collection. |
| **Grace window** | How long past a RelistAuthorization's `expiresAt` a reservation is left alone before Reconciliation hands its unit back — how long we wait for a report, not how long a relist takes. Configuration, not a constant (T15). _Avoid_: timeout, TTL (that is the authorization's ~45s). |
| **Quota remaining** | What a tier grants per period less the units the current period is holding, **never below zero** — one subtraction with two readers, the gate's refusal and `/complete`'s answer (T14), with `/api/me` to come. The clamp is not cosmetic: an operator may lower a tier's quota under a subscriber (ADR-0014). _Avoid_: quota left over, credits. |
| **RelistAuthorization** | A short-lived signed backend OK the extension must obtain before a gated relist (ADR-0007). Its `jti` is the id of the reservation it was issued against. |
| **SafetyPolicy** | Per-User rate limits, human-like pacing/jitter, and caps — harm-reduction for the user's own account (ADR-0008). |

| **Default tier** | The Tier flagged `isDefault`, auto-assigned to every User on first login. Currently the free tier; removing free = unset the flag and migrate rows (ADR-0014). _Avoid_: Free plan as a special case. |
| **Quota period** | The `[periodStart, periodEnd)` window on a Subscription that usage is counted within. Copied from Stripe for payers, rolled monthly from signup for free users. `resetAt` = `periodEnd`. A free window is rolled **when the gate next reads it** (T13), in whole calendar months anchored on the Subscription's creation — anchoring on the window being replaced would re-anchor on February's clamped 28th and walk the reset day earlier. A Stripe-owned window is only ever moved by its webhook (T20). |
| **Display state** | The unsigned `GET /api/me` snapshot (status, tier, quota, resetAt, features) the UI renders from. Explicitly **not** an authorization — the relist path ignores it (ADR-0007). _Avoid_: cached grant, session state. |
| **Golden payload** | A byte-exact snapshot of a request the internal-API layer emits (method, URL, headers, body including form field order), asserted with `fetch` stubbed. Freezes the working Marktplaats calls so the code around them can be refactored (ADR-0015). |
| **Client config** | The backend-served document of endpoint paths, CSRF extraction rules and DOM anchors that overrides the extension's hardcoded defaults. Strictly data, never executable (ADR-0013). _Avoid_: remote code, feature flags. |
| **Endpoint override** | A tester's local pin of one or more endpoint paths, stored under `endpointOverrides` by the `__setEndpoints` dev hook. Only the keys named are stored, so an endpoint left alone still follows the build's default. A third resolution source alongside built-in defaults and the **Client config** — where the served value ranks between them is T27's open call. |
| **Breakage canary** | The `/complete` outcome mix. A rising `FAILED_BEFORE_DELETE` rate means Marktplaats changed something and a client-config hotfix is needed. |
| **Ownership detection** | Deciding, on an arbitrary marktplaats.nl page, that an ad belongs to the current user before injecting a Repost control. **Open spike** — to be pinned against the real DOM. |

<!-- Add terms as they are defined during grilling. -->
