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
| [0013](0013-remote-client-configuration.md) | Remote client configuration for the internal-API layer | Accepted |
| [0014](0014-tier-catalog-and-entitlements.md) | Tier catalog & entitlements ours, keyed to Stripe Prices | Accepted, refines 0006 |
| [0015](0015-frozen-internal-api-golden-tests.md) | Internal-API layer frozen by golden-payload tests | Accepted |
| [0016](0016-vertical-slices-and-review-gates.md) | Iteration 1 cut into vertical slices, each ending at a manual review | Accepted |
| [0017](0017-web-surface-and-subscribing.md) | One web app, loginless public routes; subscribing starts in the popup | Accepted, amends 0011 |
| [0018](0018-lapse-falls-back-to-the-default-tier.md) | A subscription that ends falls back to the default tier | Accepted, refines 0014 |
| [0019](0019-plans-are-stripe-first-and-webhook-synced.md) | Plans created in Stripe, synced to the Tier catalog by webhook | Accepted, refines 0014 |
| [0020](0020-deployment.md) | Deployed as four containers on one host, from a second compose file | Accepted |

**Amended by the 2026-08-13 session:** 0006 (Stripe narrowed to money + lifecycle), 0007 (gating depth,
`/api/me` display state, `marktplaatsAccountId` dropped), 0009 (monorepo, React popup, Options page removed).

**Amended by the 2026-08-20 session:** 0011 (`apps/dashboard` becomes `apps/web`, no customer login),
0006 (no trial in iteration 1), 0014 (`SUBSCRIPTION_INACTIVE` is dunning-only, no-free-tier is a zero quota,
admin CRUD un-deferred). That session also cut the backlog into vertical slices and split **Go-Live** out as
its own milestone — see [0016](0016-vertical-slices-and-review-gates.md) and [../backlog.md](../backlog.md).

See also [../domain-model.md](../domain-model.md), [../glossary.md](../glossary.md) and
[../enforcement-contract.md](../enforcement-contract.md).

<!-- Add a row per ADR as decisions are confirmed. -->
