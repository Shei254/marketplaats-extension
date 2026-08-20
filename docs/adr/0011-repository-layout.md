# ADR-0011: Repository layout — monorepo, one deployable per workspace

**Status:** Accepted (2026-08-13)
**Scope:** Full app. Extends ADR-0009.

## Context
Until now the repository held a single Chrome MV3 extension built with esbuild. The full app adds a Spring
Boot API, a React dashboard, Keycloak, and Postgres. The API contract has **two clients** (extension and
dashboard), and ADR-0009 already banks on sharing TypeScript between them. Options: one monorepo, two repos
(extension separate from platform), or three repos.

## Decision
**A single monorepo**, one deployable per workspace:

```
apps/extension      the existing Chrome MV3 extension
apps/api            Spring Boot (Gradle, Java 21, Flyway)
apps/web            React SPA  (named apps/dashboard when this was decided — see the amendment)
packages/contracts  shared API types, consumed by both clients
packages/ui         design tokens + components, consumed by apps/web and popup
infra/              docker-compose for Postgres + Keycloak
docs/               ADRs, specs, glossary — unchanged location
```

## Consequences
- **Positive:** An API contract change lands atomically in one commit across server and both clients;
  `packages/ui` makes one design system serve the popup and the dashboard instead of two that drift;
  `infra/` gives one command to a working local stack.
- **Negative:** Mixed Gradle + npm CI. And the standing risk that "same repo" quietly becomes "lockstep
  releases", which it must not — see below.

## Constraint this does not remove
**Extension releases take days (Chrome Web Store review); API deploys take minutes.** The API must therefore
stay backward-compatible with older installed extension versions regardless of source layout. Monorepo means
lockstep *source*, never lockstep *releases*.

## Amended by ADR-0017 (2026-08-20)
`apps/dashboard` is renamed **`apps/web`** and its purpose changes. It is not a customer dashboard: it is a
public surface — Stripe success and cancel landings, privacy and terms — with an authenticated `/admin`
corner, and no customer ever has an account page on it. The plan choice and Checkout live in the extension
popup, so the app has **no customer login at all**. One workspace, one build; the `www.`/`admin.` split is
DNS at deploy time. See [ADR-0017](0017-web-surface-and-subscribing.md).

`packages/ui` keeps its reason to exist unchanged — it still serves two consumers, now the popup and
`apps/web` — and so does `packages/contracts`, which still types one API contract for both.

## What T59 cost (2026-08-20)
The "mixed Gradle + npm CI" above, priced. It is **two jobs in one workflow, neither carrying a `needs:`** —
no artefact crosses between the two toolchains and no version is shared, so the mixture costs a second job
rather than a second pipeline, and a broken extension test does not withhold the backend's verdict. What it
does *not* buy is a filter: both jobs read inputs from outside the directory they are named for, so
`.github/workflows/ci.yml` runs everything on everything and says why. Monorepo means lockstep *source*, and
this is the shape of CI that keeps it from meaning lockstep *verdicts* either.
