# ADR-0012: Backend architecture — modular monolith (Spring Modulith), hexagonal within modules

**Status:** Accepted (2026-08-13)
**Scope:** `apps/api`. Extends ADR-0009.

## Context
`docs/specs/quota-enforcement.md` already presumes a backend "module" named `enforcement`, but the module
concept was never defined. Options: conventional package-by-layer Spring, a modular monolith with enforced
boundaries, or separate services from the start.

Separate services were rejected as premature for one team, and specifically because the quota
reserve/refund path is the one place you most want a **local database transaction** rather than a
distributed one.

## Decision
**Package-by-module, not package-by-layer**, with **Spring Modulith** verifying the boundaries in a
build-time test. Ports-and-adapters inside each module keeps Stripe and Keycloak as replaceable adapters,
preserving ADR-0009's no-lock-in goal.

```
com.mprelist
├── identity/       public: UserRef, CurrentUser, UserProvisioned
├── catalog/        public: TierId, TierCatalog, Entitlement
├── subscription/   public: SubscriptionStatus, Subscription, QuotaPeriod, Subscriptions
│   ├── internal/                 ◀ the table, through JdbcClient
│   └── internal/stripe/          ◀ adapter, at #30
├── enforcement/    public: /authorize, /complete
│   └── internal/                 ◀ the tables, and the decision itself
└── admin/
```

Those lists are the whole of what each module lets another see, so **a ticket that adds to one amends them
here**. The boundary check enforces that `internal/` stays private; what it cannot enforce is whether a type
*should* have been made public, and a list kept only in the code is one where that decision is taken by
whoever happened to write the class. Amended in #20: `identity` publishes `UserProvisioned` so that
`subscription` can listen for a new account rather than `identity` calling it — the dependency would
otherwise point from the module everything depends on towards one that depends on it — and `catalog` exposes
`TierCatalog`, because `defaultTier()` is the one question provisioning has to ask of a table no other module
may read. Completed in #21: `Entitlement` — what a tier grants — is public, and `entitlementOf(TierId)` is on
that same interface. It takes a tier rather than a user, so `catalog` still reads only the `tier` table:
*which* tier somebody is on is `subscription`'s to answer, and #22's gate is what puts the two together. That
leaves `catalog`'s list above complete as written; the next amendment to it is whichever of #26 and #29 first
needs what a tier is *called* or what it *costs*, neither of which is a grant.

Amended again in #22, which is the first module to *read* two others. `subscription` publishes
`SubscriptionStatus` (Stripe's seven, normalized, with the contract's "allowed" set answered once on the enum),
`Subscription` (tier, status and the quota window — and deliberately not the Stripe ids, so that nothing outside
the module can come to branch on whether a user is paying) and the `Subscriptions` port that answers one. That
port also **locks the row for the caller's transaction and rolls a free window that has closed**, because both
belong to the module that owns the table: a gate that had to remember to take the lock, or to notice a closed
window, is a gate that can forget to.

The tree above is amended in #22 rather than annotated, because it is what a reader consults for where a
class goes; two things an earlier draft of it promised are recorded here so that their absence is a decision
rather than an omission. There is **no `enforcement/domain` package**: the decision is a status and two
numbers the same method has just read, and a package holding one function with one caller is structure ahead
of its reason — whichever ticket gives that decision a second reader creates it, #25's SafetyPolicy being the
likeliest. And what was drawn as `internal/jpa` is **`internal`, and not JPA**: every module reads its own
tables through `JdbcClient`, because nothing yet loads a row, mutates it and writes it back, and Hibernate
would arrive with `ddl-auto` — a second schema author beside the migrations.

`subscription` also publishes **`QuotaPeriod`** as of #22: `[periodStart, periodEnd)` is one concept in the
glossary and travelled as two parameters, which is a pair the compiler cannot tell apart and an invariant
("it runs forward") with no single home. The gate hands the window whole to the count that reads it.

Build tool **Gradle**, **Java 21**, migrations via **Flyway** — closing the corresponding open build
question in `enforcement-contract.md`.

## Consequences
- **Positive:** "Maintainable" is enforced by CI rather than by discipline — a module reaching into another's
  `internal/` fails the build. Each module's published types carry their own invariants and so are directly
  unit-testable with no Spring context, which is what `EntitlementTest` and `QuotaPeriod`'s own rules are.
  If `enforcement` ever needs its own deployable, the seam already exists.
- **Negative:** More upfront ceremony than a plain layered Spring app, and one more build-time dependency.

## Rejected, and why it stays rejected
Package-by-layer (`controller/`, `service/`, `repository/`) gives no boundary at all — nothing would stop the
`authorize` hot path calling a Stripe repository directly, which is exactly the coupling ADR-0014 exists to
prevent.
