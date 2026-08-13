# Architecture Decision Records

Each ADR captures one decision made during grilling: the context, the options weighed, the choice, and its consequences. Status is `Proposed` until you confirm, then `Accepted`.

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

**Amended by the 2026-08-13 session:** 0006 (Stripe narrowed to money + lifecycle), 0007 (gating depth,
`/api/me` display state, `marktplaatsAccountId` dropped), 0009 (monorepo, React popup, Options page removed).

See also [../domain-model.md](../domain-model.md), [../glossary.md](../glossary.md) and
[../enforcement-contract.md](../enforcement-contract.md).

<!-- Add a row per ADR as decisions are confirmed. -->
