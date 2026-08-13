# `apps/api` — Spring Boot API

The skeleton: five empty modules and the build-time check that makes them mean something. No endpoints, no
database, no security — those arrive with the tickets named below.

```bash
cd apps/api
./gradlew test      # 4 tests: the context starts, and three that hold the module boundary
./gradlew build     # the above, plus the executable jar
./gradlew bootRun   # http://localhost:8080 — 404 on everything, there are no controllers yet
```

Nothing here needs [the local stack](../../infra/README.md) yet: no datasource is configured, and no token is
validated. Postgres becomes a requirement with [#17](https://github.com/Shei254/marketplaats-extension/issues/17)
(Flyway), Keycloak with [#19](https://github.com/Shei254/marketplaats-extension/issues/19).

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

## Versions, and where they are stated

- **Java 21** ([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)) as a Gradle *toolchain*, not as
  source/target compatibility: the compiler is 21 on every machine, so a newer local JDK cannot quietly
  compile against its own API. `settings.gradle.kts` applies the foojay resolver, which downloads a JDK 21 on
  a machine that has none — otherwise this build would fail for most people's default JDK.
- **Gradle 9.7.0**, via the committed wrapper, pinned by `distributionSha256Sum`.
- **Spring Boot 4.1.0**, stated once, in the `plugins` block; every Spring dependency takes its version from
  Boot's BOM. Boot's BOM does not manage Spring Modulith, so **2.1.0** is the one version pinned by hand.

## Not here yet

Schema and Flyway ([#17](https://github.com/Shei254/marketplaats-extension/issues/17)), the OAuth2 resource
server ([#19](https://github.com/Shei254/marketplaats-extension/issues/19)), and the endpoints of
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md)
([#22](https://github.com/Shei254/marketplaats-extension/issues/22),
[#23](https://github.com/Shei254/marketplaats-extension/issues/23),
[#26](https://github.com/Shei254/marketplaats-extension/issues/26)).

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI will run `./gradlew` here separately once this repo has CI. Both are covered in
[../../README.md](../../README.md#working-on-it).
