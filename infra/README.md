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
curl -s http://localhost:8081/realms/master/.well-known/openid-configuration | jq .issuer
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

Keep `-v` in mind when editing [`postgres/init/`](postgres/init): the Postgres image runs those scripts
exactly once, when it initialises an empty data directory. On an existing volume an edited script is not an
error — it simply never runs, and the change appears not to have taken.

## Not here yet

The version-controlled Keycloak realm — clients for the extension, dashboard and API, and the `ADMIN` role —
is [#15 (T06 · Keycloak realm, clients, and roles)](https://github.com/Shei254/marketplaats-extension/issues/15).
It exports to this directory and is imported at startup, which is a `--import-realm` flag and a mount on the
`keycloak` service; neither is here yet, because there is nothing to import. Until then the stack gives you
Keycloak with only its `master` realm, which is enough to reach the admin console and enough for `apps/api`
to have a database.
