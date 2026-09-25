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
- The name is **AdBump**, provisionally, and must never lead with "Marktplaats" — Web Store policy forbids
  trademark use implying endorsement. Marktplaats belongs in the *description*.
- Distinct from the internal identifier `mprelist`, which is frozen (`com.mprelist`, `@mprelist/*`, the realm,
  the database). Renaming the brand is one file; renaming the identifier is not.
- Drops the `(POC)` suffix. Refs: [glossary — Brand name](glossary.md).

**The mark joined it on 2026-09-19**, and the rule it followed is the file's own: *nothing else holds a copy.*
`brand.json` gains **`icon`**, one square master in `brand/`, and every size the two surfaces declare is
resized from it at build time — Chrome's 16/32/48/128 into `dist/icons/`, the site's tab and home-screen
icons emitted beside its `index.html`. No resized copy is committed anywhere, so redrawing the artwork is the
same one-file edit a rename already was. Until this, the extension loaded as Chrome's grey jigsaw piece and
the Web Store's required 128px icon did not exist.

- **The manifest is the list.** `build.mjs` emits exactly what `manifest.template.json` declares, reading the
  size off the declaration rather than off the filename, so a size added there is emitted and a size emitted
  is one Chrome was told about. A path declared at two different sizes stops the build: it would otherwise
  turn on which of the two objects the loop read last, and one reading is a manifest Chrome believes and an
  image that is not that size.
- **`packages/ui/src/icon-png.mjs`** decodes, area-averages and re-encodes the PNG — the only such code in
  the repository, and no new dependency. It is in `packages/ui` for the reason ADR-0011's T66 amendment gives
  for `money.ts` being in `packages/contracts`: one concept — the mark, which that package already draws as
  `Icon name="logo"` — derived for two consumers. What it accepts is what a committed master is (8-bit, RGB
  or RGBA, non-interlaced) and it refuses the rest **by name**, because a 16-bit export, a palette and an
  interlaced file are three different mistakes with three different fixes.
- **Colour is averaged weighted by alpha.** Averaging the channels as they sit lets a transparent pixel's
  colour into the result and draws the dark halo every naive resizer puts around a soft edge. At 2000 → 16
  that is the difference between the mark and a smudge.
- **The popup header was left alone**, deliberately. It draws the mark as `Icon name="logo"` — stroked, in an
  accent tile, from the design canvas — and the raster icon is Chrome's toolbar and the Web Store listing,
  not an image for a page that already has the vector.
- **The site's icons are emitted, not committed**, and served from memory by a Vite plugin in development
  too: a dev server 404ing two links on every page load is the noise somebody eventually silences by
  committing a copy into `public/`, which is the one outcome this arrangement exists to prevent.
- **The master is 512px and re-encoded**, not the 2000px export it arrived as. Nothing asks for more than
  180, and a 5 MB blob is permanent in a history whose whole pack was 223 KiB; 512 leaves every size a
  downscale and costs 99 KiB. The second variant that came with it — the same mark with wider margins — is
  not committed: at 16px the tighter one is the one whose strokes survive, and an unused copy of the artwork
  is the thing this arrangement exists to not have.
- **The popup header keeps drawing the vector**, decided rather than overlooked. `.popup-mark` tiles the mark
  on `--mp-accent`, which is a different colour in dark mode, and a raster cannot follow a theme — nor is its
  teal-to-blue gradient a token any screen here uses. The raster is for Chrome's toolbar and the Store, which
  take PNG and have no theme to follow.

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

#### [T32](https://github.com/Shei254/marketplaats-extension/issues/41) · Quota display and locked states · **S** · T17, T30b · **shipped**
Remaining quota and `resetAt` in the header; locked buttons carrying upgrade / update-card / cooldown per the
reason code, with `retryAfter` rendered as a countdown.

**What locks, decided 2026-09-16.** `AdList`'s `locked` is computed from serialisation, cooldown and
batch-frozen — quota is not an input — so on a tier granting nothing every Repost button is live, costs a
round trip to be refused, and shows *"Je hebt je limiet voor herplaatsingen in deze periode bereikt"*: a
sentence about a limit that was never reached, on a plan where nothing comes back next period. The rule is
**lock on the grant, never on the remainder**:

- **`relistQuotaPerPeriod === 0`** — the button is disabled, `tone="locked"`, with the row line naming the
  plan rather than a limit, and `NoRepostsPrompt` already above it offering plans. Safe to lock on because it
  is a property of the **Tier**: nothing the holder does moves it, only an operator or a purchase.
- **`quotaRemaining === 0` with a grant above it** — the button **stays live** and the backend refuses. This
  number goes *up* without the user acting: a `FAILED_BEFORE_DELETE` report refunds its unit and so does
  **Reconciliation**, so a disabled button here is one a refund has already made wrong until somebody presses
  Refresh.

This is the **Display state** used for copy and for a control's appearance and never for a decision, which is
the line [ADR-0007](adr/0007-quota-enforcement.md) draws — `authorize` is still the only thing that grants,
and it refuses *before* any delete, so a click that gets through costs nothing but a round trip. It is the
same treatment the bulk checkbox already gets ([ADR-0025](adr/0025-bulk-repost-is-entitled-queued-and-paced-wider.md)):
*"The free tier sees a control it cannot use, deliberately … the difference between a feature a free user
knows to want and one they never learn exists."*

**The discriminator is display state, not the denial.** `LockedState`'s `upgrade` carries `resetAt` and a
zero-grant tier has a real one — the period still rolls, it just rolls to 0 — so the denial payload cannot
tell the two apart. The row reads `relistQuotaPerPeriod` from `/api/me` to pick the sentence, the way
`screens.tsx` already does for the strip. Splitting the copy is the same move `LockedState` makes for
`not-in-plan`: *"`upgrade` means 'you have spent this period's relists', which is a true sentence about a
different thing, and showing it here would answer a question nobody asked."*

**`click-through.md` step 5 of slice D already asserts the result** — *"every button is locked with an upgrade
prompt. No error, no failed sign-in"* — so that step is what this ticket makes true, and it failed until now.

**Built as written.** The grant is one boolean handed down to `AdList` — the screen above holds the
subscription, the list holds the order the ads are in, which is the division `selection.bulk` already keeps —
and `grantsNothing` is named once in `plans.ts` so the strip, the prompt and the rows cannot spell it three
ways. `refusalNote` takes it as a second argument and splits `upgrade` on it. Two things the ticket did not
say, and the code decides: **a row holding a deleted ad keeps its Opnieuw**, which falls out of `locked`
darkening only an *idle* button: finishing a relist whose delete already ran needs no fresh grant
(`enforcement-contract.md`), and a lock that took that with it would strand somebody's listing inside the
extension until they bought a plan. And **the row line is the refusal's, not a line under every row**: the bullet
above asks for *"the row line naming the plan rather than a limit"*, and the limit sentence being replaced is
`refusalNote`'s, so that is the one that moved. A locked idle row draws nothing — `NoRepostsPrompt` says it
once directly above a list that is uniform when this is true, twenty copies of one sentence would be the
third line per row that stops a 360px list being scannable, and Chrome draws no tooltip on a disabled control
to hover instead.

**Left alone deliberately:** the bulk cap is still `min(quotaRemaining, upTo)` (T68, ADR-0025), so on a spent
period the tick boxes do go dead while the Repost buttons stay live. That is not the same question — a cap
says how many of these may go in one batch, and `describeTick` names which of the two numbers is biting —
and changing it is a decision about the selection, not about the lock.

**Found, not decided: a failing card is the third case and this ticket did not rule on it.** `AdList`'s
`locked` does not read `subscriptionStatus`, so on dunning every Repost button is live, the click is refused
with `update-card`, and only then does the row go dark — the same shape the spent period keeps, and unlike a
spent period it is not a number that moves on its own. Two reasons it was left: it is a state about Stripe
rather than about the catalog, and the prompt is already there with the one button that fixes it. What is
worth saying out loud is the pair — **zeroed tier + failing card**, which ADR-0029 says is reachable — where
the buttons lock on the grant, the strip reads *"Geen herplaatsingen in dit abonnement"*, and the dunning
prompt below still offers *"Werk je betaalgegevens bij om weer te kunnen herplaatsen"*, which on that plan
would not. Pinned by a test so the state is known rather than accidental; the copy is a ticket of its own.

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
- The privacy page's words are the canvas's and every claim on them is one the schema can keep. **The
  terms are no longer the canvas's**: the operator handed over a full Gebruiksvoorwaarden on 2026-09-22 —
  acceptance, registration, IP, termination with its grounds, warranties and liability, payment and
  chargebacks, the 14-day herroepingsrecht, and the Marktplaats disclaimer T58 wants — rendered as written,
  and the `[PLACEHOLDER]` box came off both pages with it.
- **Three claims on the terms are ahead of the build and were kept deliberately**: a *gratis proefperiode*
  (ADR-0006 ships none — the free tier is permanent), billing *per maand* (T62 sells monthly and annually),
  and cancelling via *accountinstellingen* rather than the Stripe Customer Portal. The herroepingsrecht
  clause leans on the first of them. Reconciling the three is work this ticket did not do.
- **What the rewrite dropped is one section, *Opzeggen***: the operator's copy describes cancelling
  differently, and a page naming two routes would contradict itself. *Abonnementen en limieten* stayed, cut
  back to the facts that copy does not touch — the monthly grant, no carry-over, and a plan running out
  returning somebody to the free tier rather than locking them out (ADR-0018). It names **no way to cancel**,
  which is what keeps the two sections from disagreeing.
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

**The domain landed on 2026-09-23.** `adbump.nl`'s A record moved off Strato and onto the VPS, all four
hostnames and the apex resolve, and all five hold browser-trusted Let's Encrypt certificates — so
`MPRELIST_ACME_CA` is on the production directory and no longer on the staging one the example file ships.
`deployment.json`, `brand.json` and the generated theme carry the new addresses; the Web Store draft exists
and assigned `cefnlogjhmeceojlaoionfjpdkklmnaf`. What this ticket still owns, and none of it is a commit:
the `mprelist-dashboard` client's redirect URIs and web origins in the Keycloak console (the realm imported
the nip.io ones and the `${…}` templates went inert at first start), the Stripe webhook endpoint, and
registering the published extension id on `mprelist-extension` beside the unpacked one. `infra/README.md`
§ Hostnames before you own a domain records what the switch actually cost.

