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
apps/dashboard      React SPA
packages/contracts  shared API types, consumed by both clients
packages/ui         design tokens + components, consumed by dashboard and popup
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
