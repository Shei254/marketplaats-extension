# Backlog

Derived from the 2026-08-13 grilling session and **re-cut by the 2026-08-20 one**. Decisions live in
[`adr/`](adr/README.md); the wire contract is [`enforcement-contract.md`](enforcement-contract.md). This file
is the work breakdown, not a decision record — if it disagrees with an ADR, the ADR wins.

The work is cut into **vertical slices** ([ADR-0016](adr/0016-vertical-slices-and-review-gates.md)): a slice
ends at something a human can click through, not at a layer that can be unit-tested. **A slice is done when
its script in [`click-through.md`](click-through.md) has been walked against a real build** — not when its
tickets close.

**Ticket ids are stable.** A ticket that moved between milestones kept its number, so every GitHub issue and
every ADR reference to a `T`-number still resolves.

**Sizes:** S ≈ under a day · M ≈ 1–3 days · L ≈ 3+ days.

---

## Shipped — the backend gate

Milestones 0–2 of the original plan, issues #9–#26. All closed.

| | | |
|---|---|---|
| T47 | typecheck drift fixed | [#55](https://github.com/Shei254/marketplaats-extension/issues/55) |
| T01 | golden-payload tests freezing the internal-API layer | [#9](https://github.com/Shei254/marketplaats-extension/issues/9) |
| T02 | endpoint config collapsed | [#10](https://github.com/Shei254/marketplaats-extension/issues/10) |
| T03 | monorepo restructure | [#11](https://github.com/Shei254/marketplaats-extension/issues/11) |
| T04 | POC Options page and console hooks removed | [#12](https://github.com/Shei254/marketplaats-extension/issues/12) |
| T05 | `infra/docker-compose.yml` — Postgres + Keycloak | [#14](https://github.com/Shei254/marketplaats-extension/issues/14) |
| T06 | Keycloak realm, three clients, roles, dev users | [#15](https://github.com/Shei254/marketplaats-extension/issues/15) |
| T07 | Spring Boot skeleton with enforced module boundaries | [#16](https://github.com/Shei254/marketplaats-extension/issues/16) |
| T08 | Flyway schema | [#17](https://github.com/Shei254/marketplaats-extension/issues/17) |
| T09 | tier catalog seeded — `free` 3, `pro` 50, `power` 200 | [#18](https://github.com/Shei254/marketplaats-extension/issues/18) |
| T10 | OAuth2 resource server + `identity` | [#19](https://github.com/Shei254/marketplaats-extension/issues/19) |
| T11 | auto-provisioned Subscription on first login | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) |
| T12 | `catalog`: Tier → Entitlement | [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| T13 | `POST /api/relist/authorize` — check and reserve as one decision | [#22](https://github.com/Shei254/marketplaats-extension/issues/22) |
| T14 | `POST /api/relist/complete` — settle, refund, idempotent on `jti` | [#23](https://github.com/Shei254/marketplaats-extension/issues/23) |
| T15 | reservation reconciliation job | [#24](https://github.com/Shei254/marketplaats-extension/issues/24) |
| T16 | SafetyPolicy rate and pacing rails | [#25](https://github.com/Shei254/marketplaats-extension/issues/25) |
| T17 | `GET /api/me` | [#26](https://github.com/Shei254/marketplaats-extension/issues/26) |

**None of it has ever been looked at.** That is what slice A is for, and it is the reason for ADR-0016.

---

## Iteration 1 — the loop, on one machine, in Stripe test mode

Everything up to and including a user paying and being unlocked, running locally. Real Checkout, a real card
number, a real webhook forwarded by the Stripe CLI — not a mock. What it does **not** cover is anybody else
reaching it; that is [Go-Live](#go-live--making-it-reachable-by-somebody-else).

### Critical path

```
T44 ext id ──▶ T23 PKCE ──▶ T24 tokens ──┐
                                          ├──▶ T29 shell ──▶ T30a list  ═══▶ SLICE A
T48 brand ──▶ T28 packages/ui ────────────┘                     │
                                                                ▼
                          T25 gate fn ──▶ T26 orchestrator ──▶ T30b rows ──▶ T32 quota  ═══▶ SLICE B
                                                                │
T22 Stripe ──▶ T51 sync ──▶ T49 /api/plans ──▶ T52 plan cards ──┤
                       └──▶ T19 checkout ──▶ T20 webhook ──▶ T21 portal   ═══▶ SLICE C
T50 apps/web ──▶ T36 legal ─────────────────────────────────────┘
                                                                │
                          T18 admin guard ──▶ T53 tier CRUD ──▶ T54 /admin  ═══▶ SLICE D
```

---

### Slice A · I can sign in
**Review:** load unpacked, click the icon, sign in through Keycloak, and see your plan and quota above your
real ads. → [script](click-through.md#slice-a--i-can-sign-in)

#### [T44](https://github.com/Shei254/marketplaats-extension/issues/13) · Pin the extension ID · **S** · runbook, first
A `key` in `manifest.json` giving a stable extension id. **Blocks everything**: the realm's redirect URI is
`https://${MPRELIST_EXTENSION_ID}.chromiumapp.org/` and the realm imports on **first start only**, so an
unpinned id means `down -v` later.

#### [T48](https://github.com/Shei254/marketplaats-extension/issues/78) · `brand.json` and a templated manifest · **S** · no deps
One root `brand.json` — `name`, `tagline`, `domain`, `supportEmail` — read by `scripts/build.mjs`, which
templates `public/manifest.template.json` instead of `cp`-ing `manifest.json`. Also feeds the popup header,
the `<title>`, and later `apps/web`.
- The name is **Bumpr**, provisionally, and must never lead with "Marktplaats" — Web Store policy forbids
  trademark use implying endorsement. Marktplaats belongs in the *description*.
- Distinct from the internal identifier `mprelist`, which is frozen (`com.mprelist`, `@mprelist/*`, the realm,
  the database). Renaming the brand is one file; renaming the identifier is not.
- Drops the `(POC)` suffix. Refs: [glossary — Brand name](glossary.md).

#### [T23](https://github.com/Shei254/marketplaats-extension/issues/32) · `launchWebAuthFlow` + PKCE sign-in · **L** · T06, T44
Authorization Code + PKCE against Keycloak; sign-out clears tokens.
Refs: [ADR-0010](adr/0010-extension-authentication.md).

#### [T24](https://github.com/Shei254/marketplaats-extension/issues/33) · Token storage and on-demand refresh · **M** · T23
- **Refresh at call time, never on a timer** — the MV3 worker sleeps.
- Concurrent callers share one in-flight refresh (the pattern `ensureCsrfToken` already uses).
- Refresh failure surfaces as signed-out, not as an error state.

#### [T28](https://github.com/Shei254/marketplaats-extension/issues/37) · `packages/ui` foundation · **M** · T48, design canvas
Tokens (colour, spacing, type scale, motion) and base components, light and dark — today's popup already
supports both. Consumed by the popup and `apps/web` ([ADR-0017](adr/0017-web-surface-and-subscribing.md)).
**Encodes the agreed design canvas**, not guesses — that is why the canvas comes first (ADR-0016).

#### [T29](https://github.com/Shei254/marketplaats-extension/issues/38) · React popup shell and state routing · **M** · T24, T28
Routes between signed-out / loading / signed-in / unavailable. Signed out shows **only** sign-in. Renders the
`/api/me` snapshot — tier name, quota remaining, `resetAt`. Unreachable backend renders "unavailable", never
"active".

#### [T30a](https://github.com/Shei254/marketplaats-extension/issues/39) · Ad list in React · **M** · T29
Port the existing list rendering — title, price, empty state, refresh. **No relist behaviour yet**; the row
state machine is T30b, in slice B. Split from the original T30 so slice A ends at a screen with real ads on
it rather than an empty shell.

---

### Slice B · The gate bites
**Review:** relist and watch the count fall; exhaust the quota and watch the button lock; relist twice
quickly and watch the cooldown. → [script](click-through.md#slice-b--the-gate-bites)

#### [T25](https://github.com/Shei254/marketplaats-extension/issues/34) · Authorization gate — pure decision function · **M** · contract only
`(backendResponse) -> Proceed | Refuse(uiState)`. No DOM, no fetch, no Chrome APIs.
- **Fails closed** on every non-200, network error and timeout.
- Maps `SUBSCRIPTION_INACTIVE → update-card`, `QUOTA_EXCEEDED → upgrade`, `RATE_LIMITED → cooldown`,
  else `retry`. Note the first is now **dunning only** — a cancelled customer is a free user
  ([ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md)) — so the copy is "your payment didn't go
  through", not "resubscribe".
- First consumer of `packages/contracts`; creates it rather than inlining the wire types.

#### [T26](https://github.com/Shei254/marketplaats-extension/issues/35) · Wire the gate into `RelistOrchestrator` · **M** · T13, T14, T24, T25
`authorize` → existing delete-first flow **unchanged** → `complete` with the mapped outcome.
- `failed-before-delete` → `FAILED_BEFORE_DELETE`; `failed-recoverable` → `FAILED_AFTER_DELETE`.
- The engine runs **only** on `Proceed`.
- `resumeAll()` on startup re-authorizes rather than assuming a prior grant.

#### [T30b](https://github.com/Shei254/marketplaats-extension/issues/79) · Per-row relist state machine · **M** · T26, T30a
The idle/busy/done/failed behaviour the POC popup has, including the one-relist-at-a-time lock that stops a
distracted click fanning out into several deletes.

#### [T32](https://github.com/Shei254/marketplaats-extension/issues/41) · Quota display and locked states · **S** · T17, T30b
Remaining quota and `resetAt` in the header; locked buttons carrying upgrade / update-card / cooldown per the
reason code, with `retryAfter` rendered as a countdown.

---

### Slice C · I can pay, and it unlocks
**Review:** locked popup → plan cards → real Stripe Checkout → `4242…` → success page → reopen the popup and
it says Pro. Then cancel in the Portal and land back on Free.
→ [script](click-through.md#slice-c--i-can-pay-and-it-unlocks)

#### [T22](https://github.com/Shei254/marketplaats-extension/issues/28) · Create Stripe Products and Prices · **S** · runbook
**Test mode** for iteration 1. iDEAL and SEPA enabled. **No trial days** — the free tier is the trial
([ADR-0006](adr/0006-billing.md), amended). Each Price tagged **`metadata.tier_code`** (`pro`, `power`),
which is what T51 syncs on. Amounts are decided here, not in code.
- **The Price's `nickname` is what names the tier**, and only if it has one — T51 writes it through a
  `coalesce`, so a Price with no nickname leaves Pro called Pro rather than renaming it to nothing. A tier
  the catalog has never heard of and whose Price has no nickname is named after its own code.
- The endpoint's **signing secret** is what the API verifies every event against; it is per `stripe listen`
  session locally and per endpoint once deployed, and unset it refuses everything.

#### [T51](https://github.com/Shei254/marketplaats-extension/issues/82) · `tier.published` + Price → Tier sync webhook · **M** · T08, T22
Migration adding `published boolean not null default false`, plus `price.created`/`price.updated` handling.
- **Upserts on `metadata.tier_code`**, writing `name` and `stripe_price_id` and **never touching a quota** —
  the rule `V2__seed_tier_catalog.sql` already states for itself.
- An unrecognised code inserts a **draft**: quota 0, `published = false`, unbuyable.
- A Price with **no** `tier_code` is not a plan and is ignored. The admin list (T53) must surface unadopted
  Prices, since a missing tag is otherwise silent.
- Backfills `published = true` for the seeded `pro` and `power` once their Prices land.
- Refs: [ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md).

#### [T49](https://github.com/Shei254/marketplaats-extension/issues/80) · `GET /api/plans` · **M** · T12, T51 · **shipped**
Published tiers with a price id, each joined with its Stripe Price — quota and flags ours, amount and
currency and interval Stripe's, **cached and never stored**.
- The free tier and every draft are absent; there is nothing there to buy.
- Stripe unreachable → **`503` with an empty body**, rendered as "prices unavailable, retry". Never a guessed
  amount, never a free plan — and **all of them or none of them**, because a plan screen is a comparison and
  a buyer cannot tell a plan that is missing from a plan that does not exist. An empty list is a different
  thing and is a `200`: nothing is on sale.
- The cache is safe for an unusual reason: Stripe Prices are **immutable** (ADR-0019), so a cached amount
  cannot go stale. What changes is which id a tier points at, and that is read from our own table every time.
- `authorize` still never calls Stripe — this is display, not the hot path.

#### [T19](https://github.com/Shei254/marketplaats-extension/issues/29) · Stripe Checkout session endpoint · **M** · T12, T51 · **shipped**
`POST /api/checkout` takes a tier **code**, resolves it against the same published list `GET /api/plans`
renders, and answers with the session URL. So a tier that is unpublished or has no price is unbuyable by
construction rather than by a second `where` clause remembering to say so.
- `success_url`/`cancel_url` point at `apps/web`'s loginless pages (T50, #81).
- **`404` when nothing is on sale under that code, `503` when Stripe could not be asked** — different
  statuses because only one of them is worth a retry.
- The session carries our **account id** twice: as `client_reference_id`, which the Stripe dashboard shows
  beside the payment, and as `subscription_data.metadata.app_user_id`, which is what T20 actually pulls on —
  this API holds no email address to match on (#108). An existing `stripe_customer_id` is passed when there is
  one, so ADR-0018's cancel-and-return is one billing history rather than two.

#### [T20](https://github.com/Shei254/marketplaats-extension/issues/30) · Stripe webhook receiver → Subscription mirror · **L** · T11 · **shipped**
`customer.subscription.created`, `.updated` and `.deleted` become the plan somebody is on — the only thing in
this application that moves anybody onto a paid tier. Status, tier and Stripe's own billing period are
mirrored onto the subscriber's row; `trialing` goes through with no special-casing anywhere.
- **Terminal end falls back to the default tier**, `active`, period back on our monthly roll anchored where it
  always was, `stripe_customer_id` kept and `stripe_subscription_id` cleared. **Dunning does not** —
  `past_due`, `unpaid`, `incomplete` keep the paid tier and stay denied, so `SUBSCRIPTION_INACTIVE` means a
  card that is currently failing and nothing else. Refs:
  [ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md).
- **The thread is `metadata.app_user_id` on the subscription**, written by T19's Checkout session and copied
  by Stripe onto the subscription itself, so every event about it names the account — the first one and the
  cancellation months later. `checkout.session.completed` is deliberately **not** handled: it carries no
  status, Price or period, and Stripe usually sends it after the subscription was created. The customer id is
  the fallback lookup, for a subscription made in the dashboard for somebody we already bill.
- **Order and repetition are one column, not a log of event ids.** `subscription.mirrored_through` holds the
  `created` of the newest event applied, and an older one is not applied — which stops a three-day retry of
  Monday's cancellation from undoing Tuesday's resubscription, and makes a redelivery a no-op. Equal
  timestamps do apply: Stripe stamps whole seconds, and a Checkout generates two events inside one.
- **Three things it will not guess**, each leaving the plan exactly as it was and answering `200`: a status
  this API does not store (Stripe adds them), a Price no tier carries (ADR-0019's untagged Price, sold), and
  an event with no billing period. The tier a Price names is looked up **published or not**, because
  unpublishing stops new purchases and existing subscribers keep renewing.
- The period is read from the subscription **item** first and the subscription second — Stripe moved
  `current_period_*` onto items in the 2025 API versions, and the pinned client has no accessor for the old
  place at all.

#### [T50](https://github.com/Shei254/marketplaats-extension/issues/81) · `apps/web` scaffold and public pages · **M** · T28, T48
Rename `apps/dashboard` → `apps/web`. React + Vite, one build, consuming `packages/ui`.
- **Public routes carry no auth at all**: `/success`, `/cancel`. The success page says the payment landed and
  to reopen the extension — the webhook does the real work, so the page never learns who anybody is.
- `/admin` arrives in slice D. Subdomains are DNS at Go-Live.
- Refs: [ADR-0017](adr/0017-web-surface-and-subscribing.md).

#### [T36](https://github.com/Shei254/marketplaats-extension/issues/45) · Privacy and terms pages · **S** · T50 · **shipped**
Required for the Web Store listing, which needs a hosted privacy policy URL. Public, loginless — `/privacy`
and `/terms`, linked from the header and footer of every page, which is what T50 held back until they
existed.
- The words are the canvas's and every claim on them is one the schema can keep. **They render
  `[PLACEHOLDER]` on their own face**: the binding text needs a lawyer before T58 (#89), and a reader of the
  deployed page has to be able to tell.
- `/privacy` is the URL the Web Store listing carries, so once #89 is live the address is published somewhere
  we do not control. It is a string to choose and then leave alone.

#### [T52](https://github.com/Shei254/marketplaats-extension/issues/83) · Plan cards and Checkout hand-off in the popup · **M** · T29, T49, T19
Renders `GET /api/plans`, calls the Checkout endpoint with the popup's own token, opens the returned Stripe
URL in a tab. **This is where the original T34 went** — the conversion click stays beside the locked button
(ADR-0007/0017). The popup closes when the tab takes focus; that is expected, and the success page is what
catches the user.

#### [T21](https://github.com/Shei254/marketplaats-extension/issues/31) · Customer Portal session endpoint · **S** · T20 · **shipped**
`POST /api/portal`, no body: a portal redirect URL for whoever the token names, which the popup opens the same
way it opens Checkout. **This is where the original T35 went** — the account page is the popup's quota display
plus this link.
- **The question is whether Stripe holds a customer, and nothing else.** `404` when it does not, which is
  every free user who never bought anything. A subscriber who cancelled is **not** one of those: ADR-0018
  keeps `stripe_customer_id` precisely so their invoices and their card stay reachable, and neither is
  somebody in dunning, who is the likeliest caller of all. **The subscription's status is never consulted.**
- **`503` when Stripe could not be asked** — including a Stripe account whose Portal has never been configured
  in the dashboard, which is what a fresh test-mode account answers and is a step in T22 (#28).
- Stripe returns the browser to `apps/web`'s **`/billing`**, a page of its own rather than `/success`: the
  commonest reason to be in the Portal is cancelling. The three paths `apps/api` sends Stripe now live in one
  `WebPages`, held to `apps/web/src/routes.ts` by a test that reads it.

---

### Slice D · I can run it
**Review:** sign in to `/admin`, set the default tier's quota to 0, sign in as a fresh user and find them
locked out with an upgrade prompt. → [script](click-through.md#slice-d--i-can-run-it)

#### [T18](https://github.com/Shei254/marketplaats-extension/issues/27) · `admin` module skeleton + role guard · **S** · T10
`ADMIN` role from the realm; every route under it closed to anyone else.

#### [T53](https://github.com/Shei254/marketplaats-extension/issues/84) · Tier CRUD · **M** · T18, T51
Quota, name, feature flags, `isDefault`, publish/unpublish. **Not** amount or interval — Stripe Prices are
immutable and those are not ours ([ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)).
- Lists **unadopted Stripe Prices** too, so a missing `tier_code` tag is visible rather than silent.
- Refuses unsetting `isDefault` without setting another: a catalog with no default provisions nobody.
  "No free tier" is **quota 0** on the default tier.
- Lowering a quota under subscribers is allowed and clamps `quotaRemaining` at zero — no proration, no
  notification (ADR-0014, amended).

#### [T54](https://github.com/Shei254/marketplaats-extension/issues/85) · `/admin` routes in `apps/web` · **M** · T50, T53
Keycloak redirect PKCE against the existing `mprelist-dashboard` client, guarded on the `ADMIN` role. Tier
list, tier form, unadopted-Price list. **The only authenticated part of `apps/web`** — this is where the
original T33 went.

---

## Go-Live — making it reachable by somebody else

Had **no ticket at all** in the 2026-08-13 plan. Nothing here is optional before a stranger can pay.

#### [T55](https://github.com/Shei254/marketplaats-extension/issues/86) · Deploy the stack · **L** · Iteration 1
API, Postgres, Keycloak, `apps/web`. **One API instance only** — `authToken` is signed with an RSA key
generated per process, so a second instance signs with a second key; making that key configuration is the
prerequisite for scaling out (see `enforcement-contract.md`, resolved build questions).
- **Whatever serves `apps/web` must answer every public path with its one `index.html`.** T50 is one build
  and the router runs in the browser, so a host left on its default returns 404 for `/success` — which is
  the page a customer lands on *after* the money has moved. `vite dev` and `vite preview` already fall back.

#### [T56](https://github.com/Shei254/marketplaats-extension/issues/87) · Domain, TLS, and the production realm · **M** · T55, T60
`www.` and `admin.` for `apps/web`. The realm imports on **first start only**, so the production realm must
name every origin and redirect URI *before* it is first started — the extension's
`https://<id>.chromiumapp.org/`, and both web origins.

#### [T57](https://github.com/Shei254/marketplaats-extension/issues/88) · Live Stripe · **M** · T22, T55
Live keys, Stripe Tax, VAT registration, iDEAL and SEPA in live mode, webhook endpoint pointed at the
deployed API. ADR-0006 is explicit that **Stripe Tax calculates and does not file**.

#### [T46](https://github.com/Shei254/marketplaats-extension/issues/54) · Client-side pacing and jitter between relists · **M** · T26 · **shipped**
**Moved here from "deferred", deliberately**, because serialisation (one relist at a time) is not a gap
between them — and ADR-0008 wants human-like pacing precisely because internal-API calls already lack the
interaction signals of real clicks.
- A randomised **45–90s** gap between consecutive relists, drawn per relist and never a fixed interval,
  waited out in the worker before the authorization — which is where the backend's own rail starts counting.
- Cannot be the backend's: it can refuse a call that came too soon, it cannot make one arrive at a
  human-shaped moment.
- The floor sits above `mprelist.safety.minimum-interval` (30s), so consecutive relists stop *discovering*
  that rail. The burst cap stays the backend's — no usable gap keeps somebody under ten an hour.
- The window is **handed to the pacer** rather than read by it, which is the seam
  [T27](https://github.com/Shei254/marketplaats-extension/issues/36)'s served config arrives through. Until
  it does, tuning is a release — the one acceptance criterion this ticket left open.

#### [T58](https://github.com/Shei254/marketplaats-extension/issues/89) · Chrome Web Store listing · **M** · T36, T46, T60
Name, icons, screenshots, description naming Marktplaats **in the copy and not the title**, privacy policy
URL, permission justifications for `host_permissions` on marktplaats.nl. Review takes days to weeks.

#### [T60](https://github.com/Shei254/marketplaats-extension/issues/91) · Finalise the brand name · **S** · before T56 and T58
Web Store name availability, domain availability, a trademark search. One edit to `brand.json` and a rebuild
(T48) — everything else is prose, the listing, and the realm's origins.

#### [T59](https://github.com/Shei254/marketplaats-extension/issues/90) · CI · **M** · **shipped**
`.github/workflows/ci.yml`: two jobs, neither waiting for the other — `npm ci` and the three root scripts,
and `./gradlew build` on the runner's Docker daemon. **No path filters**, because both jobs read inputs from
outside the directory they are named for and a stale filter fails silently. Node is pinned in `.nvmrc`, Java
by the toolchain already in `build.gradle.kts`. See [the root README](../README.md#ci).

#### [T43](https://github.com/Shei254/marketplaats-extension/issues/52) · API backward-compatibility policy · **S** · **shipped**
Extension releases take days, API deploys take minutes. Settled in
[`enforcement-contract.md` § Which build is calling](enforcement-contract.md#which-build-is-calling):
`X-Mprelist-Client: extension/<version>` on every call, a minimum supported version per surface shipped as
`0`, and `426 Upgrade Required` with an empty body below it — the one answer a client reads by status, because
it is about their software rather than about them.
- **Built before it is needed, deliberately.** A lever added later cannot reach the builds that predate it, so
  the header has to be in the first published release or the mechanism is useless for exactly the users it is
  for.
- The policy the rest of the time is **additive-by-default**; raising the minimum strands everybody who has
  not updated, so it is for correctness and safety only.
Refs: [ADR-0011](adr/0011-repository-layout.md).

---

## Deferred

| Ticket | Why it waits |
|---|---|
| [T27](https://github.com/Shei254/marketplaats-extension/issues/36) · `GET /api/client-config` | Nothing to hotfix yet. Its value is a Marktplaats DOM change you can fix without a release; that bill arrives with real users, not before ([ADR-0013](adr/0013-remote-client-configuration.md)) |
| [T31](https://github.com/Shei254/marketplaats-extension/issues/40) · Debounced server-side searchbar | A convenience over the ad list, not part of the gate. Fixes today's dead path where `content-script.ts` returns `undefined` |
| [T37](https://github.com/Shei254/marketplaats-extension/issues/46) · SPIKE: is `listMyAds` paginated? | Cheap and high-information; run it when the list gets long enough to matter |
| [T38](https://github.com/Shei254/marketplaats-extension/issues/47) · SPIKE: stable Marktplaats account identifier | Blocks `maxMpAccounts` as a sellable entitlement and multi-account |
| T39/T40 · SPIKEs: ownership detection, injected-UI runtime | Feed T41 |
| T41/T42 · In-page injection | The second surface. The popup has to be good first |
| [T45](https://github.com/Shei254/marketplaats-extension/issues/53) · Findings note for the internal-API spikes | **Shipped** — [`internal-api-findings.md`](internal-api-findings.md). It had no dependants and one dependent moment: the night something breaks |

**Dissolved by [ADR-0017](adr/0017-web-surface-and-subscribing.md):** T33 (SPA login → the admin route guard,
T54), T34 (plans page → the popup, T52), T35 (account page → the popup's quota display plus the Portal link,
T21).

**Still deferred by decision, not by sequencing:**

| Item | Decided in |
|---|---|
| Annual and regional pricing | Blocked by `tier.stripe_price_id` being `UNIQUE` and single-valued ([ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)) |
| Free trials | [ADR-0006](adr/0006-billing.md), amended — the free tier is the trial; turning one on later is a Stripe dashboard change |
| Customer login on `apps/web` | [ADR-0017](adr/0017-web-surface-and-subscribing.md) — revisit when there is something to manage without the extension |
| Proration or notice when a tier quota is edited | [ADR-0014](adr/0014-tier-catalog-and-entitlements.md), amended — `quotaRemaining` clamps at zero and nothing else happens |
| Multi-Marktplaats-account support | T38 |
| Firefox port | [ADR-0009](adr/0009-tech-stack.md) |
| Relist history / outcome analytics screens | Not in iteration 1 |
