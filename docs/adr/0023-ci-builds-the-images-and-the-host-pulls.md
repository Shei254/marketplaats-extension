# ADR-0023: CI builds the images, a registry holds them, the host pulls — and TLS terminates in a fifth container

**Status:** Accepted (2026-09-02)
**Scope:** Go-Live. **Amends [ADR-0020](0020-deployment.md)**, whose *Revisit if* names this exact moment.
T56 ([#87](https://github.com/Shei254/marketplaats-extension/issues/87)) is what carries it out.

## Context
ADR-0020 decided that the deployed host builds both images from source with no registry in between, and left
TLS as "T56's". Both halves were decided before the host was known. It is now: a Hostinger VPS with **one
vCPU and 4 GB of RAM**.

That number settles the first half by itself. `apps/api/Dockerfile` compiles this repository *inside* the
image — `.github/workflows/ci.yml`'s `images` job gives it a thirty-minute ceiling and says why, "from a cold
Gradle cache every run". On one shared vCPU that build is a third JVM wanting a gigabyte, competing for it
with the Keycloak and Spring processes it is in the middle of replacing, on a box where — as this ADR also
fixes — **no service had a memory limit and neither JVM had a heap cap**. Unbounded, each sizes its heap
against the whole host: Keycloak's image runs a high `MaxRAMPercentage` and the API's JVM defaults to ≈25%,
which on 4 GB can total more than 4 GB. The Linux OOM killer then takes the largest resident process,
`restart: unless-stopped` brings it back, and what an operator sees is an unexplained restart loop rather
than a failure with a cause.

ADR-0020 predicted all of this in its own Negative — "a deploy is a build on the production host — a slow
one for `apps/api`, and one that competes with the running stack for CPU" — and named the exit in its
*Revisit if*: "images move to a registry and the host pulls instead of building."

The second half was never designed at all. `infra/README.md` § Deploying carries the interim, and says so:
bind all three published ports to `127.0.0.1` "so nothing public reaches them". That is a holding position.
Nothing can sign in through it, because the realm's `sslRequired` is `external` and Keycloak answers
`403 HTTPS required` to any non-local plain-HTTP caller — which `click-through.md` step 7 asserts as *correct*
behaviour, and which is exactly why a proxy in front is not optional.

Options weighed for the first half: keep building on the host with the stack stopped first; ship a
`docker save` tarball over the deploy's own SSH connection; push to a registry and pull. For the second:
a host-level proxy as an OS package, nginx with certbot, Traefik, or Caddy inside the compose.

## Decision

### Images are built once, by CI, and are never rebuilt for a release
**Every green push to `master` builds both images and pushes them to GHCR as `sha-<commit>`.** The host
compiles nothing, ever. A deploy becomes a pull of a few hundred megabytes instead of a Gradle build on a
vCPU that is also serving requests.

**A version tag deploys by *retagging a digest*, not by building.** `docker buildx imagetools create` adds
`v1.0.0` to the digest CI already tested, so the bytes that reach the host are provably the bytes the suite
ran against — not a second build of the same source, which lockfiles narrow but do not guarantee (a
transitive range, or `node:24-alpine` moving underneath a rebuild, are both enough). It also costs seconds
rather than the `images` job's thirty-minute ceiling.

**The packages are private.** They are the compiled backend — the quota gate, the authorize/complete
settlement, the Stripe wiring. The extension is published to the world by design; this is the half that is
not.

### The deploy is one script, behind a key that can run only that script
Actions connects over SSH with a key restricted in `authorized_keys` by
`command="/usr/local/bin/mprelist-deploy"`, so a stolen key deploys and **cannot obtain a shell**.

**`production.env` stays on the host and GitHub never sees a credential.** ADR-0020 already said "the
environment file on the host is the boundary"; that sentence is unchanged and is now load-bearing rather
than incidental. The blast radius of a compromised workflow, or of a malicious transitive dependency inside
Actions, is *it can deploy an image* — it cannot read the live Stripe secret key, the Keycloak bootstrap
admin password, or either database password. The host holds one credential of its own: a **read-only** GHCR
token, scoped to `read:packages` and never the token that pushes.

**The deploy job `needs:` all three test jobs.** This is the first `needs:` in `ci.yml`, whose header states
the opposite principle — "none waits for another... a broken extension test has no business withholding the
backend's verdict". That principle is about **verdicts**, and it still holds: neither suite tells you
anything about the other, so neither may withhold the other's result. A deploy is not a verdict, it is an
**act** — one act that puts both images on one host and runs a Flyway migration against the only copy of
every subscription this product knows about. Gating an act on evidence is not the same as gating a report on
an unrelated report. A `workflow_dispatch` input carries the override, so the 3am hotfix path exists, is
deliberate, and appears in the log — rather than being absent and improvised into an SSH session that
bypasses the pipeline entirely.

### Caddy is a fifth container, and the other three stop publishing ports
Four hostnames: `www.` and `admin.` for `apps/web`, `api.` for the API, `auth.` for Keycloak, with the apex
redirecting to `www.`. Caddy issues and renews from Let's Encrypt with no cert plumbing of our own, and sends
`X-Forwarded-Proto`/`-For` by default — which is what the compose's existing `KC_PROXY_HEADERS: xforwarded`
has been waiting for since T55.

**The point is not the certificates, it is the ports.** `api`, `web` and `keycloak` stop publishing to the
host at all and exist only on the compose network; Caddy alone binds 80 and 443. That is strictly stronger
than `infra/README.md`'s loopback interim, and it removes a whole class of mistake — a port variable set to a
public value by someone who did not know why it was loopback.

**Two things about Caddy that are silent until they are not**, both recorded because neither is discoverable
from a working config:

- **`caddy_data` must be a named volume.** The certificate *and the ACME account key* live in `/data`.
  Without the volume, every `up` starts Caddy with nothing to renew, so it requests a **new** certificate for
  the identical four-name set. That is Let's Encrypt's *duplicate* limit — 5 per 7 days, refilling one every
  34 hours — and it is spent not by renewals (six a year, per certificate) but by the ordinary loop of
  getting a Caddyfile right, and thereafter by every deploy.
- **Iterate against the staging CA.** `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` while
  the four hostnames are being made to resolve; back to production once they do. Staging issues
  browser-untrusted certificates, which is the point — it proves the plumbing without spending real
  issuances. *Built as `MPRELIST_ACME_CA` in `production.env` rather than as a line edited in the global
  block: the Caddyfile is committed, and switching should not mean a modified file on the host.*

**`admin.<domain>` needs the browser's address changed, because the bundle decides by path.**
`apps/web/src/main.tsx` renders the admin surface on `isAdminPath(location.pathname)`, and knows nothing about
the host — deliberately, since one image runs anywhere. See [ADR-0017](0017-web-surface-and-subscribing.md),
whose "`www.` serves `/`, `admin.` serves `/admin`" was always a statement about a proxy.

> **Corrected 2026-09-02, in T56.** This paragraph said *rewrite*, and a rewrite cannot do it. `rewrite` is
> internal to the proxy: it changes which path Caddy asks nginx for and leaves the browser's address alone —
> and nginx answers every path with the same `index.html` regardless, so the bundle would boot at
> `location.pathname === "/"` and render the public site's not-found page. The rewrite would have been
> *inert*, on both sides silently. What is built is `redir / /admin{uri}`: a 302 that reaches the address
> bar, carrying the path and query of the request, so `/` becomes `/admin/` and `/?code=…&state=…` becomes
> `/admin/?code=…&state=…` — which is what `returningFromSignIn` needs and what `isAdminPath` accepts,
> trailing slash included. `DeployedStackTest` names the directive rather than the outcome, so that this
> paragraph's original sentence cannot be applied back.

### Every service gets a memory limit, and both JVMs get a heap percentage
```
postgres 512M   keycloak 1G   api 1G   web 64M   caddy 128M     ≈ 2.7 GB
```
leaving ~1.3 GB for the OS, dockerd, page cache and a concurrent `pg_dump`, with a 2 GB swapfile as
insurance — Hostinger's images ship with little or none.

**`mem_limit` alone is not enough, and fails in the direction that looks like success.** Modern JVMs read
their cgroup, so a 1 GB limit on the API would correctly bound it — to a **256 MB heap**, a quarter of its
allowance, because ≈25% is the JVM's default `MaxRAMPercentage`. The stack would be properly bounded and the
API would garbage-collect far harder than it should, presenting as latency rather than as a crash: the harder
of the two to trace back to here. So the API is given `-XX:MaxRAMPercentage=70` explicitly.

### A deploy dumps the database before it pulls, and does not roll back
The script takes a `pg_dump` **first**, so every deploy leaves a restore point from seconds before the
migration that might break it, written to the host filesystem rather than into the volume — which is what
makes it survive a `down -v`. Then `pull`, then `up -d --wait`, and a failure fails the Actions job loudly.
A nightly cron dump retained seven days sits underneath, and Hostinger's free weekly VPS backup — stored off
the machine, on their own infrastructure — is the floor beneath that.

**Automatic rollback is rejected rather than merely unbuilt**, because it is the first thing anyone will
propose. If a deploy applies `V8` and the new API then fails its healthcheck, rolling the image back to the
build that predates `V8` starts Flyway against a schema whose history contains a migration its classpath does
not have; `validateOnMigrate` is on by default, so **the rollback refuses to boot as well**. The automation
would convert a one-container outage into a two-attempt one while somebody watches. It becomes viable only
under a policy of backward-compatible migrations, which is a real discipline and a far larger commitment than
a deploy script. Blue/green is ruled out separately and already: `RelistAuthorizations` signs its grant with
an RSA key generated per process, so a second instance refuses the first's `complete` calls.

## Consequences
- **Positive:** the production box never compiles anything. The 1 vCPU is spent serving.
- **Positive:** the deployed bytes are the tested bytes, by digest rather than by assertion — and "what is
  running right now" has an immutable answer even if somebody later moves a tag.
- **Positive:** nothing but Caddy binds a public port, and no credential this product has is reachable from
  GitHub.
- **Positive:** the memory budget is *written down*, so a container that is killed points at the number that
  was wrong instead of at a guess.
- **Negative:** GHCR is a third party in the deploy path. A GitHub outage now blocks deploys as well as CI,
  and Packages storage and transfer are billed on private repositories past the account's included
  allowance — small at ~350 MB and ~60 MB with layer reuse, but it wants old tags pruned.
- **Negative:** an SSH key that can trigger a production deploy now exists in GitHub. The forced command
  narrows what it can do to one script; it does not remove the key.
- **Negative:** five containers inside 4 GB is a budget, and a budget with no load data behind it is a
  well-documented guess.
- **Negative:** no automatic recovery. A failed migration is downtime until a human reads a Flyway error —
  and ADR-0007 makes the extension fail *closed*, so that downtime is every user's Repost button, not only
  new sign-ups.
- **Consequence for [ADR-0020](0020-deployment.md):** "four containers" becomes five, and both "images are
  built on the host from source, with no registry in between" and "no registry and no CI deploy" are
  superseded here. **Everything else in it stands** — one host, one API instance, a second compose file that
  is deliberately not an override of the first, and configuration as environment with nothing that could be
  deployed by accident.

## Revisit if
- A second API instance is wanted. Unchanged from ADR-0020: make the authorization signing key configuration
  first, or the two instances refuse each other's grants.
- Load data arrives and contradicts the memory budget — which it will, since the budget predates any traffic.
- The manual Web Store upload becomes the release bottleneck, at which point
  [ADR-0024](0024-the-extension-addresses-are-built-in.md)'s consequences are what to read first.
- GHCR's bill, or its availability, makes the registry the wrong dependency — the `docker save` over the
  deploy's own SSH connection is the fallback that needs no new decision.
