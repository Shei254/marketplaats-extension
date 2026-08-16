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
answerable.

A free window is rolled **when it is next read** — by either end of the gate: `authorize` before it counts
against one (#22), `complete` before it answers with one (#23), and `complete` only once it knows the `jti` is
the caller's, so a value nobody was issued rolls nothing — in whole calendar months **anchored on the
subscription's creation** rather than on the window being
replaced, so that an account provisioned on the 31st does not spend every month after February on the 28th. A
window Stripe owns is never rolled here: a closed one means a webhook has not arrived yet, and moving it would
grant a period Stripe did not (#30 is what moves it). Usage is the reservations in `[periodStart, periodEnd)` that were not refunded — the
**reservation holds the unit**, from `authorize` until `complete` settles or refunds it, so a relist still
in flight already counts against quota. A RelistEvent records what the extension reported, refunds
included, and is therefore not itself the count (#17).

## Denial shape
Every denial carries a typed `reason` code in a JSON body — `{ "reason": "<CODE>" }` — plus whatever that code
adds (`resetAt`, `retryAfter`), and nothing else: a code that adds nothing sends nothing, rather than a null
field inviting a client to render a value it does not have. The extension's gate reads the code, never the
prose.

It is UTF-8, in two spellings the client can treat as one. The `401` is written by hand and says
`application/json;charset=UTF-8`, because a servlet writer that has not been told otherwise is ISO-8859-1; the
denials a handler returns are written by the JSON converter and say `application/json`, which is UTF-8 by
definition of the media type.

`401 UNAUTHENTICATED` is the one that exists today (#19) and is the shape the rest follow. It is answered for
every route this repository writes, including ones no ticket has written yet: the API is closed by default, so
an unauthenticated call reaches no handler at all. It also carries the `WWW-Authenticate: Bearer` challenge
RFC 6750 requires, which is where *how* a presented token was wrong is said — the body says only that the
caller is not authenticated, because that is the whole of what a client acts on.

A `4xx` that is *not* a denial **carries an empty body** — no `reason`, and nothing else either — so a client
can read the presence of `reason` as meaning it was turned away. `/complete` ships the first two (#23): a body
this API could not read is a `400`, and a `jti` naming no reservation of the caller's is a `404`. Both answer
with the status and nothing to parse beside it.

It carries no `WWW-Authenticate` either. That challenge belongs to the `401` and to nothing else (RFC 6750):
these callers were authenticated, they named something this API could not read or could not find.

The `400` is written by this repository rather than left to the framework (`UnreadableRequests`, #24's review).
Spring Boot's default error representation — `{timestamp, status, error, path}` — names no reason code and so
did not break the letter of the rule above, but it is a second body shape on the same two endpoints and it
echoes the caller's own request path back at them. A `415` is still Spring's, which sets the `Accept` header
RFC 9110 wants on one.

One route is exempt and it is not ours: Spring Security publishes RFC 9728 protected-resource metadata at
`/.well-known/oauth-protected-resource` and permits it, which is what the challenge above points a client at.
It answers `200` to an unauthenticated caller, disclosing the base URL that caller has just used and naming no
authorization server.

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
  `{ "authToken": "<JWT>", "expiresAt": "<~45s out>", "jti": "..." }`, with `expiresAt` an ISO-8601 instant.
  The `authToken` is a backend-signed JWT embedding `{ sub, adId, jti, exp }` — where `sub` is our own
  `app_user` id rather than the IdP subject the caller's own token carries, and `jti` is the reservation, which
  is what `complete` settles.
- A body carrying fields this contract does not name — an older extension build still sending
  `marktplaatsAccountId` — is **not refused for them**: they are ignored. A body naming no `adId` is a request
  that could not be read, so it is a `400` with no reason code, per the denial shape above.
- **Checked, and spent, as one decision.** The check reads the caller's subscription row under a lock held for
  the length of the call, so two of the same user's requests in flight cannot both pass a quota that has one
  unit left in it. Nobody else waits: the lock is that user's own row.

### `POST /api/relist/complete`
- **Auth:** `Authorization: Bearer <Keycloak access token>`, and the reservation must be **that caller's own**.
- **Body:** `{ "jti": "...", "outcome": "SUCCESS" | "FAILED_BEFORE_DELETE" | "FAILED_AFTER_DELETE" }`
- Resolves the reservation the `jti` names, and records a **RelistEvent** against it either way.
  - `SUCCESS` / `FAILED_AFTER_DELETE` → the reservation **settles**; usage stands (the destructive action
    happened).
  - `FAILED_BEFORE_DELETE` → the reservation is **refunded**; nothing was consumed on Marktplaats, so the
    unit returns to the period. The RelistEvent is still written — that is the canary below.
- Idempotent on `jti`: the event's reservation id is unique, so a second report collides in the database, and
  the endpoint answers that collision with the unchanged `{quotaRemaining, resetAt}` rather than an error.
  **The first report decides** and a later one cannot revise it — a `FAILED_BEFORE_DELETE` after a `SUCCESS`
  does not hand back the unit for a relist that happened.
- **No check runs here** (#23). A lapsed subscription, an exhausted quota, or a grant whose 45 seconds ran out
  long ago are all still reported on: this call grants nothing, and refusing it would hold the unit for the
  rest of the period and lose exactly the outcome the canary is watching for. The token's lifetime bounds how
  long an *authorization* is good for, not how long the extension has to say what it did with one.
- A `jti` naming no reservation **of this caller's** is a `404` with no reason code — the shape above for a
  `4xx` that is not a denial. Deliberately the same answer for one that never existed and one belonging to
  somebody else, so that it cannot be used to ask whether an id is anybody's. A `jti` that is not shaped like a
  reservation id is a `400` instead: "we could not read this" and "this is not yours" are different things for
  a client to do about. **The ownership question is asked first**, before the subscription is read: reading one
  takes a write lock on the caller's row and may roll a closed window, and the `jti` is the one input to this
  call an adversary chooses (ADR-0007). A reservation's owner never changes, so nothing is lost by asking
  outside the lock.
- No `authToken` in the body, and **nothing here verifies one**: the `jti` is the reservation's own id, so this
  resolves a row in our own table, and who the caller is comes from their access token. That is why the signing
  key of the authorization is still generated per process — see the build question below.
- A never-completed reservation expires and auto-refunds after a grace window (#24, shipped: a fixed-delay job
  every `5m`, refunding reservations still held `30m` past the `expiresAt` of the grant they were taken for —
  both configurable, neither defaulted in code). A report arriving after that refund still wins: it is the only
  account of what actually happened on Marktplaats, and reconciliation is the guess made in its absence. The
  job writes **no** RelistEvent, because all three outcomes are things the extension observed and it observed
  only that nothing was said — a row there would put an invention into the canary below. It is measured from
  `expiresAt` rather than from when the unit was taken, so a relist is judged against the authorization it was
  actually given, and the window is generous because the two mistakes are not symmetric: guessing early costs
  a unit the eventual report settles back, guessing late holds a free user's month a third short.
- **Returns the updated `{ quotaRemaining, resetAt }`**, so a relist needs no follow-up `/api/me` call.
  `quotaRemaining` is **never negative**: a tier's quota is an operator's to edit (ADR-0014), so a subscriber
  can hold more units than their tier now grants, and that state reads as nothing left rather than as less than
  nothing. It is the same number the gate refuses on, from the same subtraction.

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
   │  complete(jti, outcome) ──────▶│ settle/refund the reservation│
   │                                │ record the RelistEvent   │
   │  ◀── {quotaRemaining, resetAt}─│                          │
```

## Resolved build questions
- **Build tool / Java version:** Gradle, Java 21, Flyway migrations (ADR-0012). Package base `com.mprelist`.
- **`complete` required?** Yes — reserve/complete with refund, for the telemetry reason above as much as for
  quota accuracy. Counting at authorize alone would charge users for relists that never touched Marktplaats,
  which is punishing on a 3-relist free tier.
- **JWT signing key management:** backend-held asymmetric key, rotated. **Not yet true, and knowingly so:**
  #22 signs with an RSA key generated per process and held in memory, because nothing verifies one of these
  tokens — `complete` takes a `jti` and resolves the reservation it names in our own table. A restart therefore
  invalidates at most 45 seconds of grants, and a second instance of the API would sign with a second key. The
  first code that *verifies* an `authToken` is what has to make the key configuration. #23 was named as that
  code and turned out not to be it: resolving the row answers everything verifying the token would, and better,
  since the caller's own access token already says who they are. **No ticket is open that needs to verify one**,
  so a second instance of this API is the thing that cannot be deployed today, and it is the reason to make the
  key configuration when one is wanted.

## Open spikes
- **Stable Marktplaats account identifier** — blocks `maxMpAccounts` as a sellable entitlement and the return
  of any ownership check to this contract.
- **`listMyAds` pagination** — unverified. The current client does `data.ads ?? []` with no paging, and
  `searchAd` hits the same path with a `query` param, which is weak evidence the endpoint is paged.
- **Tier quota edited under existing subscribers** — deferred with the admin CRUD UI.
