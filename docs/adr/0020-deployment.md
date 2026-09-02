# ADR-0020: Deployed as four containers on one host, from a second compose file

**Status:** Accepted (2026-08-23), amended by [ADR-0023](0023-ci-builds-the-images-and-the-host-pulls.md) (2026-09-02)
**Scope:** Go-Live. Settles what T55 ([#86](https://github.com/Shei254/marketplaats-extension/issues/86))
deploys and how; T56 (#87) puts a domain, TLS and the production realm in front of it.

## Context
Nothing has ever been deployed. The 2026-08-13 backlog had no deployment ticket of any kind, and until it
exists four things are impossible, none of them optional before a stranger can pay:

1. **Stripe webhooks must reach the API.** [#30](https://github.com/Shei254/marketplaats-extension/issues/30)
   is the only thing in this application that moves anybody onto a paid tier, so without a reachable endpoint
   a payment never becomes an entitlement.
2. **Keycloak must be publicly reachable.** `launchWebAuthFlow` opens the real login page; on
   `localhost:8081` that works on one machine and nobody else's.
3. **`success_url` must be a public URL.**
4. **The Web Store listing needs the extension to actually work** (T58, #89).

What there is to deploy is small and it is already containerised for development: Postgres, Keycloak, and two
of our own workspaces — `apps/api`, one Spring Boot process, and `apps/web`, a static bundle. There is one
database, no queue, no cache, no second service.

Options weighed: a managed platform per service (Fly, Render, a PaaS), Kubernetes, or one host running the
same compose the local stack runs.

## Decision
**One host, four containers, described by `infra/docker-compose.prod.yml` and run with an environment file
that is never committed.** TLS terminates in front of it, which is T56's.

```
infra/docker-compose.prod.yml     postgres · keycloak · api · web
infra/production.env.example      every variable, no values
apps/api/Dockerfile               multi-stage: gradle bootJar → JRE
apps/web/Dockerfile               multi-stage: vite build → nginx
```

**A second file, not an override of the first.** Compose's `-f a -f b` merge and its profiles both start from
`docker-compose.yml`, and that file exists to be convenient: it commits every password on purpose, runs
Keycloak's `start-dev`, publishes Postgres on 5432 and imports a realm with two users sharing one published
password. An override *removes* things, and the failure mode of a removal that was forgotten is a deployment
that works — with the local stack's admin password on it. Two files means the deployed one can be read on its
own, and `DeployedStackTest` reads it that way: it asserts the differences rather than the merge.

**Configuration is the environment, and nothing has a default that could be deployed by accident.** Every
credential and every address is `${NAME:?…}`, so compose refuses to start and names the one that is missing —
at the only moment anybody is looking. The two exceptions are the Stripe secrets, which are `${NAME:-}`
because T57 (#88) is what fills them in and this stack has to come up before it.

**The browser's half of that configuration is served, not built.** `apps/web` is one bundle whose admin corner
has to know where the API and the realm are, and baking them in would make the image environment-specific and
a wrong value a rebuild. Instead nginx answers `/config.js` from its own environment with a **patch** over
what the bundle was built with — the shape `GET /api/client-config` already serves the extension
([ADR-0013](0013-remote-client-configuration.md)) — so an empty answer means the defaults are correct, one
image runs anywhere, and being wrong costs a restart.

**One API instance.** `RelistAuthorizations` signs its short-lived grant with an RSA key generated per
process, so a second instance signs with a second key and every `complete` that lands on the wrong one is
refused. Making that key configuration is the prerequisite for scaling out, and it is not this ticket.

**Images are built on the host from source**, with no registry in between. There is one host and one
deployer; a registry is a second thing to run, secure and pay for before anything is running at all.

## Consequences
- **Positive:** The deployed stack is the software the suite tests. `DeployedStackTest` holds the two compose
  files to the same Postgres and Keycloak image tags, so a schema proven on one major cannot be served by
  another.
- **Positive:** Everything a deployment decides is in one file the host holds and git never sees, and the
  refusal to start without it is compose's rather than ours.
- **Positive:** `docker compose down` and `up` are the whole runbook, and the same tool a developer already
  uses. No new vocabulary at the moment the first customer is waiting.
- **Negative:** One host is one point of failure and one machine's capacity. That is the right trade at zero
  customers and the wrong one at some number of them; the ceiling is the API's per-process signing key rather
  than the hardware.
- **Negative:** A deploy is a build on the production host — a slow one for `apps/api`, and one that competes
  with the running stack for CPU. A registry and a CI-built image is the obvious next move and needs no
  decision here.
- **Negative:** No secret manager. The environment file on the host is the boundary, so the host's own access
  control is what protects every password there is.
- **Consequence for T56 (#87):** the realm this file imports is not `infra/keycloak`, and the compose has no
  default for which one it is. TLS, the domain and the production realm are all downstream of the ports this
  file publishes.
- **Consequence for the API's own reachability:** the issuer it validates tokens against is the *public*
  Keycloak URL, because that is what Keycloak stamps into every token. The API container therefore has to be
  able to resolve and reach that public name from inside the network it runs on.

## Revisit if
- A second API instance is wanted — make the authorization signing key configuration first, or the two
  instances refuse each other's grants (`docs/enforcement-contract.md` § Resolved build questions).
- Deploys start costing more than they save, at which point images move to a registry and the host pulls
  instead of building.
- The stack grows something that is not one process and one database — a queue, a second service, a read
  replica — which is the point at which "four containers on one host" stops describing it.

---

## Amended 2026-09-02 (ADR-0023) — the host was chosen, and two of these decisions did not survive it

The second **Revisit if** trigger above fired, and earlier than expected, for a reason that ADR could not
have known: it chose how to deploy before there was a machine to deploy onto. There is now, and it is a
Hostinger VPS with **one vCPU and 4 GB**.

**Superseded — "Images are built on the host from source, with no registry in between."** The API image
compiles this repository inside itself. On one shared vCPU that is a third JVM, wanting a gigabyte on a box
that had no memory limits at all, competing with the two processes it is in the middle of replacing. The
Negative consequence above described this exactly; the host is simply smaller than the sentence assumed.
[ADR-0023](0023-ci-builds-the-images-and-the-host-pulls.md) moves the build to CI and the images to GHCR, and
a release **retags a tested digest rather than rebuilding**, so the deployed bytes are the tested bytes.

**Superseded — the sentence `infra/README.md` drew from it, "No registry and no CI deploy. The host
builds."** A version tag now deploys, over SSH, against a key restricted by `command=` to one script and no
shell.

**Amended — "four containers."** Five: Caddy terminates TLS, and `api`, `web` and `keycloak` stop publishing
ports to the host entirely. The TLS this ADR deferred to T56 is designed there.

**Unchanged, and load-bearing rather than incidental — "No secret manager. The environment file on the host
is the boundary."** It is what keeps every credential this product has out of GitHub: a compromised Actions
run can deploy an image and cannot read the live Stripe key.

**Everything else stands.** One host. One API instance, for the per-process signing-key reason given above.
A second compose file that is deliberately not an override of the first, and `DeployedStackTest` asserting
the differences. Configuration as environment, with nothing that could be deployed by accident.

