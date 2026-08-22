# `apps/api` — Spring Boot API

Six modules and the build-time check that makes them mean something, the schema they fill, the tier catalog
seeded into it and what each of its tiers grants, the resource server every route is closed behind, the
account and subscription a first sign-in leaves behind, and the tests that hold `infra/`'s Keycloak realm to
what it promises. Three endpoints so far — `POST /api/relist/authorize` and `POST /api/relist/complete`, the
two ends of the gate, and `GET /api/me`, the display state both clients read after signing in — plus the
rails that say how fast one account may relist and the scheduled reconciliation that gives back the units
nobody ever reports on, with the rest arriving on the tickets named below.

```bash
cd apps/api
./gradlew test      # 195 tests: the module boundary, the schema and catalog on a real Postgres, the realm,
                    #            which tokens get past the resource server, what first login provisions, what
                    #            a tier grants whoever is on it, who may relist and what it costs them, how
                    #            fast they may do it again, what the extension reporting back settles or gives
                    #            them back, what becomes of the relists it never reports on at all, and what a
                    #            signed-in caller is shown of all of it
./gradlew build     # the above, plus the executable jar
./gradlew bootRun   # http://localhost:8080 — 401 without a token, and the gate below with one
```

Both tasks read the repository's own **`.env`** — `cp .env.example .env` once, from the root, and
`build.gradle.kts` loads it into the JVM each of them starts. That is where the Stripe keys go, and the
extension id, and anything else this application takes from its environment; a variable you have exported in
your shell still wins over it. See [the one env file](#the-one-env-file) below, and
[`.env.example`](../../.env.example) for what each variable is.

`bootRun` in particular wants **`MPRELIST_EXTENSION_ID`**, or no browser client can call it — a copied `.env`
already carries it, and the substitution is the same one everything else uses:

```bash
export MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension)   # or leave it to .env
```

That id is what [`mprelist.cors.allowed-origins`](#which-origins-may-call-it) substitutes into the origin the
extension calls from. Unset, it falls back to the same `unset-extension-id` the realm file does — a valid
origin no browser will ever send — and the popup shows "unavailable" while this application answers every
request correctly. The startup log names the origins it accepted, which is the only place in *our* logs that
failure appears at all.

`bootRun` needs [the local stack](../../infra/README.md) up: it migrates `postgres://localhost:5432/mprelist`
on startup and will not start without it. Keycloak it does **not** need to start — discovery from
`issuer-uri` is deferred until the first token arrives, so the stack has to be up for anyone to get *in*, not
for the application to come up. `test` needs neither: it starts a Postgres and a Keycloak of its own, though
it does need a Docker daemon for that.

> On **Docker Desktop for Linux**, Testcontainers starts but every container fails with
> `mounts denied: the path /socket_mnt/home/<you>/.docker/desktop/docker.sock is not shared from the host`.
> Ryuk, the reaper Testcontainers starts first, mounts the Docker socket into itself, and Desktop's socket
> lives on a path its VM will not share. Export
> `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, which is where that same socket is inside the
> VM. It is a property of the daemon rather than of this project, so it must not be committed anywhere — but
> your own `.env` is exactly the right home for it now that one exists, and `.env.example` carries the line
> commented out. What it must never become is a value in a file everybody checks out, where it would be wrong
> for everyone running a plain Docker Engine.

> On the same daemon, both realm suites can also fail to start with
> `Timed out waiting for URL to be accessible … HTTP response code was: 403`, and every Keycloak URL answers
> `{"error":"invalid_request","error_description":"HTTPS required"}` — the local stack's `8081` included.
> Keycloak's `sslRequired` default is `external`, which means *plain HTTP is only allowed from a private
> address*, and Docker Desktop forwards a published port from an address of its VM's choosing. When that
> address is site-local (`172.17.x`, `192.168.x`) everything works; when it is not — observed here as
> `172.66.152.246`, after nothing but a `compose up` and `down` in between — Keycloak refuses the lot.
> Reproduce it in a minute without Gradle:
>
> ```bash
> docker run --rm -p 18099:8080 quay.io/keycloak/keycloak:26.7 start-dev
> curl -s http://localhost:18099/realms/master/.well-known/openid-configuration   # 200, or "HTTPS required"
> ```
>
> **Settled since #108: the realm relaxes it, and the suites follow the stack.** `sslRequired` is
> `${MPRELIST_SSL_REQUIRED:external}` in `infra/keycloak/mprelist-realm.json`, compose sets that variable to
> `none`, and `KeycloakFromCompose` reads the value out of compose — so both suites start the realm your
> stack starts and neither depends on the address any more. This paragraph stays because the failure is worth
> recognising: a daemon whose forwarder looks external refused **the browser's sign-in too**, not just the
> tests, and the extension reported it as `403` on the discovery URL with nothing about TLS in it.
>
> What #15 refused was `sslRequired: none` **in the file**, on the grounds that it would be wrong everywhere
> but a laptop — and that still holds, which is why the file's own default is untouched. A production realm
> (T56, #87) sets no such variable and imports as `external`. `infra/README.md` has the whole trade.
>
> **The address is not the whole story**, observed while running #21: the reproduction above answered `403`,
> and then `200` thirteen minutes later with nothing changed and no daemon restart, on a host where an
> `nginx` container in between logged the host's own requests as arriving from `192.168.65.1` — site-local,
> which by the paragraph above should always have worked. So treat "which address" as a symptom rather than
> the cause. It flaps on one daemon within minutes, and that flapping is exactly what the compose value now
> takes out of the suites' path.

## The modules

Each is a direct sub-package of `com.mprelist`, which is what makes it an application module
([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)).

| Module | Owns | Fills with |
|---|---|---|
| `identity` | who the caller is: `CurrentUser`, and `UserRef` for the account behind them | [#19](https://github.com/Shei254/marketplaats-extension/issues/19) — [below](#the-resource-server) — and [#20](https://github.com/Shei254/marketplaats-extension/issues/20) — [below](#first-login) |
| `catalog` | Tier → Entitlement and what a tier is called, from our table, no Stripe | `TierId` and `defaultTier()` with [#20](https://github.com/Shei254/marketplaats-extension/issues/20), `Entitlement` with [#21](https://github.com/Shei254/marketplaats-extension/issues/21) — [below](#what-a-tier-grants) — and `TierName` with [#26](https://github.com/Shei254/marketplaats-extension/issues/26) |
| `subscription` | the mirror of Stripe's status and period | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) provisions the first one, [#22](https://github.com/Shei254/marketplaats-extension/issues/22) reads and rolls its window — [below](#the-gate) — and [#30](https://github.com/Shei254/marketplaats-extension/issues/30) mirrors Stripe into it |
| `enforcement` | `authorize` / `complete`, the gate, and the reconciliation behind it | [#22](https://github.com/Shei254/marketplaats-extension/issues/22) — [below](#the-gate) — [#23](https://github.com/Shei254/marketplaats-extension/issues/23) — [below](#what-the-extension-reports-back) — and [#24](https://github.com/Shei254/marketplaats-extension/issues/24) — [below](#what-nobody-ever-reports-back) |
| `display` | `GET /api/me`: the unsigned snapshot the popup and the dashboard render from, composed from the four above | [#26](https://github.com/Shei254/marketplaats-extension/issues/26) — [below](#what-the-caller-is-shown) |
| `admin` | operator endpoints behind the `ADMIN` role | [#27](https://github.com/Shei254/marketplaats-extension/issues/27) — [below](#the-admin-guard) — which is the guard and no endpoint; the endpoints are [#84](https://github.com/Shei254/marketplaats-extension/issues/84) |
| `billing` | what Stripe tells us: the webhook, and the only Stripe dependency in the application | [#82](https://github.com/Shei254/marketplaats-extension/issues/82) — [below](#where-a-plan-comes-from) — syncs a Price into a tier; [#30](https://github.com/Shei254/marketplaats-extension/issues/30) mirrors subscriptions, [#29](https://github.com/Shei254/marketplaats-extension/issues/29) and [#31](https://github.com/Shei254/marketplaats-extension/issues/31) hand out the redirects |

Every module now holds at least one class, `admin` included since #27, which changes what its
`@ApplicationModule` annotation is doing. Modulith's default detection takes every direct sub-package that
*holds* a class, so on all seven the annotation is now consistency rather than what makes them visible — and
`allSevenModulesAreVisibleToTheCheck` no longer fails if `admin`'s `package-info` loses it. It did until this
ticket, because an empty package compiles to no class file at all and a module Modulith cannot see is a
module it does not check; that was the one place the annotation was load-bearing, and the mutation table
below records both readings and when each was true.

A module's **sub-packages are internal to it** — `enforcement.internal.jpa` is reachable from `enforcement`
and from nowhere else. That is the rule below enforces, and it is why ADR-0012 can promise Stripe and JPA stay
replaceable adapters rather than becoming everyone's dependency.

## The boundary check

`ModuleBoundaryTest.noModuleReachesIntoAnothersInternals` fails the build on a cross-module reach into an
`internal` package. There are real references for it to be right about since
[#20](https://github.com/Shei254/marketplaats-extension/issues/20) — `subscription` reads `identity`'s
`UserProvisioned` and `catalog`'s `TierCatalog`, both public API — but a check that passes is still
indistinguishable from one that has stopped working, and a violation is not a thing to write into `main` on
purpose. So the same verification is also pointed at a fixture built to be caught: `src/boundaryFixture/java`
holds two modules, `beta` reaching into `alpha.internal`, and `andTheCheckAboveIsWhatWouldCatchOneThatDid`
asserts it is rejected by name.

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
| `admin`'s `package-info` loses `@ApplicationModule` | **nothing, since #27** — the module now holds a class and is detected either way. It failed `allSevenModulesAreVisibleToTheCheck` — `allSix…` as it was then called — while the package was empty, which is what that row said before this ticket; re-run and observed on both sides of the change |
| `subscription` holds a field of type `enforcement.Quotas`, which is `/api/me` written in the module whose concept dominates it | `noModuleReachesIntoAnothersInternals`, by name: `Cycle detected: Slice enforcement -> Slice subscription -> Slice enforcement`. It is why `display` is a module of its own (#26) |
| `catalog`'s `package-info` loses `@ApplicationModule` | **nothing** — corrected in #26. The row was recorded against the wrong module: a package holding classes is detected either way, and `display` shipped with the same mutation surviving before this was chased down |

## The schema

`src/main/resources/db/migration/V1__baseline_schema.sql`, applied by Flyway on startup: the five tables
[`docs/domain-model.md`](../../docs/domain-model.md) calls backend-owned, and nothing else. Flyway checksums
what it has already applied, so a correction to that file once it has run anywhere is a new `V2` — never an
edit to `V1`.

Five migrations follow it, each named for what it adds rather than for the ticket that wanted it:
`V2__seed_tier_catalog.sql` (the catalog, below), `V3__index_abandoned_reservations.sql` (the index #24's
sweep reads — see [What nobody ever reports back](#what-nobody-ever-reports-back)),
`V4__index_relists_by_when_they_were_taken.sql` (the one the pacing rail reads — see
[How fast, as well as how much](#how-fast-as-well-as-how-much)), `V5__tier_publication.sql` (whether a tier
may be sold, and the constraint that published implies a price — see
[Where a plan comes from](#where-a-plan-comes-from)) and `V6__subscription_mirror.sql` (how far through
Stripe's telling a subscription is, which is what makes a redelivered or overtaken webhook harmless — see
[Where a payment becomes an entitlement](#where-a-payment-becomes-an-entitlement)). Both index files carry the
whole argument for why they do not collapse into V1's, which is the same argument twice: an index partial on a
status serves only a statement that says something about status.

> If startup fails with **`Migration checksum mismatch for migration version 1`**, your Postgres volume
> predates the rename `keycloak_subject` → `idp_subject` in [#17](https://github.com/Shei254/marketplaats-extension/issues/17),
> which edited `V1` after some machines had run it. `docker compose --env-file .env -f infra/docker-compose.yml down -v`
> and start again: `V1` has been applied to no deployed environment, so a dropped local volume is the
> whole of the cost. It is also the rule above, demonstrated.

| Table | Holds | Filled by |
|---|---|---|
| `app_user` | one row per human, keyed to the IdP `sub` (Keycloak's, today) | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) — [below](#first-login) |
| `tier` | our catalog: quota, max MP accounts, feature flags, nullable `stripe_price_id` | seeded by [#18](https://github.com/Shei254/marketplaats-extension/issues/18), read by [#20](https://github.com/Shei254/marketplaats-extension/issues/20) and [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| `subscription` | the mirror: user, tier, normalized status, period, Stripe ids | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) writes the first row, [#22](https://github.com/Shei254/marketplaats-extension/issues/22) rolls a free window that has closed, [#30](https://github.com/Shei254/marketplaats-extension/issues/30) keeps it in step with Stripe |
| `usage_reservation` | one quota unit, held from `authorize` until `complete` | [#22](https://github.com/Shei254/marketplaats-extension/issues/22) takes one, [#23](https://github.com/Shei254/marketplaats-extension/issues/23) settles or refunds it |
| `relist_event` | what the extension reported about a relist | [#23](https://github.com/Shei254/marketplaats-extension/issues/23) — [below](#what-the-extension-reports-back) |

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
| …and at least one | not the schema's to hold — [first login](#first-login) provisions it in the transaction that creates the user | `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` |
| Status is one of the seven the contract normalizes to | check constraint | `aSubscriptionCarriesOneOfTheSevenNormalizedStatuses`, `andAStatusOutsideTheSevenIsRejected` |
| A tier with subscribers cannot be dropped | foreign key, no delete rule | `aTierWithSubscribersCannotBeDeleted` |
| A reservation is reported on at most once | `relist_event.reservation_id` unique | `aReservationIsReportedOnAtMostOnce` |
| A resolved reservation says when it resolved, and only a resolved one does | paired check constraint | `aResolvedReservationSaysWhenItWasResolved`, `aRefundedReservationSaysWhenItWasResolvedToo`, `aReservationStillHoldingItsUnitHasNoResolvedAt` |

Two things the contract wants are deliberately *not* in that table, because the schema cannot hold them
alone. `complete`'s **idempotency** is more than the unique above: the constraint refuses the second report,
and answering it with the unchanged `{quotaRemaining, resetAt}` instead of an error is what
[#23](https://github.com/Shei254/marketplaats-extension/issues/23) wrote around it — `on conflict do nothing`,
and the reservation resolved only when that insert was the one that landed. And while at most one event per
reservation is enforced here, that there is *exactly* one for every reservation that resolved is a rule only
the writing service can keep — kept for the ones a report resolves, and #24's to keep for the ones nothing
ever reports on.

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

`V2__seed_tier_catalog.sql` seeds three tiers: **Free** (3 relists a period, the `is_default` one), **Pro**
(50) and **Power** (200). Those are the values the file inserts, not a description of the live catalog — it
is admin-managed from then on (below), so what the table holds is the table's to say. `TierCatalogSeedTest`
reads them back — it inserts nothing, because the subject is the rows the migration left behind.

Quota is the whole ladder. The other two columns a tier could differ on are deliberately identical across
all three, and the file says why beside each: `max_marktplaats_accounts` is 1 everywhere because it is
sellable only once [#47](https://github.com/Shei254/marketplaats-extension/issues/47) finds a stable
Marktplaats account identifier, and `features` keeps its `{}` default because the flags
[`docs/domain-model.md`](../../docs/domain-model.md) names — bulk, scheduling — have no implementation and
no ticket, and [#26](https://github.com/Shei254/marketplaats-extension/issues/26)'s `/api/me` would hand a
seeded `"bulk": true` to the UI to render as though it did. The numbers themselves are configuration —
[`docs/specs/quota-enforcement.md`](../../docs/specs/quota-enforcement.md) puts them outside its scope — and
none of them is a rate: pacing and burst are the SafetyPolicy's, and they are one setting for everybody rather
than a rung of this ladder.

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
| `do nothing` becomes `do update set relist_quota_per_period = excluded.…` | `andAQuotaAnOperatorHasEditedStaysEdited` — and *nothing else*, which is why it exists |
| Free is seeded `is_default = false` | `freeIsTheTierEveryNewUserIsProvisionedOnto` |
| Free is seeded with quota 0, or with 4 | `andTheFreeRungIsTheThreeTheCopyPromises` |
| the Power row is left out | `theCatalogHoldsFreeProAndPower`, `quotaRisesFromFreeToPower` |
| Pro is seeded with a `stripe_price_id` | `andNoTierCarriesAStripePriceUntilOneExists` |
| Pro is seeded `{"bulk": true}`, Power three MP accounts | `andNoTierPromisesAFeatureThatDoesNotExist`, `noTierSellsMoreThanOneMarktplaatsAccountYet` |

## What a tier grants

`TierCatalog` answers two questions and no others: which tier a new account lands on
([#20](https://github.com/Shei254/marketplaats-extension/issues/20)), and what a tier grants whoever is on it
([#21](https://github.com/Shei254/marketplaats-extension/issues/21)). The second is an `Entitlement` —
relists per period, max Marktplaats accounts, feature flags — resolved from the `tier` table and **never from
Stripe** ([ADR-0014](../../docs/adr/0014-tier-catalog-and-entitlements.md)), which is what keeps a network hop
to a payment provider off the path between a user and their own quota.

```java
Entitlement free = catalog.entitlementOf(catalog.defaultTier());   // 3 relists a period, 1 MP account, {}
```

**Neither question is about a user**, and that is the module seam. Which tier somebody is subscribed to is
`subscription`'s to say — it holds the mirror of Stripe's status and period —
so [#22](https://github.com/Shei254/marketplaats-extension/issues/22)'s gate is what puts the two together: it
reads the subscriber's tier from there and brings it here to find out what it grants. A convenience
`entitlementFor(UserRef)` would have made `catalog` read a `subscription` row, which is the coupling
[ADR-0012](../../docs/adr/0012-backend-modular-monolith.md) draws the module boundary to prevent.

**Limits, not a window and not a rate.** The period a quota is counted in is on the *subscription*, because it
is Stripe's billing period for a payer and a monthly roll from provisioning for a free user — two tiers are not
two windows. And a number per period is not a number per minute: a month's quota spent in one is what the
SafetyPolicy refuses, and nothing here paces anything.

**What a tier is called is not among these.** `name` is display text an operator may rewrite and `code` is the
handle the seed upserts on; neither is something a caller is entitled *to*.
[#26](https://github.com/Shei254/marketplaats-extension/issues/26)'s `/api/me` renders a tier to a human and
[#43](https://github.com/Shei254/marketplaats-extension/issues/43)'s plans page lists the catalog, so "what is
this tier called" — and `stripe_price_id`, which is
[#29](https://github.com/Shei254/marketplaats-extension/issues/29)'s — arrive with the tickets that have
somewhere to put them, on this same interface.

**A tier that is not there throws**, like `defaultTier()` and for a sharper reason. A subscription references
its tier behind a foreign key with no delete rule, so a row cannot go out from under a subscriber; an id that
resolves to nothing came from somewhere this module never wrote it. The `Optional` that reported it would
reach a gate whose job is to fail closed, which would deny that caller with `QUOTA_EXCEEDED` —
**indistinguishable from an ordinary exhausted user**, which is how a catalog fault comes to look like the
product working.

**Flags arrive as data, values and all.** `features` is a JSON object rather than a set of names precisely so
a flag can later carry one ("bulk, up to 20 at a time"), so resolution parses it into a `Map<String, Object>`
and no reader is handed a string to parse for itself. Copied and unmodifiable, so an entitlement cannot change
under a reader already holding it — and copied with a `LinkedHashMap` rather than `Map.copyOf`, which rejects
a null value: `{"bulk": null}` is a thing an operator can write, and a catalog that threw on reading one would
deny that tier's subscribers their quota over a flag nothing has been written to read yet. There is no
`grants(flag)` helper, because what a non-boolean value means is the first reader's to decide rather than the
record's to guess.

`Entitlement`'s own guards restate `V1`'s check constraints — quota at or above zero, at least one Marktplaats
account. Every entitlement resolved here comes off a row the database already held to them, so the reason to
repeat them is the ones that do not: #22's tests will stand entitlements up with no catalog behind them, and a
quota below zero denies every relist while reading as a gate that works. Zero is *allowed*: a paused plan is
denied by `QUOTA_EXCEEDED` like any exhausted user, which is one code path rather than a case of its own.

`TierEntitlementTest` drives all of it through the interface — never `TierRows`, since the interface is the
whole of what another module may hold — and arranges its own tiers rather than asserting the seeded numbers a
second time; `EntitlementTest` is the record's guards, with no Spring and no database.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the query stops naming the tier, and answers with whichever row came first | `andTheTierNamedIsTheOneResolvedRatherThanWhicheverRowCameFirst` (+4) |
| the two limits are read into each other's component | `aTierGrantsTheLimitsItsRowCarries` (+2) |
| the flags are dropped rather than parsed | `andTheFeatureFlagsItCarriesWithWhateverValuesTheyHold`, `andAFlagLeftWithNoValueArrivesAsTheNullItIsStoredAs` |
| a tier that is not there resolves to a grant of nothing | `butATierIdNamingNoRowIsAnErrorRatherThanAnEmptyGrant` |
| the flags are held as handed in rather than copied | `theFlagsAreCopiedRatherThanShared` |
| …or copied with `Map.copyOf` | `andAFlagLeftWithNoValueArrivesAsTheNullItIsStoredAs` |
| either guard on the record is dropped | `butNotFewerThanNone`, `andItGrantsAtLeastOneMarktplaatsAccount` |

The first of those is why `andTheTierNamedIsTheOneResolvedRatherThanWhicheverRowCameFirst` arranges two tiers.
A single arranged tier leaves a query that ignored its `where` clause answering from whichever row Postgres
reached first, and the catalog is never a table of one — the seed leaves three in it.

## The resource server

A Keycloak access token is the only way in (ADR-0005), and **every route is closed until one arrives** —
`anyRequest().authenticated()`, deliberately not scoped to `/api/**`, so a route a later ticket adds is shut
until that ticket opens it rather than open until somebody notices. This ticket adds no route of its own:
`identity` answers no request, it decides who is asking.

Four files hold it, all in `identity/internal` because everything that knows how Keycloak spells a claim is an
adapter ADR-0012 wants replaceable:

| Class | Holds |
|---|---|
| `ResourceServerSecurity` | the filter chain, the realm-role → authority conversion, and the `401` body |
| `TokenOnThisRequest` | the validated token this request arrived with, or the refusal — the one guard both resolvers below fail closed through |
| `CurrentUserFromToken` | the argument resolver that makes `CurrentUser` a parameter any controller can declare |
| `UserRefFromToken` | the resolver beside it for `UserRef`, and so the moment [first login](#first-login) provisions an account |

The last of those arrived with [#20](https://github.com/Shei254/marketplaats-extension/issues/20); the first
three are this ticket's. `CurrentUser` carries the token's `sub` and nothing else, which is the whole of what
a handler needs when it only has to know who is calling — `UserRef` beside it names our own `app_user` row,
and the table under [First login](#first-login) is where the choice between them is set out. Roles are
deliberately not a field on either: they become Spring Security authorities (`ADMIN` → `ROLE_ADMIN`), because
the only thing that reads them is a declarative guard on a route
([#27](https://github.com/Shei254/marketplaats-extension/issues/27)'s `hasRole('ADMIN')`), and a second copy
is a second thing that can disagree with the one the guard consults.

A controller in any module therefore reads:

```java
@PostMapping("/api/relist/authorize")
AuthorizationResponse authorize(CurrentUser caller, @RequestBody AuthorizeRequest request)
```

with no Spring Security type in the signature. Not `@AuthenticationPrincipal`, which binds `null` on an
anonymous request and lets the handler run; this resolver refuses, and the refusal comes out as the same
`401 UNAUTHENTICATED` as a missing token rather than as a 500.

**The refusal's body follows its status.** `BearerTokenAuthenticationEntryPoint` sets the status and the
`WWW-Authenticate` challenge, and `ResourceServerSecurity` writes `{"reason":"UNAUTHENTICATED"}` after it only
if that status is a `401`. It is not always: the entry point takes its status from the `BearerTokenError` it
was handed, and `invalid_request` is a `400` — a status the
[contract](../../docs/enforcement-contract.md#denial-shape) describes no denial for, because a request this
API could not parse is not a caller it turned away. Nothing configured here reaches that today, both places
`DefaultBearerTokenResolver` raises it being behind the form-encoded and query-parameter options this
application leaves off. That is also why `ResourceServerSecurityTest` is the one test of this security
configuration not driven over a real port: the pairing cannot be arranged by a request without turning on a
setting the application does not ship.

**The decoder is configuration, not code.** `issuer-uri` and `audiences` in `application.yml` are what Boot
builds it from, so the signature, the issuer, the expiry and the audience are all checked by code that is not
in this repository. That is the reason `ResourceServerTest` mints tokens rather than asserting settings: a
property silently dropped and a validator never installed look identical from here.

`sub` is the one claim that configuration does not buy, and so the one this module checks itself. A token can
pass all four checks above and still name nobody; `requireASubject` refuses it while it is still
authentication, so it comes back as the same `401 UNAUTHENTICATED` on **every** route rather than as a 500
from whichever handler first asked who was calling. Not in the resolver, which runs only for routes that take
a `CurrentUser` — a check there would leave every other route admitting a caller the API cannot name,
`hasRole('ADMIN')` included. Keycloak always writes `sub`, so nothing in the realm produces such a token: the
point is that the answer is decided rather than discovered.

That the check is on the way in rather than at the resolver is itself asserted, and the discriminator is the
`404` beside it: `andAtARouteThatNeverAsksWhoIsCalling` drives a route no controller claims, where an
authenticated caller is told `404`. A `401` there is the token being turned away before routing. Were the
guard moved into `CurrentUserFromToken`, that same call would answer `404` — a caller this API cannot name,
admitted, because nothing on that route happened to ask for a name.

Wiring the converter into `.jwt(...)` rather than exposing a `JwtAuthenticationConverter` bean is what makes
that placement available at all: the class declares `convert` final, so its only seams are the claim
converters, and refusing a token is not what an authorities converter is for.

**The audience is the check that is not the issuer's.** Every client in the realm signs in against the same
issuer and gets a token signed by the same key, so without it the dashboard's own token — or `account`'s,
which Keycloak hands to anybody — would be one this API accepts. `mprelist-api` exists to be named there and
nothing else.

`ResourceServerTest` runs against a **real port**, not MockMvc. MockMvc installs Spring Security's filters
only when `spring-security-test` happens to be on the classpath, and a suite that quietly stopped running them
would pass every test in that file by never refusing anything — which is the one failure it exists to make
impossible.

Its tokens come from `MintedTokens`: an RSA key, a JWKS and a discovery document on a loopback port, and no
Keycloak. Half of what has to be proven is a refusal, and an IdP will not mint the tokens that earn one —
expired, for another audience, signed by a key it never published. What it is *not* free to differ on is
shape: the issuer path is Keycloak's, the lifetime is the realm's own `accessTokenLifespan`, and one audience
is written as a bare string where several are an array, exactly as Keycloak writes them. Both shapes are
asserted, because the realm produces both — a resource server comparing `aud` as one string passes against
`dev` and fails against the first user made through a registration form.

The pairing a stub cannot cover is held by two tests that read files instead:
`theIssuerThisApiTrustsIsTheRealmTheLocalStackServes` puts `application.yml`'s `issuer-uri` beside compose's
`KC_HOSTNAME` and the realm's name, and `andTheAudienceItRequiresIsTheOneTheRealmsMappersWrite` puts its
`audiences` beside every audience mapper in the realm file. A realm renamed or a port moved would otherwise
leave this application behind silently, and the first anyone would know is a refused sign-in.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the resource server's `authenticationEntryPoint` is dropped | `aCallWithNoTokenIsRefusedWithTheReasonEveryDenialCarries` (+3) |
| `audiences` is dropped from `application.yml` | `aTokenForSomebodyElsesAudienceIsRefusedThoughThisIssuerMintedIt`, `andTheAudienceItRequiresIsTheOneTheRealmsMappersWrite` |
| `issuer-uri` names another port | `theIssuerThisApiTrustsIsTheRealmTheLocalStackServes` |
| the converter stops being wired into `.jwt(...)` | `aRealmRoleBecomesTheAuthorityAGuardWouldAskFor` (+2) |
| …or stays wired and loses the `ROLE_` prefix | the same one |
| `requireASubject` is dropped from the converter | `andOneThatNamesNoSubjectIsRefusedRatherThanHandedToAHandler`, `andAtARouteThatNeverAsksWhoIsCalling` |
| the refusal's `setCharacterEncoding` is dropped | `aCallWithNoTokenIsRefusedWithTheReasonEveryDenialCarries` |
| the refusal's body is written whatever status the challenge set | `butAMalformedRequestIsNotOne` |
| the absent `realm_access` claim stops being a case and becomes a null dereference | `andAUserWhoseTokenCarriesNoRolesAtAllIsStillOne` (+5) |
| `anyRequest().authenticated()` becomes `permitAll()` | `everyRouteIsClosedUntilItsOwnTicketOpensIt`, `aRouteThatPermitsAnonymousAccessCannotBeToldWhoTheCallerIs` |
| the argument resolver returns `null` instead of refusing | `aRouteThatPermitsAnonymousAccessCannotBeToldWhoTheCallerIs` |

That last one is the reason the test beside it counts handler entries rather than trusting the status code. A
resolver returning null blows up *inside* the handler, and the container dispatches that to `/error` — which
this application also protects, so it comes back as the very same 401. The status alone cannot tell "refused"
from "ran and threw", and the first version of that test could not either.

Two mutations survive and are left surviving, both because Spring Security already does the thing by another
route:

- **`.csrf(disable)` removed.** The resource-server configurer exempts any request carrying a bearer token,
  which is every request the contract makes today. The line is what will still hold for the first POST that
  does not carry one — [#30](https://github.com/Shei254/marketplaats-extension/issues/30)'s Stripe webhook,
  which would otherwise be refused for want of a CSRF token this API has no way to hand Stripe.
- **`.sessionManagement(STATELESS)` removed.** The bearer filter keeps the security context in a request
  attribute rather than a session on its own, so no cookie appears either way and
  `andNothingIsRememberedBetweenCalls` stays green. The promise is this application's to keep, not that
  filter's default to change.

**One route is open, and it is not ours.** Spring Security 7 publishes RFC 9728 protected-resource metadata at
`/.well-known/oauth-protected-resource`, permits it, and points every `WWW-Authenticate` challenge at it. It
was found by curling the running application rather than by reading the configuration, which is why
`exceptForTheOneRouteSpringSecurityOpensForItself` now pins it: it discloses the base URL the caller has just
used and names no authorization server, and an upgrade that started publishing the issuer there would be
widening what an unauthenticated caller learns.

Verified against the real stack too, which is the half `MintedTokens` cannot be:
a full code + PKCE sign-in as `mprelist-dashboard` produced a token with `iss: http://localhost:8081/realms/mprelist`
and `aud: mprelist-api`, and the running application answered it `404` — accepted, no such route. Without a
token: `401 {"reason":"UNAUTHENTICATED"}`. With a **real** token from the same realm minted for another
audience (`admin-cli`): `401`, `The aud claim is not valid`. With one byte of the signature changed: `401`,
`Invalid signature`.

## First login

ADR-0014 requires that **every user always has a Subscription** — the free tier is an ordinary `tier` row, a
new account lands on it `active`, and no code anywhere asks "is this user free?". `FirstLoginProvisioningTest`
is where that is held — twice over, and the pair is the point:
`aCatalogWithNoDefaultTierProvisionsNobodyAtAll` takes the one path where it could break, and
`andNoAccountIsLeftWithoutOneWhicheverWayItWasReached` asserts the property itself, that no `app_user` is
left without a `subscription` whichever way the row was reached. A test per path only ever covers the paths
that existed when it was written.

**There is no login to hang it off.** This application is a resource server; nobody signs in *to* it. So
"first login" is the first request carrying a `sub` that `app_user` has never seen, and provisioning happens
on the way into a handler — when one declares a `UserRef` parameter:

```java
@GetMapping("/api/me")
Me me(UserRef caller)          // the account exists by the time this body runs
```

That is the difference between the module's two public types, and a handler chooses by which it declares:

| Parameter | Answers | Costs |
|---|---|---|
| `CurrentUser` | the token's `sub`, and nothing else | no database at all |
| `UserRef` | our `app_user` row | the query that finds it, and on first sight the one that creates it |

A filter provisioning on every authenticated request was the alternative, and would make "first login" literal
at the price of a query on every call that never looks at an account. What both have that a service method
would not is that **neither leaves it to a handler to remember**: a route declaring `UserRef` cannot be reached
without the row existing. #26's `/api/me` is the first such route, and it is the call both clients make
immediately after signing in.

**One transaction, three modules.** `identity` creates the `app_user` and publishes `UserProvisioned`;
`subscription` listens and writes the row; `catalog` says which tier it goes on:

| Class | Module | Holds |
|---|---|---|
| `UserRefFromToken` | `identity/internal` | the resolver, and so the moment provisioning happens |
| `AppUsers` | `identity/internal` | the `app_user` table, the insert that claims a subject, and the transaction |
| `ProvisionOnFirstLogin` | `subscription/internal` | the subscription: default tier, `active`, and the period |
| `TierRows` | `catalog/internal` | the `tier` table, and the only code that reads it |

An **event, listened to synchronously**, and both halves of that are decisions:

- **An event**, because a subscription references a user and everything references identity. Had `identity`
  called `subscription` directly, the dependency would point the wrong way and the module everything else
  depends on would grow one of its own for every ticket that hangs something off a new account.
- **Synchronously**, which is why it is a plain `@EventListener` and *not* Spring Modulith's
  `@ApplicationModuleListener`. That one is asynchronous and after-commit, so the account would exist for a
  moment with no subscription against it — and "no subscription is unreachable" is an invariant, not an
  eventual state. Here the listener runs inside the transaction that created the row, so a listener that
  throws takes the account down with it. `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` is that test: with
  no tier carrying `is_default` the call fails **and leaves no `app_user` behind**, so the caller retries
  rather than becoming a signed-up user with nothing to spend.

**`accountFor` is package-private, and for most of Spring's history it could not have been.**
`@Transactional` on a non-public method used to be ignored rather than rejected — no error, no transaction —
and every guarantee in the paragraph above would quietly not have existed. It was written `public` here for
that reason, and the mutation that narrowed it back **survived**: as of Spring 7,
`AbstractTransactionManagementConfiguration` builds its `AnnotationTransactionAttributeSource` with
`publicMethodsOnly = false`, so it applies either way. The rule is real and out of date, and the reason it is
not a thing to remember is that `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` fails the moment the
transaction is not there, whichever way it stopped being.

**The period is a calendar month from provisioning**, computed once in UTC in Java. Free users have no Stripe
period to copy, so this is what makes `resetAt` answerable for everybody (ADR-0014, and #26 renders it).
Thirty days would pass a test written as "about a month" while walking the reset date a day earlier every
month, and Postgres's own `interval '1 month'` is evaluated in the session's time zone, so two deployments
would give the same account periods an hour apart across a DST boundary.

**The second period is not written here**, and for a while it was written nowhere. #20 provisions one window
and nothing advanced it, so a free account's `period_end` sat in the past from its second month on. That was
deferred on purpose — nothing read `period_start`/`period_end` yet, and a roll with no reader is a mechanism
whose first real exercise would be in production — and it is now [the gate](#the-gate)'s, which is the first
code to read the window and so the first that can notice it has closed.

**Two first requests can be in flight at once** — the popup and the dashboard both waking after a sign-in —
and the loser must join the winner's account rather than fail on `app_user_idp_subject_key`. `on conflict
(idp_subject) do nothing` makes its insert *wait* on the other transaction instead of raising, and the select
after it turns the nothing it then returns into the answer. Eight callers at once provoke that only when the
scheduler cooperates, so the test arranges it instead: the competing account is claimed on a connection of the
suite's own and left uncommitted, the call is fired, and the commit waits until Postgres reports a backend
blocked on a lock — which is the application's insert, stopped on exactly that row.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `@Transactional` is dropped from `accountFor` | `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` |
| the `@EventListener` becomes a `@TransactionalEventListener` | the same one |
| `UserProvisioned` is not published | `andASubscriptionOnTheDefaultTierRatherThanNoneAtAll` (+5) |
| `defaultTier()` stops asking for `is_default` | `andASubscriptionOnTheDefaultTierRatherThanNoneAtAll`, `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` |
| the subscription is seeded `incomplete` rather than `active` | `andASubscriptionOnTheDefaultTierRatherThanNoneAtAll` |
| the period runs `plusDays(30)` instead of `plusMonths(1)` | `andAPeriodThatRunsAMonthFromTheMomentItWasProvisioned` |
| `on conflict (idp_subject) do nothing` is dropped from the insert | `andASubjectClaimedWhileTheCallWasInFlightJoinsThatAccount` |
| …or kept, and the select that follows it removed | the same one |
| the resolver takes the caller's name instead of refusing an anonymous one | `andNorDoesOneAtARouteThatWouldHaveLetItThrough` |

That last one is why the test beside it counts handler entries. Asking for an account is a **write**, so the
failure that matters is not that the caller saw an error — it is a row created for somebody who never signed
in, at whatever open route a later ticket adds. Every route in this application is closed today, so the chain
refuses such a call before any resolver runs and the fixture brings an open one of its own.

One mutation is left surviving and said so: **narrowing `accountFor` to package-private**, for the reason two
paragraphs up. It is left in the source rather than reverted, because the narrower method is the better one
and the Spring behaviour it depends on is held by a test rather than by a convention.

## The gate

`POST /api/relist/authorize` is the first route this application ships, and the one thing between a user and a
relist ([ADR-0007](../../docs/adr/0007-quota-enforcement.md),
[the contract](../../docs/enforcement-contract.md)). The body is `{ "adId": "..." }` — no
`marktplaatsAccountId`, which ADR-0007's 2026-08-13 refinement removed along with the `NOT_YOUR_ACCOUNT`
denial it fed, because nothing in the extension can produce one and this backend could not verify it if it
did. Quota is per user.

```
200  { "authToken": "<JWT>", "expiresAt": "…", "jti": "…" }   and one unit of quota is gone
402  { "reason": "SUBSCRIPTION_INACTIVE" }                    a payer whose subscription stopped
429  { "reason": "QUOTA_EXCEEDED", "resetAt": "…" }           the period's relists are spent
429  { "reason": "RATE_LIMITED", "retryAfter": 27 }           relisting faster than the rails allow
401  { "reason": "UNAUTHENTICATED" }                          answered by the filter chain, never reached (#19)
```

**The checks run in the contract's order and the first failure wins**, which is a product decision rather than
an implementation detail: a lapsed payer who is *also* out of quota is told their subscription lapsed, because
that is the one of the two they can act on. The other way round they would be shown an upgrade prompt for a
plan they are no longer paying for. `aLapsedPayerIsToldTheirSubscriptionStoppedRatherThanThatTheyAreOutOfQuota`
arranges exactly that user, which is why it gives them a tier granting nothing.

**Three modules meet here, and each answers only what it owns.** `subscription` says which tier the caller is
on and when their window ends, `catalog` says what that tier grants, and the reservations are `enforcement`'s
own. That is why the entitlement is resolved from a *tier* rather than from a user (#21): the gate is the one
place that knows both halves.

| Class | Module | Holds |
|---|---|---|
| `AuthorizeRelist` | `enforcement/internal` | the route, and the verdict → status mapping |
| `RelistGate` | `enforcement/internal` | the checks, in order, and the transaction that makes them one decision |
| `Quotas` | `enforcement/internal` | the tier's grant less what the window holds — the walk both ends of the gate take |
| `SafetyPolicy` | `enforcement/internal` | the pacing read and the configuration behind it (below) |
| `RelistPace` | `enforcement/internal` | the rails themselves, with no reading in them — pure, and tested without Spring |
| `UsageReservations` | `enforcement/internal` | the `usage_reservation` table: what a period holds, and taking one |
| `RelistAuthorizations` | `enforcement/internal` | the signed, ~45-second grant a `200` comes with |
| `SubscriptionRows` | `subscription/internal` | the `subscription` table, the row lock, and the roll below |

**Reading a quota and spending against it is one decision.** `Subscriptions.currentFor` reads the
subscription `for update`, so the same user's second concurrent call — the popup and an injected button, or an
impatient double-click — waits there and then counts the reservation the first one wrote. Two callers holding
one unit between them cannot both be authorized. The lock is one row per user, so it costs nobody else
anything. That promise is only kept inside a transaction, so `currentFor` is `@Transactional(MANDATORY)`: the
gate's own `@Transactional` is then load-bearing rather than decorative, and dropping it fails 24 of the
suite's 27 tests instead of quietly leaving the lock to be released one statement later.

`theSubscriptionIsHeldForTheLengthOfTheCallSpendingAgainstIt` asserts the mechanism and
`andTwoCallersHoldingOneUnitBetweenThemDoNotBothSpendIt` the property, both arranged rather than raced — this
suite holds the row itself and waits until Postgres reports a backend blocked on a lock, which is #20's
technique and for its reason: firing N callers and hoping proves nothing on the run where they do not overlap.

**The unit is held, not recorded.** `authorize` inserts a `RESERVED` row before the extension has done
anything, because the relist is about to become a *delete* on Marktplaats: a unit counted on the way back would
leave an in-flight relist costing nothing and a crashed one costing nothing either. Usage in a period is
therefore the reservations in it that were not refunded — `status <> 'REFUNDED'`, which is also the predicate
of `usage_reservation_holding_a_unit`, so this read is what that index exists for. A refusal reserves nothing:
a user out of quota would otherwise sink deeper into it by asking.

**The window a free account is counted in is rolled here**, which is the half of ADR-0014's monthly roll #20
deferred: it writes the first window and nothing advanced it, so from a free account's second month every
relist would have been counted against a window that closed — permanently exhausting the account — and
`resetAt` would have been a date in the past, which the popup would render as a cooldown that is already over.
Rolled in `subscription` rather than in the gate, because it is that module's window and a caller that had to
notice a closed one is a caller that can forget to.

Two things about the roll are decisions:

- **It anchors on the subscription's creation, not on the window it replaces.** Rolling from the stored start
  re-anchors on whatever the last roll clamped to — an account provisioned on the 31st spends February on the
  28th, and every month after that on the 28th — so the reset date walks earlier and never comes back. From the
  anchor, February clamps and March returns to the 31st.
- **A window Stripe owns is left alone.** A payer's period is copied from Stripe's own (#30), so a closed one
  means a webhook has not arrived yet; rolling it would invent a period Stripe did not grant — a month's quota
  to an annual plan every month, and a fresh one to a subscriber whose next webhook says `past_due`. Nothing is
  purchasable until [#28](https://github.com/Shei254/marketplaats-extension/issues/28) and
  [#29](https://github.com/Shei254/marketplaats-extension/issues/29), so no row can carry a Stripe subscription
  today. The branch is asserted anyway, because the answer is a decision rather than a thing to discover the
  first time somebody pays.

**The authorization is signed, and the key is not yet configuration.** The token carries the four claims the
contract names — `sub`, `adId`, `jti`, `exp` — where `sub` is our own `app_user` id rather than the IdP subject
(we are its only reader, and every row in the schema is keyed by our id) and `jti` is the reservation, which is
what makes it single-use without a table to burn it in: #23 settles the reservation the `jti` names, and
`relist_event.reservation_id` is unique. The RSA key is generated per process and held in memory. **Nothing
verifies one of these yet** — `/complete` takes a `jti` and resolves a row — so a configured key would be a
secret to distribute and rotate in every environment before anything read it, and a development default would
be the one that eventually shipped. What that costs is stated rather than discovered: a restart invalidates
every grant still in flight, which is at most 45 seconds of them, and **a second instance would sign with a
second key**. The first verifier is what turns this into configuration — and
[#23](https://github.com/Shei254/marketplaats-extension/issues/23), which was named as it, turned out not to
be one: `/complete` takes the `jti` and resolves the row, so the token is still something only we read and
never something we check. **Nothing verifies one of these yet remains true**, and the ticket that changes it is
whichever first has a reason to trust the token rather than the row — none is open today, so it is stated here
and in the contract rather than assigned.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the subscription is read without `for update` | `theSubscriptionIsHeldForTheLengthOfTheCallSpendingAgainstIt`, `andTwoCallersHoldingOneUnitBetweenThemDoNotBothSpendIt` |
| `@Transactional` is dropped from the gate | 24 of the 27 — `currentFor` is `MANDATORY`, so it refuses rather than running without one |
| the status check is dropped | `aLapsedPayerIsToldTheirSubscriptionStoppedRatherThanThatTheyAreOutOfQuota` (+5) |
| …or moved after the quota check | that same one, alone — which is what it is for |
| `trialing` stops entitling its holder | `butATrialIsASubscriptionThatEntitlesItsHolder` |
| the quota comparison is `>` rather than `>=` | `aSubscriberWhoHasSpentThePeriodsQuotaIsRefusedWithTheDateItComesBack` (+4) |
| usage counts every reservation, refunds included | `aRefundedReservationIsNotOneTheyAreStillHolding` |
| …or only the ones still open | `butASettledOneIs` |
| usage is not bounded below by the period start | `andAUnitSpentBeforeThisPeriodBeganIsNotCountedInIt`, `aFreeWindowThatHasClosedIsRolledForwardBeforeUsageIsCountedInIt` |
| …or is counted across every user | `andNorIsSomebodyElsesRelist` |
| the unit is reserved before the checks rather than after them | 13, including both denials asserting they cost nothing |
| a closed window is never rolled | `aFreeWindowThatHasClosedIsRolledForwardBeforeUsageIsCountedInIt` (+2) |
| the roll anchors on the window it replaces | `andTheWindowItRollsIntoStartsOnTheDayTheAccountWasProvisioned` |
| a window Stripe owns is rolled too | `butAWindowStripeOwnsIsLeftForItsWebhookToMove` |
| the two denials swap statuses | `aLapsedPayerIsToldTheirSubscriptionStopped…` (+5) |
| `@JsonInclude(NON_NULL)` is dropped from the refusal | that same one, on the `resetAt` a `402` must not carry |
| a quota refusal carries no `resetAt` | `aSubscriberWhoHasSpentThePeriodsQuota…`, `andSoTheDateAQuotaComesBackIsNeverOneThatHasPassed` |
| a request naming no ad is accepted | `aBodyNamingNoAdIsARequestThisApiCouldNotReadRatherThanADenial` |
| the token's `jti` is a nonce of its own rather than the reservation | `andTheAuthorizationNamesTheCallerTheAdAndTheReservationItSpent` |
| …or the token does not name the ad it authorizes | the same one |
| the authorization lasts 45 minutes rather than 45 seconds | `andExpiresSoonEnoughThatOneCannotBeSavedForLater` |

One mutation survives and is left surviving: **the reservation's `reserved_at` left to the column's `now()`
default** rather than passed from the gate. The two clocks — this application's and the database's — are the
same machine in every environment this has ever run in, so nothing here can tell them apart. It is passed
anyway because the instant a row is counted at should be the instant the gate compared against the period it
counted in, and the row that falls outside the window it was authorized against is the one nobody would find.

**Not here.** ADR-0012 sketches an `enforcement/domain` package for pure decision logic and there is none —
see the section below, which is the ticket that was expected to create it and did not.

## How fast, as well as how much

A quota is a number per period and not a number per minute, so a month's worth spent in one is something no
check above refuses. `SafetyPolicy` is the last check of the gate and the only one that is not about
entitlement ([#25](https://github.com/Shei254/marketplaats-extension/issues/25),
[ADR-0008](../../docs/adr/0008-safety-and-consent.md)).

```yaml
mprelist:
  safety:
    minimum-interval: 30s   # between one relist and the next; 0 turns this rail off
    burst-limit: 10         # how many inside the window below, at least 1
    burst-window: 1h        # sliding, not aligned to a clock
```

**These are rails for the user's own Marktplaats account, not a throttle protecting ours.** Relisting is
delete-and-recreate against a private API ([ADR-0002](../../docs/adr/0002-relist-mechanic.md)/
[0004](../../docs/adr/0004-surfaces-and-internal-api.md)), and the account that gets flagged for a
machine-shaped rhythm is the seller's. Nothing here is about load. Human-like *jitter* around the interval is
the extension's ([#54](https://github.com/Shei254/marketplaats-extension/issues/54)) and can be nothing else:
a backend can refuse a call that came too soon, it cannot make one arrive at a human-shaped moment.

**Two rails, because one of them caps nothing.** Thirty seconds between relists permits a hundred and twenty
an hour — a Power tier's whole month in under two — at a rhythm no human has. The interval is what keeps
consecutive actions out of a volley; the burst cap is what keeps a properly paced volley from running all day.
So a window shorter than `burst-limit` × `minimum-interval` would be a rail arithmetic can never reach, and a
rail written off by arithmetic is one nobody decided to switch off: `theShippedRailsAreBothOnesThatCanBind` is
what refuses to let that happen quietly. None of the three is defaulted in code, for the reconciliation
window's reason — how fast is too fast is a judgement about a platform that publishes no number.

**The longer of the two rails answers**, since waiting out the one that binds today and being refused by the
other is a cooldown that runs to zero in front of a user and then refuses them anyway. The burst rail is
measured from the **cap-th most recent** relist rather than the oldest one in the window: those are the same
row until an operator lowers the cap under somebody who has already exceeded it, and answering from the oldest
would name a moment at which this still refuses. The wait is rounded **up** to whole seconds, because it
leaves as a countdown a client renders — rounded down, a client that waits exactly as long as it was told
arrives a fraction early and is refused a second time, which reads to a user as a timer that lied.

**It counts attempts, where quota counts what was kept**, and that is the whole difference between the two
reads of one table. `Quotas` asks what a period is still holding, so a `FAILED_BEFORE_DELETE` gives its unit
back (#23) and a relist nobody reported on is handed back too (#24). This asks what the extension has been
doing to Marktplaats — and those relists *happened*: an ad was captured, photos were fetched, requests were
made from the user's own session. A rail that forgave every failure would stop pacing an extension exactly
when it started failing.

```sql
select reserved_at from usage_reservation
where app_user_id = ? and reserved_at >= ?
order by reserved_at desc limit ?
```

Which is why it needs an index of its own. `usage_reservation_by_when_it_was_taken` (`V4`) leads with the same
two columns as V1's `usage_reservation_holding_a_unit` and is **unpartial**, because the statement above
carries no predicate about status at all and a planner uses a partial index only where it can prove the
statement's predicate implies the index's. Bounded on both ends — as far back as the longer rail reaches, and
never more rows than the cap can be decided by — so what this costs on the hot path is set by a number an
operator configures rather than by how much a user has ever relisted.

**No lock of its own, and it needs none.** Two of the same user's calls cannot both pass it for the reason
neither can spend the last unit of a quota: the gate already holds a write lock on that caller's subscription
row, so the second call is still waiting at that read when the first commits its reservation. The clock is
read once by the gate and passed in, so the horizon this counts back from and the `reserved_at` the next call
will pace itself from are the same instant rather than two readings.

**`RelistPace` is the rules with no reading in them**, and `RelistPaceTest` runs the lot with no Spring
context and no database: which rail answers, what happens at the exact instant one runs out, how a wait is
rounded, what a cap lowered under somebody does. Those are cases an HTTP suite could not land on a clock it
does not control. It is **still `internal`**, though ADR-0012 names this ticket as the likeliest to create the
`domain` package: that ADR's bar is a *second reader*, and this has one. Moving it would make a type public so
that a test could sit beside it.

`RelistPacingTest` is then about what only the running application can answer, and it **overrides none of the
three settings** — like the reconciliation suite and its grace, what it is written against is what ships. The
suites whose subject is quota switch both rails off instead, which is a setting rather than a hole: they spend
a quota one relist at a time, and the interval is exactly what refuses the second of them.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the pacing check is dropped from the gate | 4, every refusal `RelistPacingTest` arranges |
| …or runs before the quota check | `aCallerWithNothingLeftThisPeriodIsToldSoRatherThanToldToWait`, alone — which is what it is for |
| the unit is reserved before the rail is asked | 12, including `andTheRefusalCostsNothingButTheWait`; the rest are grants that begin failing at random, since a row stamped `now` reads back rounded a microsecond into the future |
| the pace counts only the units still held | `aRelistThatFailedBeforeAnythingWasDeletedStillPacesTheNextOne` |
| …or counts every user's relists | `butSomebodyElsesRelistIsNotThisCallersToWaitFor` |
| the interval rail is dropped | 4 in `RelistPaceTest` |
| the burst rail is dropped | 3 there |
| the earlier of the two rails answers | 7 there |
| the burst rail is decided by the oldest relist in the window | `theBurstRailIsDecidedByTheCapthMostRecentRelistRatherThanByTheOldestInTheWindow` |
| the horizon is the shorter of the two rails | `theHorizonIsAsFarBackAsTheLongerRailReaches` |
| one more relist is read than the cap can be decided by | `andNoMoreRelistsThanTheCapCanBeDecidedBy` |
| the interval is over one instant *after* it runs out | 5, including `andItIsOverAtTheInstantItRunsOutRatherThanAfterIt` |
| a wait is rounded down | `aWaitIsRoundedUpToWholeSeconds` |
| …or always up, whole or not | 6, including `andOneThatIsAlreadyWholeIsLeftAlone` |
| a burst cap of none is allowed | `aBurstCapOfNoneIsRefusedWhereItIsConfigured` |
| a negative rail is allowed | `andSoIsARailSetToLessThanNothing` |
| the rails are constants rather than the configured values | `aSubscriberWhoHasSpentThePeriodsQuotaIsRefusedWithTheDateItComesBack` — the suites that switch the rails off are what notice |
| a rate-limited refusal carries no wait | `aSecondRelistTheMomentAfterTheFirstIsToldHowLongToWait`, `aWindowFullOfRelistsIsRefused…` |
| `RATE_LIMITED` is served as something other than `429` | 3 |
| `@JsonInclude(NON_NULL)` is dropped from the refusal | 3, on the `retryAfter` a quota denial must not carry and the `resetAt` this one must not |
| `V4` is left out of the migrations | `andThePaceIsReadThroughAnIndexRatherThanByReadingEveryRelistThisCallerEverMade` |

One mutation survives and is left surviving: **the rail reading a clock of its own** rather than the one the
gate passes it. The two are microseconds apart on one machine, so nothing here can tell them apart — it is
`reserved_at`'s case again, and it is passed for the same reason: the instant a relist is paced from should be
the instant the row it wrote was stamped with, or the interval enforced between two relists is the drift
between two readings.

## What the extension reports back

`POST /api/relist/complete` is the other end of the gate: what happened to the relist an authorization was
issued for, and what that costs. Every `authorize` takes a unit before anything is deleted, so **every one of
them has to come back here** or the unit stays taken for the rest of the period.

```
200  { "quotaRemaining": 2, "resetAt": "…" }   whether it settled the unit or gave it back
404                                            a jti naming no reservation of this caller's — empty body
400                                            a body this API could not read — empty body
```

The body is `{ "jti": "…", "outcome": "SUCCESS" | "FAILED_BEFORE_DELETE" | "FAILED_AFTER_DELETE" }`. The `jti`
is the reservation's own id, so this resolves a row in our own table rather than reading a claim out of the
token — which is why **nothing here verifies a signature**, and why `RelistAuthorizations`' key is still
generated per process. The `authToken` would buy one thing this does not need: proof the caller was the one it
was issued to. That is already answered, better, by the caller's own access token, since a reservation is only
ever resolved against the account holding it.

**Whether the unit is spent is a different question from whether the relist worked**, and the two are answered
separately:

| Outcome | The reservation | Why |
|---|---|---|
| `SUCCESS` | settles | the user got what they paid a unit for |
| `FAILED_AFTER_DELETE` | settles | the ad was deleted — the destructive half happened, and a refund would let a broken relist loop burn a seller's listings for free |
| `FAILED_BEFORE_DELETE` | **refunds** | nothing was consumed on Marktplaats, so nothing is consumed here |

A refund still writes a `relist_event`, and that is the point of the table: it is the **breakage canary**, not
the usage count. A rising `FAILED_BEFORE_DELETE` rate is the first sign Marktplaats moved something, and a
table keeping only the relists that worked would be blind to exactly the failure it exists to reveal. What a
period spent is the reservations in it, one row away.

**The database is what makes this idempotent.** `relist_event.reservation_id` is unique, so a second report
for one authorization conflicts there rather than depending on anything having remembered the first;
`on conflict do nothing` turns that into the contract's answer — the unchanged `{quotaRemaining, resetAt}`,
which is also the right answer to the ordinary cause of a second report, an extension retrying because our
own response never arrived. **The first report decides and later ones cannot revise it**: a
`FAILED_BEFORE_DELETE` after a `SUCCESS` does not hand back the unit for a relist that happened, and under
ADR-0007 the client sending it is the adversary.

**No check runs here.** A lapsed payer whose subscription stopped between the two calls is still the only
witness to what happened, and refusing their report would hold their unit forever and lose the outcome the
canary is watching for. The same goes for a report arriving after the 45-second grant expired: the token's
lifetime bounds how long an *authorization* is good for, not how long the extension has to say what it did
with one — and the late reports are the slow and broken relists, which are the ones worth hearing about. This
call grants nothing, so there is nothing here to fail closed about.

**A `jti` that is not this caller's is a `404` with an empty body**, which is the contract's shape for a
`4xx` that is not a denial: they were not turned away, they named something that is not there. It is the same
answer for a reservation that never existed and for one belonging to somebody else, on purpose — a client
that could tell those apart would have been handed a way to ask whether a given id is anybody's. A `jti`
shaped like anything other than a reservation id is a `400` instead, because "we cannot read this" and "this
is not yours" are different things for an extension to do about.

**Both bodies are empty, and the `400`'s is ours rather than the framework's.** Left alone, an unreadable
request came back as Spring Boot's default error representation — `{timestamp, status, error, path}` — which
names no reason code and so satisfied the letter of the contract, but put a second body shape on these two
endpoints and echoed the caller's own request path back at them. `UnreadableRequests` is a
`@RestControllerAdvice` scoped to this module's two controllers — named types rather than a global advice,
since one with no types named would decide the shape of every route later modules write, a reach across a
boundary the build-time check cannot see because Spring wires it by annotation. The tests assert the body is
*empty* rather than that it lacks `reason`, which is the assertion the default body used to pass.

**It is asked before the subscription is read**, because reading one is not free of consequence: `currentFor`
takes a write lock on the caller's row and rolls a free window that has closed. The `jti` is the one input to
this call an adversary picks (ADR-0007), so a value nobody was ever issued should move nothing at all — and a
reservation's owner never changes, so nothing is bought by asking under the lock instead.

**What the caller is told it has left is what the gate will enforce.** `RemainingQuota` is one subtraction
with three readers — the refusal in `RelistGate`, the answer here, and `/api/me` since #26 — because two
written a day apart are two chances for the popup to show a relist left beside a button that refuses. `Quotas`
is the pair of reads that feeds it, in one place for the same reason: a subtraction shared over two callers
that each fetched their own entitlement and counted their own window is still two answers waiting to differ.
It is **clamped at zero**: a tier's quota is an operator's to edit at any time (ADR-0014), so a subscriber
holding more than their tier now grants is reachable without anybody doing anything wrong, and a negative
number rendered in the popup is not a smaller quota but a bug on screen. The clamp is also what keeps
"nothing left" and "refused" the same condition.

| Class | Module | Holds |
|---|---|---|
| `CompleteRelist` | `enforcement/internal` | the route, and the `200`/`404` |
| `RelistReports` | `enforcement/internal` | the transaction: the ownership check, the lock, the report, the answer |
| `RelistEvents` | `enforcement/internal` | the `relist_event` table, and the conflict that makes this idempotent |
| `RelistOutcome` | `enforcement/internal` | the three outcomes, and which of them spend the unit |
| `Quotas` | `enforcement` | the question, published at #26 — `QuotasFromReservations` in `internal` is the walk the gate takes, so both answer from one pair of reads |
| `RemainingQuota` | `enforcement` | what is left of a period, for the gate, for this and for `/api/me` |
| `UnreadableRequests` | `enforcement/internal` | the empty-bodied `400` both routes answer with, scoped to the two of them |

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `FAILED_AFTER_DELETE` refunds rather than settling | `andSoDoesOneThatFailedOnceTheAdWasAlreadyDeleted` |
| `FAILED_BEFORE_DELETE` settles rather than refunding | `butOneThatFailedBeforeTheAdWasTouchedGivesTheUnitBack` (+2) |
| the `on conflict` is dropped from the event insert | `theSameReportTwiceCostsWhatTheFirstOneCost` (+2) |
| the reservation is resolved whether or not this report is the first | `andASecondReportCannotReviseWhatTheFirstOneSaid`, `andNorTheOtherWayRound` |
| the ownership check is dropped | all three `404` tests |
| …or no longer names the caller | `aReservationSomebodyElseHoldsIsNotThisCallersToResolve` alone — which is what it is for |
| what is left is not clamped at nothing | `aQuotaLoweredUnderASubscriberLeavesThemWithNothingRatherThanLessThanNothing` |
| spent means *fewer than* none left rather than none | that one and 6 in the authorize suite — the two readers of one subtraction |
| `@Transactional` is dropped from the report | 14 of the 22 — `currentFor` is `MANDATORY`, so it refuses rather than running without one. Not the three `404`s: they answer before the subscription is read, which is the point of the order |
| the quota is counted before the report resolves the unit | `butOneThatFailedBeforeTheAdWasTouchedGivesTheUnitBack` (+1) |
| a resolved reservation is not stamped with when it resolved | 13 — `usage_reservation_resolved_at_matches_status` refuses the row |
| a `jti` that is nobody's answers `200` | all three `404` tests |
| the ownership check runs after the subscription is read | `andAJtiThatIsNobodysRollsNoWindowOnTheWayToSayingSo` |
| the body's `jti` may be absent | `aBodyNamingNoAuthorizationIsARequestThisApiCouldNotRead` |
| …or its `outcome` may | `andSoIsOneSayingNothingAboutWhatHappened` |
| `UnreadableRequests` is dropped, so the `400` is the framework's default body again | 4 here and 1 in the authorize suite |
| …or is left global instead of scoped to these two controllers | none — see below |

Two survive and are left surviving.

**`recorded_at` left to the column's `now()` default** rather than passed from the report, for the reason
`reserved_at`'s twin does. Both clocks are the same machine everywhere this has run, so nothing here can tell
them apart. It is passed anyway, because the event and the reservation it resolves should be stamped by one
clock — the interval between a relist being authorized and reported on is what #24 sizes its grace window
from, and two clocks would make that interval the drift between two machines.

**`UnreadableRequests` left global** rather than scoped to the two controllers it names — applied, and the
suite stays green. It cannot fail today: `enforcement` ships the only routes there are, so global and scoped
select the same two. The scope is written for the routes #26 and #36 will add, and the day it starts mattering
is the day somebody wants a different shape on a route this module does not own. That is a test those tickets
can write and this one cannot, since the thing to assert is the behaviour of a controller nobody has written.

## What nobody ever reports back

Every `authorize` takes a unit and only a report gives it back, but **nothing obliges the extension to make
the second call**. An MV3 worker is evicted between the delete and the create, a tab is closed, a machine
sleeps, a network drops on the one request that mattered. `ReservationReconciliation` is what stops waiting:
on a schedule, every reservation still `RESERVED` whose grant ran out more than the grace window ago has its
unit handed back.

```yaml
mprelist:
  reconciliation:
    grace: 30m     # how long past a grant running out we keep waiting for a report
    interval: 5m   # how often we stop waiting — a fixed delay, and it fires once at startup
```

Neither setting has a fallback in code: a missing one fails startup rather than running with a window nobody
chose, because a wrong value here is silent in both directions.

**This is the only guess in the enforcement path, and it is deliberately the weaker of the two claims.** A
report is the sole account of what actually happened on Marktplaats; what is known here is only that one has
not arrived. So a report that turns up afterwards **settles the unit back and this refund is discarded** —
the rule #23 fixed from its own side, and the reason `UsageReservations.resolve` is unconditional on the
status it finds. And **no `relist_event` is written here**: all three outcomes are things the extension
observed, and a row saying a relist failed because we stopped waiting for news of it would put an invention
into the breakage canary.

**The grace is generous because the two mistakes are not symmetric.** Guessing too early costs almost
nothing — the relist that was still running reports in the end, and that report settles the unit back.
Guessing too late is what the ticket exists to stop: a free user is three relists a month, so one browser
closed at the wrong moment is a third of their quota held until the period rolls. It is measured from
`expires_at` rather than from `reserved_at`, so what a relist is judged against is the authorization it was
actually given rather than a second rule that could drift from `RelistAuthorizations.LIFETIME`.

**Idempotent and safe to run twice over — including from two instances — because of the statement rather than
because of anything remembered.**

```sql
update usage_reservation set status = ?, resolved_at = ?
where status = 'RESERVED' and expires_at < ?
```

`status = 'RESERVED'` is the whole of it. Rows a previous run moved are `REFUNDED` and no longer match, so a
second run refunds nothing; rows a report already resolved are not `RESERVED` and are never matched. The
interesting case is the one in between — a report that commits *while this statement is scanning* — and
`read committed` is what covers it: the update blocks on that row's lock, and when the report commits it
re-checks the predicate against the new version, finds it no longer holds, and leaves the row alone. A
statement that read the ids first and updated them afterwards would pass every other test and refund a relist
that happened. No lock is taken on the subscription, unlike both ends of the gate, so this never waits on the
hot path and cannot deadlock against a call that takes the subscription first and this row second.

**It reads an index, and the status stays a literal so that it keeps reading one.** `V3` adds
`usage_reservation_awaiting_a_report (expires_at) where status = 'RESERVED'`. V1's index leads with
`app_user_id`, which this statement does not constrain — it asks about every user at once — so without V3 the
sweep is a full scan taking row locks against the hot path, every `interval`, over a table that gains a row
per relist and never loses one. The index is partial, which is what keeps it small forever: it holds only the
relists currently in flight, and a row leaves it for good the moment either a report or this job resolves it.

That partial predicate is also why `where status = 'RESERVED'` is pasted into the statement while the status
being *written* is bound. A planner uses a partial index only when it can prove the statement's predicate
implies the index's, and through a bind parameter it can do that only while planning with the value
substituted — a *custom* plan. A statement that earns a *generic* plan has an opaque parameter, no proof, and
a sequential scan: measured over 200k rows, cost 5356 against the index's 12.43. Postgres takes the generic
plan only when it judges it no worse, so the parameterized form would very likely keep the index today — the
point is that it would make the access path of a growing sweep depend on a cost comparison and a statement
cache, with nothing to announce the day it tips. `ReservationStatus.inSql` is where that is spelled once, and
`andItFindsThemThroughAnIndexRatherThanByReadingEveryRelistEverMade` asserts the plan rather than the index's
existence, because those are what come apart.

| Class | Module | Holds |
|---|---|---|
| `ReservationReconciliation` | `enforcement/internal` | the grace window, the schedule, and the decision to stop waiting |
| `UsageReservations` | `enforcement/internal` | the statement above, and why its predicate is the safety |
| `ReservationStatus` | `enforcement/internal` | the three states, and the one place each is spelled for SQL |
| `ApiApplication` | root | `@EnableScheduling` — an application-wide capability, not a module's to switch on |

`ReservationReconciliationTest` **runs the job rather than waiting for it**: the suite sets an interval long
enough that the schedule never fires, and each test invokes the task the scheduler holds. That is what makes
the negative assertions — *this row was left alone* — claims about a reconciliation that provably happened
rather than about one that may not have got there yet. The task is reached through `ScheduledTaskHolder`
rather than by naming the bean, so nothing in `enforcement/internal` had to be made public for a test, and the
wiring becomes part of what is asserted: a job that stopped being scheduled is one the suite cannot find to
run.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the `status = 'RESERVED'` guard is dropped | `aReservationAReportAlreadySettledIsNotOneToHandBack` (+2) |
| the grace window is dropped, so anything expired is swept | `butAGrantThatRanOutAMomentAgoIsARelistThatMayStillBeRunning` |
| abandonment is judged on `reserved_at` rather than on the grant's expiry | 4 |
| `resolved_at` is left null on a refunded row | 5 — `usage_reservation_resolved_at_matches_status` refuses it |
| `@EnableScheduling` is dropped | all 9 — there is then no `ScheduledTaskHolder` and the suite does not start |
| `@Scheduled` is dropped from the method | 8 — the task is not there to be found and run |
| the interval is a constant rather than the configured one | `andItIsScheduledWithTheIntervalItIsConfiguredWith` |
| the shipped grace is set to nothing | that suite's two, including the one reading `application.yml` |
| `V3`'s index is dropped, or made non-partial on another column | `andItFindsThemThroughAnIndexRatherThanByReadingEveryRelistEverMade` |

Two survive and are left surviving.

**The grace read from a constant rather than from configuration.** No test can tell them apart while the
constant and the shipped value agree, and catching it would mean a second Spring context whose only difference
is a grace — a container per assertion. It is configuration because how slow a real relist gets is a thing the
world tells an operator and not a thing this code knows.

**The matched status bound rather than pasted** — applied, and the suite stays green. The plan test explains a
statement of its own rather than the one `UsageReservations` runs, because that statement is `internal` and
reaching it would mean making SQL public for a test. So what the test holds is the *index*: that one exists
and can serve this predicate. What it cannot see is the day the statement stops being written in the form that
uses it. Closing that would mean either a scan counter read back after a real run — which needs a table two
hundred thousand rows deep before a planner prefers an index at all, in a suite where every other test arranges
three — or exporting the statement. Neither is worth what it costs; the comment on `ReservationStatus.inSql` is
the guard instead, and it is a weaker one than a test, which is why it is written out at length.

## What the caller is shown

`GET /api/me` is the display state of ADR-0007: what the popup and the dashboard render, read once after
signing in and again from a `/complete` answer. It is **never a grant** — the relist path ignores it
completely, so a stale `active` sitting in a client's cache cannot cause a relist — and that is what the
module is named for.

```json
{ "subscriptionStatus": "ACTIVE",
  "tier": { "code": "free", "name": "Free" },
  "quotaRemaining": 2,
  "resetAt": "2026-09-14T08:31:22.101Z",
  "features": {} }
```

**`200` or `401`, and nothing between them.** Every user always has a subscription (ADR-0014), so there is
nothing here to refuse: a payer whose plan lapsed and a free user with nothing left are both *shown* that,
and being turned away for it is the job of the call that grants something. A caller refused here could not
tell a lapsed plan from a backend that is down, which is the opposite of the fail-closed display the contract
asks for. It also **spends nothing** — a popup opened five times is five of these calls, and one that cost a
unit would empty a free tier by being looked at.

**It is a sixth module, and the reason is a cycle rather than taste.** The body is four modules' answers: the
status and the window are `subscription`'s, the tier's name and flags are `catalog`'s, and `quotaRemaining` is
counted from `enforcement`'s `usage_reservation` and nowhere else. `subscription` is the module whose concept
dominates that body — and `enforcement` already reads `subscription`, so a route living there closes a loop
the boundary check refuses by name (`Cycle detected: Slice enforcement -> Slice subscription -> Slice
enforcement`, which is the mutation recorded [above](#the-boundary-check)). `identity` and `catalog` sit
underneath both and fare no better. So the composer of a view over four modules is its own module, `display`,
which publishes the route and nothing else: nobody asks it anything, it is the leaf that asks everybody.

**`enforcement` publishes one question, and this is the first thing anybody has ever asked it.** `Quotas`
answers what a subscriber has left of the period they are in and `RemainingQuota` is what it answers with —
the same subtraction the gate refuses on and `/complete` reports, now with a third reader. A display that
counted for itself is the popup reading "1 relist left" beside a button the gate refuses, which is the whole
reason that type exists. The port **takes the `Subscription` its caller has already read**, so a third reader
is not a third lock on that row and not a third chance to roll a closed window — and the number and the
`resetAt` beside it provably describe one period.

**The tier travels in both of its spellings.** `code` is the handle an admin edit never moves; `name` is
display text an operator may rewrite at any time. A client given only the name brands a plan by text somebody
is free to change; given only the code it renders `power` to a human, or keeps a second catalog of labels
ours never reaches. `TierName` is `catalog`'s, on the interface `Entitlement` came in on, and is read by a
statement of its own so the authorize path keeps reading only the columns a check is made of.

**A free window that has closed is rolled here too**, like both ends of the gate — this is the call both
clients make immediately after signing in, so it is exactly where a user returning after a month would
otherwise be shown a `resetAt` in the past and a quota counted in a period that ended. It is also the first
route to declare a `UserRef`, which is what [#20](https://github.com/Shei254/marketplaats-extension/issues/20)
deferred to "the first handler that needs one": a subject this API has never seen is provisioned an account
and a default-tier subscription, and answered with the plan it has just been given.

| Class | Module | Holds |
|---|---|---|
| `ShowDisplayState` | `display/internal` | the route, and the `UserRef` that provisions on first sight of a subject |
| `DisplayStates` | `display/internal` | the transaction, and the four questions in the order that keeps their answers consistent |
| `DisplayState` | `display/internal` | the body: the five fields, serialized as the record stands |
| `Quotas` / `RemainingQuota` | `enforcement` | what a period has left — asked here, refused on by the gate |
| `TierName` | `catalog` | the code and the display name, which are not interchangeable |

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `@Transactional` is dropped from the snapshot | 11 of the 12 — `currentFor` is `MANDATORY`, so it refuses rather than reading without one. Not the `401`, which never reaches a handler |
| the units held are not counted, so the tier's grant is shown | `theQuotaShownIsWhatThePeriodHasLeftRatherThanWhatTheTierGrants` (+2) |
| what is left is not clamped at nothing | `andItIsNeverFewerThanNoneWhenATierIsLoweredUnderItsSubscribers` |
| `resetAt` is where the window began rather than where it ends | `aSubscriberIsShownTheStatusTierQuotaAndResetDateOfThePlanTheyAreOn` (+2) |
| the status shown is `ACTIVE` whatever the subscription says | `aPayerWhoseSubscriptionLapsedIsShownThatRatherThanTurnedAway` |
| `features` is dropped from the body | `aSubscriberIsShownTheStatusTierQuotaAndResetDateOfThePlanTheyAreOn` (+2) |
| …or is always empty rather than the tier's own flags | `theFlagsTheTierGrantsAreShownAsTheColumnHoldsThem` |
| the tier's `code` is its display name too | `theTierIsShownInBothOfItsSpellingsSoThatNobodyBrandsAPlanByItsLabel` (+1) |
| `@JsonIgnore` is dropped from `RemainingQuota.isSpent` | `aRelistReportedAsDoneSpendsTheUnitItWasAuthorizedFor` — see below |
| the route is written in `subscription` instead | the boundary check, on the cycle |

**One of those was not a mutation but a bug this suite's neighbour caught.** Publishing `RemainingQuota` made
`isSpent()` public, and public plus an `is` prefix is a *property* as far as Jackson is concerned — so
`/complete` began answering `{quotaRemaining, resetAt, spent}`, a third field no contract names and one a
client could come to read instead of the number beside it. `RelistCompletionTest` asserts that body has two
fields and failed on the first run. `@JsonIgnore` is the fix, and the general lesson is written on the method:
this record is a wire shape as well as an answer, so anything added to it is added to the contract.

**One survives and is left surviving: the route permitted without a token.** `permitAll()` on `/api/me`
changes nothing a test can see, and that is [#19](https://github.com/Shei254/marketplaats-extension/issues/19)
working rather than a hole. `TokenOnThisRequest.orRefuse` fails closed in the *same* shape as the filter
chain — `401 UNAUTHENTICATED`, with the challenge header — precisely so that a route which permits anonymous
access and then asks who is calling cannot answer a caller it could not name. The two guards are
indistinguishable from outside because they were built to be, and a test that could tell them apart would be
asserting which of the two refused rather than that the caller was refused.


## The admin guard

`/api/admin/**` needs the realm's `ADMIN` role, and **that is the whole of what #27 ships** — the guard and no
endpoint, the way #19 shipped a resource server and no endpoint. `AdminGuardTest` brings its own routes for
the same reason `ResourceServerTest` does: what has to be proven is a filter chain, and the application still
serves nothing under that path.

**It is a rule over a path space, not over a list of handlers.** A path under `/api/admin` that nothing serves
is already refused — asserted, and asserted beside its discriminator, since to an operator that same path is a
`404`. That pairing is the point of the ticket: [#84](https://github.com/Shei254/marketplaats-extension/issues/84)'s
tier CRUD will be guarded by being written there, rather than by each handler remembering an annotation whose
absence looks exactly like its presence.

**The rule is `admin`'s, applied by `identity`.** `RoutesNeedingARole` is a two-field record — a pattern and a
realm role — that a module publishes as a bean and the filter chain turns into a guard:

```java
@Bean
RoutesNeedingARole theAdminApiIsForOperators() {
    return new RoutesNeedingARole("/api/admin/**", "ADMIN");
}
```

Two alternatives were weighed and both are worse. Spelling `requestMatchers("/api/admin/**")` inside
`ResourceServerSecurity` puts another module's URL space in the one file that knows nothing else about it, and
importing the pattern from `admin` instead would point `identity` at a module that already points back at
it — a cycle the boundary check rejects. A **second `SecurityFilterChain`** owned by `admin` would have to
restate how a token is read, how its realm roles become authorities and what a refusal looks like; the piece
easiest to leave out is the authorities converter, and without it these routes are closed to operators too,
silently and completely.

The record says *what*, never *how* — no Spring Security type appears in it — and it can only ever restrict.
There is deliberately no way to say "open this to anyone": every route is closed until its own ticket opens it,
and opening one should be visible in the chain rather than contributed from a module.

**The refusal is a `403` with an empty body**, which is the rule `docs/enforcement-contract.md` states for a
`4xx` that is not one of its denials, and in particular carries no `reason` — a client reads the presence of
one as meaning the gate turned it away. It does carry `WWW-Authenticate: Bearer error="insufficient_scope"`,
which is the resource server's own and what RFC 6750 §3.1 defines for this status; the contract is amended to
say so rather than a handler written to strip it. A call with **no** token is still the contract's
`401 UNAUTHENTICATED`, because "sign in" and "you are signed in as somebody who may not do this" are different
instructions.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the chain stops applying the rules it is handed | `andACallerWithoutTheRoleIsRefusedBeforeItRuns` (+3) |
| the rule is applied *after* `anyRequest().authenticated()` | the same, and for the reason the parameter's javadoc gives: nothing after the catch-all is ever reached |
| `hasRole(...)` becomes `authenticated()` | `andSoIsOneHoldingSomeOtherRole` (+1) — every signed-in user is an operator |
| the pattern loses its `/**` | `aPathNobodyHasWrittenYetIsAlreadyClosed` — the guard then covers one path and not the space |
| the guard is scoped to `/**` instead | `andEverywhereElseIsUntouched` — one rule, and the whole application is operators-only |


## Which origins may call it

Every client of this API is cross-origin — the extension from `chrome-extension://<id>`, `apps/web` from its
own host — so `mprelist.cors.allowed-origins` is what stands between a working popup and one that says
"unavailable" over a backend answering perfectly well. **Found by running it**, not by a test: this suite
drives the application over a real port and never sent an `Origin` header, so it could not see CORS at all.
`CrossOriginTest` sends one now.

The important half is the **preflight**. `Authorization` is never a safelisted header and neither is a JSON
content type, so *every* call the contract describes is preceded by an `OPTIONS` that carries **no token** —
by design, browsers send none. A chain that authenticated it first would answer the contract's `401`, and the
browser would report a missing `Access-Control-Allow-Origin` rather than anything about a token. So the CORS
filter runs before authentication and answers the preflight itself, which is what `.cors(...)` in
`ResourceServerSecurity` buys.

**It is handed the configuration source rather than left to `Customizer.withDefaults()`.** That default looks
for a bean *named* `corsConfigurationSource` and, finding none, falls back to Spring MVC's own
`CorsConfigurationSource` — which knows nothing about our origins and answers a preflight `200` with no CORS
headers on it whatsoever. That is exactly the bug this section exists about, and it is not one to leave
resting on a bean name. The bean is declared as the concrete `UrlBasedCorsConfigurationSource` for the same
reason: asking for the interface finds two.

| | |
|---|---|
| Origins | exactly what is configured. No patterns, no `*` |
| Methods | `GET`, `POST` — the two the contract uses. `OPTIONS` needs no entry: a preflight is answered, not routed |
| Headers | `Authorization`, `Content-Type`, `Accept` |
| Credentials | **not allowed.** Nothing here is authenticated by a cookie, so a browser is never invited to send one |
| Max age | 30 minutes, so a popup opening five times costs one preflight rather than five |

**This is not the security boundary and is not written as one.** CORS decides which page's script may read an
answer; the token decides who is answered at all. What it prevents is a site the user happens to be visiting
reading their plan out of this API in the background — not anything a caller holding a valid token could not
do anyway.

**The origin defaults to the id rather than to an environment variable, and that was the second attempt.**
The first spelled it as a substitution of `MPRELIST_EXTENSION_ID`, exactly as `infra/keycloak`'s realm file
does, so that neither held a literal copy of an id that is supposed to be derived (T44). Every developer then
met the same failure — a browser refusing an answer, naming nothing about this application, with the fix
living in a shell they had already opened. So the trade was inverted: this file is re-read on every start, and
a value that is wrong here costs a restart, while the realm imports **once** and a wrong value there costs a
`down -v`. The realm keeps the substitution; this defaults.

What keeps the literal honest is not care but
`theOriginThisApiAllowsIsDerivedFromTheKeyTheExtensionIsPinnedBy`, which derives the id from the `key` in
`apps/extension/public/manifest.template.json` — SHA-256, first sixteen bytes, each nibble as a letter `a`–`p`,
which is Chrome's own and `npm run extension-id`'s — and fails the build if `application.yml` disagrees. The
variable still wins where it is set, which is what the Web Store's own id will need at publish (#87).

`andTheRealmRegistersThatSameOriginAsTheExtensionsWebOrigin` holds the two files to each other — they break in
different halves of the same sign-in otherwise, and the symptom names whichever was asked first.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| `.cors(...)` dropped from the chain | every test in `CrossOriginTest` bar the file-parity one — the preflight comes back `200` with no headers, which is the reported bug exactly |
| `Customizer.withDefaults()` in place of the explicit source | the same, and for the reason above: MVC's own source is found and it allows nothing |
| the allowed origins widened to `*` | `anOriginNobodyConfiguredIsNotAnsweredAtAll` |
| `Authorization` dropped from the allowed headers | `theBrowsersQuestionIsAnsweredBeforeAnybodyIsAskedForAToken` |
| credentials allowed | `andNoBrowserIsInvitedToSendCredentialsWithIt` |
| one letter of the allowed origin's id changed | `theOriginThisApiAllowsIsDerivedFromTheKeyTheExtensionIsPinnedBy` — which is what makes writing the id here safe at all |


## Where a plan comes from

`POST /api/stripe/webhook`, and it is the first route here that no bearer token reaches
([#82](https://github.com/Shei254/marketplaats-extension/issues/82), T51).

[ADR-0019](../../docs/adr/0019-plans-are-stripe-first-and-webhook-synced.md) makes **Stripe the place a plan
is created** and this catalog the place it is given a quota. The operator creates a Product and a Price in
the Stripe dashboard, tagged `metadata.tier_code`; `price.created` and `price.updated` arrive here and upsert
the tier that tag names. So the link between what a plan costs and what it grants is never typed twice, which
is the whole reason the tag is the handle rather than a price id somebody pastes into a form.

**Three rules, and the SQL in `TierRows.adopt` is the whole of the enforcement of them:**

| | |
|---|---|
| A quota is never written | `relist_quota_per_period` appears only in the `insert`, and only as the `0` a draft starts at. The `do update` arm cannot raise or lower one, because it does not name the column. A Price tagged `pro` fills in the seeded row and leaves its 50 alone — the rule `V2__seed_tier_catalog.sql` already states for itself |
| An unknown code drafts a tier | quota 0, `published = false`. A Price that exists before anybody has said what it grants sells nothing rather than selling everything |
| Publication only ever rises | and only when a tier **with a quota** takes its **first** Price, which is what fills in the seeded `pro` and `power`. A later Price repoints the tier and leaves `published` alone, so a tier an operator took off sale does not come back on it because Stripe sent an update |

**A Price with no `tier_code` is not a plan.** Stripe Prices get created for one-offs, coupons and
experiments, and a sync that adopted all of them would turn a billing experiment into a tier. The cost is the
one ADR-0019 names: a tag somebody forgot is **silent**. It is a log line here and it has to be a list in
T53's admin screen ([#84](https://github.com/Shei254/marketplaats-extension/issues/84)), because absence is
not a thing anybody notices.

**The name comes from the Price's `nickname`, and only if it has one.** Stripe's nickname is optional and
usually unset, so it travels as a suggestion: a Price with none leaves the tier called what an operator
called it, and a draft with none is named after its own code until somebody renames it.

### Why the route is open, and what closes it instead

Stripe holds no account in our realm and could not present a bearer token. What it presents is an HMAC of the
exact bytes it sent, keyed by a secret only the two ends hold, with a timestamp so a captured request cannot
be replayed for ever. `SignedByStripe` checks it through Stripe's own library rather than a hand-rolled HMAC:
the failure mode of getting the compare wrong is a timing oracle nobody would notice.

- **The chain opens exactly this path**, by name, in `ResourceServerSecurity` — `POST` only. That is the rule
  `RoutesNeedingARole` states for itself: a module may say its routes *need a role*, and **opening** one is a
  decision that belongs in the chain where a reviewer meets it. The path is therefore spelled twice, and
  `StripePriceSyncTest` is what holds the two copies together: every request it makes carries no token, so a
  chain that opened some other path would refuse all of them with `401`.
- **The body is read as a `String` and verified before anything parses it.** A signature is over bytes; a
  body bound to a type is a body re-serialised, and re-serialising changes them.
- **No secret configured refuses everything**, loudly at startup and then silently per event.
  `mprelist.stripe.webhook-secret` has an *empty* default — unlike the pacing rails, which have no fallback
  at all — because it is a secret, it cannot be committed, and it is different for every `stripe listen`
  session. An API that would not boot without one would make every unrelated change need one.
  `StripeWithoutAWebhookSecretTest` asserts both halves: it starts, and it refuses a perfectly well-formed
  event.

### What answers what

`400` means we could not tell that this was Stripe, or could not read what it sent. `200` means the event was
handled **or deliberately ignored** — and the second is the common case, since an endpoint hears about
everything it is subscribed to and this ticket handles two types. Answering non-2xx to the rest would put the
endpoint in a permanent retry loop over events it will never act on, which is the state that hides a real
failure. An operator's mistake — a missing tag, a Price re-tagged onto a tier that would have to steal
another's — is the same `200` and a log line, for the same reason: retrying cannot fix a tag.

`V5__tier_publication.sql` adds `published`, and with it a constraint: **published implies a price**. Written
into the schema rather than left to its two readers, so T53's publish button cannot offer a tier whose
Checkout session could not be opened.

### What is not here

- **Idempotency on the event id.** Nothing here needs it: an upsert on a tier code says the same thing however
  often it is said and in whatever order, which `andTheSameEventTwiceIsTheSameRowOnce` asserts. The events
  where repetition and order *do* change the answer are the subscription ones —
  [#30](https://github.com/Shei254/marketplaats-extension/issues/30) handles them, and it turned out to need
  a timestamp rather than a log of ids. See [below](#where-a-payment-becomes-an-entitlement).
- **Archiving.** A `price.updated` carrying `active: false` is adopted like any other: the tier keeps
  pointing at it. Repointing is create-then-archive, so unpublishing on archive would fight the order the
  events arrive in. An archived Price a tier still points at is T53's to notice.
- **A second Price for one tier**, monthly and annual — `tier.stripe_price_id` is `UNIQUE` and single-valued,
  so the second one repoints the tier rather than joining it. ADR-0019 names the `tier_price` table that
  would be needed first.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| adoption publishes every tier it touches | `aTierThatGrantsNothingIsNotPublishedByAPriceLandingOnIt`, `andDoesNotRepublishATierSomebodyUnpublished` |
| the `do update` arm writes a quota too | `andNeverTouchesTheQuota` |
| a Price with no nickname renames the tier anyway | `andLeavesTheTierNamedWhatItWasNamed` |
| another tier's Price is taken rather than left | `aPriceAnotherTierHoldsIsLeftWhereItIs` |
| an unconfigured secret verifies everything | `anEventCarryingNoSignatureIsRefused`, `andRefusesAnEventItCannotCheck` |
| the signature is not checked at all | four, including `andOneSignedWithSomeOtherSecretIsRefused` |
| the replay window widened to a year | `andAGenuineOneReplayedTomorrowIsRefused` |
| the chain no longer opens the webhook | sixteen — every request in the suite comes back `401` |
| `published` no longer implies a price | `aTierCannotBePublishedWithoutAPrice` |
| `price.updated` is not synced, only `price.created` | `andDoesNotRepublishATierSomebodyUnpublished` |

**Not verified: no Stripe account has ever sent one of these.** Every event in the suite is hand-built and
hand-signed with a fake secret — which is the right way round for our end of a published algorithm, but says
nothing about whether a real Price arrives shaped like these. That is
[#28](https://github.com/Shei254/marketplaats-extension/issues/28), a runbook, and step 1 of slice C in
[`docs/click-through.md`](../../docs/click-through.md).

## What can be bought

`GET /api/plans` ([#80](https://github.com/Shei254/marketplaats-extension/issues/80), T49): the published
tiers that carry a Stripe Price, each joined with what Stripe says it costs.

**Two halves, and neither module can see the other's.** What a tier grants is `catalog`'s and comes from our
table; the amount is `billing`'s and comes from Stripe. The join is in `display`, which is what that module is
for — a view over other modules' answers, put there because the alternative points a dependency the wrong way
(ADR-0014 keeps Stripe out of `catalog` entirely, and `catalog` never learns what anything costs).

**The cache is safe here for an unusual reason.** Stripe Prices are **immutable** (ADR-0019) — €9.99 never
becomes €11.99, a new Price is created and the tier repointed — so a cached amount for a given id cannot go
stale the way cached money usually does. What changes is *which* id a tier points at, and that is read from
our own table on every request, uncached. The TTL is therefore not about keeping a number true; it bounds how
long a mistake could go on being shown. **Failures are not cached**: a Stripe outage must cost a retry, not
fifteen minutes of "unavailable" for everybody.

**All of them or none of them.** One price that could not be fetched takes the whole answer with it — `503`,
empty body — rather than rendering the plans that did resolve. A plan screen is a *comparison*, and a buyer
cannot tell a plan that is missing from a plan that does not exist, which is a wrong picture of the offer at
the moment somebody is deciding what to pay for. An **empty list** is a different thing and is a `200`:
nothing is on sale, which is true of every stack whose Stripe Prices have not been created yet.

**No API key configured is the same answer as Stripe being down**, deliberately: the plan cards say
"unavailable, retry" rather than rendering an invented amount, and the application says so once at startup
because otherwise the only symptom is a screen that fails and a log that mentions nothing.

`PlansTest` drives the route over a real port with Stripe as a fake bean — the join, the exclusions and the
refusals. `StripePriceCacheTest` is the only thing here that talks to something Stripe-shaped: it serves
Stripe's own JSON on a loopback port and points the real client at it, because what is at risk is the field
mapping (`unit_amount` is not `amount`, the interval is nested under `recurring`) and a mocked SDK would pass
with every one of those upside down.

## Where a plan card becomes a payment

`POST /api/checkout` ([#29](https://github.com/Shei254/marketplaats-extension/issues/29), T19): a tier code
in, a Stripe Checkout URL out. The wire shape is
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md); what is here is why it is built the way
it is.

**You can only buy what the cards show.** The tier is resolved against `TierCatalog.published()` — the same
list `GET /api/plans` renders — rather than by a query of its own. "Published, and carrying a Price" is
therefore decided in exactly one place, and a draft synced at quota 0 before anybody said what it grants is
unbuyable *by construction* rather than by a second `where` clause remembering to say so.

**Two refusals, two statuses, and the difference is whether a retry helps.** `404` means nothing is on sale
under that code — which is what a client holding yesterday's plan cards gets, and is nobody's error. `503`
means Stripe could not be asked. Collapsing them would have a network blip tell a buyer that the plan they
were looking at no longer exists.

**Every session carries our own account id as `client_reference_id`.** That is the thread T20 (#30) pulls to
know whose subscription just started; the alternative is matching on an email address, which this application
deliberately does not hold ([#108](https://github.com/Shei254/marketplaats-extension/issues/108)). Nothing
else about the person is sent — Stripe collects what it needs itself.

**A returning subscriber is the same customer.** ADR-0018 has a cancellation drop somebody back to the free
tier with `stripe_customer_id` *kept*, precisely so resubscribing continues one billing history. So an
existing customer id is passed when we have one, which is what `Subscriptions.stripeCustomerFor` was added
for — a second question rather than a field on `Subscription`, because that record is read on the authorize
path and a Stripe id travelling there is a column a later reader could come to branch on.

**Which payment methods are offered is the Stripe account's setting, not a parameter here.** iDEAL and SEPA
for a Dutch marketplace (ADR-0006) are configured in the dashboard (T22, #28); naming them in code would mean
a deploy to add one, and a second answer beside the dashboard's.

`CheckoutSessionTest` asserts what we send Stripe against the bytes on the wire — a stub on a loopback port,
because `client_reference_id` is the whole of how money is traced back to an account and a mocked SDK would
accept it missing. `CheckoutTest` drives the route with **no Stripe configured**, which is what makes the
refusals testable: every one of them is decided before Stripe would be asked, and the unconfigured key
produces the one that is not. A `200` over a real port needs a live Stripe account and is the click-through's
(slice C, step 4).

## Where a payment becomes an entitlement

`POST /api/stripe/webhook` again, and the other half of what arrives there
([#30](https://github.com/Shei254/marketplaats-extension/issues/30), T20): `customer.subscription.created`,
`.updated` and `.deleted` become the plan somebody is on. **Nothing else in this application moves anybody
onto a paid tier.** A `200` from `POST /api/checkout` is an offer to pay; this is what happens when Stripe
says the money moved.

**The thread is our own id on the subscription, not on the session.** `OpenCheckout` writes
`subscription_data.metadata.app_user_id`, which Stripe copies onto the subscription it creates, so every
event about it names the account — the first one, and the cancellation three months later. The alternative
was `checkout.session.completed` and its `client_reference_id`, and it does not work on its own: that event
carries no status, no Price and no period, and Stripe usually sends it *after* the subscription was created,
so the mirror would need two events in an order nobody guarantees. `client_reference_id` stays on the session
because it is what the Stripe dashboard shows beside a payment.

**A terminal end falls back to the default tier**
([ADR-0018](../../docs/adr/0018-lapse-falls-back-to-the-default-tier.md)), and that is the decision this
ticket is arranged around rather than a detail of it:

| Stripe says | What the row becomes | Why |
|---|---|---|
| `active`, `trialing` | that tier, that status, Stripe's window | the ordinary case; a trial is mirrored with no special case anywhere |
| `past_due`, `unpaid`, `incomplete` | **the paid tier, kept**, and the status denied | dunning. Stripe is still retrying the card and a successful retry gives the tier straight back; taking it away mid-retry takes away something the next event returns |
| `canceled`, `incomplete_expired` | **the default tier**, `active`, our monthly roll, `stripe_subscription_id` cleared and `stripe_customer_id` kept | mirroring `canceled` onto a row still pointing at Pro leaves somebody who paid three months with strictly less than a stranger who never paid — the gate checks status before quota, so every relist would be `402` for ever |

So `SUBSCRIPTION_INACTIVE` means **a card that is currently failing** and nothing else. Somebody who ended
their subscription never sees it; they see the free tier's `QUOTA_EXCEEDED` and the plan cards.

**Order and repetition are one column, not a table of event ids.** `subscription.mirrored_through` holds the
`created` of the newest event applied to the row — Stripe's clock, because the order they arrive in is the one
not to be trusted — and an event older than that is not applied. Stripe delivers at least once and retries for
three days, so this is what stops Monday's cancellation from undoing Tuesday's resubscription. It also makes a
redelivery a no-op, which is what "idempotent on the event id" was asking for: the mirror is a statement of
the current state, so applying the newest one twice writes the same row twice. A log of ids would have added a
table nothing could tell the difference about, which is the precedent
[#41](https://github.com/Shei254/marketplaats-extension/issues/41) set. Equal timestamps **are** applied:
Stripe stamps whole seconds and a Checkout generates `created` and `updated` inside one of them, so refusing
them would leave a paid-up subscriber on whatever the first of the pair said.

**Whose row it is: the tag, then the customer.** The tag names an account directly, which is what makes a
purchase land whichever order the events arrive in. The customer id is the fallback, and is ours only once an
earlier event stored it — it is what finds a subscription created in the Stripe dashboard for somebody we
already bill. A third clause on `stripe_subscription_id` was left out rather than kept as a line no test could
tell the difference about: both ids are written in the same statement, so a row that knows a subscription
knows its customer. An event matching neither is a **`200` and a log line**, because one Stripe account can
serve more than one deployment and guessing would move a stranger's plan.

**Three things it refuses to guess**, each leaving the plan exactly as it was:

- **A status this application does not store.** Stripe adds statuses — `paused` is one nothing here asks for
  and could still arrive — and the column is held to seven by a check constraint, so the alternatives are
  inventing a status Stripe did not report or failing the write inside a webhook.
- **A Price no tier carries.** Somebody is paying for something this catalog does not sell, which is what a
  Price created without a `metadata.tier_code` tag and then sold looks like (ADR-0019). The tier is looked up
  **published or not**, because unpublishing stops new purchases and the people already on a tier keep
  renewing until they cancel.
- **An event with no billing period.** Neither shape of it — see below — leaves nothing to write rather than a
  window made up here.

**The period is read from the item first and the subscription second.** Stripe moved `current_period_start`
and `current_period_end` off the subscription and onto each of its items in the 2025 API versions, and the
pinned `stripe-java` has no accessor for the old place at all. Reading the event as a tree is what lets both
shapes work, and is the same argument the Price half makes: a typed model returns *nothing* when the API
version an event was created under differs from the one it was built against, which on a webhook is a silent
no-op.

**The window is Stripe's while they are paying and ours again afterwards.** `Subscriptions.currentFor` rolls a
free window that has closed and never a mirrored one (#20), so a payer's window only ever moves here — and the
fallback clears `stripe_subscription_id`, which is what puts it back on the roll anchored on the day the
account was provisioned rather than on the day they cancelled.

`StripeSubscriptionMirrorTest` drives this as a **lifecycle rather than as arranged rows**: every subscriber
in it signs in through `/api/me`, is put on their tier by the same event a completed Checkout produces, and is
then renewed, dunned, cancelled and resubscribed by the events Stripe sends for those. So a mirror that wrote
the right row from the wrong event has nowhere to hide. Two of the assertions go through `/authorize` rather
than reading the row — dunning is refused `402 SUBSCRIPTION_INACTIVE`, and a cancelled subscriber can still
relist — because "denied" and "not locked out" are things the gate decides, and a suite reading a status
column would be claiming them rather than showing them. One goes through `/api/me`, because the row is not the
product.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| subscription events not dispatched at all | eighteen — every lifecycle assertion in the suite |
| a cancellation mirrored as `canceled` on the paid tier | six, ending at `andTheyCanStillRelistOnTheFreeTierRatherThanBeingLockedOut` |
| dunning treated as an end | four, including `andTheGateRefusesThemWithTheCodeThatMeansAFailingCard` |
| `stripe_subscription_id` left in place on the fallback | `andTheirCustomerIsKeptWhileTheSubscriptionIsGone` |
| the ordering guard removed | `andAnEventThatHasBeenOvertakenIsNotApplied` |
| the guard refusing an equal timestamp too | `andOneStampedInTheSameSecondAsTheLastStillDoes` |
| the tag no longer written into the Checkout session | `CheckoutSessionTest.andTheSubscriptionItCreatesCarriesItToo` |
| the tag no longer read, only the customer | eighteen — a first purchase is a customer nothing here has stored yet |
| the customer no longer read, only the tag | `andOneWithNoTagIsFoundByTheCustomerItIsFor` |
| the period read only off the subscription | sixteen — the shape Stripe sends today is the item's |
| the window written the other way round | seventeen — `subscription_period_runs_forward` refuses every mirrored row |
| an unknown status mirrored as `active` | `aStatusStripeAddedLaterLeavesThePlanExactlyAsItWas` |
| a Price no tier carries falling back to the default tier | `aPriceNoTierCarriesGrantsNothing` |
| `tierSoldAs` filtered on `published` | `aTierTakenOffSaleStillGrantsWhatItsSubscribersBought` |

**Not verified: no Stripe account has ever sent one of these.** Every event in `StripeSubscriptionMirrorTest`
is hand-built and hand-signed, and the whole lifecycle it drives — bought, renewed, dunned, cancelled,
resubscribed — is this repository talking to itself. What a real subscription looks like is the
click-through's, slice C steps 5 to 8, and it needs [#28](https://github.com/Shei254/marketplaats-extension/issues/28)
first.

## Where somebody manages what they are paying

`POST /api/portal` ([#31](https://github.com/Shei254/marketplaats-extension/issues/31), T21): a token in, a
Stripe Customer Portal URL out. The popup opens it in a tab exactly as it opens a Checkout one.

**Nothing about billing is built here, and that is the decision rather than a shortcut.** ADR-0006 chose
Stripe for the hosted lifecycle and the Portal is the whole of it — payment methods, invoices, proration and
cancellation are pages Stripe serves and the dashboard configures. What this API contributes is the one thing
nobody else can: which Stripe customer the caller's token belongs to.

**The customer id is the whole of the question, and the subscription's status is never consulted.** That
column is on the row because Checkout put it there (#29) and the webhook keeps it there (#30) — including
through a cancellation, since ADR-0018 clears `stripe_subscription_id` and *keeps* `stripe_customer_id`. So
somebody who cancelled last month still reaches their invoices, and somebody in dunning still reaches the card
form, which matters because that person is the likeliest caller of all: the `402 SUBSCRIPTION_INACTIVE` copy
ADR-0018 asks for is "update your card" beside this very link. A status gate here would close the door on both
of the people most likely to knock.

**`404` is not an error.** An account Stripe holds no customer for has genuinely nothing to manage, which is
every free user who never bought anything — most accounts. It is separate from `503` for `/api/checkout`'s
reason: only one of the two is worth a retry, and telling a paying subscriber their billing does not exist
would be a support ticket. The likeliest `503` on a fresh stack is not an outage at all but a Stripe account
whose Portal has never been saved in the dashboard, which is why the exception's own message is logged rather
than a line of ours.

**Stripe returns the browser to `/billing`, a page of `apps/web`'s own.** Not `/success`, which congratulates
somebody on a payment: the commonest reason to be in the Portal is cancelling, and the page cannot know which
of the three things the visitor did — so it says the change is with Stripe, that the plan takes a moment to
catch up, and points at the toolbar.

**The three paths this module sends Stripe now live in one `WebPages`** — `/success`, `/cancel` and
`/billing` — with the trailing slash trimmed once rather than at each call site. Stripe holds the only other
copy of them, since they travel in an API call rather than in anything a client fetches, so `apps/web`'s
`routes.test.ts` reads `WebPages.java` out of the working tree and fails if a path here is one that site does
not answer. That is the same arrangement `packages/contracts` has with this application's enums, and it exists
because the symptom otherwise appears to somebody who has just paid.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the two refusals collapsed to one status | two, both `NothingToManage` cases in `PortalTest` |
| the session names no customer | `andItIsOpenedForTheirOwnStripeCustomer`, `nothingElseAboutThemIsSent` |
| the Portal returns a browser to the success page | `andStripeSendsThemBackToALoginlessPageOfOurOwn` (+1) |
| an account that never paid sent to Stripe anyway | four, across both suites |
| the trailing slash no longer trimmed | `aBaseUrlWithATrailingSlashDoesNotBecomeADoubleOne`, in both suites |
| the route declared a `GET` | five — every call in `PortalTest` that carries a token |
| only a live subscription names a customer (ADR-0018 undone) | three, including `andSoDoesSomebodyWhoCancelled` |
| `/billing` renamed in `apps/web` only | four, in that workspace's own suites |

**Not verified: no Customer Portal session has ever been opened against Stripe.** `PortalSessionTest` asserts
what we send against the bytes on a loopback stub, and `PortalTest` drives the route with **no Stripe
configured**, which is what makes both refusals testable — each is decided before Stripe would be asked. A
`200` over a real port needs a live account *with its Portal configured*, and that is the click-through's
(slice C, step 7).

## The catalog, as an operator works on it

`GET /api/admin/tiers`, `PUT /api/admin/tiers/{code}`, `PUT /api/admin/tiers/{code}/default` and
`GET /api/admin/prices` ([#84](https://github.com/Shei254/marketplaats-extension/issues/84), T53) — the CRUD
ADR-0014 deferred and [ADR-0019](../../docs/adr/0019-plans-are-stripe-first-and-webhook-synced.md)
un-deferred once iteration 1 had something to sell.

**Guarded by being where it is.** `OperatorsOnly` (#27) closes `/api/admin/**` on the realm's `ADMIN` role
before routing, so none of these handlers asks and none of them can forget to. That was the whole of #27 and
this is the ticket it was for.

**`admin` composes and owns nothing**, which makes it `display`'s counterpart for the other audience. The rows
are `catalog`'s, reached through a **third port** — `TierEdits`, beside the `TierCatalog` the gate reads and the
`PriceAdoptions` the webhook writes. Three ports rather than three methods on one, for the reason the first two
are already separate: the gate must not be able to write and the webhook must not be able to set a quota, so
being able to edit the catalog is a capability only the module behind the `ADMIN` role has. The Prices are
`billing`'s through `UnadoptedPrices`, which hands over our own records, so ADR-0014's "Stripe stays in one
module" holds here as everywhere else.

**The list is unfiltered, and that is the point.** `GET /api/plans` hides a draft — quota 0, unpublished,
created by the sync for a Price nobody has decided about — and hides the free tier, which has nothing to
charge against. Hiding them here too would leave an operator with no way to reach the one thing this screen
exists for. There is **no amount** on any row either: money is Stripe's, and an operator locked out of their
own catalog during a Stripe outage would be locked out of the one tool that could work around it.

**`isDefault` moves rather than toggling, and that is the design rather than an API style.** The catalog must
carry exactly one default: `TierCatalog.defaultTier()` throws when no row does and `ProvisionOnFirstLogin`
catches nothing, so a catalog with none takes down every new sign-in — and the operator who caused it would
see nothing wrong on their own screen. Written as `PUT …/{code}/default`, there is no request anybody can send
that leaves the catalog without one, so the invariant needs no refusal to defend it and no test to prove the
refusal works. The alternative — a boolean on the edit body, refused when it would clear the last one — is a
status, a message and a test, all to guard something that can simply be made unsayable. Two statements in one
transaction rather than `set is_default = (code = ?)`, because `tier_single_default` is a plain partial unique
index and is checked row by row as a statement proceeds.

**`409` is answered rather than thrown.** Publishing a tier with no Stripe Price is refused by
`V5__tier_publication.sql` whatever anybody does, which would arrive under the route as a
`DataIntegrityViolationException` — a `500` and a stack trace where what is wanted is a sentence telling an
operator to go and create a Price in Stripe. So the check is made before the update as well. That is the one
place in `TierRows` that duplicates a constraint, and the constraint stays: it is what makes the rule true of
every writer including this one.

**Lowering a quota under subscribers writes nothing to anybody's row.** What is left of a period is the grant
minus what has been spent, clamped at zero (`RemainingQuota`), so the arithmetic follows the edit by itself —
which is why there is no proration, no notification and nothing to undo. This resolves the last item under
"Open spikes" in [`docs/enforcement-contract.md`](../../docs/enforcement-contract.md).

**The unadopted Price list exists because the failure it reports is silent.** ADR-0019 names it in its own
consequences: a Price created without `metadata.tier_code` produces a plan screen without that plan and no
error anywhere. The list is uncached where its neighbour `CachedStripePrices` caches everything — that one
answers for an immutable Price on a display path, this one is asked by an operator seconds after they created
something, and a cache would answer "not yet" to somebody whose next move is to reload. It **lists and does
nothing**: Stripe accounts hold Prices for one-offs and experiments, and adopting is done by adding the tag in
Stripe, which fires `price.updated` and goes through the sync that already exists.

Mutation-verified — each applied, observed, reverted:

| Mutation | Fails |
|---|---|
| the tier routes moved out of `/api/admin` | twenty-three — every call in the suite that carries a token |
| the operator's list filtered on `published` | twelve, starting at `theListIsEveryTierThereIs` |
| the quota column dropped from the edit's `update` | four, including both quota-under-subscribers tests |
| publishing without a price left to the constraint | `butATierWithNoPriceCannotBePutOnSaleAtAll` |
| the default set without clearing the old one first | `theDefaultMovesRatherThanToggling` |
| a missing `published` or quota defaulted instead of refused | `anEditThatLeavesOutAFieldItCouldChangeIsNotOne` |
| the answer assembled from the request rather than read back | `andTheFlagsComeBackAsTheColumnHoldsThem` |
| a tagged Price listed as unadopted | `aPriceThatNamesATierIsNotUnadopted` (+1) |
| a blank `tier_code` treated as a tag | `andSoIsOneWhoseTagWasEmptied` |
| an unreachable Stripe answered as an empty list | three, across both suites |

**One mutation survived, and it took a clause out with it.** Sparing the new default from the clearing
statement — `where is_default and code <> :code` — turned out to be indistinguishable from clearing every row
and setting one, because re-setting the flag a statement later leaves exactly the same row. That is #41's
precedent, so the clause is gone rather than kept beside a test that cannot tell the difference.

**And one test survived long enough to prove the rule it was written beside.** `AdminTierTest`'s own setup
moved the default flag with a single `set is_default = (code = 'free')`, which is precisely the form
`makeDefault` avoids — and it failed with a duplicate key on `tier_single_default` the first time a test that
moves the flag happened to run before one that reads it. The setup now clears and then sets, like the code it
tests.

**One more, found the same way.** `AdminGuardTest` used `/api/admin/tiers` as its example of "a path nobody
has written yet", and this ticket wrote it — so that suite failed, correctly. It now names a path nothing is
planned for, which is the only version of that test that stays meaningful.

**Not verified: no operator has ever used any of this.** There is no screen — that is T54
([#85](https://github.com/Shei254/marketplaats-extension/issues/85)) — so every call in the suite is one this
repository made to itself with a hand-minted `ADMIN` token, and the unadopted Price list has never seen a real
Stripe account. Slice D's click-through is what walks it.

## Which build may call it

`X-Mprelist-Client: extension/0.0.1`, on every call, and a lever for the day a build must stop
([#52](https://github.com/Shei254/marketplaats-extension/issues/52), T43). The policy and the wire shape are
[`docs/enforcement-contract.md` § Which build is calling](../../docs/enforcement-contract.md#which-build-is-calling);
what is here is why the code looks the way it does.

**Built before it is needed, and that is the argument rather than an admission.** An extension release takes
days through a store review and cannot be forced onto anybody; this deploys in minutes. A lever added later
cannot reach the builds that predate it — so the header has to be in the first published release, or the
mechanism is useless for exactly the users it exists for.

- **An interceptor, not a filter**, so it runs *after* the security chain: a caller with no token is answered
  `401` first, and being signed out is not something updating fixes.
- **`/api/**` as a whole**, including routes no ticket has written yet. Not the Stripe webhook in any
  meaningful sense — Stripe sends no such header, and a request that names no release is never refused.
- **`426` with an empty body**, which is the contract's rule for a `4xx` that is not a denial. The reason
  codes are statements about the user; this is one about their software.
- **Absent and malformed are the same answer, and the answer is "served".** `apps/web` sends none yet, `curl`
  never will, and every extension built before this ticket cannot. Refusing what does not identify itself
  would turn a diagnostic into a gate on traffic it was never meant to judge.
- **The minimum ships as `0`** — every build there has ever been. It is the only value in `application.yml`
  that is not a decision, and raising it is one with a cost: every user who has not updated is stranded until
  Chrome gets to them.
- `CrossOriginCallers` allows the header, and that is load-bearing: a header the preflight does not allow is
  not dropped from the request, it makes the browser abandon the **whole call**. Forgetting it would break
  every request in order to carry a diagnostic.

`ClientVersionTest` sets the minimum to `1.2.0`, because a lever that is never pulled cannot be tested by
pulling nothing. It asserts both directions of the boundary — the minimum itself is served, `1.1.9` is not —
that a short version is the same release (`1.2` = `1.2.0`, Chrome's own rule), that a nameless or malformed
caller is served, that another surface's version is not the extension's, and that no token still means `401`
rather than `426`.

## The realm

`KeycloakRealmTest` and `KeycloakRealmWithoutAnExtensionIdTest` are the only places
[`infra/keycloak/mprelist-realm.json`](../../infra/keycloak/mprelist-realm.json) is exercised. They belong
here rather than in `infra/` because `infra/` has no test runner, and they will not be made redundant by
[#19](https://github.com/Shei254/marketplaats-extension/issues/19): that ticket validates tokens against
test-minted ones and never starts an IdP, so without this nothing in the repository would notice the realm
file breaking.

**Nothing here asserts a key of that JSON against itself.** Every test asks Keycloak — signs in, or is
refused — because a protocol mapper named right and configured wrong imports without complaint, and so does
an attribute Keycloak has since renamed. `KeycloakFromCompose` starts the image `infra/docker-compose.yml`
names, mounts the realm, and waits on the realm's own discovery document rather than on the container, so a
failed import is a startup failure and not twenty confusing ones. `signIn` then drives the whole
Authorization Code + PKCE flow — authorization request, Keycloak's login form, code exchanged with the
verifier — because the shortcut around it, a password grant, is one of the things the realm is supposed to
refuse.

Half of them are about a refusal being a refusal — no challenge, a `plain` one, a password grant, somebody
else's extension id, a login started as the API client. Two are about *how* Keycloak refuses, which is the
part a weaker assertion would miss: an unregistered redirect URI comes back as a 400 page and never as a
redirect, because the whole point is that Keycloak will not bounce a browser to a URI it does not already
trust, while a request it does trust is refused *through* that URI with an `error` parameter.

Three of the realm's promises are ones Keycloak does **not** default to, so each is a line in the file and a
test that spends something to prove it:

- **A redirect URI is registered exactly, not as a prefix.** ADR-0010 rules out the wildcard, and a
  host-scoped `.../*` survives the obvious test — the exact URI is still accepted — so the assertion has to
  ask for a path *beneath* the registered one and be refused. `post.logout.redirect.uris` is `"+"`, Keycloak's
  "whatever `redirectUris` holds", so the way out cannot drift from the way in; that takes a real sign-in per
  case, because a logout needs an `id_token_hint` and ends the session it was minted in.
- **Refresh tokens rotate.** `revokeRefreshToken` is off by default, which leaves every refresh token a
  session ever issued valid beside the one that replaced it — a copy read out of extension storage outliving
  the refresh that should have retired it. Nothing but spending the same token twice can tell.
- **A session outlives a sleeping MV3 worker.** Keycloak idles a session out after thirty minutes, which is
  shorter than the worker sleeps between one relist and the next; the on-demand refresh ADR-0010 chose then
  fails and [#32](https://github.com/Shei254/marketplaats-extension/issues/32) has to re-run
  `launchWebAuthFlow`, interactively. The test reads the refresh token's own `exp - iat`, which is where a
  realm setting is actually felt — **to the minute, not to the second**
  ([#116](https://github.com/Shei254/marketplaats-extension/issues/116)). Those two claims do not come from
  one clock reading: `exp` is the *session's* start plus `ssoSessionMaxLifespan` and `iat` is when the token
  was minted, so a runner slow enough to cross a second boundary reported `719H59M59S` and failed a pull
  request that had touched neither. The tolerance is far outside that race and far inside what it catches —
  drop either setting and Keycloak's own defaults are thirty minutes and ten hours.

The two dev users exist to cover the **two token shapes** a real user can produce, which one user cannot.
`dev` holds no realm role, so Keycloak omits `realm_access` rather than sending it empty — the edge
[#27](https://github.com/Shei254/marketplaats-extension/issues/27)'s role check has to survive. `dev-admin`
holds `default-roles-mprelist` beside `ADMIN`, which every user made through the console or a registration
form holds and an *imported* one otherwise does not: those default roles carry `account`'s client roles, so
its `aud` is an **array** where `dev`'s is a bare string. A resource server that compares `aud` as one string
passes against `dev` and fails against the first real user, so both shapes are in the realm on purpose.

`KeycloakRealmWithoutAnExtensionIdTest` is the same realm imported with `MPRELIST_EXTENSION_ID` **unset**,
which until [#13](https://github.com/Shei254/marketplaats-extension/issues/13) pins an id is what every
developer gets. It is a second container rather than a second test because the suite above always sets the
variable, and from there a realm that refused to import, one that registered the literal
`${MPRELIST_EXTENSION_ID:unset-extension-id}` unsubstituted, and one that fell back correctly are
indistinguishable. It asserts both halves of what [`infra/README.md`](../../infra/README.md) promises: the
fallback URI is registered, and a real extension's is refused with `Invalid parameter: redirect_uri`.

Two tests leave this project entirely, because everything else is proven on a container this suite starts and
that says nothing about the local stack ever reading the file. `andTheLocalStackImportsTheRealmThisSuiteProves`
reads `docker-compose.yml` for the `--import-realm` flag and the `./keycloak` mount.
`andPassesTheExtensionIdThroughWithoutGivingItAValue` reads it for the subtler half of the fallback above: an
unset shell has to arrive at the import as an *unset* variable, and `MPRELIST_EXTENSION_ID: ""` would define
it empty — the realm's own default would not apply and the client would register `https://.chromiumapp.org/`,
a URI with no host, which imports without complaint and refuses every sign-in.

Both `infra/` files are declared as inputs of the `test` task in `build.gradle.kts`. Gradle cannot see a file
that is read at test time rather than compiled in, so without that an edit to the realm leaves `test`
`UP-TO-DATE` and the previous run's verdict standing — a green suite that never looked at the change. That
was found the way it sounds: by editing the realm and being told it passed. `InfraFiles` is where the Java
side names those paths; Gradle cannot read a Java constant and its `inputs.files` has to resolve at
configuration time, so that list is the one copy which has to be kept in step by hand.

Mutation-verified — each applied to the realm (or to compose), observed, reverted:

| Mutation | Fails |
|---|---|
| the extension client loses `pkce.code.challenge.method` | `pkceIsRequiredOfTheExtensionRatherThanMerelyOfferedToIt`, `andPlainIsNotGoodEnoughForIt` |
| …or keeps it as `plain` | `andPlainIsNotGoodEnoughForIt` (+5 — an `S256` sign-in is then refused outright) |
| the audience mapper is deleted | `aTokenTheExtensionMintsNamesTheApiAsItsAudience` |
| the extension is made a confidential client | `theRealmIsImportedUnderTheNameTheIssuerCarries` (+4) |
| either user-facing client gains `directAccessGrantsEnabled` | `neitherClientAcceptsAPasswordGrant` |
| the redirect URI is hardcoded to another extension's id | `theExtensionRedirectUriIsBuiltFromTheExtensionIdTheImportWasGiven` (+6) |
| `webOrigins` is emptied | `andTheWebOriginIsTheExtensionItself` |
| the dashboard client is removed | `andTheDashboardIsHeldToTheSameRequirement`, `neitherClientAcceptsAPasswordGrant` |
| `dev-admin` loses its `realmRoles` | `andCarriesTheAdminRoleForAnOperatorWhoHasIt` |
| …or keeps `ADMIN` and loses only `default-roles-mprelist` | `andIsAListAsSoonAsItsUserHoldsTheRealmsDefaultRoles` |
| `mprelist-api` gains the standard flow **and a redirect URI** | `noBrowserLoginCanBeStartedAsTheApiClient` |
| the extension's redirect URI regrows a trailing `/*` | `andRegisteredExactlyRatherThanAsAPrefixOverEverythingBeneathIt`, and `andALogoutReturnsOnlyWhereASignInWouldHave` with it — which is `"+"` doing its job |
| …or the dashboard's does | `asIsTheDashboardsOwn` |
| `post.logout.redirect.uris` is the URI spelled a second time, wildcarded, instead of `"+"` | `andALogoutReturnsOnlyWhereASignInWouldHave` |
| `revokeRefreshToken` is dropped, or `refreshTokenMaxReuse` becomes `1` | `aRefreshTokenIsSpentByTheRefreshThatUsesIt` |
| the `ssoSession*` timeouts are dropped | `andOutlivesAnMv3WorkerThatSleptBetweenCalls` |
| the realm file's `${MPRELIST_EXTENSION_ID:unset-extension-id}` **default** is dropped | `KeycloakRealmWithoutAnExtensionIdTest` never starts: with the variable unset the realm no longer imports at all |
| `docker-compose.yml` loses `--import-realm` | `andTheLocalStackImportsTheRealmThisSuiteProves` |
| …or gives `MPRELIST_EXTENSION_ID` an empty value | `andPassesTheExtensionIdThroughWithoutGivingItAValue` |

Two mutations survive and are left surviving:

- Giving `mprelist-api` `standardFlowEnabled: true` while it still registers no redirect URI. Keycloak
  refuses every authorization request either way — with no URI registered there is none it will bounce a
  browser to — so the flag alone changes nothing observable, and the row above is the version of that
  mutation which does. A test that failed on it would be asserting the field rather than the promise.
- Deleting `accessTokenLifespan`, because five minutes is also Keycloak's default.
  `whileTheAccessTokenStaysAsShortLivedAsRevocationNeeds` is kept anyway: the image tag comes from compose,
  so the day that default moves under an upgrade, this suite runs on the new version and says so. Its
  subject is the revocation window ADR-0010 agreed to live with, not the line in the file.

## The one env file

`cp .env.example .env`, from the repository root, and everything that runs anything reads it: `bootRun` and
`test` here, and the local stack through `docker compose --env-file .env`. One file, because the alternative
is what this repository had — an `export` in whichever terminal you happened to be in, a second one for the
stack, and a click-through script that tells you to do both.

**The shell wins over the file.** `build.gradle.kts` drops any variable that is already set before handing
the rest to the task, which is what `docker compose --env-file` does with the same file — so a one-off
`MPRELIST_STRIPE_SECRET_KEY= ./gradlew bootRun` is still one line rather than an edit and an undo.

**A test JVM gets it too, and that is why two suites now pin what they are about.** Gradle's test workers
have always inherited the daemon's environment, so a developer who had exported a Stripe key to walk slice C
was already running `CheckoutTest` against a real Stripe account — the suite whose whole subject is what
happens when there is no key. `.env` would have made that routine instead of occasional, so both suites say
it as a property:

| Suite | Pins | Because |
|---|---|---|
| `CheckoutTest` | `mprelist.stripe.secret-key=` | every refusal in it is decided *before* Stripe would be asked, and `aPlanOnSaleGetsAsFarAsStripe` would otherwise open a live Checkout session |
| `StripeWithoutAWebhookSecretTest` | `mprelist.stripe.webhook-secret=` | its two claims are about an application that has none, and an unsigned event is refused either way — so it would have passed for the wrong reason |

Nothing else in the suite reads a credential: the Stripe suites either replace `StripePrices` with a bean or
point a real client at a loopback stub, and every container the tests need they start themselves.

**`EnvironmentFileTest` holds the committed example to the application.** An example env file is the kind of
thing that goes stale silently — a setting arrives, nobody adds a line, and the person who finds out is
whoever spends an afternoon on a stack that signs nobody in — so the two directions are asserted, along with
the rule that costs a `down -v` when it is broken:

| Mutation | Fails |
|---|---|
| a setting `application.yml` reads is missing from the example | `everySettingTheApiTakesFromTheEnvironmentIsNamedInTheExample` |
| a variable compose passes through to Keycloak is missing | `andSoIsEverythingTheStackPassesThroughToKeycloak` |
| the example keeps a `MPRELIST_` variable nothing reads any more | `andNothingInItIsReadByNobody` |
| the extension id in the example goes stale against the manifest key | `theExtensionIdItSuggestsIsTheOneThisApiDefaultsTo` |
| a variable the realm substitutes ships as an **empty** assignment | `nothingTheRealmSubstitutesShipsAsAnEmptyValue` |
| somebody's own key is pasted into the example | `andNoRealSecretIsCommittedInIt` |
| `.env` stops being gitignored | `theFileItIsAnExampleOfIsNeverCommitted` |

That fifth row is the expensive one. Compose hands an empty assignment to Keycloak as a variable that is
*defined and empty*, and a realm file's `${MPRELIST_SMTP_HOST:sandbox.smtp.mailtrap.io}` default applies only
where the variable is **absent** — so `MPRELIST_SMTP_HOST=` means "no mail host", and the same line for the
extension id means a realm registering `chrome-extension:///`, imported once and undone only by dropping the
volume. Anything you have no value for is commented out in that file, and the test is what keeps it so.

## Versions, and where they are stated

- **Java 21** ([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)) as a Gradle *toolchain*, not as
  source/target compatibility: the compiler is 21 on every machine, so a newer local JDK cannot quietly
  compile against its own API. `settings.gradle.kts` applies the foojay resolver, which downloads a JDK 21 on
  a machine that has none — otherwise this build would fail for most people's default JDK.
- **Gradle 9.7.0**, via the committed wrapper, pinned by `distributionSha256Sum`.
- **Spring Boot 4.1.0**, stated once, in the `plugins` block; every Spring dependency takes its version from
  Boot's BOM. Boot's BOM manages neither Spring Modulith nor Stripe, so **2.1.0** and **stripe-java 29.2.0**
  are the two versions pinned by hand. Flyway and Testcontainers it does manage, so neither is stated here or
  anywhere else — and the Postgres *image* is not a version either, since it is read from
  `infra/docker-compose.yml`.
- Boot 4 splits auto-configuration into per-technology modules, which is why the Flyway dependency is
  `spring-boot-starter-flyway` and not `flyway-core`: the latter would put Flyway on the classpath and leave
  nothing to run it, and an application that quietly migrates nothing starts perfectly well.
- Security is `spring-boot-starter-security-oauth2-resource-server`, not the shorter
  `spring-boot-starter-oauth2-resource-server`: same jars, but the shorter name's own POM says it is
  deprecated in favour of this one, so taking it would mean moving on the release that drops it. There is no
  OAuth2 *client* starter beside it — this application only ever validates a token somebody else obtained,
  and obtaining one is the extension's ([#32](https://github.com/Shei254/marketplaats-extension/issues/32))
  and the dashboard's ([#42](https://github.com/Shei254/marketplaats-extension/issues/42)), both in a browser.

## Not here yet

**The rest of the endpoints** of [`docs/enforcement-contract.md`](../../docs/enforcement-contract.md):
`GET /api/client-config` ([#36](https://github.com/Shei254/marketplaats-extension/issues/36)), which is the
next route to test whether `UnreadableRequests`' scope was worth naming.

**Client-side pacing and jitter** ([#54](https://github.com/Shei254/marketplaats-extension/issues/54)). The
rails above refuse a relist that came too soon; making one *arrive* at a human-shaped moment is the
extension's, and there is no jitter anywhere today — only serialisation.

**What a tier costs.** `TierCatalog` answers what a tier grants and what it is called, and since
[#82](https://github.com/Shei254/marketplaats-extension/issues/82) a tier can carry the `stripe_price_id` a
Stripe Price landed on it — but nothing here reads an *amount*. That is
[#80](https://github.com/Shei254/marketplaats-extension/issues/80)'s `GET /api/plans`, which joins each
published tier with its Price and caches what Stripe says, and
[#29](https://github.com/Shei254/marketplaats-extension/issues/29)'s Checkout session, which is what a price
id is finally spent on. No tier carries one on any machine until
[#28](https://github.com/Shei254/marketplaats-extension/issues/28) creates the Prices in the dashboard by
hand — the sync has nothing to hear about until it does.

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI runs `./gradlew` here in a job of its own that no npm job waits for
([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), T59). It runs `./gradlew build` rather than
`test`: the same suite, and then the boot jar T55 deploys. Both are covered in
[../../README.md](../../README.md#working-on-it).
