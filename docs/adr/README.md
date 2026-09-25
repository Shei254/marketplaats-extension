# Architecture Decision Records

Each ADR captures one decision made during grilling: the context, the options weighed, the choice, and its consequences. Status is `Proposed` until you confirm, then `Accepted`.

**The decision an ADR records is frozen; the file paths in it are not.** Context, options weighed, choice and
consequences are a dated record and are never rewritten to match how things turned out — that history is the
point. Path references are different: they are kept current, so every path in an ADR can be followed as
written. A change that moves code updates the ADRs naming it, alongside
[../../README.md](../../README.md), [../live-testing.md](../live-testing.md) and
[../backlog.md](../backlog.md).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-execution-model.md) | Execution model — client-side browser extension | Accepted |
| [0002](0002-relist-mechanic.md) | Relist mechanic — delete + re-create | Accepted |
| [0003](0003-relist-safety-and-snapshot.md) | Relist safety — delete-first ordering + durable client-side snapshot | Accepted |
| [0004](0004-surfaces-and-internal-api.md) | Relist surfaces + internal-API engine | Accepted |
| [0005](0005-identity-and-auth.md) | Identity & auth (full app) — Keycloak + Spring Boot | Accepted, refined by 0010 and 0033 |
| [0006](0006-billing.md) | Subscription billing — Stripe Billing | Accepted |
| [0007](0007-quota-enforcement.md) | Quota enforcement — backend-authorized per relist | Accepted |
| [0008](0008-safety-and-consent.md) | Safety & consent posture | Accepted |
| [0009](0009-tech-stack.md) | Technology stack | Accepted, amended by 0010–0015 |
| [0010](0010-extension-authentication.md) | Extension auth — launchWebAuthFlow + PKCE, public client | Accepted |
| [0011](0011-repository-layout.md) | Repository layout — monorepo, one deployable per workspace | Accepted, amended by 0017, refined by 0033 |
| [0012](0012-backend-modular-monolith.md) | Backend — modular monolith (Spring Modulith), hexagonal modules | Accepted |
| [0013](0013-remote-client-configuration.md) | Remote client configuration for the internal-API layer | Accepted, refined by 0024 |
| [0014](0014-tier-catalog-and-entitlements.md) | Tier catalog & entitlements ours, keyed to Stripe Prices | Accepted, refines 0006, refined by 0026, 0029, 0030 and 0031, amended by 0032 |
| [0015](0015-frozen-internal-api-golden-tests.md) | Internal-API layer frozen by golden-payload tests | Accepted |
| [0016](0016-vertical-slices-and-review-gates.md) | Iteration 1 cut into vertical slices, each ending at a manual review | Accepted |
| [0017](0017-web-surface-and-subscribing.md) | One web app, loginless public routes; subscribing starts in the popup | Accepted, amends 0011, refined by 0023, superseded in part by 0036 |
| [0018](0018-lapse-falls-back-to-the-default-tier.md) | A subscription that ends falls back to the default tier | Accepted, refines 0014, refined by 0032 |
| [0019](0019-plans-are-stripe-first-and-webhook-synced.md) | Plans created in Stripe, synced to the Tier catalog by webhook | Accepted, refines 0014, refined by 0029 and 0031 |
| [0020](0020-deployment.md) | Deployed as four containers on one host, from a second compose file | Accepted, amended by 0023 |
| [0021](0021-design-system-stays-ours.md) | The design system stays ours, and stays a CSS string | Accepted, refines 0016, refined by 0033 and 0035 |
| [0022](0022-the-plan-screen-names-the-payment-methods.md) | The plan screen names the payment methods, read from Stripe | Accepted, refines 0006 |
| [0023](0023-ci-builds-the-images-and-the-host-pulls.md) | CI builds the images, a registry holds them, the host pulls; TLS in a fifth container | Accepted, amends 0020, amended by 0034 |
| [0024](0024-the-extension-addresses-are-built-in.md) | The extension's own addresses are built in, never served | Accepted, refines 0013 |
| [0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) | Bulk repost is a paid entitlement, run by the worker, paced wider | Accepted, realises 0007/0014's `bulk` flag, refined by 0027 |
| [0026](0026-a-feature-flag-is-a-field-spelled-once.md) | A feature flag is a field an operator types, and the flag is spelled once | Accepted, refines 0014 |
| [0027](0027-the-popup-stops-offering-bulk-repost.md) | The popup stops offering bulk repost, and the mechanism stays | Accepted, refines 0025 |
| [0028](0028-a-repost-puts-back-what-it-can.md) | A repost puts back what it can, and says what it cannot | Accepted, refines 0002 |
| [0029](0029-unlimited-is-null-and-zero-still-grants-nothing.md) | Unlimited is `null`, and zero still grants nothing | Accepted, refines 0014 and 0019 |
| [0030](0030-the-catalog-order-is-the-operators.md) | The catalog order is the operator's, and it is one sequence | Accepted, refines 0014 |
| [0031](0031-the-free-tier-is-the-one-without-a-price.md) | The free tier is the one without a price, and an operator edits it | Accepted, refines 0014 and 0019, partly reversed by 0032 |
| [0032](0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md) | Every tier is deletable, and an empty catalog is a state | Accepted, amends 0014, refines 0018, partly reverses 0031 |
| [0033](0033-the-login-page-is-ours-and-is-generated.md) | The login page is a surface of ours, and it is generated rather than written | Accepted, refines 0005, 0011 and 0021, amended by 0034, refined by 0035 |
| [0034](0034-the-deployment-tree-ships-with-the-tag.md) | The deployment tree ships with the tag, and the host stops being a checkout | Accepted, amends 0023 and 0033 |
| [0035](0035-the-mail-is-ours-and-so-are-the-words.md) | The mail that page sends is ours too, and owning it means owning the words | Accepted, refines 0021 and 0033 |
| [0036](0036-the-site-sells-and-a-subscriber-switches-in-place.md) | The site sells, and a subscriber switches plan in place rather than buying a second one | Accepted, supersedes part of 0017, refines 0019 and 0031 |
| [0037](0037-an-annual-price-buys-a-monthly-grant.md) | An annual price buys a monthly grant | Accepted, refines 0014 and 0019 |

