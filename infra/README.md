# `infra` — local stack

Postgres and Keycloak, the two services the API needs to run at all
([ADR-0009](../docs/adr/0009-tech-stack.md), [ADR-0011](../docs/adr/0011-repository-layout.md)). One command,
from the repo root — `-f` resolves against the working directory, so run it there or pass an absolute path:

```bash
docker compose -f infra/docker-compose.yml up -d --wait
```

`--wait` returns only once both containers report healthy — Keycloak's own `/health/ready`, not merely a
listening port. First start takes about a minute while Keycloak creates its schema; later starts, under
half that.

```bash
docker compose -f infra/docker-compose.yml ps        # what is running, and its health
docker compose -f infra/docker-compose.yml logs -f   # follow both services
docker compose -f infra/docker-compose.yml down      # stop, keeping the data
```

## What you get

| | Where | Credentials |
|---|---|---|
| App database | `postgres://localhost:5432/mprelist` | `mprelist` / `mprelist` |
| Keycloak | http://localhost:8081 | admin console `admin` / `admin` |
| Keycloak's database | `postgres://localhost:5432/keycloak` | `keycloak` / `keycloak` |
| The `mprelist` realm | http://localhost:8081/realms/mprelist | `dev` / `dev`, `dev-admin` / `dev-admin` |

**Development only.** Every credential is a well-known default, committed on purpose so that the stack needs
no setup step before it runs. Nothing here is fit to deploy: `start-dev` turns off TLS and hostname
strictness, and the bootstrap admin is exactly the account a real deployment must not have.

**Keycloak is on 8081, not 8080**, because 8080 is Spring Boot's default and `apps/api`
([#16 (T07 · Spring Boot skeleton with enforced module boundaries)](https://github.com/Shei254/marketplaats-extension/issues/16))
runs on the host. `KC_HOSTNAME` pins the issuer to `http://localhost:8081`, so the OIDC discovery document,
the tokens Keycloak mints, and the issuer the resource server
([#19 (T10 · OAuth2 resource server + `identity` module)](https://github.com/Shei254/marketplaats-extension/issues/19))
validates all agree:

```bash
curl -s http://localhost:8081/realms/mprelist/.well-known/openid-configuration | jq .issuer
```

**Keycloak stores its state in Postgres**, in its own `keycloak` database — not the dev-mode embedded H2, and
not alongside the application's tables. Two schema managers in one database is the thing to avoid: Flyway
([#17 (T08 · Flyway schema)](https://github.com/Shei254/marketplaats-extension/issues/17)) owns `mprelist`,
Keycloak migrates its own. Both databases live in the one instance, which is one container to run and one
volume to drop.

## Resetting

```bash
docker compose -f infra/docker-compose.yml down -v   # -v also drops the data
```

Keep `-v` in mind when editing [`postgres/init/`](postgres/init) **or [`keycloak/`](keycloak)**: the Postgres
image runs its init scripts exactly once, on an empty data directory, and Keycloak imports a realm exactly
once, when that realm does not already exist. Neither is an error the second time — the file simply never
applies, and the change appears not to have taken.

## The realm

[`keycloak/mprelist-realm.json`](keycloak/mprelist-realm.json) is imported on first start, and it is the only
description of the realm there is: nothing here was clicked into the admin console, and anything clicked into
it is gone at the next `down -v`. Three clients and one role
([ADR-0005](../docs/adr/0005-identity-and-auth.md), [ADR-0010](../docs/adr/0010-extension-authentication.md)):

| Client | What it is | Used by |
|---|---|---|
| `mprelist-extension` | public, Authorization Code + **PKCE required**, redirects to `https://<extension-id>.chromiumapp.org/*` | [#32 (T23 · PKCE sign-in)](https://github.com/Shei254/marketplaats-extension/issues/32) |
| `mprelist-dashboard` | public, PKCE required, redirects to `http://localhost:5173/*` — Vite's default, [#42 (T33)](https://github.com/Shei254/marketplaats-extension/issues/42)'s to change if the tooling differs | [#42](https://github.com/Shei254/marketplaats-extension/issues/42) |
| `mprelist-api` | starts no flow and holds no session; it exists to be the `aud` the other two put in their tokens | [#19 (T10 · resource server)](https://github.com/Shei254/marketplaats-extension/issues/19) |

Both user-facing clients **refuse the password grant**: ADR-0010 chose code + PKCE, and a public client that
also takes a password offers a second, weaker way in that neither client would ever use. Both carry an
audience mapper naming `mprelist-api`, which is what gives the resource server something to check beyond the
issuer — every client in the realm shares that.

The `ADMIN` realm role is defined and held by `dev-admin`, for
[#27 (T18 · `admin` module + role guard)](https://github.com/Shei254/marketplaats-extension/issues/27). Note
that `dev`, who has no roles, gets **no `realm_access` claim at all** rather than an empty one — a role check
that reads `realm_access.roles` straight through fails on every ordinary user.

### Your extension id

The redirect URI needs an extension id, and this repository does not know one:
[ADR-0010 § Obtaining the extension ID](../docs/adr/0010-extension-authentication.md) leaves that to
[#13 (T44 · Pin the extension ID)](https://github.com/Shei254/marketplaats-extension/issues/13), and until
then an unpacked extension's id is derived from its absolute path and so differs per developer. So the realm
takes it from the environment at import time:

```bash
MPRELIST_EXTENSION_ID=<your 32-character id> docker compose -f infra/docker-compose.yml up -d --wait
```

Unset, it falls back to the literal `unset-extension-id`, which is a valid URI and will never match a real
flow — the realm imports, and sign-in from a real extension is refused with `Invalid parameter: redirect_uri`
rather than silently bouncing a code somewhere. Because the import runs once, changing the variable means
`down -v` first. A wildcard would avoid all of this; ADR-0010 says not to, and a realm file that grew one for
convenience is the one that gets copied to a deployed realm.

### No `sslRequired`, deliberately

The file does not set it, so the realm keeps Keycloak's default of `external`: plain HTTP is served to a
client address Keycloak considers local — which includes every private range — and refused to anything else.
Through Docker's published port a request from the host arrives from exactly such an address, so the whole
flow works over `http://localhost:8081` with the default left alone. That is not a guess: the realm as it
stands was imported into the stack and signed into from the host, discovery through token.

**`sslRequired: none` is what a dev realm reaches for here, and it is deliberately absent.** It is the one
field that would be wrong everywhere except a laptop, and the file it is added to for convenience is the file
that later gets copied to a deployed realm. If a machine ever does answer `HTTPS required` — reaching
Keycloak across a network rather than from the host would do it, and there the refusal is *correct* — the
answer is to serve it over TLS or to reach it from the host, not to edit this file.

The `master` realm keeps the same default and needs nothing either: the admin console answers over plain HTTP
from the host for the same reason.

### What proves it

`apps/api`'s `KeycloakRealmTest` imports this file into a Keycloak of its own and then *uses* it: it signs
in through the full code + PKCE flow and reads the token, and it checks that the refusals are refusals. It
asserts no key of this JSON against itself, because a protocol mapper named right and configured wrong
imports without complaint. It also asserts the two lines of `docker-compose.yml` that connect the file to
this stack, which nothing else would notice going missing.