Three things this ticket leaves standing, recorded rather than discovered later:
- **The host's checkout is updated by hand**, deliberately. Doing it in the deploy script would mean a
  repository read key on that machine beside the read-only GHCR token, which ADR-0023 does not put there. So
  a release that changes anything under `infra/` needs a `git pull` on the host first, and nothing enforces
  it. **Closed by T81 below**, which is what happened the first time nobody did: the tree now travels as a
  third GHCR package on the credential the host already has, and there is no checkout left to forget.
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
  - **One field is already in that position.** `displayName` was renamed from the stale `Bumpr` to
    `mprelist (production)` on 2026-09-19 (T60), and if this realm has had its first start, the export is
    inert and that rename reaches it **only through the admin console**. The theme's half of this is what
    T81 removed: the sign-in page's new footer — `contact@adbump.nl`, and links to the site rather than to
    `bumpr.nl` — needed a `git pull` on the host when this was written, and now arrives with the tag
    (ADR-0034). The console edit does not, and never will: it is a realm property.
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
- **Production's tiers are test-mode tiers, and a key swap does not carry them over** (found 2026-09-24,
  preparing T58). Production was set up against test keys, so every paid tier row there points at a
  *test-mode* Price — and live mode has different objects with different ids. Swap the keys alone and every
  `/api/plans` lookup misses, which T49's all-or-nothing rule turns into a plan screen that fails for
  everybody, the Web Store reviewer included. So the swap is three steps, all in the dashboards and none in
  the repo: live keys into the host's `.env`; the Products and Prices recreated in live mode, whose webhooks
  draft the new tiers; those published, and the test-mode tiers deleted in `/admin` (ADR-0032). Any test
  subscriber left behind keeps a test customer id, so their *Betaling beheren* fails — nobody real, but
  expected rather than a bug.

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

**The icons are no longer part of filling this in** (T48, 2026-09-19): the package carries 16/32/48/128
resized from `brand.json`'s master, including the 128 the Store requires, and the listing's own store icon is
that same file. What is left here is the screenshots, the copy and the justifications below.

**The justifications, as they stand.** One line each, written here as each permission arrives rather than
assembled the night the listing is filled in — a permission whose reason has to be reconstructed months later
is the one that gets a vague sentence and a rejection.