**Amended by the 2026-08-13 session:** 0006 (Stripe narrowed to money + lifecycle), 0007 (gating depth,
`/api/me` display state, `marktplaatsAccountId` dropped), 0009 (monorepo, React popup, Options page removed).

**Amended by the 2026-08-20 session:** 0011 (`apps/dashboard` becomes `apps/web`, no customer login),
0006 (no trial in iteration 1), 0014 (`SUBSCRIPTION_INACTIVE` is dunning-only, no-free-tier is a zero quota,
admin CRUD un-deferred). That session also cut the backlog into vertical slices and split **Go-Live** out as
its own milestone — see [0016](0016-vertical-slices-and-review-gates.md) and [../backlog.md](../backlog.md).

**Amended by the 2026-09-01 session:** 0006 (PayPal is a payment **method** inside Stripe, not a second
processor — the second-processor reading is costed and rejected there rather than left to be costed
again). Telling the buyer *which* methods are accepted is a separate decision with a separate revisit
condition: [0022](0022-the-plan-screen-names-the-payment-methods.md), which reads the list from Stripe when
the cards are drawn rather than writing it down a second time — and breaks `/api/plans`' all-or-nothing rule
on purpose, because a missing sentence is not a wrong comparison.

**Corrected later the same day, from a buyer who saw neither PayPal nor a bank option at Checkout:**
[0006](0006-billing.md) assumed an EU-established Stripe account and this one is US-established, which is
why neither method is on offer — so the EU account is now written down as a **precondition** of that
decision rather than a fact about the current one. [0022](0022-the-plan-screen-names-the-payment-methods.md)
is amended with the two readings the investigation found wrong: `is_default` alone can select a Connect
child configuration rather than the account's own, and the list now means what a **subscription** Checkout
will offer — iDEAL, Bancontact and Sofort need a SEPA mandate to charge again, so without SEPA they are
enabled and still absent.

**Amended by the 2026-09-02 session:** the account precondition above is met — it is Netherlands-established
and priced in EUR — and PayPal was *still* absent from Checkout. The cause was Stripe's **Adaptive Pricing**,
on by default, which converts a session into the buyer's local currency; a converted cross-border
subscription is offered card, Link, Apple Pay and Google Pay only, so a buyer outside the eurozone loses
iDEAL, SEPA and PayPal together. [0006](0006-billing.md) now pins the session to the Price's own currency and
says why that parameter belongs in code rather than in the dashboard beside the method list.
[0022](0022-the-plan-screen-names-the-payment-methods.md) is amended in turn: its session log is evidence
about the configuration, not about the page, because the method set is resolved at creation and the
conversion happens at render.

