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
**Test mode** for iteration 1. iDEAL, SEPA and **PayPal** enabled (T64). **No trial days** — the free tier
is the trial ([ADR-0006](adr/0006-billing.md), amended). Each Price tagged **`metadata.tier_code`**
(`pro`, `power`), which is what T51 syncs on. Amounts are decided here, not in code.
- **The account must be established in the Netherlands and the catalog priced in EUR**, and it is a
  precondition rather than a preference ([ADR-0006](adr/0006-billing.md), corrected 2026-09-01). PayPal is
  not offered to US-established accounts at all — not turned off, *absent from the payment method
  configuration* — and iDEAL is EUR-only and bills a subscription through a SEPA Direct Debit mandate, which
  such an account cannot have. The failure is silent: Checkout opens, a card form renders, a test card
  completes a subscription, and the two methods ADR-0006 chose Stripe **for** are simply not there. **This
  applies to the test account too**, or what iteration 1 exercises is not this decision.
- **PayPal is a method here, never a second processor** ([ADR-0006](adr/0006-billing.md), amended
  2026-09-01), so it is a dashboard checkbox and no code. Stripe enables **recurring** for PayPal
  automatically on most accounts and not all — if the PayPal button is missing from a `subscription`
  Checkout while present on a one-off, that setting is why, and it is not something the API can report.
  Since T65's amendment `OpenCheckout` logs what each session actually resolved to, which is where to look.
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

#### [T52](https://github.com/Shei254/marketplaats-extension/issues/83) · Plan cards and Checkout hand-off in the popup · **M** · T29, T49, T19 · **shipped**
Renders `GET /api/plans`, calls the Checkout endpoint with the popup's own token, opens the returned Stripe
URL in a tab. **This is where the original T34 went** — the conversion click stays beside the locked button
(ADR-0007/0017). The popup closes when the tab takes focus; that is expected, and the success page is what
catches the user.
- **The worker opens the tab, not the popup.** The popup is destroyed the moment the tab takes focus, so a
  `chrome.tabs.create` awaited there is awaited in a page that no longer exists — the same shape of bug as a
  sign-in awaited there (ADR-0010). What comes back to the popup is only ever news that nothing opened.
- **The plan they are on is a card too**, and it carries no amount unless it is also on sale: a tier absent
  from `/api/plans` is either free or one withdrawn under the people still paying for it (ADR-0019), and
  nothing in the popup can tell those apart, so it shows what is left of it instead of a made-up €0.
- **Two ways in, one of them not on the canvas.** The prompt beside a spent quota is the canvas's "See plans";
  a quiet **Plans** in the header is the addition, because without it a subscriber who is *not* out of relists
  could never reach their own billing — and [ADR-0017](adr/0017-web-surface-and-subscribing.md) makes this
  popup the account surface ("the popup's quota display plus a Customer Portal link").
