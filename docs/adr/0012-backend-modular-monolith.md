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
├── identity/       public: UserRef, CurrentUser
├── catalog/        public: TierId, Entitlement
├── subscription/   public: SubscriptionStatus
│   └── internal/stripe/          ◀ adapter
├── enforcement/    public: /authorize, /complete
│   ├── domain/                   ◀ pure decision logic, no Spring
│   └── internal/jpa/             ◀ adapter
└── admin/
```

Build tool **Gradle**, **Java 21**, migrations via **Flyway** — closing the corresponding open build
question in `enforcement-contract.md`.

## Consequences
- **Positive:** "Maintainable" is enforced by CI rather than by discipline — a module reaching into another's
  `internal/` fails the build. The pure `enforcement/domain/` decision logic is directly unit-testable with no
  Spring context. If `enforcement` ever needs its own deployable, the seam already exists.
- **Negative:** More upfront ceremony than a plain layered Spring app, and one more build-time dependency.

## Rejected, and why it stays rejected
Package-by-layer (`controller/`, `service/`, `repository/`) gives no boundary at all — nothing would stop the
`authorize` hot path calling a Stripe repository directly, which is exactly the coupling ADR-0014 exists to
prevent.
