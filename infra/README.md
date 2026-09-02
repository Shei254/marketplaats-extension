# `infra` — local stack

Postgres and Keycloak, the two services the API needs to run at all
([ADR-0009](../docs/adr/0009-tech-stack.md), [ADR-0011](../docs/adr/0011-repository-layout.md)). One command,
from the repo root — both `-f` and `--env-file` resolve against the working directory, so run it there or
pass absolute paths:

```bash
cp .env.example .env      # once. Everything below is read from it; it is gitignored
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
```

**`--env-file` is not optional and naming a missing file is an error**, which is the safer half of the trade:
the alternative is compose looking for a `.env` beside the compose file, finding none, and importing a realm
whose redirect URI names no extension — an import that happens once and is undone only by `down -v`. What
that file holds and why is [`.env.example`](../.env.example) and
[the root README](../README.md#credentials-in-one-file); anything exported in your shell still wins over it.

`--wait` returns only once both containers report healthy — Keycloak's own `/health/ready`, not merely a
listening port. First start takes about a minute while Keycloak creates its schema; later starts, under
half that.

```bash
docker compose --env-file .env -f infra/docker-compose.yml ps        # what is running, and its health
docker compose --env-file .env -f infra/docker-compose.yml logs -f   # follow both services
docker compose --env-file .env -f infra/docker-compose.yml down      # stop, keeping the data
```

## What you get

| | Where | Credentials |
|---|---|---|
| App database | `postgres://localhost:5432/mprelist` | `mprelist` / `mprelist` |
| Keycloak | http://localhost:8081 | admin console `admin` / `admin` |
| Keycloak's database | `postgres://localhost:5432/keycloak` | `keycloak` / `keycloak` |
| The `mprelist` realm | http://localhost:8081/realms/mprelist | `dev` and `dev-admin`, both `local-dev-password` |

**The dev password is no longer the username**, which it was until the realm gained a password policy.
Keycloak validates *imported* credentials against the policy and refuses to start otherwise — `dev` / `dev`
now aborts the container with `ERROR: invalidPasswordMinLengthMessage` and no realm at all, which is the
policy working and an alarming way to find out. Test code takes it from `KeycloakFromCompose.PASSWORD`.

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
docker compose --env-file .env -f infra/docker-compose.yml down -v   # -v also drops the data
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

**There is a second export, and everything above this line is about the first one.**
[`keycloak-production/mprelist-realm.json`](keycloak-production/mprelist-realm.json) is what a deployment
imports (T56, #87) — the same three clients and the same role, with no users at all and every origin a
`${…}` the compose file fills in. The differences are exactly the ones a `down -v` on production is the price
of getting wrong, so `ProductionRealmTest` starts a Keycloak on it: it registers the published extension,
signs the admin corner in from **both** site hostnames, refuses a third, and opens no account this
repository's published password would.

### Strangers make their own accounts

```jsonc
"registrationAllowed": true,      // the login page offers "Register"
"resetPasswordAllowed": true,     // …and "Forgot password?"
"bruteForceProtected": true,
"passwordPolicy": "length(12) and notUsername and notEmail"
```

All four are **off or absent in a default realm**, which was survivable while the only accounts were the two
this file writes. It is not once the accounts belong to customers: with no policy Keycloak accepts a
one-character password at sign-up, and with no brute-force protection it will let a script guess at one
forever.

A self-registered user is **granted the realm's default roles**, unlike an imported one — so they arrive with
the array-shaped `aud` and the populated `realm_access` that #19 and #27 have to read, which until now only
`dev-admin` produced and only because this file grants it `default-roles-mprelist` by hand. Our API
provisions them a free-tier subscription on their first call ([#20](https://github.com/Shei254/marketplaats-extension/issues/20)).

**Nothing they type into that form reaches us.** The registration page asks for a first name, a last name and
an email address — Keycloak's own form, not ours to shorten — and none of it is in the token, because the
clients name their own scopes (above). `KeycloakRealmTest` registers a stranger and asserts exactly that.

**Email verification is deliberately off.** With `verifyEmail` on, a new account cannot sign in until a mailed
link is clicked — so on a stack whose SMTP credentials are unset, every sign-up dead-ends. It belongs with
real SMTP at Go-Live (T55/T56), where mail is always configured.

### Mail, and the two variables that are yours

Password reset sends an email, so the realm names an SMTP server: **Mailtrap's sandbox** by default, whose
credentials are per-inbox and therefore not committable.

Both live in your `.env`, where `.env.example` ships them commented out:

```bash
# in .env — uncomment and fill in from your Mailtrap inbox
MPRELIST_SMTP_USER=…
MPRELIST_SMTP_PASSWORD=…
```

Then the ordinary `up` passes them through. Unset, everything still imports and every other flow works; only
the reset mail fails to send, in Keycloak's logs rather than on the user's screen. `MPRELIST_SMTP_HOST`,
`_PORT` and `_FROM` are passed through too and default to `sandbox.smtp.mailtrap.io`, `2525` and
`no-reply@mprelist.local` — the internal identifier rather than the brand, which lives in `brand.json` and is
provisional until T60.

**Commented out rather than empty, and that is the difference between a default and no value at all.** An
empty assignment reaches Keycloak as a variable that is *defined and empty*, and
`${MPRELIST_SMTP_HOST:sandbox.smtp.mailtrap.io}` applies only where the variable is absent — so
`MPRELIST_SMTP_HOST=` in your `.env` imports a realm with no mail host rather than the sandbox one.
`EnvironmentFileTest` holds the committed example to that rule for every variable this realm substitutes.

A test asserts the user and password in the realm file are **substitutions and not literals**, because that
file is the natural place for someone to paste a working credential.

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

**These are a dev realm's numbers, and the deployed realm keeps two of them on purpose** (T56, #87).
`infra/keycloak-production/mprelist-realm.json` carries the same 30 days, because the *reason* for the idle
timeout is not convenience: it is the MV3 service worker sleeping longer than Keycloak's 30-minute default
between one relist and the next, which is as true of a paying user as of a laptop. The max lifespan is the
row that is a security dial rather than a constraint, and 30 days is a decision — a month's cadence of
interactive sign-in — rather than an inherited number. What bounds a stolen refresh token is the rotation in
the first two rows and the five-minute access token, not this.

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
  docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
```

`.env.example` ships that same id as a value, so a copied `.env` already has it and the command above is the
override rather than the ritual — the shell wins over the file, in compose and in Gradle alike. What keeps
the committed literal honest is `EnvironmentFileTest`, which fails the build if it stops matching the default
`application.yml` derives from the manifest key. Prefer the substitution when in doubt: if the key is ever
replaced — which it will be at publish time, see below — a literal is wrong and the command still is not.

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

Because the import runs once, changing the **variable** achieves nothing on its own — the realm has already
been read, and it is not read again. On a laptop that means `down -v` and start over, which is what the local
stack is for.

**On a deployed stack it does not mean `down -v`, and an earlier version of this page said it did.** The
*import* is first-start-only; the realm's *contents* are ordinary rows in Keycloak's database and stay
editable in the admin console for as long as the realm exists. Changing a redirect URI, a web origin or the
extension id after the fact is a field in a form. Taken literally, the old sentence wiped every account this
product had in order to change one URI — so the ordering below (§ Before the first `up`) exists to make that
edit unnecessary, not to make it impossible.

A wildcard would avoid all of this; ADR-0010 says not to, and a realm file that grew one for convenience is
the one that gets copied to a deployed realm.

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

---

# Deploying

The same four pieces of software, none of the same settings — plus a fifth in front of them.
[`docker-compose.prod.yml`](docker-compose.prod.yml) and
[`production.env.example`](production.env.example) (T55,
[#86](https://github.com/Shei254/marketplaats-extension/issues/86), and
[ADR-0020](../docs/adr/0020-deployment.md)); the pipeline, the proxy and the resource budget are T56
([#87](https://github.com/Shei254/marketplaats-extension/issues/87)) and
[ADR-0023](../docs/adr/0023-ci-builds-the-images-and-the-host-pulls.md). Everything above this line is a
laptop's stack and is not fit to deploy — `start-dev`, a published database port, and every password
committed on purpose.

> **State:** everything below is built and committed — the compose file, the Caddyfile, the production realm,
> the pipeline and the two host scripts — and **nothing is deployed**. What is left is a host, a DNS name, and
> the ordered steps on this page. `ProductionRealmTest` starts a real Keycloak on the realm that import
> depends on, so the file this page is most afraid of getting wrong is the one thing here already proven.

## The host, and what it never does

A Hostinger VPS, **1 vCPU / 4 GB**. It **never compiles anything** — that is the whole of ADR-0023's first
half, and the reason is arithmetic: `apps/api/Dockerfile` builds this repository inside itself, which is a
third JVM wanting a gigabyte, on one shared core, competing with the two processes it is replacing.

So the host pulls. GitHub Actions builds both images on every green push to `master` and pushes them to GHCR
as `sha-<commit>`; a version tag adds `v…` to that **same digest** with `docker buildx imagetools create` —
no rebuild, so what runs is provably what was tested. The compose file names image tags, not build contexts.

```bash
# on the host, once
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >>/etc/fstab   # Hostinger's images ship with little or no swap

docker login ghcr.io -u <user> --password-stdin   # a READ-ONLY token: read:packages, never the push token

git clone <this repository> /opt/mprelist         # the compose file, the Caddyfile and the realm live here
cp /opt/mprelist/infra/production.env.example /opt/mprelist/production.env   # then fill it in
install -m 755 /opt/mprelist/infra/deploy/mprelist-deploy /opt/mprelist/infra/deploy/mprelist-backup /usr/local/bin/
```

**The checkout is yours to keep current, and the deploy script deliberately does not touch it.** Doing that
would put a second credential on this machine — a repository read key beside the read-only GHCR token — which
ADR-0023 does not. The cost is one rule: **a release that changes anything under `infra/` needs a `git pull`
here before the tag is pushed**, or new images run against an old compose file. Nothing enforces it.

Then the key Actions connects with, in `~/.ssh/authorized_keys`, restricted to one command:

```
command="/usr/local/bin/mprelist-deploy",no-agent-forwarding,no-port-forwarding,no-pty ssh-ed25519 AAAA…
```

and the nightly dump, in root's crontab:

```
17 3 * * *  /usr/local/bin/mprelist-backup >>/var/log/mprelist-backup.log 2>&1
```

Three repository secrets are what the pipeline needs, and none of them is a credential of this product's:
`MPRELIST_DEPLOY_SSH_KEY` (the private half of the key above), `MPRELIST_DEPLOY_TARGET` (`user@host`), and
`MPRELIST_DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` of the host — a secret rather than a
`StrictHostKeyChecking=no`, or the key is offered to whoever answers).

## Before the first `up`

**Three things are imported or assigned once**, and the order between them is a cycle that has to be broken
deliberately rather than discovered:

| | |
|---|---|
| `MPRELIST_REALM_DIR` | `./keycloak-production`, and **not `./keycloak`** — that realm has two dev users sharing a published password and every redirect URI on localhost. No default, so a stack pointed at nothing stops rather than importing it. The production export has no users at all and writes down no hostname: every origin in it is a `${…}` the compose file fills in, which is what keeps one deployment's addresses out of git. `ProductionRealmTest` starts a Keycloak on it and holds all of that |
| `MPRELIST_EXTENSION_ID` | What the realm registers `https://<id>.chromiumapp.org/` for. The Web Store assigns a different id than this repository's key derives — see [§ Your extension id](#your-extension-id) |
| The four hostnames | `www.` `admin.` `api.` `auth.`, with the apex redirecting to `www.` Both **site** origins go in the `mprelist-dashboard` client ([ADR-0017](../docs/adr/0017-web-surface-and-subscribing.md)) |

**The cycle, and the way out.** The realm wants the published extension id at first start. The Web Store
assigns that id only once a store item exists. Creating the item needs a built extension, which needs the
deployed addresses, which need the realm. Break it at the store:

1. Create the Web Store item as an **unpublished draft**, with any buildable zip.
2. Read the assigned id; `npm run extension-key -w @mprelist/extension -- set <the Web Store public key>`.
3. *Then* fill in `production.env` and first-start the stack.
4. Build the real extension against the deployed addresses (`deployment.json`,
   [ADR-0024](../docs/adr/0024-the-extension-addresses-are-built-in.md)) and upload it to the draft.

Getting this order wrong is recoverable — the realm's contents stay editable in the admin console, whatever
[§ Your extension id](#your-extension-id) used to claim. Getting it *right* means never opening that console.

## Hostnames before you own a domain

The domain is T60 ([#91](https://github.com/Shei254/marketplaats-extension/issues/91))'s, and it has lead
time nothing else here shares — a trademark search and Web Store name availability. **You do not have to wait
for it to deploy**, and you must not deploy on a bare IP either: the realm is `sslRequired: external`, so
Keycloak answers `403 HTTPS required` to any non-local plain-HTTP caller. That is the setting working, and it
is asserted as correct in [`click-through.md`](../docs/click-through.md).

Use **sslip.io**. `www.203-0-113-5.sslip.io` and its three siblings resolve to your VPS through public
wildcard DNS, so Let's Encrypt issues ordinary certificates for them and you get the entire real setup —
four hostnames, real HTTPS, `sslRequired` untouched, the full click-through including Stripe test webhooks —
on an IP you have and a domain you have not bought.

When the domain arrives, the switch is:

| | |
|---|---|
| `production.env` | The three URL variables, then `up -d` |
| Keycloak admin console | The `mprelist-dashboard` client's redirect URIs and web origins |
| Stripe dashboard | The webhook endpoint. `success_url` and the Portal return follow `MPRELIST_WEB_BASE_URL` on their own |
| Every existing session | Refused. `KC_HOSTNAME` changes the `iss` in every token and the API validates it. Free at zero users, a forced re-sign-in at any other number |
| `deployment.json` + a rebuild | **The one that has a deadline.** See below |

**Do all of this before the extension is published.** The extension's API and issuer addresses are compiled
in and cannot be served to it (ADR-0024: the config document is fetched *from* `baseUrl`, and sign-in
precedes the first fetch of it). After publication, moving them is a Web Store review — and the `426` lever
cannot even tell the stranded builds to update, because saying so requires reaching the API they can no
longer find.

## TLS, and the two things about Caddy that are silent

Caddy is the fifth container. `api`, `web` and `keycloak` **publish no ports at all** and exist only on the
compose network; Caddy alone binds 80 and 443. That replaces the loopback-binding interim this page used to
carry, and it removes the mistake that interim invited — a port variable set to a public value by somebody
who did not know why it was loopback. Hostinger's own firewall wants 80, 443 and SSH open and nothing else.

- **`caddy_data` is a named volume.** The certificate *and the ACME account key* live in `/data`. Without it
  every `up` starts Caddy with nothing to renew, so it requests a **new** certificate for the same four
  names — Let's Encrypt's duplicate limit, 5 per 7 days, refilling one per 34 hours. Renewals never approach
  that (six a year); the ordinary loop of getting a Caddyfile right does, and then so does every deploy.
- **Iterate against staging, which is what the example file already does.** `MPRELIST_ACME_CA` decides which
  directory Caddy asks, and `production.env.example` ships it pointed at *staging* with production commented
  out — because a first deployment is precisely the loop that spends the limit, and forgetting to switch this
  way round fails visibly in a browser on the first page load, while forgetting the other way round fails
  invisibly and then not for 34 hours. Switch it once all four hostnames resolve and the click-through
  passes. A variable rather than a line in the Caddyfile because the Caddyfile is committed, and switching
  should not mean a modified file on the host.

`admin.<domain>` needs `/` **redirected** to `/admin`, carrying the query — `apps/web` picks its surface by
path and knows nothing about the host, so without it that hostname serves the public site's not-found page.
The query matters because a sign-in returns to the origin root with a `code` in it.

**A `rewrite` will not do**, which is what ADR-0023 originally said and
[corrected](../docs/adr/0023-ci-builds-the-images-and-the-host-pulls.md): a rewrite is internal to the proxy
and never reaches the address bar, and the surface is chosen in the browser from `location.pathname`. nginx
answers every path with the same `index.html` anyway, so the rewrite would change nothing and look like it
had. The Caddyfile carries `redir / /admin{uri}` and `DeployedStackTest` holds it there.

## The memory budget

Nothing in either compose file set a limit before T56, and unbounded JVMs size their heaps against the whole
host: Keycloak's image runs a high `MaxRAMPercentage`, the API's JVM defaults to ≈25%, and on 4 GB the two
can total more than there is. What you see when that happens is not an error — it is the OOM killer taking
the largest process and `restart: unless-stopped` bringing it back, over and over.

```
postgres 512M   keycloak 1G   api 1G   web 64M   caddy 128M    ≈ 2.7 GB
```

plus the 2 GB swapfile [§ The host](#the-host-and-what-it-never-does) creates; Hostinger's images ship with
little or none. **`mem_limit` alone is a trap**: JVMs read
their cgroup, so a 1 GB limit gives the API a 256 MB heap. It is given `-XX:MaxRAMPercentage=70` explicitly.

The numbers are a guess that predates any traffic and are meant to move. `DeployedStackTest` asserts their
**sum** rather than any one of them, because what must not move is the ~1.3 GB left for the OS, dockerd, the
page cache and a concurrent `pg_dump`.

## Deploying, and what happens when it fails

```bash
git tag v1.0.0 && git push origin v1.0.0
```

That is the deploy. Actions runs the three test jobs, retags the digest `master` already built for that
commit — `imagetools create`, not a second build — and connects over SSH with a key restricted in
`authorized_keys` by `command="/usr/local/bin/mprelist-deploy"`: it can run that script and **cannot get a
shell**. The script takes a `pg_dump` first, writes the tag into `production.env`, pulls, and `up -d --wait`.
A failure fails the job loudly and stops.

**Two things about the tag.** It must be on a commit `master` has already built, or there is no
`sha-<commit>` digest to rename and the job stops saying so. And `MPRELIST_IMAGE_TAG` in `production.env` is
the record of what is running: the script rewrites that one line, so `docker compose ps` afterwards needs no
argument and answers about the same build.

**The 3am path is a `workflow_dispatch`** — Actions → CI → Run workflow, with the image tag and the `hotfix`
box. It deploys past a failed test job, and it is in this pipeline rather than absent so that the thing
somebody does at 3am is one that leaves a log entry, instead of an SSH session that goes around all of it.

**There is no automatic rollback, and that is deliberate.** If a deploy applies `V8` and the API then fails
its healthcheck, rolling the image back to the build that predates `V8` starts Flyway against a schema whose
history holds a migration its classpath lacks — `validateOnMigrate` is on, so the rollback will not boot
either. The recovery that works is a human reading the Flyway error.

`production.env` never leaves the host. GitHub holds the SSH key and no credential of this product's at all
(ADR-0020's "the environment file on the host is the boundary", now load-bearing): a compromised workflow can
deploy an image and cannot read the live Stripe key.

## Afterwards

```bash
docker compose --env-file production.env -f infra/docker-compose.prod.yml ps      # health of all five
docker compose --env-file production.env -f infra/docker-compose.prod.yml logs -f api
```

The API's own settings — the client-config patch (#36), the pacing window, the Stripe secrets — are read at
start, so changing one is an edit to `production.env` and `up -d`. No tag, no pipeline; nothing was rebuilt.

**Backups, in three layers.** Each covers what the one below it cannot:

| Layer | Recovery point | Covers |
|---|---|---|
| Hostinger's free weekly VPS backup, off the machine | up to 7 days | The VPS ceasing to exist |
| A nightly `pg_dump` cron, 7 kept | ≤ 24 h | A bad migration, a bad admin action, `down -v` |
| The deploy script's own dump, taken before it pulls | seconds | The migration it is about to run |

The dumps are written to the **host filesystem, not into a volume** — that is what makes them survive
`down -v`, which drops the realm and every account with it. Copying them to object storage (B2 and R2 are
both free at this size) is the only layer that survives losing the Hostinger account, and is two lines in the
same cron.

```bash
docker compose --env-file production.env -f infra/docker-compose.prod.yml \
  exec -T postgres pg_dump -U mprelist mprelist | gzip > mprelist-$(date +%F).sql.gz
```

## What this deliberately is not

- **One API instance.** The authorization grant is signed with an RSA key generated per process, so a second
  instance refuses the first's `complete` calls. Making that key configuration is the prerequisite for
  scaling out — `docs/enforcement-contract.md` § Resolved build questions. It also rules out blue/green, which
  is why the deploy above accepts downtime instead.
- **No secret manager.** `production.env` on the host is the boundary, and ADR-0023 leans on it.
- **No automated Web Store publish.** CI attaches the extension zip to the GitHub release so the shipped
  bytes are CI's — built from the tag, against the committed `deployment.json`, by something with no local
  state. Uploading it is yours. Every release waits on a review of days to weeks regardless.
- **No health check of its own.** `up -d --wait` is what a deploy waits on, and after that nothing watches.
  Let's Encrypt's expiry mail to `MPRELIST_ACME_EMAIL` is the only alert this stack sends.
- **Nothing prunes GHCR *on a deploy*.** ADR-0023 named the bill as a cost of the registry — private-repository
  storage and transfer are billed past the account's allowance, and every green `master` adds a
  `sha-<commit>` pair. A weekly `.github/workflows/prune-ghcr.yml` now takes them, keeping every release and
  the newest ten builds per image, so the growth is bounded rather than monotonic. What it deliberately is
  not is part of the deploy: a delete in the path of a release is a delete running while somebody is
  watching a migration, and the two failures want separate logs.
- **Caddy does not wait for the backends to be healthy**, only for them to start. The opposite was written
  first and is worse: an unhealthy API would keep the only container binding 80 and 443 from starting, taking
  the marketing site down with it and blocking the ACME challenge — a one-container outage becoming an
  expired certificate. `up -d --wait` already fails a deploy whose API is unhealthy, with or without it.
