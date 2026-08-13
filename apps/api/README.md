# `apps/api` — Spring Boot API

Five empty modules, the build-time check that makes them mean something, the schema they will fill, and the
tier catalog seeded into it. No endpoints and no security yet — those arrive with the tickets named below.

```bash
cd apps/api
./gradlew test      # 27 tests: the module boundary, the schema against a real Postgres, and the catalog
./gradlew build     # the above, plus the executable jar
./gradlew bootRun   # http://localhost:8080 — 404 on everything, there are no controllers yet
```

`bootRun` needs [the local stack](../../infra/README.md) up: it migrates `postgres://localhost:5432/mprelist`
on startup and will not start without it. `test` does not — it starts a Postgres of its own — but it does
need a Docker daemon, for the same reason. Keycloak becomes a requirement with
[#19](https://github.com/Shei254/marketplaats-extension/issues/19).

## The modules

Each is a direct sub-package of `com.mprelist`, which is what makes it an application module
([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)).

| Module | Owns | Fills with |
|---|---|---|
| `identity` | who the caller is; `UserRef`, `CurrentUser` | [#19](https://github.com/Shei254/marketplaats-extension/issues/19) |
| `catalog` | Tier → Entitlement, from our table, no Stripe | [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| `subscription` | the mirror of Stripe's status and period | [#20](https://github.com/Shei254/marketplaats-extension/issues/20), [#30](https://github.com/Shei254/marketplaats-extension/issues/30) |
| `enforcement` | `authorize` / `complete`, the gate | [#22](https://github.com/Shei254/marketplaats-extension/issues/22), [#23](https://github.com/Shei254/marketplaats-extension/issues/23) |
| `admin` | operator endpoints behind the `ADMIN` role | [#27](https://github.com/Shei254/marketplaats-extension/issues/27) |

Every one holds a single `package-info.java` carrying `@ApplicationModule` and nothing else. The annotation is
not decoration: an empty package compiles to no class file at all, and a module Spring Modulith cannot see is
a module it does not check. `allFiveModulesAreVisibleToTheCheck` is the test that says so.

A module's **sub-packages are internal to it** — `enforcement.internal.jpa` is reachable from `enforcement`
and from nowhere else. That is the rule below enforces, and it is why ADR-0012 can promise Stripe and JPA stay
replaceable adapters rather than becoming everyone's dependency.

## The boundary check

`ModuleBoundaryTest.noModuleReachesIntoAnothersInternals` fails the build on a cross-module reach into an
`internal` package. Today it cannot fail for the right reason — every module is empty — and a check that
cannot fail is indistinguishable from one that has stopped working. So the same verification is also pointed
at a fixture built to be caught: `src/boundaryFixture/java` holds two modules, `beta` reaching into
`alpha.internal`, and `andTheCheckAboveIsWhatWouldCatchOneThatDid` asserts it is rejected by name.

The fixture is a **separate source set** rather than test code, for two reasons that both make it invisible or
harmful anywhere else:

- Spring Modulith skips test output when it scans, so a fixture under `src/test/java` would be found by
  nothing and the test would pass by verifying an empty structure.
- It cannot live under `com.mprelist`, or the real verification would scan it and fail on it.

Mutation-verified — each of these was applied, observed, and reverted:

| Mutation | Fails |
|---|---|
| `enforcement` references `identity.internal.TokenParser` | `noModuleReachesIntoAnothersInternals` |
| the fixture's `beta` stops reaching into `alpha.internal` | `andTheCheckAboveIsWhatWouldCatchOneThatDid` |
| `catalog`'s `package-info` loses `@ApplicationModule` | `allFiveModulesAreVisibleToTheCheck` |

## The schema

`src/main/resources/db/migration/V1__baseline_schema.sql`, applied by Flyway on startup: the five tables
[`docs/domain-model.md`](../../docs/domain-model.md) calls backend-owned, and nothing else. Flyway checksums
what it has already applied, so a correction to that file once it has run anywhere is a new `V2` — never an
edit to `V1`.

> If startup fails with **`Migration checksum mismatch for migration version 1`**, your Postgres volume
> predates the rename `keycloak_subject` → `idp_subject` in [#17](https://github.com/Shei254/marketplaats-extension/issues/17),
> which edited `V1` after some machines had run it. `docker compose -f infra/docker-compose.yml down -v`
> and start again: `V1` has been applied to no deployed environment, so a dropped local volume is the
> whole of the cost. It is also the rule above, demonstrated.

| Table | Holds | Filled by |
|---|---|---|
| `app_user` | one row per human, keyed to the IdP `sub` (Keycloak's, today) | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) |
| `tier` | our catalog: quota, max MP accounts, feature flags, nullable `stripe_price_id` | seeded by [#18](https://github.com/Shei254/marketplaats-extension/issues/18), read by [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| `subscription` | the mirror: user, tier, normalized status, period, Stripe ids | [#20](https://github.com/Shei254/marketplaats-extension/issues/20), [#30](https://github.com/Shei254/marketplaats-extension/issues/30) |
| `usage_reservation` | one quota unit, held from `authorize` until `complete` | [#22](https://github.com/Shei254/marketplaats-extension/issues/22), [#23](https://github.com/Shei254/marketplaats-extension/issues/23) |
| `relist_event` | what the extension reported about a relist | [#23](https://github.com/Shei254/marketplaats-extension/issues/23) |

**The reservation holds the quota unit, and the event does not.** An in-flight relist has to hold one — the
extension is between the delete and the create and has reported nothing yet — so usage in a period is the
reservations in it that were not refunded, and a refund is a status change on one row. That also leaves
`relist_event` free to record the `FAILED_BEFORE_DELETE` outcomes that cost no quota, which is precisely the
breakage canary [`docs/enforcement-contract.md`](../../docs/enforcement-contract.md) says `/complete` exists
for. That contract had said usage was `count(RelistEvent)`, written before the reservation existed; it,
[`docs/specs/quota-enforcement.md`](../../docs/specs/quota-enforcement.md), the domain model and the glossary
were all corrected to match.

These invariants are in the schema rather than in a service, so no module can write around one by forgetting:

| Invariant | Held by | Asserted by |
|---|---|---|
| At most one tier is the default | partial unique index `tier_single_default` | `aSecondDefaultTierIsRejected`, and `butTheCatalogMayHoldAnyNumberOfTiersThatAreNotTheDefault` for the *partial* |
| A user has at most one subscription | `subscription.app_user_id` unique | `aUserHasAtMostOneSubscription` |
| Status is one of the seven the contract normalizes to | check constraint | `aSubscriptionCarriesOneOfTheSevenNormalizedStatuses`, `andAStatusOutsideTheSevenIsRejected` |
| A tier with subscribers cannot be dropped | foreign key, no delete rule | `aTierWithSubscribersCannotBeDeleted` |
| A reservation is reported on at most once | `relist_event.reservation_id` unique | `aReservationIsReportedOnAtMostOnce` |
| A resolved reservation says when it resolved, and only a resolved one does | paired check constraint | `aResolvedReservationSaysWhenItWasResolved`, `aRefundedReservationSaysWhenItWasResolvedToo`, `aReservationStillHoldingItsUnitHasNoResolvedAt` |

Two things the contract wants are deliberately *not* in that table, because the schema cannot hold them
alone. `complete`'s **idempotency** is more than the unique above: the constraint refuses the second report,
and answering it with the unchanged `{quotaRemaining, resetAt}` instead of an error is
[#23](https://github.com/Shei254/marketplaats-extension/issues/23)'s to write. And while at most one event
per reservation is enforced here, that there is *exactly* one for every reservation that resolved is a rule
only the writing service can keep.

`BaselineSchemaTest` runs them against a Postgres it starts itself (Testcontainers), on **the image
`infra/docker-compose.yml` names** — `PostgresFromCompose` reads the tag out of that file rather than
restating it, because a schema proven on one major and served by another is a divergence nothing would
report until deploy. Pointing that file at `postgres:16-alpine` moves the whole suite onto 16.14, which is
the coupling working. An in-memory stand-in was never an option: partial indexes, `jsonb` and expression
checks are the subject here, not incidental to it.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `tier_single_default` becomes a plain `unique (is_default)` | `butTheCatalogMayHoldAnyNumberOfTiersThatAreNotTheDefault` (+2) |
| `subscription.app_user_id` loses `unique` | `aUserHasAtMostOneSubscription` |
| `relist_event.reservation_id` loses `unique` | `aReservationIsReportedOnAtMostOnce` |
| the `status` check constraint is dropped | `andAStatusOutsideTheSevenIsRejected` |
| `relist_event` is left out of the migration | `theMigrationCreatesTheFiveTablesTheDomainModelOwns` (+1) |

The fixtures name no tier `code` the seed below names, and each test empties the catalog it arranges — in a
transaction that is rolled back, so the seeded rows are still there for the class that is actually about
them.

## The catalog

`V2__seed_tier_catalog.sql` puts three tiers in that table: **Free** (3 relists a period, the `is_default`
one), **Pro** (50) and **Power** (200). `TierCatalogSeedTest` reads them back — it inserts nothing, because
the subject is the rows the migration left behind.

Quota is the whole ladder. The other two columns a tier could differ on are deliberately identical across
all three, and the file says why beside each: `max_marktplaats_accounts` is 1 everywhere because it is
sellable only once [#47](https://github.com/Shei254/marketplaats-extension/issues/47) finds a stable
Marktplaats account identifier, and `features` keeps its `{}` default because the flags
[`docs/domain-model.md`](../../docs/domain-model.md) names — bulk, scheduling — have no implementation and
no ticket, and [#26](https://github.com/Shei254/marketplaats-extension/issues/26)'s `/api/me` would hand a
seeded `"bulk": true` to the UI to render as though it did. The numbers themselves are configuration —
[`docs/specs/quota-enforcement.md`](../../docs/specs/quota-enforcement.md) puts them outside its scope — and
none of them is a rate: pacing and burst are [#25](https://github.com/Shei254/marketplaats-extension/issues/25)'s
SafetyPolicy.

**No tier carries a `stripe_price_id` yet**, so nothing in the catalog is purchasable:
[#28](https://github.com/Shei254/marketplaats-extension/issues/28) creates the Products and Prices by hand
in the Stripe dashboard and a migration after it fills the ids in. Free has none by design either way
([ADR-0014](../../docs/adr/0014-tier-catalog-and-entitlements.md)).

**Seeded here, not owned here.** ADR-0014 makes the catalog admin-managed, so the insert is
`on conflict (code) do nothing`: a quota an operator has edited stays edited, and a second application — a
restored dump, a hand-run — is a no-op rather than a duplicate catalog. The arbiter is named on purpose. A
bare `on conflict do nothing` would also swallow a collision with a *different* tier already flagged
default, which is not this file's conflict to ignore and should fail on `tier_single_default`. It is not an
`R__` repeatable migration for the reason that makes it idempotent: a re-run changes nothing, so the `R__`
form would advertise that editing a number below re-seeds it, and this file cannot keep that promise.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `on conflict (code) do nothing` dropped | `applyingTheSeedAgainLeavesTheCatalogExactlyAsItWas`, on `tier_code_key` |
| Free is seeded `is_default = false` | `freeIsTheTierEveryNewUserIsProvisionedOnto` |
| Free is seeded with quota 0 | `andTheFreeRungHasSomethingToSpend` |
| the Power row is left out | `theCatalogHoldsFreeProAndPower`, `quotaRisesFromFreeToPower` |
| Pro is seeded with a `stripe_price_id` | `andNoTierCarriesAStripePriceUntilOneExists` |
| Pro is seeded `{"bulk": true}`, Power three MP accounts | `andNoTierPromisesAFeatureThatDoesNotExist`, `noTierSellsMoreThanOneMarktplaatsAccountYet` |

## Versions, and where they are stated

- **Java 21** ([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)) as a Gradle *toolchain*, not as
  source/target compatibility: the compiler is 21 on every machine, so a newer local JDK cannot quietly
  compile against its own API. `settings.gradle.kts` applies the foojay resolver, which downloads a JDK 21 on
  a machine that has none — otherwise this build would fail for most people's default JDK.
- **Gradle 9.7.0**, via the committed wrapper, pinned by `distributionSha256Sum`.
- **Spring Boot 4.1.0**, stated once, in the `plugins` block; every Spring dependency takes its version from
  Boot's BOM. Boot's BOM does not manage Spring Modulith, so **2.1.0** is the one version pinned by hand.
  Flyway and Testcontainers it does manage, so neither is stated here or anywhere else — and the Postgres
  *image* is not a version either, since it is read from `infra/docker-compose.yml`.
- Boot 4 splits auto-configuration into per-technology modules, which is why the Flyway dependency is
  `spring-boot-starter-flyway` and not `flyway-core`: the latter would put Flyway on the classpath and leave
  nothing to run it, and an application that quietly migrates nothing starts perfectly well.

## Not here yet

The OAuth2 resource server ([#19](https://github.com/Shei254/marketplaats-extension/issues/19)), the
Tier → Entitlement resolution that reads the catalog above
([#21](https://github.com/Shei254/marketplaats-extension/issues/21)), and the endpoints of
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md)
([#22](https://github.com/Shei254/marketplaats-extension/issues/22),
[#23](https://github.com/Shei254/marketplaats-extension/issues/23),
[#26](https://github.com/Shei254/marketplaats-extension/issues/26)).

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI will run `./gradlew` here separately once this repo has CI. Both are covered in
[../../README.md](../../README.md#working-on-it).
