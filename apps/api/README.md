# `apps/api` — Spring Boot API

Five modules and the build-time check that makes them mean something, the schema they fill, the tier catalog
seeded into it and what each of its tiers grants, the resource server every route is closed behind, the
account and subscription a first sign-in leaves behind, and the tests that hold `infra/`'s Keycloak realm to
what it promises. Two endpoints so far — `POST /api/relist/authorize` and `POST /api/relist/complete`, the
two ends of the gate — plus the scheduled reconciliation that gives back the units nobody ever reports on,
with the rest arriving on the tickets named below.

```bash
cd apps/api
./gradlew test      # 157 tests: the module boundary, the schema and catalog on a real Postgres, the realm,
                    #            which tokens get past the resource server, what first login provisions, what
                    #            a tier grants whoever is on it, who may relist and what it costs them, what
                    #            the extension reporting back settles or gives them back, and what becomes of
                    #            the relists it never reports on at all
./gradlew build     # the above, plus the executable jar
./gradlew bootRun   # http://localhost:8080 — 401 without a token, and the gate below with one
```

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
> VM. It is a property of the daemon, not of this project, so it belongs in your shell rather than in a file
> here — where it would then be wrong for everyone running a plain Docker Engine.

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
> Nothing in this repository can move that address, and the one change that would paper over it —
> `sslRequired: none` in the realm — is the one
> [#15](https://github.com/Shei254/marketplaats-extension/issues/15) deliberately did not make, because it
> would be wrong in every environment except a laptop. It is the daemon that has to be put back.
>
> **The address is not the whole story**, observed while running #21: the reproduction above answered `403`,
> and then `200` thirteen minutes later with nothing changed and no daemon restart, on a host where an
> `nginx` container in between logged the host's own requests as arriving from `192.168.65.1` — site-local,
> which by the paragraph above should always have worked. So treat "which address" as a symptom rather than
> the cause, and **re-run before concluding anything**: what is known is that it flaps on one daemon within
> minutes. The mechanism is still unexplained, and the harness fix #15's own notes propose —
> `KC_PROXY_HEADERS=xforwarded` on the container plus `X-Forwarded-Proto: https` on the wait strategy and on
> `KeycloakFromCompose`'s requests — would make the suites independent of it either way.

## The modules

Each is a direct sub-package of `com.mprelist`, which is what makes it an application module
([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)).

| Module | Owns | Fills with |
|---|---|---|
| `identity` | who the caller is: `CurrentUser`, and `UserRef` for the account behind them | [#19](https://github.com/Shei254/marketplaats-extension/issues/19) — [below](#the-resource-server) — and [#20](https://github.com/Shei254/marketplaats-extension/issues/20) — [below](#first-login) |
| `catalog` | Tier → Entitlement, from our table, no Stripe | `TierId` and `defaultTier()` with [#20](https://github.com/Shei254/marketplaats-extension/issues/20), `Entitlement` with [#21](https://github.com/Shei254/marketplaats-extension/issues/21) — [below](#what-a-tier-grants) |
| `subscription` | the mirror of Stripe's status and period | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) provisions the first one, [#22](https://github.com/Shei254/marketplaats-extension/issues/22) reads and rolls its window — [below](#the-gate) — and [#30](https://github.com/Shei254/marketplaats-extension/issues/30) mirrors Stripe into it |
| `enforcement` | `authorize` / `complete`, the gate, and the reconciliation behind it | [#22](https://github.com/Shei254/marketplaats-extension/issues/22) — [below](#the-gate) — [#23](https://github.com/Shei254/marketplaats-extension/issues/23) — [below](#what-the-extension-reports-back) — and [#24](https://github.com/Shei254/marketplaats-extension/issues/24) — [below](#what-nobody-ever-reports-back) |
| `admin` | operator endpoints behind the `ADMIN` role | [#27](https://github.com/Shei254/marketplaats-extension/issues/27) |

`admin` still holds a single `package-info.java` carrying `@ApplicationModule` and nothing else. The annotation
is not decoration: an empty package compiles to no class file at all, and a module Spring Modulith cannot see
is a module it does not check. `allFiveModulesAreVisibleToTheCheck` is the test that says so.

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
| `catalog`'s `package-info` loses `@ApplicationModule` | `allFiveModulesAreVisibleToTheCheck` |

## The schema

`src/main/resources/db/migration/V1__baseline_schema.sql`, applied by Flyway on startup: the five tables
[`docs/domain-model.md`](../../docs/domain-model.md) calls backend-owned, and nothing else. Flyway checksums
what it has already applied, so a correction to that file once it has run anywhere is a new `V2` — never an
edit to `V1`.

Two migrations follow it, each named for what it adds rather than for the ticket that wanted it:
`V2__seed_tier_catalog.sql` (the catalog, below) and `V3__index_abandoned_reservations.sql` (the index #24's
sweep reads — see [What nobody ever reports back](#what-nobody-ever-reports-back)).

> If startup fails with **`Migration checksum mismatch for migration version 1`**, your Postgres volume
> predates the rename `keycloak_subject` → `idp_subject` in [#17](https://github.com/Shei254/marketplaats-extension/issues/17),
> which edited `V1` after some machines had run it. `docker compose -f infra/docker-compose.yml down -v`
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
two windows. And a number per period is not a number per minute: a month's quota spent in one is what
[#25](https://github.com/Shei254/marketplaats-extension/issues/25)'s SafetyPolicy refuses, and nothing here
paces anything.

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

**Not here, and each named where it goes.** #25's SafetyPolicy check has its place in `RelistGate` marked, in
the one position that is right: after the quota, so a user with nothing left is told so rather than told to
wait, and before the reservation, so a refusal does not cost the unit it refused. ADR-0012 also sketches an
`enforcement/domain` package for pure decision logic; there is none, because the decision is a status and two
numbers the same method has just read, and the ticket that gives it a second reader is the one that should
create it.

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
with two readers — the refusal in `RelistGate` and the answer here, with #26's `/api/me` to come — because two
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
| `Quotas` | `enforcement/internal` | the same walk the gate takes, so both answer from one pair of reads |
| `RemainingQuota` | `enforcement/internal` | what is left of a period, for the gate and for this |
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
  realm setting is actually felt.

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
- Security is `spring-boot-starter-security-oauth2-resource-server`, not the shorter
  `spring-boot-starter-oauth2-resource-server`: same jars, but the shorter name's own POM says it is
  deprecated in favour of this one, so taking it would mean moving on the release that drops it. There is no
  OAuth2 *client* starter beside it — this application only ever validates a token somebody else obtained,
  and obtaining one is the extension's ([#32](https://github.com/Shei254/marketplaats-extension/issues/32))
  and the dashboard's ([#42](https://github.com/Shei254/marketplaats-extension/issues/42)), both in a browser.

## Not here yet

**The rest of the endpoints** of [`docs/enforcement-contract.md`](../../docs/enforcement-contract.md):
`GET /api/me` ([#26](https://github.com/Shei254/marketplaats-extension/issues/26)), the display state both
clients read after signing in — and the first call from outside `enforcement` that will need a
`quotaRemaining`, which is counted from the `usage_reservation` table and nowhere else, so `RemainingQuota` is
what leaves `internal` on that ticket; and `GET /api/client-config`
([#36](https://github.com/Shei254/marketplaats-extension/issues/36)).

**The SafetyPolicy check** ([#25](https://github.com/Shei254/marketplaats-extension/issues/25)), whose place
in the order the gate marks. A quota is a number per period and not a number per minute, so a month's worth
spent in one is refused by nothing here today.

**What a tier is called, and what it costs.** `TierCatalog` answers what a tier grants and nothing about how
to show or sell it: the display name arrives with
[#26](https://github.com/Shei254/marketplaats-extension/issues/26), which has a caller to render it to, and
`stripe_price_id` with [#29](https://github.com/Shei254/marketplaats-extension/issues/29), which opens the
Checkout session that needs it — no tier carries one until
[#28](https://github.com/Shei254/marketplaats-extension/issues/28) creates the Prices by hand.

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI will run `./gradlew` here separately once this repo has CI. Both are covered in
[../../README.md](../../README.md#working-on-it).
