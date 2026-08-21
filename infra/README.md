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
| `mprelist-extension` | public, Authorization Code + **PKCE required**, redirects to `https://<extension-id>.chromiumapp.org/` exactly | [#32 (T23 · PKCE sign-in)](https://github.com/Shei254/marketplaats-extension/issues/32) |
| `mprelist-dashboard` | public, PKCE required, redirects to `http://localhost:5173/` exactly — Vite's default, [#42 (T33)](https://github.com/Shei254/marketplaats-extension/issues/42)'s to change if the tooling differs | [#42](https://github.com/Shei254/marketplaats-extension/issues/42) |
| `mprelist-api` | starts no flow and holds no session; it exists to be the `aud` the other two put in their tokens | [#19 (T10 · resource server)](https://github.com/Shei254/marketplaats-extension/issues/19) |

Both user-facing clients **refuse the password grant**: ADR-0010 chose code + PKCE, and a public client that
also takes a password offers a second, weaker way in that neither client would ever use. Both carry an
audience mapper naming `mprelist-api`, which is what gives the resource server something to check beyond the
issuer — every client in the realm shares that.

The `ADMIN` realm role is defined and held by `dev-admin`, for
[#27 (T18 · `admin` module + role guard)](https://github.com/Shei254/marketplaats-extension/issues/27).

### What a token carries, which is not what the client asked for

Both public clients name their own **`defaultClientScopes`** — `basic`, `acr`, `roles`, `web-origins` — and
assign **no optional ones**. That is Keycloak's own default list with `profile` and `email` taken out, and it
is the fix for [#108](https://github.com/Shei254/marketplaats-extension/issues/108).

**A client's default scopes are added to every token whatever the authorization request asks for.** The
extension asks for `scope=openid` and nothing else ([ADR-0010](../docs/adr/0010-extension-authentication.md)),
which was believed to be the whole story; it is not. Until this was named, a token minted here came back with
`"scope": "openid email profile"` and the user's address, full name and username in it — travelling to our
API, sitting in `chrome.storage.local`, and printed in full by any log line that ever logs a raw token.
Nothing reads it (`identity` takes `sub` and nothing else), which is exactly why it went unnoticed.

Assigning no optional scopes closes the other half: a realm's own optional list is `address`, `phone`,
`offline_access`, `microprofile-jwt` and `organization`, of which the first two map straight off the user
profile and the third carries the username as `upn`. Neither client requests any of them, so a request that
did is now refused with `invalid_scope` rather than answered.

What is left is `sub`, the `aud` the audience mapper writes, `realm_access` for a user who holds a role, and
`allowed-origins`. `KeycloakRealmTest` mints real tokens through the full flow and asserts both halves — that
nothing the realm records about a user appears in one, and that the admin role still does.

**Changing this needs a `down -v`**, like every other line in the file: the realm imports on first start only,
so a stack that is already up keeps the clients it imported with.

The two dev users are shaped to cover both token shapes a real user can produce, which one user cannot:

| | Realm roles | `realm_access` | `aud` |
|---|---|---|---|
| `dev` | none | **absent**, not empty | `"mprelist-api"` — a bare string |
| `dev-admin` | `default-roles-mprelist`, `ADMIN` | present | `["mprelist-api", "account"]` — an array |

Both rows matter to [#19 (T10 · resource server)](https://github.com/Shei254/marketplaats-extension/issues/19)
and #27, and the difference between them is a Keycloak quirk worth knowing: **an imported user is not granted
the realm's default roles**, though a user created through the admin console or a registration form is. So
`dev`'s bare-string `aud` is the shape of an *import artifact*, not of an ordinary user — a resource server
that compares `aud` as one string passes against `dev` and fails against the first real user. `dev-admin`
holds `default-roles-mprelist` explicitly so that the array shape is present in the realm at all. Equally,
`dev` having no `realm_access` is the edge #27 must survive rather than the case it will usually meet.

### Refresh-token rotation and session lifetimes

ADR-0010 has the extension hold "a rotating refresh token" and refresh it "on demand at call time, never on a
timer". Neither is a default, so the realm sets both:

| Setting | | Why not the default |
|---|---|---|
| `revokeRefreshToken` | `true` | Off by default: every refresh token a session issued stays valid beside the one that replaced it, so a copy read out of extension storage outlives the refresh meant to retire it |
| `refreshTokenMaxReuse` | `0` | No grace reuse; the token is spent by the refresh that uses it |
| `ssoSessionIdleTimeout` | 30 days | The default is **30 minutes** — shorter than an MV3 service worker sleeps between one relist and the next, so on-demand refresh fails and the extension has to re-run `launchWebAuthFlow`, which needs a user gesture. That is the failure the ADR chose on-demand refresh to avoid |
| `ssoSessionMaxLifespan` | 30 days | An idle timeout is capped by it, so leaving the 10-hour default at 30-day idle would mean a daily interactive sign-in anyway |
| `accessTokenLifespan` | 5 min | Already the default. Pinned because ADR-0010 accepted that "revocation is only as fast as the access-token TTL" — that window should move deliberately, not under an upgrade |

**These are a dev realm's numbers.** A 30-day session is a laptop's convenience; a deployed realm should
decide its own, and `revokeRefreshToken` is the only row here that is right everywhere.

One consequence for [#33 (T24)](https://github.com/Shei254/marketplaats-extension/issues/33): with
`refreshTokenMaxReuse: 0`, two of the extension's fetches waking and refreshing concurrently means the second
presents a spent token and the session dies. Refresh has to be serialised in the worker.

### Your extension id

The redirect URI needs an extension id, and **this repository now knows one**. T44 (#13) pinned it with a
`key` in `apps/extension/public/manifest.template.json` — ADR-0010's second row — so the id no longer depends on which
machine or which directory the extension was loaded from. It is **derived from that key on demand and never
written down twice**:

```bash
MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension) \
  docker compose -f infra/docker-compose.yml up -d --wait
```

Today that command substitutes `dolloiambeojifmnofjchofbnepodiof`, but prefer the substitution to the literal:
if the key is ever replaced — which it will be at publish time, see below — the literal is wrong and the
command still is not.

The realm still takes it from the environment at import time, and the fallback below is still what you get if
you forget.

Unset, it falls back to the literal `unset-extension-id`, which is a valid URI and will never match a real
flow — the realm imports, and sign-in from a real extension is refused with `Invalid parameter: redirect_uri`
rather than silently bouncing a code somewhere. That is not prose: `KeycloakRealmWithoutAnExtensionIdTest`
starts a Keycloak with the variable **unset**, and asserts both halves — the fallback URI is accepted, a real
extension's is refused with that error. It is what you get when the substitution above is left out, so it
gets a container of its own rather than a paragraph.

Two things have to hold for it, and each is proven where it lives: the realm file carries the
`${MPRELIST_EXTENSION_ID:unset-extension-id}` default (delete it and the realm no longer imports at all when
the variable is unset), and `docker-compose.yml` declares the variable **with no value**. The second is the
subtle one — `MPRELIST_EXTENSION_ID: ""` would define it *empty*, the realm's default would not apply, and
the client would register `https://.chromiumapp.org/`: a URI with no host, which imports without complaint
and refuses every sign-in. No container those tests start uses compose's environment, so that line is
asserted on the compose text instead.

**The id changes exactly once more, at publish.** The Web Store signs uploads with its own key, so it
assigns a different id than the one our key derives (ADR-0010's second row, and its stated cost). When that
happens, `npm run extension-key -w @mprelist/extension -- set <the Web Store public key>` rewrites the
manifest and prints the new id; the production realm then has to be built with *that* one. T56 (#87) owns it.

Because the import runs once, changing the variable means `down -v` first. A wildcard would avoid all of
this; ADR-0010 says not to, and a realm file that grew one for convenience is the one that gets copied to a
deployed realm.

### Redirect URIs are exact, and so is the way back out

Both public clients register the **exact** URI they return to — no trailing `/*`.
[ADR-0010](../docs/adr/0010-extension-authentication.md): *"Do not solve this with a wildcard redirect URI in
Keycloak — it works, but an open redirect target on a public OAuth client is not something to carry into
production."*

A host-scoped `https://<extension-id>.chromiumapp.org/*` is not an open redirect in the usual sense, which is
why it survives the obvious test and is easy to leave in. It is still the wrong shape:
`chrome.identity.launchWebAuthFlow` returns to `chrome.identity.getRedirectURL()` and nowhere else, so every
path the wildcard additionally admits is one no honest flow uses — it widens where an intercepted code can be
delivered and buys nothing back. The same holds for the dashboard; #42 owns *which* URI it redirects to (a
router wanting `/callback` changes that line), not whether it is a prefix.

`post.logout.redirect.uris` is `"+"` on both, which is Keycloak's "whatever `redirectUris` holds", rather
than the same URI spelled a second time. The sign-in and sign-out sides then cannot drift, and neither can
regrow a wildcard the other dropped. `KeycloakRealmTest` proves all of it the only way it can be proven: it
asks for a path *beneath* the registered URI and is refused, and logs out to one and is refused.

### `sslRequired` is `external` in the file and `none` on your laptop

```jsonc
// keycloak/mprelist-realm.json
"sslRequired": "${MPRELIST_SSL_REQUIRED:external}"
```
```yaml
# docker-compose.yml
MPRELIST_SSL_REQUIRED: none
```

Under `external` — Keycloak's own default — plain HTTP is served to a client address Keycloak considers
local, meaning loopback and the private ranges, and **refused to everything else with
`403 {"error_description":"HTTPS required"}`**.

**Whether your machine is "local" is a property of the machine, not of this file.** On a rootful Docker
daemon a request to a published port reaches the container from the bridge gateway, `172.17.0.1`, and
`external` never bites. Through **Docker Desktop's port forwarder it arrives from a public address** — on the
machine this was found on, `172.66.152.246` — and `external` refuses every request the browser makes,
starting with the discovery document. The symptom is the extension reporting

```
The sign-in server answered 403 for http://localhost:8081/realms/mprelist/.well-known/openid-configuration.
```

which names the URL, the status, and nothing about TLS. It is worth knowing the shape of that failure even
after this: `curl` it from the host, and if you get 403 while the same URL answers 200 from inside the Docker
VM (`docker run --rm --network host curlimages/curl -s -o /dev/null -w '%{http_code}' <url>`), this is what
you are looking at.

**Which is why the relaxation lives in compose and the default lives in the file.** This stack is the laptop
and a laptop has no TLS; a production realm built from this file (T56, #87) sets no such variable and so
imports as `external`, which is the value that must not be relaxed by inheritance. That is the extension-id
trade inverted — there the environment has to be *right* at import time, here it has to be *absent*.

`KeycloakRealmTest` asserts both halves as text, which is the one assertion in that suite made against a file
rather than a running Keycloak, and deliberately: a behavioural version would pass on a laptop, fail in CI,
and say nothing about the default either time. `KeycloakFromCompose` reads the value out of compose rather
than hardcoding it, so the suite starts the realm the stack starts — and stops with a named failure if that
line is ever deleted.

The `master` realm is **not** covered by this: it keeps Keycloak's default, so the admin console at
`http://localhost:8081/admin` answers `HTTPS required` on a machine where the forwarder looks external. The
console is reachable from inside the container (`kcadm.sh`) regardless.

### What proves it

`apps/api`'s `KeycloakRealmTest` imports this file into a Keycloak of its own and then *uses* it: it signs
in through the full code + PKCE flow and reads the token, spends a refresh token twice to see the second
refused, and checks that the refusals are refusals. It asserts no key of this JSON against itself, because a
protocol mapper named right and configured wrong imports without complaint.
`KeycloakRealmWithoutAnExtensionIdTest` does the same for the realm you get with `MPRELIST_EXTENSION_ID`
unset, which the first suite cannot see because it always sets it.

Everything either of them proves is proven on a container of their own, which says nothing about *this* stack
ever reading the file. So `KeycloakRealmTest` also reads `docker-compose.yml` for the three lines that connect
the two: the `--import-realm` command, the `./keycloak` mount, and `MPRELIST_EXTENSION_ID` passed through with
no value of its own. Nothing else in the repository would notice one of them going missing.