**Amended by the 2026-09-02 deployment session:** 0020, once the host was known. One vCPU and 4 GB settles
what that ADR left to judgement — the host cannot compile the API image while serving from it — so
[0023](0023-ci-builds-the-images-and-the-host-pulls.md) moves the build to CI, the images to a registry and
TLS into a fifth container, and supersedes 0020's "no registry and no CI deploy" while leaving the rest of it
standing. [0024](0024-the-extension-addresses-are-built-in.md) records the constraint found underneath it:
the extension's own API and issuer addresses cannot be served by [0013](0013-remote-client-configuration.md)'s
document — not because of how it was built, but because the document is fetched *from* one of them and
sign-in precedes the other — so they are build-time, and the domain has to be final before the Web Store
sees a build. 0017's "`www.` serves `/`, `admin.` serves `/admin`" is refined rather than amended: it was
always a statement about a proxy, and 0023 is where that proxy exists.

**Amended by the 2026-09-05 session:** [0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md)
turns `bulk` from a flag [0007](0007-quota-enforcement.md) named and [0014](0014-tier-catalog-and-entitlements.md)
has carried as data into a feature that exists. It leaves [0008](0008-safety-and-consent.md) untouched on
purpose, and says why the tempting loosening is foreclosed: the pacing rails are harm reduction for the
*user's* Marktplaats account, so selling a paying tier relief from them would be selling a higher chance of a
ban. A bigger plan buys more relists per period, never a faster hour. The same session recorded T67 — the
popup was reading `minimumBidPriceCents` as the seller's bid floor when it is bid activity — which is a
correction rather than a decision and lives in [../internal-api-findings.md](../internal-api-findings.md).

**Amended by the 2026-09-06 session:** [0026](0026-a-feature-flag-is-a-field-spelled-once.md) refines
[0014](0014-tier-catalog-and-entitlements.md) on the half of the catalog 0014 left open: the `features`
column stops being a JSON textarea in `/admin` and becomes a field, now that
[0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) has put a value in it. The flag itself is
spelled once in `packages/contracts` and read from there by both the admin form and the popup, and "off" is
written `false` rather than as a deleted key — which is what makes `V8__seed_bulk_entitlement.sql`'s own
claim about the admin edit true on a machine that restores a dump.

