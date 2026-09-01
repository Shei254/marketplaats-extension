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
├── identity/       public: UserRef, CurrentUser, UserProvisioned, RoutesNeedingARole
│   └── internal/                 ◀ the resource server, the account row, and the client-version gate
├── catalog/        public: TierId, TierName, TierPrice, TierCatalog, Entitlement,
│   │                       CatalogEntry, SellablePlan, TierEdit, TierEdits, TierEdited,
│   │                       Adoption, PriceAdoptions, TaggedPrice
│   └── internal/                 ◀ the tier table, through JdbcClient
├── subscription/   public: SubscriptionStatus, Subscription, QuotaPeriod, Subscriptions,
│   │                       SubscriptionMirror, SubscriberOnStripe, Mirroring
│   └── internal/                 ◀ the table, through JdbcClient, and provisioning on first sign-in
├── billing/        public: StripePrices, StripePrice, StripePaymentMethods, StripePlans,
│   │                       NewPlanInStripe, PlanCreation, StripeAccountFacts,
│   │                       UnadoptedPrices, UntaggedPrice
│   └── internal/                 ◀ the Stripe client and its caches, and the three routes
│                                   /api/checkout, /api/portal, /api/stripe/webhook
├── enforcement/    public: /authorize, /complete, Quotas, RemainingQuota
│   └── internal/                 ◀ the tables, and the decision itself
├── display/        public: /api/me, /api/plans
│   └── internal/                 ◀ the snapshots, composed from the modules above
├── clientconfig/   public: /api/client-config
│   └── internal/                 ◀ the patch served over what a release ships with
└── admin/          public: /api/admin/**
    └── internal/                 ◀ the tier catalog an operator maintains, and the ADMIN guard
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

**Not amended in #23**, which is worth saying because that ticket added seven types and shipped a second route.
`enforcement`'s published list is the routes, and it already named `/complete`; everything the report needs —
the outcomes, the event table, what is left of a period — is read by this module alone, so all of it is
`internal`. The next amendment here is #26's: `/api/me` renders a `quotaRemaining` counted from
`usage_reservation` and nowhere else, so `RemainingQuota` is the type that leaves `internal` on that ticket,
and it is the first time another module asks `enforcement` anything at all.

**Not amended in #24** either, and for a smaller reason than #23's: reconciliation reads and writes
`usage_reservation`, which is this module's own table, so the job and the statement it runs are both
`internal`. What that ticket did put outside every module is `@EnableScheduling`, on `ApiApplication`. A
scheduler is an application-wide capability rather than one module's, and a module switching one on for every
other module from inside its own `internal` package is a dependency nothing declares and the check below
cannot see — so the annotation goes where the application is configured, and the module keeps only the
`@Scheduled` method that says how often its own job runs.

**Not amended in #25** either, and this is the amendment that has to say *why*, because #25 is the ticket
named above as the likeliest to create `enforcement/domain` — and it produced exactly the thing that package
was sketched for. `RelistPace` is the pacing rules with no reading in them: a record with an invariant and
four methods, exercised by a suite that starts no Spring context and touches no database. It stays in
`internal` all the same, because the bar written above is a **second reader** and it has one — `SafetyPolicy`,
which is the reading half. Moving it would make a type public so that a test could sit beside it, which is the
trade this boundary exists to refuse, and would put a package in the tree whose entry criterion nobody could
state afterwards. The ticket that creates `domain` is the one with a second *caller*; the bar is not lowered
here. The rest of #25 is this module's own: the rail reads `usage_reservation`, and what it answers with is a
denial the routes above already publish.

**Amended in #26, which adds the sixth module and the first type `enforcement` lets anybody else see.**
`GET /api/me` renders `{subscriptionStatus, tier, quotaRemaining, resetAt, features}` — the status and the
window are `subscription`'s, the tier's name and flags are `catalog`'s, and `quotaRemaining` is counted from
`usage_reservation` and nowhere else. So `enforcement` publishes `Quotas` (one question: what has this
subscriber left of the period they are in) and `RemainingQuota` (what it answers with), which is what that
module was named for above and no more: the reservations, the statuses and the SQL stay `internal`. The port
takes a `Subscription` the caller has already read rather than reading one, so a second reader is not a second
lock on that row and not a second chance to roll a closed window. `catalog` gains **`TierName`** — the code
and the display name, the pair `/api/me` needs to render a plan without a client branding one by text an
operator may rewrite — which is the amendment predicted above as "whichever of #26 and #29 first needs what a
tier is called".

**The route is its own module because the alternative is a cycle**, and that is worth stating rather than
leaving as taste. `subscription` is the module whose concept dominates that body, but `enforcement` already
depends on it, so a `/api/me` living there would point `subscription` at `enforcement` and close the loop —
`identity` and `catalog` are underneath both and fare no better. The check catches it by name (`Cycle
detected: Slice enforcement -> Slice subscription -> Slice enforcement`), which is this ADR's boundary being
worth having twice: once for reaches into `internal`, once for the direction of a dependency. So the composer
of a view over four modules is its own module, `display`, named for the glossary's **display state** and for
what ADR-0007 makes of it: the relist path ignores this answer completely, and a module named for the display
is one nothing that grants anything can be put into by accident. It publishes the route and nothing else —
nobody asks it anything; it is the leaf that asks everybody.

`subscription` also publishes **`QuotaPeriod`** as of #22: `[periodStart, periodEnd)` is one concept in the
glossary and travelled as two parameters, which is a pair the compiler cannot tell apart and an invariant
("it runs forward") with no single home. The gate hands the window whole to the count that reads it.

**Amended in #137, and the amendment is mostly a debt being paid.** `billing` is the module ADR-0014 created
to keep Stripe behind a port, and it was never in the tree above at all. It arrived across #80, #29, #30 and
#84 carrying nine public types and three routes, and each of those tickets was a chance to write the list
that nobody took. So most of its entry above is not what T65 added — it is what was already on disk, written
down at last. T65's own contribution to that list is one line: **`StripePaymentMethods`**, the port `display`
asks what a buyer may pay with, which is the second thing `billing` lets another module ask of Stripe and the
first that is not about money. The rule this ADR states — *a ticket that adds to one amends them here* —
cannot survive a module that was never listed, because there is nothing to add to; that is the failure this
amendment is really fixing, and it is worth more than the line that exposed it.

`display` gains **`/api/plans`** in the same amendment (T49, #80). It is a second route this module publishes
and the tree said one, and it is what makes `display` the composer of *five* modules rather than four: the
join is `catalog`'s grant with `billing`'s amount, and now the payment methods beside them. That it reads
`billing` and `billing` asks it nothing keeps the direction this module was created to preserve — it is still
the leaf that asks everybody.

**Amended 2026-09-02 — the other four lists, and an adapter that was never built.** The amendment above
paid `billing`'s debt and named the failure that caused it. It then left four more of exactly that shape.
`catalog` had grown from the four types listed here to thirteen: `SellablePlan` (T49, #80), the adoption
trio `Adoption`, `PriceAdoptions` and `TaggedPrice` (T51, #82), the editing four `CatalogEntry`, `TierEdit`,
`TierEdits` and `TierEdited` (T53, #84), and `TierPrice` (T62, #128). The note above forecast this precisely
— *whichever of #26 and #29 first needs what a tier is called or what it costs* — and half of it was even
kept: `TierName` is in the list, and `TierPrice` never followed it. A forecast that names the next amendment
is not the same as making it, which is the whole lesson of this paragraph and the one above.
`subscription` gained the write half of its module at T20, #30 — `SubscriptionMirror`, `SubscriberOnStripe`
and `Mirroring`. `identity` gained `RoutesNeedingARole` (#27), which is how `admin` states a rule the filter
chain applies without the chain having heard of `admin`. And `clientconfig` (T27, #36) was a whole module
absent from the tree, the same failure as `billing`'s rather than a smaller one.

**The `subscription/internal/stripe/` adapter this tree promised at #30 is removed because it was never
built, and what happened instead is worth keeping.** The mirror is a *port on `subscription`* that `billing`
calls — `SubscriptionRows` implements it, `MirrorSubscriptions` invokes it — not an adapter inside
`subscription` that reaches for Stripe. So the count of modules that have heard of the Stripe library is
still exactly one, and the dependency runs from the module that knows Stripe towards the module that owns
the table, which is the direction this ADR wanted and not the one it drew. The tree was describing a plan;
these lists are meant to describe the code.

**What none of this fixes is that nothing checks it.** The boundary test enforces that `internal/` stays
private, and no test compares these lists against the packages. Every amendment here has been a person
noticing, which is why the drift is measured in tickets rather than in days. A test that walked each module's
root package and diffed it against this file would end that, and is worth a ticket if a fifth list goes stale.

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
