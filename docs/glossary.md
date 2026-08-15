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
| **Entitlement** | Limits/features derived from a Subscription's Tier (relists per period, max MP accounts, feature flags) — what quota checks read. Resolved from our Tier table, **never** from Stripe on the hot path. |
| **RelistEvent (UsageRecord)** | The backend's record of what a relist it authorized turned out to be — one per settled reservation, refunds included, which is what makes it the breakage canary rather than the count. |
| **UsageReservation** | The quota unit itself, held from `authorize` until `complete` settles or refunds it. Usage in a period is the reservations in it that were not refunded, so an in-flight relist already counts. _Avoid_: hold, pending usage, in-flight relist. |
| **RelistAuthorization** | A short-lived signed backend OK the extension must obtain before a gated relist (ADR-0007). Its `jti` is the id of the reservation it was issued against. |
| **SafetyPolicy** | Per-User rate limits, human-like pacing/jitter, and caps — harm-reduction for the user's own account (ADR-0008). |

| **Default tier** | The Tier flagged `isDefault`, auto-assigned to every User on first login. Currently the free tier; removing free = unset the flag and migrate rows (ADR-0014). _Avoid_: Free plan as a special case. |
| **Quota period** | The `[periodStart, periodEnd)` window on a Subscription that usage is counted within. Copied from Stripe for payers, rolled monthly from signup for free users. `resetAt` = `periodEnd`. |
| **Display state** | The unsigned `GET /api/me` snapshot (status, tier, quota, resetAt, features) the UI renders from. Explicitly **not** an authorization — the relist path ignores it (ADR-0007). _Avoid_: cached grant, session state. |
| **Golden payload** | A byte-exact snapshot of a request the internal-API layer emits (method, URL, headers, body including form field order), asserted with `fetch` stubbed. Freezes the working Marktplaats calls so the code around them can be refactored (ADR-0015). |
| **Client config** | The backend-served document of endpoint paths, CSRF extraction rules and DOM anchors that overrides the extension's hardcoded defaults. Strictly data, never executable (ADR-0013). _Avoid_: remote code, feature flags. |
| **Endpoint override** | A tester's local pin of one or more endpoint paths, stored under `endpointOverrides` by the `__setEndpoints` dev hook. Only the keys named are stored, so an endpoint left alone still follows the build's default. A third resolution source alongside built-in defaults and the **Client config** — where the served value ranks between them is T27's open call. |
| **Breakage canary** | The `/complete` outcome mix. A rising `FAILED_BEFORE_DELETE` rate means Marktplaats changed something and a client-config hotfix is needed. |
| **Ownership detection** | Deciding, on an arbitrary marktplaats.nl page, that an ad belongs to the current user before injecting a Repost control. **Open spike** — to be pinned against the real DOM. |

<!-- Add terms as they are defined during grilling. -->