- **The Portal (T21, #31) arrived with it**, since it is the same act — ask the backend for a Stripe URL, let
  the worker open it. "Manage billing" is on the plans screen for everybody, and "Update card" is on the
  dunning prompt, which is where ADR-0018 asks for it.
- No tagline per card: `/api/plans` carries none, and one hardcoded per tier code would be wrong for the tier
  T53 (#84) adds and stale for one it renames.

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

#### [T64](https://github.com/Shei254/marketplaats-extension/issues/136) · PayPal as a payment method · **S** · T22 · **shipped**
PayPal joins iDEAL, SEPA and card **inside Stripe Checkout**. It is not a second processor, and
[ADR-0006](adr/0006-billing.md) (amended 2026-09-01) costs that reading and rejects it, so nobody has to cost
it twice.
- **The only step that is not documentation is a dashboard checkbox**, and it is the one thing the API cannot
  do or report: activate PayPal in the Stripe test dashboard and confirm **recurring** is on for it.
- **Blocked on the account, not on the code (found 2026-09-01).** On the account the current test key points
  at there is no checkbox to tick: it is US-established, and `paypal` is not a field on any of its payment
  method configurations, because Stripe offers PayPal to EU- and UK-established merchants. A buyer reported
  the button missing from Checkout and this was why. Nothing here lands until T22's account precondition is
  met; [ADR-0006](adr/0006-billing.md) is corrected accordingly.
- **Unblocked 2026-09-02, and the last mile was not the account.** The key now points at a
  Netherlands-established account priced in EUR; `paypal` reads `available: true` / `on` in its own default
  configuration, and a `subscription` Checkout resolves to `card, ideal, sepa_debit, klarna, link, paypal,
  amazon_pay, satispay`. PayPal was **still** absent from the rendered page, and the cause was Stripe's
  **Adaptive Pricing** — on by default, it converts the session into the buyer's local currency, and a
  converted cross-border subscription is offered card, Link, Apple Pay and Google Pay only. Opened from
  Nairobi the page showed KES and dropped iDEAL, SEPA and PayPal together; switching its currency selector
  back to EUR brought all three back. `OpenCheckout` now sets `adaptive_pricing.enabled = false`, so the
  Price's own currency is what reaches the buyer ([ADR-0006](adr/0006-billing.md), amended 2026-09-02).
- **It is invisible to the session log**, which is worth knowing before the next one of these:
  `payment_method_types` is resolved at session creation and the conversion happens at render, so the log
  names `paypal` on a session whose buyer sees a card form. [ADR-0022](adr/0022-the-plan-screen-names-the-payment-methods.md)
  is amended to stop calling that log the ground truth.
- **Domain registration was ruled out, and is worth not re-checking.** Stripe requires it for PayPal only in
  Elements and Checkout's *embeddable* form; this integration redirects to `checkout.stripe.com`, which is
  Stripe's own domain. It becomes a hard prerequisite the day the checkout is embedded, and it fails by
  silently hiding the button.
- Nothing describes Stripe as a card processor, because on this account it never was one — ADR-0006 enabled
  iDEAL and SEPA precisely because card-only would cost Dutch conversion. Privacy says "payment details",
  Terms points at **Manage billing** rather than "the Stripe portal", and `/billing` no longer asks whether
  they changed "your card".
- **Stripe is named and then glossed, not removed.** It is the name on the buyer's bank statement, so a
  document that hid its processor would be the worse document. It is simply not a name users are assumed to
  know.
- Refs: `docs/glossary.md` gains **Payment method**, which is the distinction the whole ticket turns on.

#### [T65](https://github.com/Shei254/marketplaats-extension/issues/137) · The popup names the payment methods · **M** · T64, T49 · **shipped**
The plans screen says which methods are accepted before the hand-off, **read from Stripe** rather than typed
here — because copy that names them is otherwise the "second answer beside the dashboard's" that
`OpenCheckout` exists to avoid.
[ADR-0022](adr/0022-the-plan-screen-names-the-payment-methods.md).
- **The default configuration** — reversed from this ticket's original "the subscription configuration, not
  the default one", and [ADR-0022](adr/0022-the-plan-screen-names-the-payment-methods.md) is where the
  argument is. `OpenCheckout` passes no `payment_method_configuration`, so Stripe applies the account default
  and reading it *is* reading what the buyer will meet; reading a subscription configuration this product
  never passes would have been the wrong object. The worry behind the original wording is **not** fully
  answered and is recorded as a Negative there: nothing checks whether a method is approved for *recurring*
  payments, which for PayPal is a separate account setting no API here can report (T64, T57).
- **Raw Stripe tokens on the wire, display names in the popup** — what `PlanPrice` already does with
  `currency` and `interval`.
- **It degrades independently of the prices.** T49's all-or-nothing rule is justified on the plan screen being
  a *comparison*; without this sentence the comparison is still right, so a failed fetch renders the cards and
  no sentence rather than blanking a working screen.
- **An unmapped token is omitted and logged** — a departure from `plans.ts`, whose rule guards against
  *mistranslation* where the alternative here is silence.
- Cache it like `CachedStripePrices` and keep "failures are not cached", but **say why its safety argument
  does not transfer**: a Price is immutable and a method configuration is mutable in place, so this TTL is
  doing real staleness work and is why a freshly-toggled method is not in the popup at once.
- **Amended 2026-09-01, from a report that PayPal and the bank option were missing at Checkout.** The cause
  was the account (T64 above), but two readings here were wrong and are now fixed —
  [ADR-0022](adr/0022-the-plan-screen-names-the-payment-methods.md) carries the argument.
  - **`is_default` does not identify the configuration on its own.** A Connect platform's configurations for
    its connected accounts come back in the same list with defaults of their own, told apart by `parent`.
    First-flagged-in-list-order picked a **child** on the real account, so the sentence described a set
    Checkout never applies. The reading is now `is_default` **and** no `parent`; two of ours claiming it is
    logged rather than resolved, and none of ours answers nothing rather than borrowing somebody else's.
  - **`offered()` now means what a *subscription* Checkout will offer.** iDEAL, Bancontact and Sofort have no
    recurrence of their own — each leaves a SEPA Direct Debit mandate behind, which is what is charged
    afterwards — so with `sepa_debit` off they are enabled and still absent at the hand-off. Naming them
    there is the one failure this sentence must not have. It is a filter read from the same object, **not**
    the recurring table this ticket refused, and it can only omit a method, never invent one.
  - **Every opened session logs what Stripe actually resolved for it** (`OpenCheckout`). The sentence is a
    prediction; the session is the truth, and it is the only place the currency and PayPal's recurring
    approval are both accounted for. That residual is still unreadable in the API and is still T57's.

---

### Slice D · I can run it
**Review:** sign in to `/admin`, set the default tier's quota to 0, sign in as a fresh user and find them
locked out with an upgrade prompt. → [script](click-through.md#slice-d--i-can-run-it)

#### [T18](https://github.com/Shei254/marketplaats-extension/issues/27) · `admin` module skeleton + role guard · **S** · T10
`ADMIN` role from the realm; every route under it closed to anyone else.

#### [T53](https://github.com/Shei254/marketplaats-extension/issues/84) · Tier CRUD · **M** · T18, T51 · **shipped**
`GET /api/admin/tiers`, `PUT …/{code}`, `PUT …/{code}/default`, `GET /api/admin/prices`. Quota, name, feature
flags, publish/unpublish and which tier new accounts start on. **Not** amount or interval — Stripe Prices are
immutable and those are not ours ([ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)) — and not
`stripePriceId` or `code` either, since the tag on the Price is the only link and a second copy is the one that
drifts.
- **The list is unfiltered**, which is the point: `GET /api/plans` hides a draft and the free tier, and hiding
  them here too would leave an operator with no way to reach the one thing the screen exists for. No amount on
  any of them, so the catalog stays editable while Stripe is down.
- **`isDefault` moves rather than toggling**, and that is how "refuses unsetting it" is satisfied — by
  construction rather than by a refusal. `PUT …/{code}/default` is the only way to change it, so no request
  anybody can send leaves the catalog with none. "No free tier" is **quota 0** on the default tier.
- **`409` for publishing a tier with nothing to charge against**, answered rather than left to
  `V5__tier_publication.sql` to throw: the constraint would give a `500` where what is wanted is an operator
  being told to go and create a Price in Stripe.
- Lowering a quota under subscribers is allowed and clamps `quotaRemaining` at zero — no proration, no
  notification (ADR-0014, amended). It writes nothing to anybody's row; the arithmetic follows the edit.
- **Lists unadopted Stripe Prices** and does nothing with them: a Price with no `tier_code` is visible rather
  than silent, and adopting one is done by adding the tag in Stripe, which goes through T51's sync.
- **`admin` composes and owns nothing**, which makes it `display`'s counterpart for the other audience: the
  rows are `catalog`'s through a third port (`TierEdits`) beside the gate's and the webhook's, and the Prices
  are `billing`'s through `UnadoptedPrices`.

#### [T54](https://github.com/Shei254/marketplaats-extension/issues/85) · `/admin` routes in `apps/web` · **M** · T50, T53 · **shipped**
Keycloak redirect PKCE against the existing `mprelist-dashboard` client, guarded on the `ADMIN` role. Tier
list, tier form, unadopted-Price list. **The only authenticated part of `apps/web`** — this is where the
original T33 went.
- **A surface, not a page.** `main.tsx` chooses it before the public route table is consulted, so
  `pageFor("/admin")` still answers `not-found` and every page in that table stays public.
- **The redirect lands on `/`.** The realm registers exactly `http://localhost:5173/` and Keycloak matches
  exactly, so an arrival is recognised by the `code` in the query and the address bar is rewritten
  afterwards — no realm change, and the shape T56 (#87) wants anyway, since `admin.<domain>`'s root is this.
- **The token lives in memory and nowhere else**, so a reload signs in again through the IdP session and
  signing out of Keycloak signs you out here. No refresh token: a `401` is one redirect.
- **The role decides a screen, never a permission** — the API enforces it (#27). Somebody signed in as the
  wrong person is told so and offered the only thing that helps, which is being somebody else; without that
  the click-through's step 2 is a trap.
- **`isDefault` has no control**, because the API has no request for one. Only "make default", on the tiers
  that are not it.

#### [T61](https://github.com/Shei254/marketplaats-extension/issues/127) · Create a plan from `/admin`, synced to Stripe · **M** · T53, T54 · **shipped**
`POST /api/admin/plans` creates the Stripe Product and Price and then the tier, in one submit;
`GET /api/admin/currencies` is what the form's currency list is built from. **Amends
[ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)**, whose own *Revisit if* named this the
moment the two-place workflow had a screen to be compared against.
- **No amount is editable, anywhere** — which is the argument ADR-0019 actually made. It is written once, and
  repricing stays in Stripe, where a new tagged Price repoints the tier through the sync.
- **No new writer of the `tier` table.** The route creates the tagged Price and then makes the webhook's own
  `adopt` call and the edit form's own `apply` call; the `price.created` that follows is the documented no-op.
- **`409` for a code already taken**, before Stripe is asked — adopting it would repoint an existing tier's
  Price. **`422` carries Stripe's own sentence**, the one body in this API that is not a code.
- **The currency list is asked of Stripe** — this account's country spec, not a copy of Stripe's ~130.
- **A gap closed on the way:** repricing leaves existing subscribers matched to a Price no tier carries, and
  the mirror used to drop their events — so a failing card left the row `ACTIVE`. Now only the tier change is
  skipped; status and window are mirrored.

#### [T62](https://github.com/Shei254/marketplaats-extension/issues/128) · A plan may be sold monthly and annually · **L** · T61 · **shipped**
`tier_price` replaces `tier.stripe_price_id`, so monthly and annual Pro are **one plan a buyer chooses a
rhythm for** rather than two tiers with two quotas. **Amends
[ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md) a second time**, on the constraint that ADR
named as the first thing to move.
- **A table, not the nullable second column** the ADR also offered: a column fixes the answer at two, and the
  other revisit trigger — regional pricing — is N prices per tier.
- **The rhythm is stored**, a narrow departure from ADR-0014: the amount and currency still are not, but a row
  has to be keyed on something and "the annual one" is the handle everybody uses.
- **A tagged Price that does not recur is no longer adopted** — it has no rhythm to be filed under, and
  adopting one always made a tier whose Checkout could never open.
- `GET /api/plans` carries `prices[]`; the popup shows **one button per rhythm**, each saying its own amount.
  `POST /api/checkout` requires an `interval`, since a code alone now names two prices.
- **Repricing gets narrower**: a new monthly Price no longer silently takes annual off sale.
- **V5's check became a trigger**, `initially immediate` — the invariant spans two tables now, and `deferred`
  never fires in a rolled-back test.
- **One currency for the whole catalog** (T63, #129), read from the Stripe account: a plan screen is a
  comparison, and two currencies on it is not one. Since it is not a choice per plan it is not a field — no
  request carries a currency at all — and `GET /api/plans` refuses a mixed catalog whole, which covers the one
  way in that is left, a Price created in the Stripe dashboard.

#### T66 · A plan is created at both rhythms, priced the way money is written · **M** · T62, T61 · **shipped**
*No issue filed — this came in as a direct request rather than off the board, and is written down here so the
next reader finds it where every other decision is.*

T62 made a tier able to hold several Prices and left `/admin` writing one, so monthly-and-annual was two acts
an operator had to remember — and in between, a plan card offered no choice, which is the choice a buyer is
actually making. The form now takes both amounts and one submit creates one Stripe Product with a Price each.
- **`NewPlan.prices` replaces `amount` + `interval`** — at least one rhythm, never the same one twice. The
  duplicate is refused where it is typed rather than where it lands: adopted, the second would silently
  replace the first.
- **One Product, a Price per rhythm.** Calling the creation twice would put two identically named Products in
  the Stripe dashboard — invisible to this application, since nothing reads Products, and permanently untidy
  in somebody else's system. Each Price carries its own idempotency key, because Stripe scopes a key to the
  body and one key across both would return the first Price twice.
- **A half-made plan is reported as made.** Two Prices are two Stripe calls with nothing spanning them, so the
  annual one can be refused once the monthly one exists — and that first Price is real, tagged, and about to
  be adopted whatever the answer says. Refusing the lot would leave the retry colliding with a code the sync
  had meanwhile taken, so the plan is created selling what it can and the screen names the rhythm that did
  not land.
- **Amounts are typed the way money is written** — `9,99`, not `999`. The wire unit is still Stripe's
  smallest, and the conversion happens on the way out (`apps/web/src/admin/money.ts`), where the two awkward
  parts are pinned by a suite: the digits are read as digits, since `Math.round(4.35 * 100)` is `434` and a
  cent vanishing into an immutable Price is silent; and the number of decimal places is asked of `Intl` rather
  than assumed to be two, since a yen has none and a dinar has three. More places than the currency has is
  refused rather than rounded — rounding charges an amount nobody typed.
- **The checkout half needed nothing.** The popup has drawn a button per rhythm since T62 and `POST
  /api/checkout` has required an `interval` since then too; what was missing was plans that had two prices to
  draw. The end-to-end path — the annual button sending `year` — is now pinned by a test.
- **Both surfaces read an amount the same way.** `money.ts` lives in `packages/contracts`, beside the field
  it converts — every `amount` on that contract is in the currency's smallest unit, and both clients have to
  read it. The popup's plan card divided by a hundred until now, which is right for a euro and wrong for
  every currency without cents: ¥1200 rendered as ¥12 on the screen somebody decides to pay from. **Amends
  [ADR-0011](adr/0011-repository-layout.md)** — that package holds runtime code that is not an enum's values
  for the first time, argued there on `packages/ui`'s own grounds: two consumers, and two copies of a
  rounding rule is the pair that drifts.
- **`formatEuro` in the popup's ad list is left alone**, and is not the same thing: those are Marktplaats's
  own `priceCents` on a Dutch euro marketplace, not an amount this API carries in a currency Stripe named.
- **A `500` closed on the way:** the rhythm vocabulary was checked where the Stripe Price is built, which
  throws unchecked and, once a plan could state several rhythms, threw *after* an earlier Price had been
  created and tagged — leaving a Price the webhook adopts into a draft tier under the code the retry is then
  refused for. `PlanRhythm` refuses it at construction now, so the contract's `400` is what a body naming a
  rhythm Stripe has no word for actually gets. This narrows what may be **created**, not what may be adopted.

---

## Go-Live — making it reachable by somebody else

Had **no ticket at all** in the 2026-08-13 plan. Nothing here is optional before a stranger can pay.

#### [T55](https://github.com/Shei254/marketplaats-extension/issues/86) · Deploy the stack · **L** · Iteration 1 · **deployable, not deployed**
API, Postgres, Keycloak, `apps/web`, described by `infra/docker-compose.prod.yml` and run with an environment
file git never takes. **Both images build from source on the host** — `apps/api` through its Gradle wrapper,
`apps/web` through Vite into nginx. Refs: [ADR-0020](adr/0020-deployment.md),
[`infra/README.md` § Deploying](../infra/README.md#deploying), and the script in
[`click-through.md`](click-through.md#go-live--the-stack-is-somewhere-else-t55-86).
- **A second compose file, not an override of the local one.** An override *removes* things — a committed
  password, `start-dev`, a published database port — and a removal that was forgotten deploys a stack that
  works, with the laptop's admin password on it. `DeployedStackTest` asserts the differences rather than a
  merge: the same two image tags, Keycloak's production mode, no relaxed `sslRequired`, no realm from
  `infra/keycloak`, no published Postgres port, and no credential that is not a variable defaulting to
  nothing.
- **Whatever serves `apps/web` must answer every public path with its one `index.html`.** T50 is one build
  and the router runs in the browser, so a host left on its default returns 404 for `/success` — which is
  the page a customer lands on *after* the money has moved. The nginx template does it, and a test in
  `apps/web`'s suite reads that file so it goes on doing it.
- **Where the API and the realm are is served to the bundle, not built into it** — `/config.js` as a patch
  over `admin-config.ts`'s defaults, the same shape #36 serves the extension. One image runs anywhere and a
  wrong address costs a restart rather than a rebuild. The redirect URI is not in it at all: it is
  `location.origin`, which cannot disagree with where the browser will actually come back to.
- **One API instance only** — `authToken` is signed with an RSA key generated per process, so a second
  instance signs with a second key; making that key configuration is the prerequisite for scaling out (see
  `enforcement-contract.md`, resolved build questions).
- **What is left is the act of deploying**: a host, and then T56. The realm this file imports has no
  default, so a stack pointed at nothing stops rather than importing the two dev users. Verified locally end
  to end — four healthy containers, Flyway migrated, `/success` answered, `/config.js` carrying the
  deployment's own addresses, and Keycloak stamping the configured issuer — and **against no public host at
  all**.
- **Superseded in part, 2026-09-02.** The host turned out to be 1 vCPU / 4 GB, which is too small to compile
  the API image while serving from it, so *"both images build from source on the host"* is no longer true:
  CI builds, GHCR holds, the host pulls, and a tag retags a tested digest
  ([ADR-0023](adr/0023-ci-builds-the-images-and-the-host-pulls.md), amending
  [ADR-0020](adr/0020-deployment.md)). The compose file's `build:` contexts become `image:` tags, every
  service gains a memory limit, and the three published ports go away entirely behind Caddy. Everything else
  this ticket built stands.

#### [T56](https://github.com/Shei254/marketplaats-extension/issues/87) · Domain, TLS, the production realm, and the pipeline · **L** · T55, T60
Grown from **M** on 2026-09-02: the grilling that produced
[ADR-0023](adr/0023-ci-builds-the-images-and-the-host-pulls.md) and
[ADR-0024](adr/0024-the-extension-addresses-are-built-in.md) found work underneath this ticket that nothing
else covers. Refs: [`infra/README.md` § Deploying](../infra/README.md#deploying).

**Everything in this repository is built as of 2026-09-02; what is left is a host and a domain.** The
extension builds against a committed `deployment.json`, the pipeline pushes and retags and deploys, Caddy is
the fifth container and the other four publish nothing, every service has a memory limit, the production
realm exists and a real Keycloak is started on it by `ProductionRealmTest`, and the deploy and nightly-dump
scripts are in `infra/deploy/`. The open items are the ones no commit can close: buy or choose the hostnames
(T60), provision the VPS, create the Web Store draft to learn the id, and run the click-through.

Three things this ticket leaves standing, recorded rather than discovered later:
- **The host's checkout is updated by hand**, deliberately. Doing it in the deploy script would mean a
  repository read key on that machine beside the read-only GHCR token, which ADR-0023 does not put there. So
  a release that changes anything under `infra/` needs a `git pull` on the host first, and nothing enforces
  it.
- **Nothing pruned GHCR**, which ADR-0023 names as a cost of the registry. Every green `master` adds a
  `sha-<commit>` pair; ~350 MB with layer reuse, billed past the account's allowance. **Closed by
  `.github/workflows/prune-ghcr.yml`**, weekly and by hand, keeping every release, the newest ten builds per
  image, and every manifest a kept image still points at. The rules are a tested module rather than inline
  `jq`, because the way a prune fails — taking the digest a release was stamped onto, or an untagged child of
  a kept index — is silent until a `docker pull` fails on the host.
- **The production realm's session lifetimes were decided here**, which T56 did not ask for and could not
  avoid: the export needs values, and `infra/README.md` § Refresh-token rotation said only that "a deployed
  realm should decide its own". It keeps the 30-day idle timeout, because the reason for it is the MV3
  service worker sleeping past Keycloak's 30-minute default rather than a laptop's convenience, and takes the
  30-day max lifespan as a deliberate monthly cadence of interactive sign-in. Neither is what bounds a stolen
  refresh token — the rotation and the five-minute access token are.
- **The extension cannot currently be built for anything but localhost**, and this is the item without which
  the rest is untestable. `api-config.ts` and `auth-config.ts` hold the addresses as constants,
  `scripts/build.mjs` injects nothing, and #36's served document deliberately does not carry them — nor can
  it, since it is fetched *from* `baseUrl` and sign-in precedes the first fetch of it (ADR-0024). A committed
  `deployment.json`, resolved and enforced the way `brand.json` already is (T48), so an unresolved address
  **fails the build** rather than shipping.
- **The pipeline.** `images` gains a push to GHCR on `master`; a new tag-triggered job `needs:` all three
  test jobs, retags the digest with `imagetools create`, and SSHes to a `command=`-restricted key. Plus a
  `workflow_dispatch` hotfix override, and the extension zip attached to the GitHub release.
- **Caddy as a fifth container**, four hostnames — `www.` `admin.` `api.` `auth.`, apex to `www.` —
  `caddy_data` as a named volume, and the staging CA while iterating. `api`, `web` and `keycloak` stop
  publishing ports at all.
- **`admin.<domain>` needs a proxy *redirect* of `/` → `/admin`, query carried.** ADR-0017's "`admin.` serves
  `/admin`" was always a claim about a proxy: `main.tsx` chooses its surface by path and knows nothing about
  the host, so untouched, that hostname serves the public site. **A rewrite cannot do it** — it never reaches
  the browser, and nginx answers every path with the same `index.html` anyway, so it would be inert and look
  correct. ADR-0023 said "rewrite" and carries the correction.
- **The realm imports on first start only**, so the production export must name every origin and redirect URI
  *before* it is first started — the extension's `https://<id>.chromiumapp.org/` and **both** web origins —
  and must template the site origins as `${…}` the way `MPRELIST_EXTENSION_ID` already is, or one
  deployment's hostnames are frozen into git. (The import is once; the realm's *contents* stay editable in
  the admin console. `infra/README.md` used to say otherwise and no longer does.)
- **The publish cycle has to be broken deliberately**: the realm wants the Web Store's id, which exists only
  once a store item does, which needs a build, which needs the realm. Create the store item as an
  **unpublished draft** first, `extension-key … set`, then first-start.
- **Do not wait for the domain to deploy, and do not deploy on a bare IP.** `sslRequired: external` refuses
  plain HTTP from anywhere non-local — correctly. **sslip.io** gives four real hostnames with real
  certificates on the IP you already have; the switch to the real domain is `production.env`, an admin-console
  pass, a Stripe webhook URL, and a rebuilt extension. All of it **before** the extension is published, after
  which moving an address is a Web Store review that the `426` lever cannot even announce.
- **Memory.** Nothing in either compose file sets a limit and neither JVM has a heap cap; on 4 GB that is an
  OOM-kill restart loop rather than an error. postgres 512M · keycloak 1G · api 1G · web 64M · caddy 128M,
  `-XX:MaxRAMPercentage=70` on the API — `mem_limit` alone would leave it a 256 MB heap.
- **Backups.** A pre-deploy `pg_dump`, a nightly cron keeping seven, both written to the host filesystem so
  they survive `down -v`; Hostinger's free weekly VPS backup underneath. No automatic rollback — Flyway's
  `validateOnMigrate` means rolling past an applied migration produces a second container that will not boot.

#### [T57](https://github.com/Shei254/marketplaats-extension/issues/88) · Live Stripe · **M** · T22, T55
Live keys, Stripe Tax, VAT registration, iDEAL, SEPA and PayPal in live mode, webhook endpoint pointed at the
deployed API. ADR-0006 is explicit that **Stripe Tax calculates and does not file**.
- **The live account has to be established in the Netherlands**, which is a company-formation fact and not a
  dashboard setting — so it is the earliest item here, ahead even of PayPal's approval lead time below. An
  account in the wrong country cannot offer iDEAL, SEPA or PayPal at all, and says so by quietly selling a
  card-only plan screen ([ADR-0006](adr/0006-billing.md), corrected 2026-09-01). **Done in test as of
  2026-09-02** — the test account is Netherlands-established and priced in EUR, and iDEAL, SEPA and PayPal
  all render at Checkout. The live account is a company-formation fact and still ahead of everything here.
- **Adaptive Pricing is a per-mode dashboard setting, so check it in live as well.** `OpenCheckout` turns it
  off per session, which is authoritative for this application's own Checkout — but Payment Links have it on
  always and cannot turn it off, so a link handed out for a subscription would sell the card-only version of
  this product to anybody outside the eurozone.
- **Start PayPal's live recurring approval early — it can take five business days.** In *test* mode
  recurring is on by default, which is why T64 was a checkbox; in live mode it is Payment methods →
  PayPal → **Enable** in the *Recurring payments* section, and it then sits at `pending` until PayPal
  grants access. This product sells subscriptions and nothing else, so until that lands PayPal is on the
  plan screen and unusable at Checkout — a worse state than not offering it. It is the one item here
  with a lead time nobody controls, so it goes first rather than last.

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
  [T27](https://github.com/Shei254/marketplaats-extension/issues/36)'s served config arrived through — and it
  has: the pacer now takes a *source* and asks it per call, and the worker's source is the served `pacing`
  block falling back to `HUMAN_PACE`. The acceptance criterion this ticket left open is closed; tuning is a
  restart of the API rather than a Web Store release.
- **Retuned 2026-08**: the window is **10–30s** and the rail under it is `5s`. 45–90 was drawn against a 30s
  rail and made every second repost most of a minute of watching a countdown; the pair moved together, since
  the floor clearing the rail is the whole property. The seam this ticket left is what made the API side of
  it a setting — `MPRELIST_PACING_MIN_MS` / `MPRELIST_PACING_MAX_MS`, beside `MPRELIST_MINIMUM_INTERVAL`.

#### [T58](https://github.com/Shei254/marketplaats-extension/issues/89) · Chrome Web Store listing · **M** · T36, T46, T60
Name, icons, screenshots, description naming Marktplaats **in the copy and not the title**, privacy policy
URL, permission justifications for `host_permissions` on marktplaats.nl. Review takes days to weeks.

**The justifications, as they stand.** One line each, written here as each permission arrives rather than
assembled the night the listing is filled in — a permission whose reason has to be reconstructed months later
is the one that gets a vague sentence and a rejection.

| Permission | Why it is needed |
|---|---|
| `host_permissions` on marktplaats.nl | The extension reposts the user's own ads in their own Marktplaats session; every request it makes goes to that site and no other. |
| `storage` | Holds the sign-in session, the ad snapshot that makes a repost recoverable, and the repost queue. |
| `unlimitedStorage` | A snapshot carries the ad's photos, so one interrupted repost can exceed the default quota. |
| `identity` | Sign-in is Authorization Code + PKCE against our own identity provider, opened by `launchWebAuthFlow`. |
| `alarms` | Resumes a repost queue after the browser suspends the extension (T68). Reposts are spaced 30–60 seconds apart, which is longer than a service worker stays alive. |

**One justification needs a decision before it is filed.** `alarms` is the batch runner's only user, and the
batch is withdrawn from the popup ([ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md), T70) — so
this listing asks for a permission no user of this build can reach. It cannot be dropped instead:
`service-worker.ts` registers `chrome.alarms.onAlarm` at the top level, and a missing permission throws
before anything else starts. Either the sentence describes the queue rather than the feature, or T70 lands
first and it is true as written.

#### [T60](https://github.com/Shei254/marketplaats-extension/issues/91) · Finalise the brand name · **S** · before T56 and T58
Web Store name availability, domain availability, a trademark search. One edit to `brand.json` and a rebuild
(T48) — everything else is prose, the listing, and the realm's origins.

#### [T59](https://github.com/Shei254/marketplaats-extension/issues/90) · CI · **M** · **shipped**
`.github/workflows/ci.yml`: two jobs, neither waiting for the other — `npm ci` and the three root scripts,
and `./gradlew build` on the runner's Docker daemon. (A third, `deployable images`, followed with T55; the
deploy job that `needs:` all three is T56's, and ADR-0023 says why an *act* may wait where a *verdict* may
not.) **No path filters**, because both jobs read inputs from
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

## After Go-Live — the first feature

None of these is required before a stranger can pay, so none belongs in Go-Live above. The first two arrived
together in the 2026-09-05 grilling and are written down together for that reason; only the second is a
feature. T69 came out of the 2026-09-06 session and is the operator's half of what T68 sold. **T70 is the
2026-09-07 session taking T68's screen back off** for the length of go-live
([ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md)) — which is why the section reads as a feature
that shipped, gained an operator control, and currently cannot be reached.

#### [T67](https://github.com/Shei254/marketplaats-extension/issues/146) · The ad row stops reading `minimumBidPriceCents` as a bid floor · **S** · no deps · **shipped**
A correction to T30a's row rendering, caught before it was ever committed.

`ListingSummary.minimumBidPriceCents` is the minimum bid **placed** on an ad, not the floor its seller set,
so `describePrice` drawing `Bieden · vanaf € X` was presenting a bidder's number as the seller's own. A
bidding row now shows the **`Bieden` chip and no number at all**.
- **The field comes off `ListingSummary`** — nothing else reads it. It **stays on `ListingDraft`** with a
  comment saying what it is: that type describes Marktplaats's payload, and deleting a field from a
  description of somebody else's JSON does not stop it arriving.
- **`captureAd` and `createAd` are untouched**, deliberately. `CapturedAd.price.minimumBidPriceCent` is a
  different endpoint's field, scraped from the seller's own edit page, and the golden test stays frozen.
  Whether it carries the same meaning is now an open question in
  [`internal-api-findings.md`](internal-api-findings.md) — and if it does, every reposted bid ad is being
  given a floor nobody chose.
- **The `Vraagprijs` / `Gratis` / `Zie beschrijving` chips stay.** They fix the older bug where a free ad, an
  ad priced in its description and an ad taking bids all rendered `€ 0,00`. Only the bid branch was wrong.
- Wanted before T58 ([#89](https://github.com/Shei254/marketplaats-extension/issues/89)) — the Web Store
  screenshots are of this list.
- Refs: [`internal-api-findings.md` § `listMyAds`](internal-api-findings.md).

#### [T68](https://github.com/Shei254/marketplaats-extension/issues/147) · Bulk repost · **L** · T26, T30b, T46, T17, T27, T53
Select several of your own ads and repost them in one act, as a queue the worker owns.
[ADR-0025](adr/0025-bulk-repost-is-entitled-queued-and-paced-wider.md) carries the argument; what follows is
the work.

**API**
- `features.bulk` seeded as `{"upTo": 10}` on `pro` and `{"upTo": 25}` on `power`, absent on `free`.
  `andNoTierPromisesAFeatureThatDoesNotExist` now has one flag to permit and **must go on refusing
  `scheduling`** — the test's reason has to survive the edit.
- `POST /api/relist/authorize` accepts optional `batch: true` and answers **`403 BULK_NOT_ENTITLED`** when the
  Entitlement carries no `bulk` — checked after subscription status, before quota.
- `GET /api/client-config` gains `bulkPacing` and `rails`. The second is the one block that is not an
  override of a client default and is admitted as such in the contract: it feeds a duration estimate and
  gates nothing.
- **`upTo` is enforced nowhere here and cannot be** — a batch arrives one ad at a time. The API says
  *whether*; the popup says *how many*.
- **Two pieces of prose stop being true and have to move with the seed**:
  `V2__seed_tier_catalog.sql`'s comment that bulk and scheduling "have no implementation and no ticket", and
  `apps/api/README.md`'s paragraph built on it. Both are correct today and would be lies the moment the flag
  is seeded, which is exactly the kind of drift that outlives the person who caused it.

**Extension**
- `chrome.alarms` in the manifest, and a justification line for T58.
- A persisted queue in `chrome.storage.local`, owned by the worker, advanced by an alarm. Survives the popup
  closing and the worker being evicted; **dropped on browser restart**, with the popup saying so. Snapshot
  recovery is untouched — an ad already deleted is still restored on startup.
- A second pacing window, **30–60s**, floored at 30s because `chrome.alarms` clamps there. Single reposts keep
  10–30s. The first ad of a batch starts immediately.
- Stopping rules: `RATE_LIMITED` sleeps `retryAfter` and resumes; quota, dunning and an unreachable backend
  stop the run; a `failed-recoverable` stops it **at once** — nothing starts a second delete while one of the
  user's ads is down; a `failed-before-delete` skips that ad, and two consecutive stop the run.
- Checkboxes on every row and an action bar once one is ticked, capped at `min(quotaRemaining, upTo)`. On free
  the boxes are drawn **disabled** with one line pointing at Plans. Toolbar badge for a run in progress, done,
  or stopped — no permission needed.
- The list reloads **once at the end**, not per success: a reposted ad has a new id, and reshuffling mid-run
  would pull rows out from under the queue.

**Two things chosen with their cost visible**, recorded so they are not read as oversights: a Power batch of
25 is a ~2 hour unattended run that a Chrome restart ends, and `upTo` is unenforceable server-side.

**Closes** `bulk` as a flag the domain model names and nothing implements — a state
`V2__seed_tier_catalog.sql` has been carrying a comment about since it was written.

**Withdrawn from the popup on 2026-09-07, two days after it shipped**
([ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md)) — scope for go-live, and nothing found wrong
with any of the above. Everything here stands except the four surfaces that offered it, and the outstanding
click-through walk goes with them: **slice E is now T70's**, not this ticket's. What is left of T68 is
therefore nothing, and it is not *done* either — the repo's own rule is that a slice ends at a walk, and
T70 is where this one waits.

#### [T69](https://github.com/Shei254/marketplaats-extension/issues/153) · The bulk cap is a number an operator types · **M** · T53, T54, T68
Setting a tier's bulk cap means hand-writing `{"bulk": {"upTo": 10}}` into a textarea, one field away from the
quota an operator sets with a number. [ADR-0026](adr/0026-a-feature-flag-is-a-field-spelled-once.md) carries
the argument; what follows is the work. **No API, wire or schema change** — `features` stays open `jsonb` and
a permissive `Map`, and there is no migration.

**`packages/contracts/src/features.ts`** — new, beside `money.ts`, and the reason the ticket spans three
packages rather than one.
- `BULK`, `BulkGrant`, `bulkIn`, `withBulk`, `isExpressible`. The reader preserves today's rule exactly:
  **not** granted iff the key is absent, `null` or `false`; anything else is a grant; `upTo` is read only from
  `{ upTo: <integer ≥ 1> }`.
- `withBulk(features, null)` writes **`{"bulk": false}`**, never a deleted key — which is what makes
  `V8__seed_bulk_entitlement.sql`'s claim about the admin edit true rather than a sentence a restored dump
  falsifies. Both readers have always answered *not granted* for `false`.

**`apps/web`** — a Features fieldset replacing the JSON field, in **both** the tier form and the create form,
which retires the hardcoded `features: {}` so a plan is created with its cap in one act.
- `Bulk repost [ N ] at a time`. Empty is "this tier has no bulk"; whole numbers ≥ 1 only; **no maximum**,
  because Power's 25 is already past the burst rail by a decision ADR-0025 made deliberately.
- **0 is refused**, and this is the trap the field exists around: `upToIn` reads `upTo > 0`, so `{"upTo": 0}`
  is not "no bulk" — it is *granted, capped by the quota alone*, the exact inverse of the obvious reading.
- `Advanced · edit as JSON` keeps every shape reachable, as **a mode and not a mirror**: expanding seeds the
  textarea and disables the number, collapsing parses back, exactly one control owns the value at a time.
- **One invariant covers the rest** — the number field owns the value only when it can represent the whole
  truth. So the form opens expanded when the stored object is not expressible, and refuses to collapse while
  it is not, saying why in place. Without it a tier storing `{"bulk": true}` opens showing an empty box and
  the next save revokes bulk for everyone on it, silently.
- **A comment stops being true and moves with the field.** `AdminCatalog.tsx`'s "a set of checkboxes would be
  inventing a schema this product has not decided on, and the day it does is the day this becomes a real
  control" was written when every tier carried `{}`. T68 was that day.

**`apps/extension`** — `bulkFor` becomes `bulkIn(plan.features)` plus the quota clamp and `upToIn` is deleted,
so the rule has one reader rather than two. `batching.test.ts` is left **unchanged**, which is the proof that
adoption moved no behaviour.

**Tests** — `features.test.ts` over the reader, writer and predicate, including one case that reads
`Entitlement.java` and holds `grants()`' rule to `bulkIn`'s, the arrangement `enforcement.test.ts` already uses
for the denial enums. That agreement is the one invariant nothing enforces today, and its symptom is a popup
offering a control the API answers `403` for. Then five `AdminApp.test.tsx` cases: expanding disables the
number, unexpressible content opens expanded, collapse is refused with its reason shown, clearing sends
`{"bulk": false}`, and the create form sends a cap.

**Left alone, with its cost visible:** the Advanced textarea can still write `{"bulk": 0}` and `{"bulk":
"yes"}`, which both the popup and the API read as *granted, uncapped*. That is deliberate on both sides and
`bulkIn` preserves it; nothing here closes it, and it is written down so it is not later read as an oversight.

#### [T70](https://github.com/Shei254/marketplaats-extension/issues/155) · Bulk repost comes back to the popup, walked against real ads · **S** · T68, T69, **T58 live and steady**
Bulk is built, tested and unreachable: [ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md) took the
selection off the popup for go-live scope and left the queue, the alarm, the entitlement, the API refusal and
`/admin`'s cap exactly where T68 and T69 put them. **The trigger is go-live being stable** — T58 listed, real
users through the single-repost path without incident — and not a date.

**The flip is one word.** `BULK_OFFERED` in `apps/extension/src/popup/batching.ts` becomes `true` and
`Popup`'s `offerBulk` parameter goes with it: it exists so the suite can turn on a screen the product does
not draw, and there is nothing to turn on once it does. The forty tests in `Popup.test.tsx`'s
`describe("reposting several at once")` lose their `beforeEach`, and the two that assert the withdrawal go.
No component is edited, because none was.

**The walk is the work.** [`click-through.md`](click-through.md) slice E, steps 1–12, against a real account
with enough real ads that a selection is a selection. It is T68's outstanding walk, parked here rather than
performed against a feature no user could see, and nothing else in this repo can prove delete-first over a
queue — every suite that covers bulk stubs Marktplaats.

**And the two things left standing.** The `alarms` justification in T58's table, which has been describing a
feature nobody could reach; and `/admin`'s `Bulk repost [ N ] at a time`, which has been setting a cap with
no visible effect — worth one look at the seeded values before the boxes are back.

---

## Deferred

| Ticket | Why it waits |
|---|---|
| [T27](https://github.com/Shei254/marketplaats-extension/issues/36) · `GET /api/client-config` | **Shipped**, ahead of the bill it was waiting for — because the lever has to predate the outage it is for, the same argument T43 makes about its header. It holds **no copy** of the nine endpoints: what it serves is a patch over the build's own defaults, so a healthy deployment answers `{"schemaVersion":1}` and nothing here can go stale. The ranking this ticket left open is decided — defaults, then the served document, then a tester's `__setEndpoints`, **the tester winning** — and the four CSRF modes are an enum at both ends, which is where "strictly data" is enforced rather than asserted ([ADR-0013](adr/0013-remote-client-configuration.md)) |
| [T31](https://github.com/Shei254/marketplaats-extension/issues/40) · Debounced server-side searchbar | **Shipped.** A convenience over the ad list and never part of the gate — search is ungated at every subscription state, like the list it filters. It closed the dead path it was named for: `searchAd` reached the orchestrator and was **logged**, so nothing could render it. Server-side because `listMyAds` paging is an open spike below — a box filtering the rows that happened to arrive would fail to find an ad the seller can see, and worst on the biggest account |
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
| Bulk repost in the popup | [ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md) — built (T68, T69) and withdrawn from the screen for go-live scope; the mechanism, the entitlement and the API refusal all stand. Back with T70, once go-live is stable |