| Permission | Why it is needed |
|---|---|
| `host_permissions` on marktplaats.nl | One pattern, `https://www.marktplaats.nl/*`. The extension reposts the user's own ads in their own Marktplaats session, which means reading their active listings and submitting a replacement — all of it in a content script that runs on that host and nowhere else. The permission's own consumer is `chrome.tabs.query`, which finds the tab the content script is in; **`tabs` is deliberately not requested**, so no other tab is visible, and saying so turns the permission into evidence of what this extension cannot see. |
| `storage` | Four things, all local to the user's browser: the sign-in session, the snapshot that makes an interrupted repost recoverable, the timestamp that paces consecutive reposts, and the served configuration document. |
| `unlimitedStorage` | A snapshot carries the ad's photos, because a repost deletes the original and re-uploads its content — so the photos are the only way to put an interrupted one back. A listing can exceed the default 10 MB quota, and exceeding it would mean an ad deleted from Marktplaats that this extension can no longer restore. |
| `identity` | Sign-in is Authorization Code + PKCE against our own identity provider, opened by `launchWebAuthFlow`. `getRedirectURL` is the only other call; **`getProfileUserInfo` is never called**, so the permission reads no Chrome or Google profile — worth saying on the form, because the permission's name suggests otherwise. |
| `alarms` | `service-worker.ts` registers `chrome.alarms.onAlarm` at the top level, so the permission is required for the worker to start at all. An alarm is what lets a paced sequence of reposts resume across the worker's suspension: the gaps are drawn wider than the ~30s a suspended MV3 worker survives, so no timer inside the worker can outlive one. |
| Remote code | **None.** The answer on the form is *"No, I am not using remote code"*: no `eval`, no `new Function`, no dynamic `import()`, no remotely-hosted script, no `chrome.scripting` and no `userScripts`. The served document (#36) is JSON — endpoint paths and timing numbers that shipped code reads — so no code crosses the wire, and saying that unprompted is cheaper than being asked. |
| Single purpose | Reposting the signed-in user's own Marktplaats advertisements so a listing that has sunk in the results is at the top again. Every capability above serves that one act. |

**Two host patterns were dropped on 2026-09-23**, and what they cost was a review question with no
answer. The manifest carried `https://*.marktplaats.nl/*` and `*://*.marktplaats.nl/*` beside the `www` one;
the second is a superset of all three and reads, in the install prompt and on the form, as *all* HTTP and
HTTPS on every `marktplaats.nl` subdomain. Nothing used either. Every endpoint is a path on `www`, the one
absolute URL in the endpoint config is `www`, and the apex and plain HTTP both `301` to
`https://www.marktplaats.nl/` — so no state a user can be in depends on them. Nor could they ever have: the
**content script** is where every Marktplaats request is made, and its `matches` is `www`-only, so a wider
host permission cannot widen what the extension reaches. The ad photos look like a counter-example and are
not: `downloadPhoto` fetches them from `images.marktplaats.com`, a `.com` host **no** pattern here ever
covered, and it works because that CDN answers `Access-Control-Allow-Origin: *`.

**And the one that stays is not free-standing.** `content_scripts.matches` already requests host access to
`www.marktplaats.nl`, so Chrome shows *"Read and change your data on www.marktplaats.nl"* whether or not
`host_permissions` repeats it. Removing the field would therefore reduce neither what the extension can
reach nor what the user is asked to grant — it would only cost `chrome.tabs.query` the ability to find a tab
the user already has open, after a service-worker restart, with no way to re-discover one.

**The `alarms` decision, filed 2026-09-23.** It was the one justification this table said needed deciding:
`alarms` is the batch runner's only user, the batch is withdrawn from the popup
([ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md), T70), and so this listing asks for a
permission no user of *this* build can reach. It cannot be dropped instead — the top-level listener throws
without it. **Filed describing the mechanism rather than the feature**, which is the option this entry
already named and is true of the shipped build sentence by sentence: the listener is registered at load, the
permission is what lets the worker start, and an alarm is what carries a paced sequence across a suspension.
What it deliberately does not claim is a bulk repost a user can press. If a reviewer asks to be shown one,
the answer is T70 — not a rewrite of this sentence, which would then be describing something absent.

**The rest of the form, decided 2026-09-24**, before the first submission. The field-by-field text to paste is
[`store/listing.md`](../store/listing.md); what follows is why it says what it says.
- **The package is CI's zip, and the draft's key is committed.** The draft exists and its public key is in
  `manifest.template.json`, so every upload from now on carries the Store's own key — which the Store
  accepts, where it refuses any `key` on a *first* upload. The CI zip has `manifest.json` at its root; a
  hand-made `dist.zip` that nested it under `dist/` was found beside it and removed, and `*.zip` is now
  ignored.
- **The reviewer gets an account and a video, never a Marktplaats login.** A reviewer can see nothing
  without both an AdBump account and a Marktplaats account with a live ad, and "could not verify the
  functionality" is the commonest rejection. So: a reviewer account on the **Default tier**, set up by hand
  and checked for reposts left just before submitting; *Test instructions* in English that quote the Dutch
  labels the reviewer will see; and an unlisted video of a real repost. A real Marktplaats login is not
  handed over — the reviewer's IP would trip Marktplaats's checks on the operator's own account.
- **Data usage ticks three boxes**: personally identifiable information (email, account id), authentication
  information (the tokens the extension keeps), website content (ad text and photos read and kept locally,
  the ad id sent). Not financial information — payment is Stripe's, on the site, and `/privacy` says so. All
  three certifications. Over-disclosing costs nothing; a box left empty beside a marktplaats.nl host
  permission reads as concealment. `/privacy` stays Dutch, with an English line in *Test instructions*.
- **The description states that a repost deletes first — one sentence, the outcome and not the mechanism.**
  The *Misleading or Unexpected Behavior* policy requires that a description "directly state the
  functionality", and an irreversible delete is the one a user would not guess.
- **And it says nothing Marktplaats's terms contradict.** Their
  [Algemene Gebruiksvoorwaarden](https://www.marktplaats.nl/i/help/over-marktplaats/voorwaarden-en-privacybeleid/algemene-gebruiksvoorwaarden.dot.html)
  forbid placing ads "via een geautomatiseerd systeem, of op enige andere wijze anders dan via de 'Plaats
  Advertentie' knop" (7.4) and placing a free ad more than once (2.2.4) — the risk ADR-0002 accepted. The
  Store's policies do not police a third party's terms, so this is not a rejection; it is the takedown
  complaint that could follow one. So never *automatisch*, *officieel*, *toegestaan*, *veilig voor je
  account* or anything implying Marktplaats's approval, and always *Niet gelieerd aan Marktplaats*, which
  the *Impersonation* policy expects of a listing using someone else's name.
- **Screenshots are the real popup over a real marktplaats.nl page**, personal details blurred; the promo
  tile is the mark without text; the 128 icon stays full-bleed. All of it lives in `store/media/`, ignored,
  because it shows a real account.

**The homepage is a page now, 2026-09-25.** The listing's Homepage URL is the site's root, which answered
*"Op dit adres staat niets"* until `docs/design/Landing.dc.html` decided what goes there: the listing's own
description in the site's card, and the plan cards. **`GET /api/plans` answers without a token** for it —
the one read the API opens, since nothing in it is per-user, and the popup still sends its token and gets
the same answer ([`enforcement-contract.md`](enforcement-contract.md)). The public site's one call is
`apps/web/src/public/plans-on-offer.ts`, which omits credentials, and `no-identity.test.ts` holds it to
that. The words a plan is read aloud in moved to `@mprelist/contracts` so the two surfaces cannot word one
price two ways. The install button links to the Store by the draft's id, so it is a `404` until approval.

#### [T60](https://github.com/Shei254/marketplaats-extension/issues/91) · Finalise the brand name · **S** · before T56 and T58
Web Store name availability, domain availability, a trademark search. One edit to `brand.json` and a rebuild
(T48) — everything else is prose, the listing, and the realm's origins.

**Domain availability closed on 2026-09-19**: `adbump.nl` is registered and carries an MX, so
`brand.json`'s `supportEmail` is now `contact@adbump.nl` and it delivers. What remains of this ticket is
Web Store name availability and the trademark search — both checks rather than commits.

**`brand.domain` is `www.adbump.nl` as of 2026-09-23.** It held `www.187-7-19-175.nip.io` until then, for
the reason its `$note` gave: the field's only consumers are footer links that have to resolve, and the
domain's A record still pointed at its registrar. T56 moved the record and this value with it — `www.` and
not the apex, because the apex is a permanent redirect to the site.

**The same session swept the last stale spellings of the old name**, which is the other half of "everything
else is prose": the production realm's `displayName` (now the identifier's — see the glossary's **Brand
name**), the Stripe suites' `bumpr.test` fixtures, twelve design artboards, and `vitest.config.ts`, which
held the last hand-copy of the name and now reads `brand.json` the way `build.mjs` does. What still says
**Bumpr** says it about the past on purpose: ADR-0033, T80 below, and `ProductionRealmTest`'s javadoc.

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
that shipped, gained an operator control, and currently cannot be reached. **T77 is the 2026-09-16 deletion session**, which asked for a delete button
and left with ADR-0014's central invariant narrowed. **T73 and T74 are the
2026-09-10 session**, which came in asking for a tier with no repost cap and left with a sentinel
placement ([ADR-0029](adr/0029-unlimited-is-null-and-zero-still-grants-nothing.md)), a publish rule that
closes a gap nobody had noticed, and the vocabulary defect found underneath the new copy.

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

**And one shape to reconsider while the file is open.** `BulkSelection.cap` is `Infinity` where nothing caps
a selection — an unlimited tier whose flag sells no number (T73, [ADR-0029](adr/0029-unlimited-is-null-and-zero-still-grants-nothing.md)).
It is arithmetically correct at all ten comparison sites, and it printed "5 of Infinity selected" from the
one of three template strings that had no guard, because a docstring claimed there were two. The fix was a
guard; the shape is the question. **A nullable `cap` is not the answer** — `${bulk.cap}` compiles just as
happily and prints "5 of null", so the compiler catches neither — and the only design that makes a leak a
type error is a discriminated union on whether the selection is capped at all. That is ~10 narrowing sites
across `batching.ts`, `SelectionHeader`, `Popup`, `BatchBar` and `AdList`, which is not work to do to a
screen no user can open. Do it here, where the code is being touched and walked anyway, or decide the guards
are enough.

#### [T71](https://github.com/Shei254/marketplaats-extension/issues/157) · A repost puts back the Gereserveerd flag · **M** · T26, T30b, T45
A repost is delete-and-recreate (ADR-0002), and the new ad is not identical: the `Gereserveerd` flag is gone,
so an item the seller promised to a buyer goes quietly back on the open market as a side-effect of our own
mechanic. `CapturedAd.reserved` has been in the capture all along, read by nothing. **A safety net rather
than a feature**, which is what makes the second half of the ticket part of the work.

**`PUT /seller/api/reserve-ad`, body `{"itemId": …}`** — observed 2026-09-07, the `deleteAd` shape minus the
`reason`, and it picks up the CSRF header and the 403 retry from `request()` for free. A fresh ad is never
reserved, so the flag is only ever *set* and whether the endpoint toggles is a question nobody has to answer.

**The hard part is the new ad's id, and `createAd` returns none.** The create redirects through
`/payments/orderOverview/…?orderId=…` — the order for the free placement, not the ad — and lands on
`/seller/view/:id`. Reading that final URL off `res.url` is exact and free and **is the refinement, not this
ticket**: it depends on the middle hop being a server redirect, which nobody has observed. What ships is a
**`listMyAds` diff** around the create — one addition is the new ad, zero or more than one reserves nothing,
because reserving the wrong ad marks an unrelated *live* listing as promised to a buyer.

**The orchestrator drives it**, in `createFromSnapshot`, which `retry()` and `resumeSnapshot()` share — so a
relist that crashed and resumed hours later re-reserves, since `reserved` rides in the ADR-0003 snapshot. The
cost is visible and accepted: the refinement will take the diff back out of the orchestrator and its suites.

**It fails silently, and that is a decision.** The outcome stays `relisted` and the report stays `SUCCESS`,
because the repost did succeed and the unit is rightly spent. What is lost is the seller's knowledge that an
item they promised is back on the market, and all that mitigates it is a log line naming which of the three
cases it was. Written down so it is not later read as a bug.

**On the screen**, `<Badge tone="accent">Gereserveerd</Badge>` first in the meta line. Not a row tint and not
a left rail: `[data-ticked]` already owns `--mp-hover` plus an inset accent rail and `[data-state="busy"]`
owns the same background, so either would be indistinguishable from *selected* and *reposting*.

**And the other half — what a repost silently drops.** `reserved` is the first entry on a list nobody had
written down. `buyItNowEnabled`, `escrowAllowed` and `isMultiLingual` are captured, posted by nothing, and
destroyed by every repost; `adFeatures` is destroyed too and **correctly so**, since restoring a Dagtopper
spends the seller's money without asking. The table goes in `internal-api-findings.md`, the three form-field
candidates get their own ticket, and none of them is built here — they are edits to `createAd`'s form, whose
order is load-bearing and observed-only, and putting a safe endpoint call behind three speculative edits to
it risks the safe part for nothing. That boundary is [ADR-0028](adr/0028-a-repost-puts-back-what-it-can.md).

**Vocabulary.** This file's own orchestrator already says "the reservation the backend took" about something
else entirely, so the glossary gains **Gereserveerd (Reserved ad)** with `_Avoid_: reservation` — the quota
concept keeps the noun, the ad concept takes the Dutch adjective. And `reserveAd` is the tenth endpoint,
which makes the "nine" spelled out in prose wrong everywhere. The ticket said 13 places across 8 files; it
was **16 across 11**, the extra five being `apps/api/README.md` (×2), `clientconfig/package-info.java`,
`ClientConfig.java` and `packages/contracts/src/enforcement.ts` — none of which the count was taken from,
which is the argument for the count never being written in prose in the first place.

**Only a real account can finish it.** Every suite here stubs Marktplaats, and the end-to-end check is
destructive (ADR-0002/0003).

#### [T72](https://github.com/Shei254/marketplaats-extension/issues/158) · The three other fields a repost drops · **M** · T71, T45
[ADR-0028](adr/0028-a-repost-puts-back-what-it-can.md) wrote down what a repost destroys and restored exactly
one entry. `buyItNowEnabled` ("Direct kopen"), `escrowAllowed` (a second protection flag — the *other* one,
`isBuyerProtectionActiveOnListing`, is posted) and `isMultiLingual` (only the `nl-NL` title and description go
out, so a bilingual ad loses half of itself) are captured, posted by nothing, and gone on every repost.
`adFeatures` is **not** on the list and never will be: restoring a Dagtopper spends the seller's money without
asking.

**The work is observation and not code.** Nobody knows the field names — each needs a real ad created by hand
with the option on and the `POST /plaats/ads` body read out of DevTools, *including where in the order the
field sits*, since that order is load-bearing. Then emit it, re-freeze the golden payload (ADR-0015), and
record the finding. **A field whose name cannot be established is left alone and said so**: a guessed form
field is how a create starts 4xx-ing after a delete, which costs a real listing — which is also why this is
its own ticket rather than a rider on T71's safe endpoint call.

#### [T73](https://github.com/Shei254/marketplaats-extension/issues/160) · A tier may grant unlimited reposts · **M** · T53, T54, T66 · **shipped**
[ADR-0029](adr/0029-unlimited-is-null-and-zero-still-grants-nothing.md) is the decision, and its shape is one
sentinel placement: **`null` is unlimited, `0` still grants nothing.** The obvious spelling — `0` means
unlimited — is rejected there, because `0` is what `V5__tier_publication.sql` adopts a draft at, what
[ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md) spells "there is no free tier" as, and what
`TierRows`' `where relist_quota_per_period > 0` tests against.

**The column, and why `Integer` rather than `-1`.** `tier.relist_quota_per_period` becomes nullable; the
`>= 0` check stays. `Entitlement`, `TierEdit`, `CatalogEntry`, `RemainingQuota` and `DisplayState` go
`int → Integer`, which is the point of choosing `null`: `Math.max(0, -1 - held)` is `0`, so a `-1` tier would
refuse every repost and read as a gate that works, while a `null` cannot be silently arithmetically wrong.
`RemainingQuota.of` answers `null` and `isSpent()` is false; the held-count query may be skipped, since
nothing reads the number.

**Two wire shapes, and they differ on purpose.** Read side — `/api/me`, `/complete`, `/api/plans` and
`AdminTier` — is `number | null` in `packages/contracts`. Write side needs a rule the read side does not:
`AdministerTiers` states *"field is sent every time, so there is no 'absent or null' question"*, and both
`asGrant()` methods refuse on `null` meaning *you forgot it*. So on the admin `PUT`/`POST`, **absent is a 400
and an explicit `null` is unlimited**. No precedent for that distinction exists here — `@JsonCreator` appears
twice, both on value types — so **the mechanism is to be verified, not assumed**.

**The publish rule is the half of the original proposal that was right.** `published → (quota > 0 OR quota IS
NULL)`, at `V7`'s three layers: a trigger, a typed `TierEdited.NothingToGrant` beside `NothingToChargeAgainst`,
and a restatement in `CatalogEntry`'s constructor. It closes a live gap — the `> 0` guard was only ever on the
webhook auto-publish path, so a zero-grant tier could be hand-published and bought.

**`/admin` gains a checkbox and two warnings.** "Unlimited" disables and greys the number field. One warning
fires when a published tier is zeroed — it says the plan will be withdrawn, then the form sends
`published: false` itself, which is `NewPlanForm`'s existing habit of refusing locally rather than round-tripping
to be told. The other fires on ticking Unlimited on the `isDefault` row, naming the reach: every new account and
every subscription that ends ([ADR-0018](adr/0018-lapse-falls-back-to-the-default-tier.md)). It warns rather
than refuses because a self-hosted single-user deployment *is* that configuration. **Note while in there:**
`Number("") === 0`, so a blank quota field currently submits a zero-grant tier silently, at both call sites.

**The popup gets two states, not one.** Unlimited is the tier name and "Unlimited reposts" — no bar, no date,
mirroring the `paymentFailing` branch that drops both for the opposite reason. And a tier granting `0` stops
being read as *exhausted*: `ExhaustedPrompt` currently promises its holder their reposts "come back on 14 Sep"
when they come back as 0, so the strip reads "No reposts on this plan" and the prompt drops the date. `bulk`'s
`min(quotaRemaining, upTo)` becomes `upTo`.

**One rename rides along**, and only one: `relistsLeft` → reposts, because it would otherwise sit one line from
"Unlimited reposts". Everything else is T74.

**Deliberately not here.** A `used` count for unlimited tiers — the better screen, and its own ticket rather
than a rider on a wire shape this already changes. `max_marktplaats_accounts` gains no unlimited; it is 1 on
every tier until T38. Nothing in Stripe changes: a quota was never Stripe's
([ADR-0014](adr/0014-tier-catalog-and-entitlements.md)).

**What the build settled, since the ADR left three things open.**
- **The absent-vs-null mechanism was verified rather than assumed**, as the ADR asked. `Optional<Integer>` on
  a record component answers `Optional.empty()` for absent *and* for an explicit `null` under Jackson 3 —
  exactly the distinction wanted and exactly the one it cannot make. A `JsonNode` component arrives as a Java
  `null` when absent and a `NullNode` when written out, so that is what `TierEditRequest` and
  `NewPlanRequest` hold, read through one `AdministerTiers.quotaSent`.
- **`409` on the admin `PUT` now means one thing said two ways** — nothing to charge for it, or nothing to
  get for the money — and the two are deliberately not told apart on the wire: a `reason` would be a second
  vocabulary on an API whose codes are about a *user*, and the screen sending it has both facts on the row.
- **`POST /api/admin/plans` refuses a published zero-grant plan as a `400`, before Stripe**, where the edit
  route answers `409` at the end. That route creates a Product first, so a refusal after it would arrive as a
  `409` indistinguishable from "that code is taken" — and an operator would rename, retry, and make a second
  Product.
- **The zero-grant warning is two sentences and fires on the checkbox, not the stored row.** The ADR names
  one: a published tier being zeroed, told it will be withdrawn. The submit refuses the other direction too
  — ticking On sale on a draft, which is quota 0 by definition ([ADR-0019](adr/0019-plans-are-stripe-first-and-webhook-synced.md)) and so
  the commoner way to ask for this at all — and keying the warning to the stored flag left that path saving
  with the box quietly back where it started. Found by review. The second sentence says the tier will *not*
  go on sale, because the withdrawal one would be describing subscribers a draft does not have.

The strip's reset date goes with the prompt's on a zero-grant tier, which the ADR states only of the prompt:
"resets 14 Sep" under "No reposts on this plan" is the same promise in fewer words. And the popup's bulk cap
is `Infinity` where neither the quota nor the flag caps a selection — arithmetic rather than a sentinel, since
every comparison over it is correct. Three places could print it and each is guarded separately; this first
said "the one template string, and it asks `describeCap` first", which was wrong and was what stopped anybody
reading the third. `describeSelectAll` counted a selection against the cap whenever a search hid part of it,
and on an unlimited tier that read **"5 of Infinity selected"**. Found by review, fixed with the sentence.

**Not walked against real ads.** Everything here is held by the three suites; the click-through scripts move
with the copy but nobody has driven an unlimited tier through a real Marktplaats account.

#### [T74](https://github.com/Shei254/marketplaats-extension/issues/161) · One word for the thing users press · **S** · T73 · **shipped**
The button says **Repost**. The strip above it says **relists**. The admin quota field says both in one field —
label *"Relists per period"*, hint *"How many reposts a subscriber gets each period."*
[ADR-0029](adr/0029-unlimited-is-null-and-zero-still-grants-nothing.md) settles it: users read **repost**,
internal identifiers keep **relist**, and the split is deliberate the way the glossary already splits the
**Brand name** from `mprelist`.

**Copy only, and that is the whole reason it is a separate ticket.** `POST /api/relist/authorize`,
`RelistEvent`, `RelistGate`, `relistQuotaPerPeriod` on the wire and in the column, and every golden payload
stay exactly as they are — so this diff touches no schema, no contract and no test fixture, and mixing it into
T73 would have buried a nullable column and a new invariant in a repo-wide rename.

The sweep is `/admin`'s labels, hints and validation messages, the remaining popup and plan-card strings, and
the prompts. `relistsLeft` is already done by T73. **Prose in ADRs is not touched** — a dated record is not
rewritten to match how things turned out ([`adr/README.md`](adr/README.md)) — and neither are code comments,
which are about the identifiers they sit beside.

**Where it landed, and the half the ticket could not have known about.** The English sweep the ticket
describes was **all `/admin`'s**: the page lede, the `Relists` column, `Relists per period` on both forms, and
the validation message, which is spelled twice because the two forms parse the quota separately. There was no
popup or plan-card half left to do. The popup was **translated to Dutch** after this ticket was written, and
the Dutch had already picked one word — *herplaatsen* — so T73's `relistsLeft` was the last English string a
user could read there. *(No count is given on purpose. T71 below is the argument for that.)*

**So the ticket's real remainder was in the Dutch**, and it is three strings that had drifted to *"opnieuw
plaatsen"* — Marktplaats's own name for the act, which the glossary gives to **Relist** and not to this.
- The row message after a failed repost: *"Je advertentie is verwijderd, maar **opnieuw plaatsen** is mislukt
  … klik op Opnieuw"*. Two words for one act and then a third reading of the second, in the message a user
  only ever meets **after their ad has already been deleted**. Now *herplaatsen is mislukt*, in `relisting.ts`
  and `batching.ts` both.
- **`describeStop("ad-down")`**, found by the spec review: every other branch of that switch says
  *herplaatsen* or *herplaatsingen* and this one said *"kon niet opnieuw worden geplaatst"* — the mixture
  inside a single switch.
- **The sign-in screen**, which said *"met één klik opnieuw te plaatsen"* four lines above *"het herplaatsen
  gebeurt in je eigen browsersessie"*. One screen, two words, and it is the first screen anybody sees.

**And the two sentences stopped being two.** They were duplicated verbatim across `relisting.ts` and
`batching.ts` and agreed only by somebody remembering to keep them agreeing — which is exactly how one of them
came to say *"opnieuw plaatsen"* while the other said *"herplaatsen"*, so the popup gave the act two names
depending on whether the ad had been ticked. `AD_UNCHANGED` and `AD_IS_DOWN` are now exported from
`relisting.ts` and imported by `batching.ts`, which already took `RowState` from it. **A structural change in
a ticket scoped "copy only", and taken on purpose**: this sweep had just paid the duplication's price — one
word meant four edits — and a word cannot be *one* word if the sentence carrying it is two. The suites split
the same way, each fact once: `relisting.test.ts` asserts what the sentences say, `batching.test.ts` asserts
only that it is saying the same ones, character for character.

**One Dutch string was left alone, deliberately.** The row's hover text still reads *"Verwijder ‘…’ en plaats
de advertentie opnieuw"* — that sentence exists to say a repost **deletes first** (ADR-0002), which is the one
thing the button cannot say on its own, and the single verb is precisely what would hide it. Spelling the two
steps out is not a second name for them, and the glossary now says so rather than leaving the next reader to
"fix" it.

**Covered as a sweep rather than field by field.** `/admin`'s suite opens every panel that screen has — the
catalog, New plan, Edit, Prices and Delete — and asserts the whole rendered text says *repost* and never
*relist*. The defect this ticket is about is a **mixture**, and per-string assertions are what let the label
and its own hint disagree for four tickets; a panel added later is covered the day it is opened in that sweep.
The validation message now has **both** of its spellings asserted — the edit form's copy was the only one
anything checked, which the standards review caught and which is the exact shape of defect this ticket is for.

**Two things outside the stated sweep moved with it**, named here so they are not read as scope creep. Two
sample strings in `packages/ui`'s own component test read `Relists per period` and `2 of 3 relists left`, the
second verbatim the string T73 retired; and the root `README.md` quoted that same dead string as live copy.
Neither is shipped, and both are how a retired spelling comes back — a library's canonical example and the
first file anybody reads. `README.md`'s *"a Repost button that runs one relist at a time"* **stays**: that one
is prose about the mechanic, which is exactly what keeps the word.

#### [T75](https://github.com/Shei254/marketplaats-extension/issues/164) · The operator sets the order the plans are read in · **M** · T53, T54, T73 · **shipped**
The plan cards are ordered `relist_quota_per_period, code` and always have been — cheapest grant first, ties
by code — spelled identically in `TierRows.published()` and `TierRows.everyTier()` so the popup and `/admin`
read alike. Nobody chose it, and the `V2` seed hides that: `free` 3, `pro` 50, `power` 200 is grant order and
creation order at once, so the rule has never had to be told apart from anything. It comes apart on the first
tier granting 100.

[ADR-0030](adr/0030-the-catalog-order-is-the-operators.md) makes the order stated rather than derived,
because *which plan you want bought* is not a function of any column we have. Ordering by amount instead of
quota was weighed and is a better derived rule that still cannot say "Pro first"; a `featured` boolean was
weighed and is the pair-that-can-disagree shape this repo has refused four times.

**`V10__catalog_order.sql`** adds `position integer not null` to `tier`, backfilled from
`relist_quota_per_period, code` so nothing moves on deploy. **No `unique`** — the only unwriteable version
needs `deferrable initially deferred`, which V7 has already argued is a test that passes having checked
nothing — so distinctness is the single writer's and the read is `order by position, code`. The one insert
path in `TierRows` gains `coalesce(max(position), 0) + 1`, so a tier the sync drafts lands last. It is `V10`
because `V9__unlimited_reposts.sql` is T73's, which is why that ticket is a dependency and why it is one this
no longer waits on.

**`PUT /api/admin/tiers/order`** takes `{ codes }` — the whole catalog, in order, one statement. It follows
`isDefault`'s precedent: order is a property of the catalog, so it stays off `TierEdit`. **One refusal,
`409` with an empty body**, for a list that is not exactly the catalog's set — a forgotten tier and an unknown
code are one event to the only caller, and it doubles as the stale-screen check for a draft the sync added
while the page was open. **`AdminTier` gains no `position`**: the array is already ordered, and a number
beside it is one fact spelled twice (ADR-0026).

**The screen** gets a drag handle column, native `draggable` rows, and an up/down `IconButton` pair. The drop
*is* the commit — optimistic move, whole-sequence PUT, snap back with a `Note` on refusal. The buttons are
the keyboard path and the only half the suite can hold: `happy-dom` ships no `DragEvent` and no geometry, so
**the drag layer is covered by `click-through.md` and nothing else**. No dnd library — it would be the first
behaviour dependency in `apps/web` ([ADR-0021](adr/0021-design-system-stays-ours.md)) and would buy no
coverage either.

**Not in it:** a live preview of the cards beside the table (a second `PlanCards` in a second app, and it
could never show the per-viewer `CurrentPlanCard` anyway), touch dragging, per-viewer ordering. The extension
is untouched — `PlansOnOffer`, `subscribing.ts` and `PlanCards` already render whatever order the API sends.

**Shipped, with one thing built a layer lower than written above.** "A tier nobody placed goes last" is
`V10__catalog_order.sql`'s `tier_is_placed_last`, a `before insert` trigger, rather than a
`coalesce(max(position), 0) + 1` inside `TierRows`' insert. There is one production path that creates a tier
and there are the seed, later migrations and seven test fixtures; written in the insert the rule would have
been true of the first and false of the rest, which is V1's argument and V5's and V7's. The column is
therefore `not null` **with no default** — a `default 0` would have been the opposite of the rule, filing
every unplaced tier ahead of the plans somebody arranged. [ADR-0030](adr/0030-the-catalog-order-is-the-operators.md)
describes the expression in the insert and is a dated record that stays as written
([adr/README.md](adr/README.md)).

**Two smaller things the plan left open, decided while building.** The `200` answers with the whole catalog
in its new order — the same **AdminTiers** body the `GET` gives, read back inside the write's transaction —
so the screen reconciles against what was stored rather than keeping the row where it was dropped; the
contract now says so. And the up/down glyphs are `↑`/`↓` inside `IconButton` rather than icons added to
`packages/ui`: `icons.test.tsx` matches every glyph that package ships against an artboard, and `/admin` is
the one surface the design canvas does not draw (T54). The grip is one CSS rule over a token, for the same
reason.

**Where the honest gap is.** The drop has no automated cover at all and `docs/click-through.md` step 9f says
so in the step itself. What the suite does hold: the buttons (which are the same function), the arming of
`draggable`, the whole sequence going out as one `PUT`, the snap-back, and the `409`-becomes-reload. The API
side is `AdminTierTest`'s new section, `BaselineSchemaTest` on the column and the missing `unique`, and
`PlansTest` on the cards following the catalog.


#### T76 · The free tier is one an operator can name · **S** · T53, T54, T73, T75 · **shipped**
"How is an admin meant to set the free tier" had no answer written down, and working it out found that most
of one already existed. [ADR-0031](adr/0031-the-free-tier-is-the-one-without-a-price.md) is the decision.
Name, quota, feature flags and position have been editable since T54; **the code has not**, so every
deployment calls its free tier `free` because `V2__seed_tier_catalog.sql` said so in August.

**No migration, no column, no constraint.** A tier is free exactly when it has no `tier_price` row — derived,
like `isDefault` is derived, and for the same reason a `featured` boolean was refused in ADR-0030. "At most
one free tier" needs nothing enforcing it: `NewPlanInStripe` refuses an empty rhythm list in its constructor
and the sync adopts a tier *from* a Price, so neither creation path can make a second one.

**`TierEdit` gains `code`**, accepted exactly while `not exists (select 1 from tier_price where tier_id = ?)`.
Beyond that the code is in Stripe as `metadata.tier_code` and a rename would leave the tier holding Prices
that name something else — the next `price.updated` would adopt the old code as a fresh draft, splitting the
tier in two. Retagging the Prices in the same operation was weighed and rejected: a local commit plus N
Stripe calls half-fails into exactly that split.

**The code is derived from the name, never typed** — `tierCodeFrom` already exists, already normalises, and
`tier-code.ts`'s "nobody types a tier code any more" stays intact. The cost is accepted and stated in the ADR:
on this one row, renaming stops being cosmetic. The form prints the derived code while it is being typed, the
way `NewPlanForm` does.

**Three collisions, refused on the form before submit** — a code the catalog holds, a name deriving to
nothing, and the reserved literal **`order`**, which `AdministerTiers` currently dismisses with "Nothing
creates one" and which a *name* can now create. A tier coded `order` is the one row that can never be edited
again, including to undo it. The API keeps a `409` as the backstop, and its sentence broadens from "this tier
cannot go on sale as described" to "the catalog cannot hold this tier as described" — still one empty body,
still one recovery (reload).

**The Prices button on the free tier's row warns and then allows**, naming both consequences: it is the tier
every new account lands on and every ended subscription falls back to, and adding a price freezes its code
permanently. Refusing it on the `isDefault` row was weighed and rejected — it would force a default-tier swap
that hands new accounts a paid tier for free while it happens.

**One comment is corrected because it is already wrong.** `TierEdit`'s "No `code` … a subscription's tier is
found through it" is false and was when written: `subscription.tier_id` is a uuid and `TierRows` looks the
tier up by it, reading the code *out* of the row. Nothing finds a tier by code except the admin routes, by
path.

**Not in it:** a delete route (the free tier has every user on it and `subscription.tier_id` carries no delete
rule, so it is deletable only before the first sign-in — and deleting the default takes sign-in down), a
second free tier, grandfathering, any user-to-tier admin route, and `max_marktplaats_accounts`.

**Click-through:** rename the free tier in `/admin` and watch its code follow on the row; reopen the popup and
see the new name on the plan strip; try naming it after an existing plan and after `order`, and be refused
without a round trip; add a price to it and read the warning.

**Built as written, with one addition.** The reserved literal is refused by the **API** as well as by both
forms, in the same `409` and with its reason stated where the collision lives: `AdministerTiers` owns the
routing table, `TierEdits` knows nothing about one, so the check is on the route rather than in the catalog.
`POST /api/admin/plans` refuses it too — a plan named "Order" derived it before T76 and would have created a
Stripe Product for a row nothing could then edit. `AdminTierTest`'s fixture also changed shape: it restored
the seeded catalog by deleting every row whose code was not one of the three, which was the same statement as
"restore" only for as long as a code could not move, and would now delete a renamed free tier along with the
default flag and every later test's sign-in. It reads the three ids once and puts the codes back on them.


#### T77 · Every tier is deletable · **L** · T53, T54, T61, T62, T76 · **shipped**
*No issue filed — this came in as "the admin has no way to delete tiers" and is written down here where every
other decision is.* [ADR-0032](adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md) carries
the argument.

The session opened on symmetry — `/admin` creates and cannot delete — which this repo has refused three times
as a reason to build anything, and the argument that survived is about **T61**: creating a tier is one submit
now, so a typo, a wrong rhythm or a plan made against the wrong account is a permanent row in a catalog whose
whole audience is one operator. **T76 ruled a delete route out the same morning and was right about the
question it asked** — the free tier has every user on it — and asked of the catalog as a whole the answer came
out the other way, because what made deletion look impossible was a foreign key and a throwing lookup rather
than anything an operator would recognise.

**Two things nobody had written down, found on the way, and they are why this is an L rather than an S.**
A deleted tier **comes back**: `StripeEvent.isAboutAPrice()` is true for `price.updated` as well as
`price.created`, `tier_price` cascades but the Stripe Prices do not, and the next update on one re-adopts
`metadata.tier_code` as a fresh draft — as a `LOG.warn` nobody reads. And **archiving a Price does not stop
the billing**: it stops new purchases, so a delete that only tidied the catalog would leave real customers
paying monthly for a tier that is gone.

**Schema** — one migration.
- `subscription.tier_id` **nullable**, foreign key rebuilt `on delete set null`. A row with no tier keeps
  `stripe_customer_id` (a returning payer stays the same customer) and `created_at` (the anchor every future
  `resetAt` is rolled from), which is why the row survives rather than being deleted.
- `stripe_cleanup` — **one row per outstanding Stripe call**: `tier_code`, `kind`
  (`cancel_subscription` | `archive_price` | `archive_product`), `stripe_id`, `attempts`, `last_error`,
  `done_at`. One stuck object does not block the rest.

**API**
- `DELETE /api/admin/tiers/{code}` → the whole **AdminTiers** body, read back in the write's transaction, like
  `PUT …/order`. **`404` is the only refusal** — every tier is deletable, the default and the last included.
  A tier coded `order` is deletable though not editable, since `PUT …/order` takes the literal and this does
  not.
- In one transaction: subscribers move to the default tier (or to no tier where the deleted row *is* the
  default, or is the last); `tier_price` cascades; the Stripe work is **enqueued from the ids while they still
  exist**, never re-derived afterwards.
- A `@Scheduled` drain — `ReservationReconciliation` is the precedent. Per tier: cancel each live Stripe
  subscription, archive **and untag** each Price (`active=false` + `metadata[tier_code]=""`, one call),
  archive the Product (a `retrieve` per Price to learn the id — it was never stored).
- **`PriceAdoptions.adopt` refuses a code with unfinished cleanup rows**, which closes the resurrection window
  without burning the code for good.
- **`TierCatalog.defaultTier()` → `Optional`**; `ProvisionOnFirstLogin` stops throwing and writes a tier-less
  row; `SubscriptionRows.ended()` falls back to no tier where there is no default (ADR-0018, refined).
- **`PUT …/{code}/default` adopts every orphan** in its own transaction — the sole writer of the flag, so the
  only moment "no default exists" stops being true.
- **`Subscription.tier()` becomes `Optional<TierId>`**, so the compiler names all four readers —
  `DisplayStates`, `QuotasFromReservations`, `RelistGate`, `SubscriptionRows` — rather than each remembering.
  T70's argument about `BulkSelection.cap`, applied where it is cheap.
- **`AdminTier` gains subscriber counts**: how many move, and how many live Stripe subscriptions get
  cancelled.

**Contracts** — `DENIAL_REASONS` gains **`NO_TIER`** and `Denial` gains `{ reason: "NO_TIER" }`, carrying
nothing. **Not `NO_PLAN`**: a **Plan** is a Tier joined with a Price, so a free user has a Tier and has never
had a Plan. It states a condition rather than a cause, like every code beside it.

**Extension** — `display-state.ts` gains `{ status: "no-tier" }` beside `signed-out` and `outdated`, and the
popup draws a real sentence for it. **This is the half that makes the code worth its contract change**: every
other non-`200` maps to `unavailable`, so a denial sent only to the gate would be read by nobody.

**`apps/web`** — a Delete on each row, a quantified confirmation naming how many subscribers move, how many
Stripe subscriptions are cancelled, and that this is the default tier if it is. **Typing the tier's name is
required only when live payers will be cancelled** — friction tracking consequence, so undoing a plan made a
minute ago stays one click.

**Two comments that are already wrong and go with the work.** `AdministerTiers`' *"What it deliberately cannot
do: create a tier, delete one, or set a price"* and `AdminCatalog.tsx`'s *"What it will not offer: creating a
tier, deleting one…"* — T61 shipped creation and neither was updated, so "the API refuses it" had stopped
being the reason before this ticket touched anything. A third goes with them and is accurate until this
ships: `AdministerTiers`' *"a catalog with none takes down every new sign-in"*, which is the argument for
`isDefault` moving rather than toggling. The move survives — nothing here adds a request that clears the flag
— but the consequence it names stops being true the moment provisioning writes a tier-less row.

**Costs accepted, written down so they are not later read as oversights.** A build installed before this
renders `NO_TIER` as "something went wrong, try again" until it updates — the trap `BULK_NOT_ENTITLED`'s
docstring exists to record. Deleting the last tier takes the product down for every user until a new default
exists, by design. A payer drops to the default the instant the row goes, losing the remainder of a period
they paid for, and any refund is the operator's to issue in Stripe. `stripe_cleanup` is this app's first
durable work queue, and a row Stripe refuses forever is one somebody has to notice.

**Click-through:** `docs/click-through.md` § *After Go-Live · I can delete a plan*. Create a plan, delete it,
confirm the row and its Stripe Product and Prices are gone or archived; edit one of those archived Prices in
the Stripe dashboard and confirm the tier does **not** come back; delete a tier with a live test-mode
subscriber and watch them land on the default with the subscription cancelled; delete every tier and confirm
the popup says something true rather than "unavailable"; make a tier the default and watch the orphans
reattach.

**Where it landed, where the ticket reads differently from the code.** Two, both about placement rather than
about what was decided. The `stripe_cleanup` queue is **`catalog`'s table**, not `billing`'s: `adopt` has to
read it on the hot path to refuse a code still being torn down, and asking that across a module boundary
would invert the dependency `billing → catalog` that the boundary check already enforces — so the ids live
beside the tier codes they are keyed on and `billing` owns only the calls (`TearDownDeletedTiers`). And the
delete itself is composed in **`admin`** (`CatalogAndSubscribers`), because one transaction spans
`catalog`'s rows and `subscription`'s and neither module may reach into the other; `TierEdits.delete` is the
catalog's half alone. **`POST /api/admin/plans` had to learn the refusal too**, which the ticket did not name and which the code
review found: the catalog holds no row under a deleted code, so the create's existing `409` passed, Stripe
made a Product and tagged Prices, and the `adopt` behind them then refused the code — a `500` on a branch
commented *"both unreachable"*, and Stripe objects no cleanup row covers. So `TierTeardown.isBeingTornDown` is
on the port rather than private to the table (two callers ask it), and the create's `409` now means three
facts rather than two. `ReasonCode` moved out of `enforcement/internal` for a third, smaller reason:
`NO_TIER` is the first code answered by a route the gate does not own, so `display` needed the word and a
second spelling of it would be a string nothing compares to anything.


#### T78 · A stranded account is shown the catalog, not a wait · **S** · T77, T52 · **shipped**
*No issue filed — this came in as "instead of showing a user that message, they should be shown subscription
tiers that they could subscribe to" and is written down here where every other decision is.*

T77 shipped `NoTierScreen` with a stated rule: *"It says nothing about paying, deliberately. A subscriber
whose plan was deleted has had their Stripe subscription cancelled, and pointing them at the plan cards at
this moment would be offering a catalog that **may** be empty."*

**That argument is conditional and the screen was not.** A tier-less subscription is reachable two ways
([ADR-0032](adr/0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md)) — an operator deletes the
**default** tier, or deletes the **last** one — and only the second empties the catalog. In the first there are
published tiers sitting on sale the whole time, and the screen told somebody who could fix their own problem
in one click to wait for a stranger. Worse, it told them *"dit lost zich vanzelf op"* about a state that
resolves only when an operator happens to act.

**So the branch is on what `GET /api/plans` answers, not on the denial.** Something on sale: the cards, and
none of the waiting copy — telling somebody to sit tight directly above a row of buy buttons is the screen
contradicting itself. Nothing on sale: T77's words exactly as they were, including the button that is
deliberately absent, because there the original reasoning holds in full.

- **`PlanCards.current` becomes `DisplayState | null`.** A tier-less account is not on the free tier and must
  not be drawn as one: no `Huidig` badge and no `CurrentPlanCard`, which had nothing to draw a name or a grant
  line from anyway. The nullable is the honest shape — "which card is theirs" has *no answer* here rather than
  a default one.
- **`loadPlans` is split out of `seePlans`**, which was fetch-and-navigate in one. `no-tier` wants the fetch
  without the navigation, and it is the one non-`ready` answer that needs a second call at all — the screen is
  reached without ever passing through the plans screen, so nothing else would ask.
- **The cards are handed in as `children`**, the arrangement `PlansScreen` already uses: `PlanCards` reads
  `grantLine` from `screens.tsx`, so importing it back would close a cycle.
- **Only a *loaded and empty* catalog is the dead end.** While the call is in flight or has failed the cards
  own the screen and say so themselves, because claiming "this will resolve itself" over a request that has
  merely not landed is a guess presented as news.

**ADR-0032 is not touched** — a dated record is not rewritten to match how things turned out
([`adr/README.md`](adr/README.md)) — and its *Revisit if* already gestured at this ground: *"if an emptied
catalog turns out to be a state anybody sits in rather than passes through"*. The distinction this ticket
draws is the sharper one: it is not the **emptied** catalog anybody sits in, it is the **defaultless** one,
and those had been treated as the same screen.

**Not walked against a real account.** Held by the two suites — `screens.test.tsx` on the branch, and
`Popup.test.tsx` end to end, including that `/api/plans` is asked at all, which is the half a component test
cannot see. The Checkout hand-off from this screen is the same `upgrade` the plans screen uses and is
unchanged, but nobody has bought a plan *from* here against Stripe test mode.

#### T79 · The free tier can be created, because it can be deleted · **M** · T76, T77 · **shipped**
*No issue filed — this came in as a bug report: creating a free tier from `/admin` was refused with "A plan
states what it costs."* [ADR-0031](adr/0031-the-free-tier-is-the-one-without-a-price.md) is amended with the
argument; what follows is the work.

**The refusal was correct and the state it left was not.** ADR-0031 defines the free tier as the tier with no
`tier_price` row and rested *"at most one"* on every creation path going through Stripe — `adopt` is driven by
a Price, and `POST /api/admin/plans` demanded one — so a priceless tier was **unsayable rather than
forbidden**, which this repo prefers and says so in `CreatePlans` itself. Then **T77 made every tier deletable,
the seeded free one included**, and nothing could make another. The only priceless tier that has ever existed
was the row `V2__seed_tier_catalog.sql` wrote.

**Which matters because of what the default tier is for.** Every new account is provisioned onto it and every
terminal subscription falls back to it (ADR-0018), so a catalog that can only create paid tiers is one where
arriving and lapsing both land somebody on something they must pay for — or on no tier at all, the `NO_TIER`
state ADR-0032 introduced as one users *pass through*. T77's own recovery — "an operator makes a tier the
default and everybody is adopted at once" — could only ever produce a paid one. **Both halves of T78's screen
and this ticket's route are the same hole seen from two ends.**

**The wire.** `prices: []` states that a tier costs nothing; an **absent** `prices` is still a `400`. That is
ADR-0029's absent-versus-stated rule reused, and without it a client that forgot the field would quietly
create a free tier. **No `free` boolean** — the free tier *is* the one without a price, so a flag would be a
second spelling of the list's own emptiness, the derivable pair refused on `name`/`code`, on `isDefault`, and
on this screen once already.

**API** — `TierEdits.createWithoutAPrice`, the one insert in `TierRows` no Stripe Price drove, refusing a
second with the new `TierEdited.FreeTierAlreadyExists`. The check is a **read inside the writing transaction**
and could not be a constraint: "at most one tier with no `tier_price` row" is a property of the *absence* of
rows in another table, so there is no column for a unique index to cover — `makeDefault` has the same shape
for the flag it is the sole writer of. The route answers it **above the currency lookup**, because every line
below that is about money and a `503` for a tier that costs nothing would be refusing to act for want of a
price nobody asked for.

**The row is created off sale and not the default**, both deliberately: a published tier must have something
to charge against (`V7`), and `makeDefault` stays the sole writer of the flag, so repairing a stranded catalog
is two deliberate acts rather than one that guesses the second.

**`/admin`** — a **Free — no price, and nothing to pay** checkbox that greys the amounts, the way Unlimited
greys the quota. **A mode rather than an inference from two empty boxes**: somebody who has not finished
typing has also left both blank, and a form reading those alike would make a free tier out of a half-filled
one. The button stops saying **Create in Stripe** when it is making the one tier Stripe never hears about, and
the `409` — which already carried three facts — gets a fourth reading used *only* for a creation that stated
no price, because that case has one obvious cause and listing four would be unhelpful on purpose.

**A second instance of the same bug, found on the way and fixed with it.** The form refused to render at all
when Stripe could not name the catalog's currency. That was right until a catalog could be left with no free
tier, and is now exactly backwards: that is the state an operator must act in, and whether Stripe can name a
currency has nothing to do with a tier nobody is charged for. The amounts are greyed and the free tier can
still be made.

**One test changed meaning rather than being added to**, and it is the honest record of the reversal:
`andEachRhythmItIsSoldAtIsStatedInFull` asserted `prices: []` → `400` on the grounds that *"an empty list is
the same as no list — a plan nobody can be charged for"*. That sentence is the definition of the free tier,
and it is now the one creation on that route which can succeed in the suite at all, since it asks Stripe for
nothing.

**Not walked against a real account.** Held by the API suite (`TierDeletionTest` arranges a catalog with no
free tier and gets one back; `AdminTierTest` pins the `409`) and by `/admin`'s. Nobody has deleted a free tier
and recreated one against a real Stripe test-mode account.

#### T81 · The deployment tree ships with the tag · **M** · T80, T56 · **shipped**
*No issue filed — this came in as "would it be possible to have the keycloak build happen automatically
instead of having to do scp on the infra folder".*
[ADR-0034](adr/0034-the-deployment-tree-ships-with-the-tag.md) carries the argument.

**T80 shipped and the login page did not change, and nothing said why.** ADR-0033 delivered the generated
theme by committing it and bind-mounting it out of the host's git checkout — a checkout kept current by hand,
because automating it means a repository read key beside the read-only GHCR token and ADR-0023 refuses that
second credential. The cost was written down in three places and came due on the first release after T80.

**`infra/` was copied to the host, which is the obvious reading and is wrong in a way nothing reports.** Of
the five paths the production stack mounts, four are under `infra/` and the fifth is
`../apps/keycloak-theme/theme` — relative to the compose file's own directory, and therefore *outside* the
folder being copied. Docker creates a missing bind-mount source as an empty directory rather than failing.
Keycloak serves its built-in pages rather than failing. The sign-in page looked deliberate and was
Keycloak's. The theme was only the file that changes often enough to be noticed first: the Caddyfile decides
what the internet can reach, and the realm export is the file whose mistakes `InfraFiles` calls "the most
expensive and the least visible".

- **A third package, `FROM scratch`, about 65 KB.** `ghcr.io/<owner>/<repo>/deploy` carries `infra/` and
  `apps/keycloak-theme/theme/`, is built and pushed beside the two server images, retagged by the same
  `for image in api web deploy` loop and pruned on the same rules. It is pulled with the read-only token the
  host already holds, so **no second credential**, and the files are pinned to the tag rather than to
  whenever anybody last pulled — which a `git pull` cannot promise.
- **Extracted, staged and swapped — never copied over the top.** `docker cp` merges, so a file deleted
  upstream would survive on the host for ever. `infra/` and `apps/` are replaced wholesale;
  `production.env` sits beside them, in neither, and is never in any image.
- **The host stops being a git checkout** and needs no git. Bootstrap is a directory, `production.env`, and
  the two scripts installed once.
- **The scripts travel in the tree and are never installed by it.** Bash reads a script incrementally, so
  overwriting the running `mprelist-deploy` would execute whatever landed under the cursor. The difference is
  printed with the `install` line; running it is somebody's decision.
- **The deploy now checks the page, not the files.** `loginTheme` is a realm property and a realm imports on
  first start only, so a realm that came up before T80 does not ask for the theme however correctly the files
  arrive — which is the *other* half of why nothing appeared. After `up -d --wait` the script fetches the
  sign-in page and looks for a class only our template draws. It warns rather than failing: the stack is up
  and serving, and a re-run would change nothing. The fix is an admin-console setting and the warning names it.

**A tag built before this cannot be deployed by the new script**, having no `deploy` package; it says so
rather than failing on a missing file later. Cutover is: install the new scripts by hand once, deploy a tag
CI built after this, then delete the old checkout.

#### T80 · The login page is ours · **M** · T48, T28, T06 · **shipped**
*No issue filed — this came in as "has the custom Keycloak login page already been implemented?", and it had
not.* [ADR-0033](adr/0033-the-login-page-is-ours-and-is-generated.md) carries the argument; what follows is
the work.

**The first page a user of this product ever sees was Keycloak's.** `launchWebAuthFlow` opens the realm's
login page in a window Chrome owns (ADR-0010), and what appeared there was the stock theme — a different
typeface, a different blue, no mark. Three things were wrong with it beyond the look, and none of them is
cosmetic: the base template renders `realm.displayName`, which reads **"Marktplaats Relist (development)"**
locally and so **leads with the trademark** `brand.json` says this product must never lead with; on the
production export that same field reads **"Bumpr"**, a stale copy of a name `brand.json` now spells
`AdBump`, which is exactly the drift T48 existed to remove and which survived in the one file the brand had
been copied into by hand; and the page was in **English**, while `popup.html` and `apps/web/index.html` are
both `lang="nl"` — so signing in was the one step of the product that changed language.

**`apps/keycloak-theme` is a fourth workspace whose build output is a Keycloak theme** — `theme.properties`,
one stylesheet and three PNGs, every byte of it derived from `brand.json` and `@mprelist/ui`. Renaming the
product or redrawing the mark stays the one-file edit T48 made it. The workspace is shaped for theme
*types* rather than for this page: a type is a directory under `src/` named for Keycloak's own spelling of
it and a line in a registry, and `scripts/build.mjs` walks them and decides nothing.

- **`parent=base`, and exactly one template is replaced.** Keycloak's `base` theme carries the flow — sign-in,
  registration, the reset chain, the error pages — and styles none of it: every control is written
  `class="${properties.kcInputClass!}"`, so a theme decides what those classes *are*. Ours are the design
  system's own, so **the button on this page is the button `componentCss` draws** rather than one built to
  look like it. The replaced template is `template.ftl`, which is the card, the mark, the name and the footer.
  The alternative — our own `login.ftl`, `register.ftl` and the rest — is a fork of the authentication
  screens of a product we upgrade, on the one flow where being subtly wrong is a security bug.
- **The brand crosses as theme properties**, not as template substitution, so the committed `.ftl` holds no
  copy of the name and this workspace needs no third `{{brand.…}}` resolver beside `scripts/brand.mjs`'s and
  `apps/web/src/brand.ts`'s.
- **The mark is the raster and not the vector**, which is the opposite of T48's call for the site's callout
  and for the same underlying reason. There is no React here to draw `Icon name="logo"`, and inlining its
  geometry would be the copy `packages/ui` exists to prevent. The objection to a raster was that it cannot
  follow a theme — and `BRAND_MARK` is the one part of the palette that is deliberately the same in both.
- **Dutch, with one supported locale.** `supportedLocales: ["nl"]` and `defaultLocale: "nl"` in both realms;
  Keycloak's own `messages_nl.properties` is what makes it free, and with one locale no switcher renders.
- **One directory, committed, mounted by both stacks — and this is the part the first pass got wrong.** It
  built a third image, `ghcr.io/<owner>/<repo>/keycloak`, on the reasoning that a host with no Node cannot
  generate a theme. True, and beside the point: that host is a **git checkout** (`git clone … /opt/mprelist`),
  and `docker-compose.prod.yml` already bind-mounts the Caddyfile and the production realm out of it. So
  `apps/keycloak-theme/theme/` is committed and both compose files mount it at the same target. No third
  image, no second Keycloak version to hold equal, no package to prune, and `DeployedStackTest` goes on
  saying the deployed Keycloak is the one the suite ran against. A theme jar was the other candidate and is
  worse twice: a jar in `providers/` needs `kc.sh build` at every start, and fetching one from a private
  repository's releases needs the repository credential ADR-0023 keeps off that machine.
- **The one committed build output here, and the rule it looks like it breaks is sharpened instead.** What
  `brand.json` forbids is a copy that can *disagree* with it. CI reruns the build and fails on any
  difference — byte-reproducible, PNGs included — so this directory is a cache, not a copy. A hand-written
  stylesheet would still fail the rule, because nothing could hold it to `brand.json` at all.
- **A stale checkout now shows on a customer's screen, and that is documented rather than enforced.** The
  deploy script does not `git pull` — that is the second credential ADR-0023 refuses — so `infra/README.md`
  § Deploying already says a release touching `infra/` needs one first. The theme joins that rule and is
  the first member of it that fails *silently*: the realm is inert after first start and a stale Caddyfile
  breaks routing, but a stale theme just renders the old page.
- **`down -v` on every local stack that already exists**, once: a login theme is a realm property in
  Keycloak's model, the realm file is the only description of the realm there is, and it imports on first
  start only.

**A bug found by building it, now covered.** The build *empties* rather than *replaces* its output directory
only after the first version deleted it and the running Keycloak went on reading the directory that used to
be there — a bind mount follows the inode, and Keycloak answers a theme it cannot find by logging at ERROR
and quietly serving its built-in one. `scripts/build.test.ts` holds it to that. The other guard the first
pass needed — `create_host_path: false`, so that forgetting to build stopped compose — went away with the
reason for it: the directory is committed, so a clone has it.

**Walked, in both modes.** The sign-in, registration, forgot-password and invalid-credentials pages were
rendered against the local stack, and the **production** realm was rendered against Keycloak's `start` —
which is the half `start-dev` on a laptop cannot tell you, since production mode caches themes where
`start-dev` does not. What no suite here holds is the look: `docs/click-through.md` step 3b is where a human
reads the page.

**Not in it:** the account console and the admin console, which keep Keycloak's own theme — neither is a
surface of this product; and a second locale. **An email theme is deferred and is now cheap**: the realm
allows password reset and has an SMTP server, so that mail goes out in Keycloak's own English template
carrying the realm's label — the same three faults this ticket fixed one page earlier. Under the type
registry it is a directory and a line.

> **Corrected by T82 (2026-09-19), and the correction is most of why that ticket exists.** Two claims in the
> paragraph above are wrong, and both were reasoned from the login page rather than read off a mail.
> **It is not English:** `theme/base/email/messages/messages_nl.properties` ships inside Keycloak's own
> themes jar, and with `defaultLocale: nl` the reset mail has been Dutch since the realm was written. **And
> it is not a directory and a line:** an email theme's templates live under `html/` and `text/`, and
> `scripts/build.mjs` copies one flat level. The faults it does have are different ones —
> [ADR-0035](adr/0035-the-mail-is-ours-and-so-are-the-words.md).

#### T82 · The mail that page sends is ours too · **M** · T80
*No issue filed — this came in as "we should also customize the forgot password email template sent out to
users so that we can have a consistent professional ux".*
[ADR-0035](adr/0035-the-mail-is-ours-and-so-are-the-words.md) carries the argument.

**The ticket began by disproving its own premise.** Three living files and one ADR sentence say this mail goes
out in Keycloak's English. It goes out in Dutch, and has all along. What is actually wrong with it is four
things:

- **It names the realm.** `realmName` is `realm.getDisplayName()`, so a customer reads *"uw **mprelist
  (production)** account"* — the internal identifier, with an environment label after it, one screen after
  the page T80 put the brand on.
- **It has no design.** `base/email/html/template.ftl` emits `<html><body>` and nests the body into it. The
  default email theme is `parent=base` plus message overrides and adds nothing.
- **It comes from nobody.** `smtpServer` carries no `fromDisplayName`, so the inbox row is a bare address —
  read by more people than the body is.
- **It says *u*.** Keycloak's Dutch is formal; the popup, `apps/web` and `brand.tagline` all say *je*.

**And T80's mechanism is not here to be reused.** `base/login` writes every control
`class="${properties.kcInputClass!}"`, which is the whole reason the login page cost no copy of anything.
`base/email` has no `kc…Class` hooks at all: the body of each mail is one `msg()` string with its markup
inside it. So the choice is to own the templates or to own the words, and this owns the words.

- **One shell.** `src/email/html/template.ftl` replaces `base`'s and frames every mail the realm can send,
  including ones not yet turned on. The per-mail templates are not forked.
- **A generated message bundle**, written from `brand.json` by the build the way `theme.properties` already
  is: `passwordReset{Subject,Body,BodyHtml}` and `executeActions{…}` — the two mails a customer can get —
  **in both their HTML and plain-text forms**, because `base/email/text/` has no shell of its own and an
  HTML-only override leaves the realm's name in the part plain-text clients render. `emailTest*` stays
  Keycloak's: it goes to an administrator pressing Test.
- **In *je*.** The register the rest of the product speaks. It opens a seam with the login page, which is
  deferred by decision rather than left unsaid.
- **A styled anchor inside the message**, from one helper. This is the one surface subject to `kcSanitize`:
  `KeycloakSanitizerPolicy` calls `allowStyling`, so inline `style` survives — but markup in a *message* is
  filtered by an allowlist where markup in the *shell* is not, which is the trap to remember when a preview
  looks right and an inbox does not.
- **The design system contributes values, not rules.** `palette`, `text`, `space` and `radius`, inlined at
  build time. `var(--mp-…)` does not survive Gmail, so the most faithful sheet is the one that renders as
  unstyled text. Light only; **wordmark, no image** — email themes get no resource URL, and `brand.domain` was
  still the IP-derived nip.io host when this shipped, while a sent mail is permanent. That reason expired on
  2026-09-23; the deferred **"The mark in the mail"** row further down is what is left of it.
- **`ThemeType` gains a typed `messages` field**, rendered through the `propertiesFile()` escaper that
  already turns `é` into `\u00e9` — which is why the ambiguity between `Properties.load` and a UTF-8
  `Reader` never has to be settled. **And `scripts/build.mjs` learns to copy templates recursively**, which
  falsifies two sentences that were true when written and are rewritten with this ticket.
- **Both realms name the theme and the sender.** `"emailTheme": "mprelist"`, and `fromDisplayName` as a
  literal — the brand going back into the file it once drifted in, which is safe for the one reason the
  drift was not: `KeycloakRealmTest` and `ProductionRealmTest` read `brand.json` and hold it, where the test
  that let `Bumpr` through had been commented out.

**The production half cannot be delivered by a file and cannot be probed.** A realm imports on first start
only, so the running one will not pick `emailTheme` up; and there is no mail to fetch the way ADR-0034's
deploy fetches the sign-in page, while reading it over the admin API needs the bootstrap account
`production.env.example` says to stop using. So the existing warning names **both** settings and
`mprelist-wizard`'s theme stage gains the second — documented, not enforced, for the third time.

**Nothing of this is visible in production yet anyway.** `production.env.example`'s Mail block is commented
out, so `MPRELIST_SMTP_HOST` is absent and no reset mail is sent there at all; `MPRELIST_SMTP_FROM` defaults
to `no-reply@mprelist.invalid`, a reserved TLD that can never authenticate. This ships correct and invisible
until go-live fills that block in.

**Held as data, then read by a person.** The suite pins the keys against a dated list of the ones Keycloak
asks for, the `MessageFormat` placeholder ceiling (`{0}`–`{3}` for a reset, `{0}`–`{4}` for execute-actions),
un-doubled apostrophes — the failure that silently eats the rest of a sentence, which is why Keycloak's own
English writes `account''s` — a sanitizer-safe tag allowlist, and colours traced to `palette`;
`build.test.ts` gains the recursive case. **No rendered-mail test**: mounting this workspace's output into a
Gradle test is the boundary ADR-0011 draws and `ProductionRealmTest` relies on. `docs/click-through.md` gains
a step beside 3b — trigger a reset on the local stack and read the mail in Mailtrap.

**Not in it:** the mark (waits on T56 for a domain worth embedding in something permanent); the login
screens' Dutch; a second locale; and the verification mail's copy, which `verifyEmail` does not yet send.

#### T83 · Nobody pays twice · **S** · T19, T52
*No issue filed — this came out of the 2026-09-25 grilling on "the landing page must include our tiers so that
it can go through Stripe review", as the first of three tickets (T83–T85).*

**Nothing on the server stops a paying subscriber from opening a second Checkout.** `OpenCheckout` passes an
existing `stripe_customer_id`, so Stripe knows the customer — and will still create a second subscription on
it. The only guard today is the popup's: the current plan's card carries no buy button (`PlanCards.tsx`).
T85 adds a second surface that sells, and a rule each client must remember is a double charge the day one
forgets.

- **`POST /api/checkout` refuses** a caller whose Subscription is paid and not terminal: `409`, with a reason
  code in `packages/contracts/src/enforcement.ts` and `docs/enforcement-contract.md`. Beside "you can only
  buy what the cards show", which `OpenCheckout` already states for the same kind of reason.
- **The popup answers it with Betaling beheren** — the Customer Portal — through `handoffFailure`, as a
  note rather than an apology.
- **A plan switch is the Portal's, always** — Pro to Business, monthly to annual. `customer.subscription.updated`
  already mirrors the new Price onto its Tier (`MirrorSubscriptions`), so no plan-change flow is built here.
  **Operator step:** allow switching between the tagged Prices in Stripe's Customer Portal settings — a
  dashboard setting, not a deploy; `docs/click-through.md` gains the walk.

**Not in it:** our own upgrade or downgrade screen; proration of any kind.

#### T84 · The site says what it sells · **M** · T49, T50, T76, T79
*Same session. Stripe's activation form asks for a public, unprotected website "to check your company and
what you sell" — and `https://www.adbump.nl/` answers with the not-found fallback, "Op dit adres staat
niets". **This is the ticket that unblocks Stripe**; T85 is not needed for the review.*

`apps/web/README.md` deferred a landing page to "the ticket that also writes the Web Store listing" (T58).
This is it, split off from T58 because it is its own feature.

- **`GET /api/plans` is readable without a token** — `GET` and the exact path, in `ResourceServerSecurity`
  beside the webhook, which is the chain's own rule for opening a route. Its answer never depended on the
  caller (`PlansOnOffer.cards()`); it needed a token only because of `anyRequest().authenticated()`. **An ADR**,
  since it is the first anonymous route that is not Stripe's, and B (prices typed into the copy) and C (fetched
  at build time) were weighed and rejected: money lives in Stripe alone (ADR-0014/0019).