**Amended by the 2026-09-07 session:** [0027](0027-the-popup-stops-offering-bulk-repost.md) refines
[0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) by taking bulk repost off the popup for
go-live — scope rather than risk — while leaving the entitlement, the queue, the API refusal and
[0026](0026-a-feature-flag-is-a-field-spelled-once.md)'s operator field exactly as they are. It is the one
ADR here that is cheap to reverse, and says so: what earns it a file is that the alternative leaves a whole
tested subsystem with no way into it and nothing anywhere saying why.
[T70](https://github.com/Shei254/marketplaats-extension/issues/155) is the ticket that undoes it.

**Amended by the 2026-09-10 session:** [0029](0029-unlimited-is-null-and-zero-still-grants-nothing.md)
makes `relist_quota_per_period` nullable so a tier can grant no cap, and refines
[0014](0014-tier-catalog-and-entitlements.md) and [0019](0019-plans-are-stripe-first-and-webhook-synced.md) by
keeping `0` exactly where they left it. The proposal it rejects is the obvious one — *let `0` mean unlimited* —
and the rejection is the value: `0` is what a draft is adopted at, what "there is no free tier" is spelled as,
and what the auto-publish rule tests against, so redefining it would have given every new account unlimited
reposts by the same gesture that withdraws the free tier. The half of the proposal that was right became a
publish rule instead, and closed a real gap: the `> 0` guard existed only on the webhook path, so a zero-grant
tier could be hand-published and sold. The session also found the vocabulary defect underneath the new copy —
the button says **Repost**, the strip above it says **relists** — and split the two the way the glossary
already splits the brand name from `mprelist`.

**Amended by the 2026-09-10 ordering session:** [0030](0030-the-catalog-order-is-the-operators.md) refines
[0014](0014-tier-catalog-and-entitlements.md) on something that ADR made ours and never said: what order the
catalog is in. It was `order by relist_quota_per_period, code`, written twice on purpose so the popup and
`/admin` read alike, and chosen by nobody — the `V2` seed grants 3, 50 and 200 in that sequence, so grant
order has been indistinguishable from creation order on every deployment that exists. The session opened with
the belief that the cards were in creation order, which is the clearest evidence the rule was never designed.
An operator now states the order, because *which plan you want bought* is not a function of any column we
have. Two cheaper alternatives are costed and rejected there — ordering by amount is a better derived rule
that still cannot say "Pro first", and a `featured` boolean is the pair-that-can-disagree shape this repo has
now refused four times. The decision also departs from this schema's habit of making invariants unwriteable,
and says why: the only unwriteable spelling of "positions are distinct" needs the `deferred` constraint
[0019](0019-plans-are-stripe-first-and-webhook-synced.md)'s trigger work already rejected as a test that
passes having checked nothing.
[T75](https://github.com/Shei254/marketplaats-extension/issues/164) is the ticket.

**Amended by the 2026-09-16 free-tier session:** [0031](0031-the-free-tier-is-the-one-without-a-price.md)
answers a question that had never been asked out loud — *how is an admin meant to set the free tier* — and
the answer turned out to be mostly "they already can, and nothing says so". The session's value is what it
ruled out on the way: a create route (both creation paths refuse a tier with no price, in the constructor and
by construction, so a second free tier is already unsayable and needs no constraint); a delete route (the free
tier has every user on it and `subscription.tier_id` carries no delete rule, so it can be deleted only before
the first sign-in, and doing so takes sign-in down with it); and grandfathering (it works today and was
rejected because raising the free grant should reach the people already on it, which editing the row does for
nothing). What was actually missing was one field — `code`, editable exactly while a tier has no Price to
freeze it in Stripe — and one sentence in `TierEdit` that was never true: a subscription's tier is found by
uuid, not by code.

**Amended by the 2026-09-16 deletion session, later the same day:**
[0032](0032-every-tier-is-deletable-and-an-empty-catalog-is-a-state.md) reverses the delete route
[0031](0031-the-free-tier-is-the-one-without-a-price.md) had just ruled out, and the reversal is not a
contradiction: that rejection was an argument about the **free** tier, in a session about the free tier, and
it is still correct about it. Asked of the catalog as a whole the answer came out the other way, because what
made deletion look impossible was a foreign key rather than anything an operator would recognise. The session
opened on symmetry — `/admin` creates and cannot delete — which is the ground this repository has refused
three times, and what survived the pressing was T61: creating a tier is one click now, so a typo is a
permanent row. Getting there cost [0014](0014-tier-catalog-and-entitlements.md)'s central invariant, which
narrows from "every user always has a Subscription" to "every user always has a subscription *row*" — the
largest thing this repo has given up, argued at length there. Two facts nobody had written down turned up on
the way and are the reason the ticket is not small: a deleted tier **comes back**, because the Stripe Prices
outlive it still carrying `metadata.tier_code` and `price.updated` re-adopts them; and archiving a Price
stops new purchases while existing subscriptions **keep billing**, so a delete that only tidied the catalog
would charge people for a plan that is gone. Stripe has no delete for a Price at all — verified against
`stripe-java:29.2.0` rather than assumed — so archiving is what the word means there.

**Amended by the 2026-09-19 mail session:** [0035](0035-the-mail-is-ours-and-so-are-the-words.md) asks
ADR-0033's question one page later, about the mail that page sends, and finds that 0033's mechanism is not
there to be reused: `base/email` has no `kc…Class` hooks, so the body of every mail is one `msg()` string with
its markup inside it, and "our clothes" amounts to a `<body>` wrapper. The session opened on a premise that
turned out to be false — three living files and an ADR sentence say that mail goes out **in English**, and it
has been Dutch all along, because `messages_nl.properties` ships in Keycloak's own themes jar. What is
actually wrong with it is that it calls the product *"mprelist (production)"*, has no design at all, comes
from an address with no name on it, and says *u* to a product that says *je*. So the copy becomes ours —
generated from `brand.json`, both the HTML and the plain-text half of every key — and [0021](0021-design-system-stays-ours.md)
narrows on this surface only: in an inbox the design system is a set of **values**, because Gmail keeps no
`:root` rule and the sheet that is most faithful to that ADR is the one that renders as unstyled text. The
session also reversed a direction `ProductionRealmTest` had argued: the brand goes **back** into the realm
file, as `smtpServer.fromDisplayName`, because no theme can reach the inbox row — and the reversal is safe for
the reason the original drift was not, which is that this copy has a live test holding it to `brand.json`
rather than a commented-out one. T82 is the ticket, and there is no GitHub issue, as with T76–T81.

See also [../domain-model.md](../domain-model.md), [../glossary.md](../glossary.md) and
[../enforcement-contract.md](../enforcement-contract.md).

<!-- Add a row per ADR as decisions are confirmed. -->
