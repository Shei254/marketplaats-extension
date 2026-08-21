# Quota Enforcement — Contract & Flow

Concrete design for the subscription/quota gate. Implements ADR-0007 (backend-authorized per relist,
action-time, fail-closed) with ADR-0005/0010 (Keycloak + PKCE), ADR-0006/0014 (Stripe money, our
entitlements), and ADR-0008 (safety).

**Revised 2026-08-13** — see [ADR-0007's second refinement](adr/0007-quota-enforcement.md).
**Revised 2026-08-20** — a terminal subscription end falls back to the default tier
([ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md)), so `SUBSCRIPTION_INACTIVE` is now a
**dunning-only** state; and `GET /api/plans` is added
([ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)).

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
| Signed in, payment **failing** (dunning) | Full: ads, search | buttons **locked + "update your card"** | denied |

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
- **A terminal end falls back to the default tier** (ADR-0018). `canceled` and `incomplete_expired`, and a
  trial or period ending unpaid, move the row to the `isDefault` tier with status `active` and the period
  back to our monthly roll; `stripeCustomerId` is kept and `stripeSubscriptionId` cleared. **Dunning does
  not** — `past_due`, `unpaid` and `incomplete` keep the paid tier and stay denied, because Stripe is still
  retrying and a successful retry gives the tier straight back.
- **`SUBSCRIPTION_INACTIVE` therefore means one thing: a card that is currently failing.** Nobody who
  deliberately ended a subscription ever sees it — they see the free tier's `QUOTA_EXCEEDED` and the plan
  cards. That is what the "update your card" copy above is for, and why it is not an upsell.
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

**Amended 2026-08-20 (#27).** One `4xx` does carry one, and it is not ours to remove: an authenticated caller
without the `ADMIN` role is refused `403` by the resource server itself, with the empty body the rule above
asks for and a `WWW-Authenticate: Bearer error="insufficient_scope"` — which RFC 6750 §3.1 defines for exactly
that status and that case. The sentence above was written about the two answers this repository writes by
hand. A standards-defined header is not worth a handler of our own to strip, so what it actually sends is
pinned by `AdminGuardTest` instead. It still carries **no `reason`**, which is the part a client reads: the
presence of one means the gate turned you away.

The `400` is written by this repository rather than left to the framework (`UnreadableRequests`, #24's review).
Spring Boot's default error representation — `{timestamp, status, error, path}` — names no reason code and so
did not break the letter of the rule above, but it is a second body shape on the same two endpoints and it
echoes the caller's own request path back at them. A `415` is still Spring's, which sets the `Accept` header
RFC 9110 wants on one.

One route is exempt and it is not ours: Spring Security publishes RFC 9728 protected-resource metadata at
`/.well-known/oauth-protected-resource` and permits it, which is what the challenge above points a client at.
It answers `200` to an unauthenticated caller, disclosing the base URL that caller has just used and naming no
authorization server.

## Which build is calling
Every client names itself on every call:

    X-Mprelist-Client: extension/0.0.1

One header, because the two facts are useless apart — a version with no surface cannot be compared against
anything, and this API has more than one client. The version is Chrome's kind, not semver's: one to four
dot-separated integers, compared component-wise with a missing component read as zero, so `1.2` and `1.2.0`
are one release. The extension takes it from its own manifest, which is the number Chrome shows and the Web
Store rolls out — the only version a user can act on.

**The policy is additive-by-default** (T43, #52; refines [ADR-0011](adr/0011-repository-layout.md)). An
extension release takes days through a store review and cannot be forced on anybody; this API deploys in
minutes. So several builds are always talking to one backend, and the rule that makes that survivable is that
new fields may appear in responses and new routes beside old ones, while existing fields keep their meaning. A
client that ignores what it does not recognise keeps working — which is how `relistQuotaPerPeriod` arrived
(#41), and what the rule about unknown denial codes above is for.

**The exception is a minimum supported version**, configured per surface and shipped as `0`: every build there
has ever been. Raising it strands every user who has not updated yet, so it is for correctness and safety
only — a build that would delete an ad wrongly, or one holding something it must not — and never for tidiness.

**Below the minimum, `426 Upgrade Required` with an empty body.** This is the one answer a client reads by
*status* rather than by a reason code, and the reason is the same one that makes the codes worth having: a
`reason` is a statement about the **user** — their quota, their card, their pace — and this is a statement
about their **software**. It therefore carries none, exactly like every other `4xx` that is not a denial.

- The refusal applies to **every** route under `/api`, so a stopped build has no plan to render and no ad list
  worth listing. The extension shows one screen: what happened, that Chrome will fix it within a few hours,
  and that nothing on Marktplaats has changed. No retry button — there is nothing a retry could do.
- A client too old to understand `426` falls into "unavailable, retry", which is the right outcome for a build
  that has just been refused: it stops.
- The gate needs no arm for it. `426` is not a `200`, and `authorize` grants only on a `200`.
- **A caller that names no release is served** — `apps/web` does not send one yet, `curl` never will, and every
  extension built before T43 cannot. That is the honest limit of the mechanism: the lever only reaches builds
  that already identify themselves, which is the whole argument for shipping the header before there are users
  rather than after.
- It is identification, **not authentication**. A client could lie about its version; one modified enough to
  bother is not running our code at all.
- `X-Mprelist-Client` must be in the CORS allow-list or nothing works: a header the preflight does not allow is
  not dropped, it makes the browser abandon the whole call.

## Endpoints

### `GET /api/plans` — what can be bought
- **Auth:** `Authorization: Bearer <Keycloak access token>`. Nothing here is per-user, but the API is closed
  by default and there is no reason to open one route.
- **Returns `200`:** the **published** tiers carrying a `stripePriceId`, each as a **Plan** — our half joined
  with Stripe's:

  ```json
  { "plans": [
      { "tier": { "code": "pro", "name": "Pro" },
        "relistQuotaPerPeriod": 50,
        "features": {},
        "price": { "amount": 999, "currency": "eur", "interval": "month" } } ] }
  ```

- **The amount comes from Stripe and is cached; it is never stored** (ADR-0014/0019). This is display, so the
  cache is the whole defence — `authorize` still never calls Stripe, and this route is not on that path.
- **The free tier is absent**, and every unpublished tier with it. A tier with no price id is not something a
  buyer can choose, and a **draft** — synced by webhook at quota 0 before anyone said what it grants — must
  not be sellable (ADR-0019).
- **Stripe unreachable → `503` with an empty body**, which the plan cards render as "prices unavailable,
  retry". Never a free plan, never a stale-but-unlabelled price, and never a card whose button would open a
  Checkout for an amount we guessed. Fail-closed applies to display, as it does for `/api/me`. No `reason`,
  for the rule every non-denial refusal here follows: the codes are statements about the *user*, and this is
  one about our ability to answer at all.
- **All of them or none of them.** One price that could not be fetched takes the whole answer with it, rather
  than rendering the plans that did resolve: a plan screen is a *comparison*, and a buyer cannot tell a plan
  that is missing from a plan that does not exist. In practice it is all-or-nothing anyway — an unreachable
  Stripe fails every call, not one.
- **An empty list is a different thing and is a `200`**: nothing is on sale, which is true of every stack
  whose Stripe Prices have not been created yet (T22, #28). Answering "unavailable" there would report a
  fault that is not there.
- Consumed by the **popup**, which holds the access token and opens the Checkout URL in a tab; `apps/web`
  has no login and never calls this (ADR-0017).

### `GET /api/me` — display state, **never a grant**
- **Auth:** `Authorization: Bearer <Keycloak access token>`.
- **Returns `200`:** `{ subscriptionStatus, tier, quotaRemaining, relistQuotaPerPeriod, resetAt, features }`
  — shipped (#26), with the grant added by #41:

  ```json
  { "subscriptionStatus": "ACTIVE",
    "tier": { "code": "free", "name": "Free" },
    "quotaRemaining": 2,
    "relistQuotaPerPeriod": 3,
    "resetAt": "2026-09-14T08:31:22.101Z",
    "features": {} }
  ```

  **`relistQuotaPerPeriod` is the other half of "2 of 3"** — the sentence the popup draws, and one a client
  holding only the numerator cannot. It is the tier's grant and does not move when a unit is spent; lowering
  it under a subscriber is an operator's to do (ADR-0014), and `quotaRemaining` clamping at zero is what keeps
  the pair readable when they do. Added rather than replacing anything, which is the direction ADR-0011's
  release cadence allows: an older installed extension that has never heard of it goes on rendering what it
  did.

  `subscriptionStatus` is one of the seven normalized statuses, spelled in the same screaming case as the
  reason codes and the outcomes, so a client reads one convention across this API.
- **`tier` carries both spellings**, and that is the one place the shipped shape says more than the field list
  above. `code` is the stable handle an admin edit never moves; `name` is display text an operator may rewrite
  at any time (ADR-0014). Given only the name, a client deciding "is this the free plan" branches on text
  somebody is free to change and stops matching the day they do; given only the code, it renders `power` to a
  human or keeps a second catalog of labels ours never reaches. So both travel and which is which is stated
  here rather than guessed at each reader.
- **`200` is the only answer other than `401`.** Every user always has a subscription (ADR-0014), so there is
  nothing here to refuse: a lapsed payer and a user with nothing left are both *shown* their state, and being
  turned away is the job of the call that grants something. A caller refused here would have no way to tell a
  lapsed plan from a backend that is down, which is the same fail-closed display the last bullet asks for.
- **It grants nothing and spends nothing.** No token, no `jti`, no expiry, and no reservation is taken — a
  popup opened five times is five of these calls, and one that cost a unit would empty a free tier by being
  looked at. It carries no cooldown either: the pacing rails answer with a `retryAfter` at the moment of
  refusal (#25), and a rail has nothing to say ahead of one.
- **`quotaRemaining` is the number the gate refuses on**, from the same subtraction `/complete` answers with
  and never negative. It is counted from `usage_reservation`, which is `enforcement`'s table, so this route
  asks that module rather than counting for itself — the popup showing "1 relist left" beside a button the
  gate refuses is the failure that shares one arithmetic prevents.
- **A free window that has closed is rolled before it is answered with**, like both ends of the gate (#22,
  #23) — this is the call both clients make immediately after signing in, so it is where a user returning
  after a month would otherwise be shown a `resetAt` in the past and a quota counted in a period that ended.
- `features` is the tier's flag object as stored, `{}` on every tier in the catalog today, and sent as an
  empty object rather than omitted: "this plan grants no flags" is an answer where a missing field is a
  guess. `maxMarktplaatsAccounts` is deliberately **not** sent — nothing renders it until
  [#47](https://github.com/Shei254/marketplaats-extension/issues/47) finds an identifier that can tell two
  Marktplaats accounts apart.
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

  `retryAfter` is **whole seconds** — a number, not a date — named after HTTP's own `Retry-After` because it
  is what a client renders as a countdown, and rounded **up**, so that a client waiting exactly as long as it
  was told does not arrive a fraction of a second early and get refused twice. It travels in the body and not
  in the header of that name: everything a client acts on is in the JSON, and a second copy in a header is a
  second thing that can disagree. The two `429`s are told apart by the code and not by the status — they are
  the same statement about HTTP and different statements about the user, one of whom needs a bigger plan and
  the other of whom needs a minute.

  **The pacing rails are for the user's own Marktplaats account**, not a throttle protecting ours (ADR-0008).
  Shipped (#25) as a `30s` minimum interval between consecutive relists and at most `10` inside a sliding `1h`
  window — three settings, all configuration, none defaulted in code. The longer of the two rails answers, and
  the burst rail is measured from the cap-th most recent relist rather than the oldest in the window, so the
  wait it names is a moment at which this actually stops refusing. **Jitter around the interval is the
  extension's** ([#54](https://github.com/Shei254/marketplaats-extension/issues/54)) and can be nothing else:
  a backend can refuse a call that came too soon, it cannot make one arrive at a human-shaped moment.

  **Pacing counts attempts; quota counts what was kept.** The rail reads every reservation this caller has
  taken, whatever became of it — a `FAILED_BEFORE_DELETE` hands its unit back but had already captured an ad
  and fetched its photos, and a rail that forgave every failure would stop pacing an extension exactly when it
  started failing. So the two reads have no predicate in common and neither is the other's filter.
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

**Amended 2026-08-20 (#35) — what an *interrupted* relist needs.** An MV3 worker is evicted mid-flight, so a
relist can be finished minutes or hours after the grant that started it expired. The rule is not "resume
re-authorizes" but the narrower one that says why:

| The snapshot says | Finishing it can | So it |
|---|---|---|
| `captured` — the delete may not have run | delete a listing | **needs a fresh `200`**, like any other relist |
| `deleted` — the ad is already gone | only put the ad back | **does not** |

Both halves matter. The snapshot store is `chrome.storage.local`, which under ADR-0007 the *user* can write,
so a fabricated `captured` snapshot must not be a way to delete-and-recreate for nothing. And refusing the
other half would leave somebody's listing deleted because their quota ran out mid-relist — the exact outcome
ADR-0003 keeps a snapshot to prevent, and a fabricated `deleted` snapshot buys nothing anyway, since posting
an ad is something anyone may do on Marktplaats for free.

**The reservation rides in the snapshot**, so whichever grant paid for the attempt is the one its outcome is
reported against — however long later, and whether or not reconciliation has already refunded it (a late
report still wins, above).

## Extension gating states (UI)
| Backend result | Control state |
|---|---|
| `200` OK | active → proceeds with delete-first relist (ADR-0003) |
| `402 SUBSCRIPTION_INACTIVE` | shown but locked → **"update your card"** + Portal link (dunning only) |
| `429 QUOTA_EXCEEDED` | shown → **upgrade** prompt + `resetAt` |
| `429 RATE_LIMITED` | shown → cooldown timer (`retryAfter`) |
| `401` / unreachable / timeout | shown → "unavailable, retry" (fail-closed) |
| not signed in | sign-in screen; nothing injected |

That mapping is a function rather than a habit: `apps/extension/src/gate/authorization-gate.ts` (T25, #34)
turns an attempt into `proceed` or a locked state, and nothing else in the extension decides it. It reads the
**code and never the status** — the two `429`s above are one statement about HTTP and two about the user — and
it maps every reason `@mprelist/contracts` declares, so a code added there without an answer here is a compile
error. A code from a *newer* backend than the installed build, which the release cadence makes a certainty
rather than an edge case, refuses with "retry": the safe reading of a denial nobody here recognises is that we
were turned away.

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
