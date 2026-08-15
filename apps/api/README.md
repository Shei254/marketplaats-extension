# `apps/api` — Spring Boot API

Five modules and the build-time check that makes them mean something, the schema they will fill, the tier
catalog seeded into it, the resource server every route is now closed behind, the account and subscription a
first sign-in leaves behind, and the tests that hold `infra/`'s Keycloak realm to what it promises. Still no
endpoint of its own — those arrive with the tickets named below.

```bash
cd apps/api
./gradlew test      # 83 tests: the module boundary, the schema and catalog on a real Postgres, the realm,
                    #           which tokens get past the resource server, and what first login provisions
./gradlew build     # the above, plus the executable jar
./gradlew bootRun   # http://localhost:8080 — 401 without a token and 404 with one, bar the open route below
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

## The modules

Each is a direct sub-package of `com.mprelist`, which is what makes it an application module
([ADR-0012](../../docs/adr/0012-backend-modular-monolith.md)).

| Module | Owns | Fills with |
|---|---|---|
| `identity` | who the caller is: `CurrentUser`, and `UserRef` for the account behind them | [#19](https://github.com/Shei254/marketplaats-extension/issues/19) — [below](#the-resource-server) — and [#20](https://github.com/Shei254/marketplaats-extension/issues/20) — [below](#first-login) |
| `catalog` | Tier → Entitlement, from our table, no Stripe | `TierId` and `defaultTier()` with [#20](https://github.com/Shei254/marketplaats-extension/issues/20); `Entitlement` with [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| `subscription` | the mirror of Stripe's status and period | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) provisions the first one, [#30](https://github.com/Shei254/marketplaats-extension/issues/30) mirrors Stripe into it |
| `enforcement` | `authorize` / `complete`, the gate | [#22](https://github.com/Shei254/marketplaats-extension/issues/22), [#23](https://github.com/Shei254/marketplaats-extension/issues/23) |
| `admin` | operator endpoints behind the `ADMIN` role | [#27](https://github.com/Shei254/marketplaats-extension/issues/27) |

`enforcement` and `admin` hold a single `package-info.java` carrying `@ApplicationModule` and nothing else.
The annotation is not decoration: an empty package compiles to no class file at all, and a module Spring
Modulith cannot see is a module it does not check. `allFiveModulesAreVisibleToTheCheck` is the test that says
so.

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

> If startup fails with **`Migration checksum mismatch for migration version 1`**, your Postgres volume
> predates the rename `keycloak_subject` → `idp_subject` in [#17](https://github.com/Shei254/marketplaats-extension/issues/17),
> which edited `V1` after some machines had run it. `docker compose -f infra/docker-compose.yml down -v`
> and start again: `V1` has been applied to no deployed environment, so a dropped local volume is the
> whole of the cost. It is also the rule above, demonstrated.

| Table | Holds | Filled by |
|---|---|---|
| `app_user` | one row per human, keyed to the IdP `sub` (Keycloak's, today) | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) — [below](#first-login) |
| `tier` | our catalog: quota, max MP accounts, feature flags, nullable `stripe_price_id` | seeded by [#18](https://github.com/Shei254/marketplaats-extension/issues/18), read by [#20](https://github.com/Shei254/marketplaats-extension/issues/20) and [#21](https://github.com/Shei254/marketplaats-extension/issues/21) |
| `subscription` | the mirror: user, tier, normalized status, period, Stripe ids | [#20](https://github.com/Shei254/marketplaats-extension/issues/20) writes the first row, [#30](https://github.com/Shei254/marketplaats-extension/issues/30) keeps it in step with Stripe |
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
| …and at least one | not the schema's to hold — [first login](#first-login) provisions it in the transaction that creates the user | `aCatalogWithNoDefaultTierProvisionsNobodyAtAll` |
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

## The resource server

A Keycloak access token is the only way in (ADR-0005), and **every route is closed until one arrives** —
`anyRequest().authenticated()`, deliberately not scoped to `/api/**`, so a route a later ticket adds is shut
until that ticket opens it rather than open until somebody notices. This ticket adds no route of its own:
`identity` answers no request, it decides who is asking.

Two files hold it, both in `identity/internal` because everything that knows how Keycloak spells a claim is an
adapter ADR-0012 wants replaceable:

| Class | Holds |
|---|---|
| `ResourceServerSecurity` | the filter chain, the realm-role → authority conversion, and the `401` body |
| `CurrentUserFromToken` | the argument resolver that makes `CurrentUser` a parameter any controller can declare |

`CurrentUser` — the module's public API, and for now the whole of it — carries the token's `sub` and nothing
else. `UserRef` waits for [#20](https://github.com/Shei254/marketplaats-extension/issues/20), which is what
first provisions the `app_user` row such a reference would name. Roles are deliberately not a field on it:
they become Spring Security authorities (`ADMIN` → `ROLE_ADMIN`), because the only thing that reads them is a
declarative guard on a route ([#27](https://github.com/Shei254/marketplaats-extension/issues/27)'s
`hasRole('ADMIN')`), and a second copy is a second thing that can disagree with the one the guard consults.

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
is where that is held.

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

The Tier → Entitlement resolution that reads the catalog above
([#21](https://github.com/Shei254/marketplaats-extension/issues/21)), and the endpoints of
[`docs/enforcement-contract.md`](../../docs/enforcement-contract.md)
([#22](https://github.com/Shei254/marketplaats-extension/issues/22),
[#23](https://github.com/Shei254/marketplaats-extension/issues/23),
[#26](https://github.com/Shei254/marketplaats-extension/issues/26)).

Gradle, not npm, and so deliberately **not** an npm workspace — the root scripts skip a directory with no
`package.json`, and CI will run `./gradlew` here separately once this repo has CI. Both are covered in
[../../README.md](../../README.md#working-on-it).