- **The answer gains the Free tier on offer** (glossary) — the priceless tier that is also the **Default
  tier** *and* grants something, quota above `0` or unlimited. Absent in every other case: no priceless row,
  a priceless default at `0` (ADR-0019's "there is no free tier"), or a priceless row nobody lands on. Name,
  grant and features, and no price. The popup reads the same body and ignores the field until it wants it.
- **Canvas first** (ADR-0016): `docs/design/Landing.dc.html`, light and dark, reviewed before any code. A
  promotional page — a hero, the product in three short steps rather than in detail, then the **Plans** and
  the Free tier on offer on the same page, no `/pricing` of its own. The hero's call to action scrolls to the
  plans.
- **`/` becomes `landing`** in `routes.ts`; every other unclaimed address stays `not-found`, and the README's
  sentence about `/` is rewritten.
- **Dutch, and the listing's forbidden words are a test** — *automatisch*, *officieel*, *toegestaan*,
  *volgens de regels*, *veilig voor je account*, *geen risico* (`store/listing.md`) — held against the page's
  copy the way `brand.test.ts` holds the brand.
- **The plan cards carry no buy button yet**: *"Kies je abonnement in de extensie"*, no link. The Free tier
  card carries none ever — there is nothing to buy. States as the popup's: loading, unavailable (`503`),
  and nothing on sale (an empty list).
- **Decided and left out:** a link to the Chrome Web Store — anywhere, before or after the listing is live;
  an "incl. btw" label (the Prices are inclusive, so the number shown is the number paid); a KvK number,
  btw-id or address in the footer — the first thing to add if Stripe comes back asking to verify the
  business.

**Follow-up in `store/listing.md`:** *"een gratis abonnement geeft een beperkt aantal herplaatsingen per
maand"* is a copy of the Free tier on offer, and is false the day an operator withdraws it.

#### T85 · The site sells, too · **L** · T83, T84, T54, T21, T62
*Same day, second session.* The first draft of this ticket — sign-in only at the moment of buying, no
signed-in state, switching through the Portal — was re-grilled on "the plans … dont have buttons if a user
wanted to subscribe, also the card are really too plain … a switcher for monthly and yearly prices … and it
also doesnt show the free tier", and came out larger. [ADR-0036](adr/0036-the-site-sells-and-a-subscriber-switches-in-place.md)
carries the argument; **Plan switch** is in the glossary. `no-identity.test.ts` is rewritten to hold what
stays true — the success, cancel and billing pages still learn nothing — rather than deleted.

- **A customer session on `/`** — `mprelist-dashboard`, PKCE, the token in memory, and a secret-free
  `localStorage` flag that drives one `prompt=none` round trip on load. The realm redirects to the origin root
  only, where the admin sign-in also lands, so `/` tells a returning buyer from a returning admin. Header:
  *Inloggen*; signed in, **Mijn account** with *Betaling beheren* (Portal) and *Uitloggen* — not the email,
  which this application does not hold (#108) and this client's tokens do not carry.
- **Buttons.** Free tier or no tier: *Kies* → Checkout. Subscriber: "Huidig" on theirs, *Overstappen* on the
  rest. A choice made signed out survives sign-in in `sessionStorage` and continues to Checkout only when it
  is still a purchase — never into a switch. T83's `409` is shown as *Betaling beheren*, should it ever reach
  the site.
- **A Plan switch route** — the Price on the existing Stripe subscription, immediate, prorated both ways,
  `pending_if_incomplete`; a confirmation dialog from Stripe's invoice preview; 3-D Secure via the hosted
  invoice page. The cards move once `/api/me` reflects the webhook.
- **The free card is the Free tier on offer** (T84). Signed out *Gratis beginnen* → the Store; on it
  "Huidig"; paying *Opzeggen* → the Portal.
- **A Maandelijks / Jaarlijks switcher**, on the landing page only: shown only when some plan has a `year`
  price, starts on monthly, a monthly-only plan stays with *"Alleen maandelijks"*, the saving is computed from
  the plan's two prices, and its position is the Rhythm bought or switched to.
- **Cards led by the number of reposts**, in the direction chosen from a throwaway prototype — branch
  `prototype/landing-plan-cards`, variant **A**: gradient cards, a quota meter relative to the largest plan,
  the largest card filled with the mark's gradient and lifted. No benefit lists. The prototype stood in for
  the canvas; `Landing.dc.html` is redrawn at the next re-seed, as `docs/design/README.md` records.
- **`/success`** gains *"Nog niet geïnstalleerd? Toevoegen aan Chrome"*; **`/cancel`** links to
  `/#abonnementen`.
- **`frame-ancestors 'none'` and a tight CSP** in `apps/web/nginx.conf.template`.
- **Accepted, not solved:** somebody can pay before the extension is installable, including from a phone.
  The subscription belongs to the App account, so it is waiting whenever they do sign in.

**Not in it:** the popup's cards, which keep T83's Portal door; scheduling downgrades for period end; showing
the Stripe credit; an account page.

#### T86 · The popup's mark is off-centre · **XS**
*Same session.* The badge at the popup's top left (`screens.tsx`, `mp-mark popup-mark`) is not symmetrical,
and the white glyph inside it is not centred.

---

## Deferred

| Ticket | Why it waits |
|---|---|
| [T27](https://github.com/Shei254/marketplaats-extension/issues/36) · `GET /api/client-config` | **Shipped**, ahead of the bill it was waiting for — because the lever has to predate the outage it is for, the same argument T43 makes about its header. It holds **no copy** of the ten endpoints: what it serves is a patch over the build's own defaults, so a healthy deployment answers `{"schemaVersion":1}` and nothing here can go stale. The ranking this ticket left open is decided — defaults, then the served document, then a tester's `__setEndpoints`, **the tester winning** — and the four CSRF modes are an enum at both ends, which is where "strictly data" is enforced rather than asserted ([ADR-0013](adr/0013-remote-client-configuration.md)) |
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
| The login screens' Dutch | [ADR-0035](adr/0035-the-mail-is-ours-and-so-are-the-words.md) — the mail T82 writes says *je* and the login page still runs on Keycloak's formal *u*. Closing the seam means owning the login theme's message bundle for the sign-in, registration and reset screens, which is a different size of decision from six keys |
| The mark in the mail | [ADR-0035](adr/0035-the-mail-is-ours-and-so-are-the-words.md) — **unblocked on 2026-09-23**, when T56 made `brand.domain` a domain we own rather than a hostname derived from a VPS IP. The condition the deferral named is met; what is left is the work it named — one entry in `SITE_ICONS` and one `<img>` in the shell — and it is deferred now by nothing but scope |
| Bulk repost in the popup | [ADR-0027](adr/0027-the-popup-stops-offering-bulk-repost.md) — built (T68, T69) and withdrawn from the screen for go-live scope; the mechanism, the entitlement and the API refusal all stand. Back with T70, once go-live is stable |
