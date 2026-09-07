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
| [0005](0005-identity-and-auth.md) | Identity & auth (full app) — Keycloak + Spring Boot | Accepted |
| [0006](0006-billing.md) | Subscription billing — Stripe Billing | Accepted |
| [0007](0007-quota-enforcement.md) | Quota enforcement — backend-authorized per relist | Accepted |
| [0008](0008-safety-and-consent.md) | Safety & consent posture | Accepted |
| [0009](0009-tech-stack.md) | Technology stack | Accepted, amended by 0010–0015 |
| [0010](0010-extension-authentication.md) | Extension auth — launchWebAuthFlow + PKCE, public client | Accepted |
| [0011](0011-repository-layout.md) | Repository layout — monorepo, one deployable per workspace | Accepted |
| [0012](0012-backend-modular-monolith.md) | Backend — modular monolith (Spring Modulith), hexagonal modules | Accepted |
| [0013](0013-remote-client-configuration.md) | Remote client configuration for the internal-API layer | Accepted, refined by 0024 |
| [0014](0014-tier-catalog-and-entitlements.md) | Tier catalog & entitlements ours, keyed to Stripe Prices | Accepted, refines 0006 |
| [0015](0015-frozen-internal-api-golden-tests.md) | Internal-API layer frozen by golden-payload tests | Accepted |
| [0016](0016-vertical-slices-and-review-gates.md) | Iteration 1 cut into vertical slices, each ending at a manual review | Accepted |
| [0017](0017-web-surface-and-subscribing.md) | One web app, loginless public routes; subscribing starts in the popup | Accepted, amends 0011, refined by 0023 |
| [0018](0018-lapse-falls-back-to-the-default-tier.md) | A subscription that ends falls back to the default tier | Accepted, refines 0014 |
| [0019](0019-plans-are-stripe-first-and-webhook-synced.md) | Plans created in Stripe, synced to the Tier catalog by webhook | Accepted, refines 0014 |
| [0020](0020-deployment.md) | Deployed as four containers on one host, from a second compose file | Accepted, amended by 0023 |
| [0021](0021-design-system-stays-ours.md) | The design system stays ours, and stays a CSS string | Accepted, refines 0016 |
| [0022](0022-the-plan-screen-names-the-payment-methods.md) | The plan screen names the payment methods, read from Stripe | Accepted, refines 0006 |
| [0023](0023-ci-builds-the-images-and-the-host-pulls.md) | CI builds the images, a registry holds them, the host pulls; TLS in a fifth container | Accepted, amends 0020 |
| [0024](0024-the-extension-addresses-are-built-in.md) | The extension's own addresses are built in, never served | Accepted, refines 0013 |
| [0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) | Bulk repost is a paid entitlement, run by the worker, paced wider | Accepted, realises 0007/0014's `bulk` flag, refined by 0027 |
| [0026](0026-a-feature-flag-is-a-field-spelled-once.md) | A feature flag is a field an operator types, and the flag is spelled once | Accepted, refines 0014 |
| [0027](0027-the-popup-stops-offering-bulk-repost.md) | The popup stops offering bulk repost, and the mechanism stays | Accepted, refines 0025 |
| [0028](0028-a-repost-puts-back-what-it-can.md) | A repost puts back what it can, and says what it cannot | Accepted, refines 0002 |

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

See also [../domain-model.md](../domain-model.md), [../glossary.md](../glossary.md) and
[../enforcement-contract.md](../enforcement-contract.md).

<!-- Add a row per ADR as decisions are confirmed. -->
