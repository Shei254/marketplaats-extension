# Marktplaats Relist

Relist your Marktplaats ads to regain top ranking. A Chrome MV3 extension does the relisting in the page
under the user's own session; a Spring Boot API gates it on subscription and quota.

Monorepo, one deployable per workspace ([ADR-0011](docs/adr/0011-repository-layout.md)):

| Path | What | State |
|---|---|---|
| `apps/extension` | Chrome MV3 extension (esbuild, TypeScript) | the POC, working |
| `apps/api` | Spring Boot, Gradle, Java 21, Flyway | reserved — #16 |
| `apps/dashboard` | React SPA | reserved — #42 |
| `packages/contracts` | API types shared by both clients | reserved — no owner; consumers #34/#36 |
| `packages/ui` | design tokens + components (popup and dashboard) | reserved — #37 |
| `infra` | docker-compose: Postgres + Keycloak | working; realm export still #15 |
| `docs` | ADRs, specs, glossary, backlog | — |

Each reserved directory holds a README and nothing else, naming the ticket or tickets that fill it — or,
where none owns it yet, the first tickets expected to create it, as with `packages/contracts`.

## Working on it

```bash
npm install        # once, from the root — npm workspaces
npm run typecheck  # every workspace that has the script
npm test
npm run build
```

The workspace globs are `apps/*` and `packages/*`, so a reserved directory becomes a real workspace simply by
gaining a `package.json` — the root file does not have to be edited again. The root scripts fan out with
`--workspaces --if-present`, so a workspace without that script — or without a `package.json` at all, like
the Gradle `apps/api` — is skipped rather than a failure. To work in one place:

```bash
npm run build -w @mprelist/extension
```

`apps/api` will be built with `./gradlew`, not npm, and CI will run it separately once either exists — this
repo has no CI config yet. That mixed Gradle + npm toolchain is the cost ADR-0011 accepted.

## The local stack

Nothing in `apps/extension` needs it — the extension talks to Marktplaats, not to us. The backend does:

```bash
docker compose -f infra/docker-compose.yml up -d --wait   # Postgres on 5432, Keycloak on 8081
docker compose -f infra/docker-compose.yml down           # -v to also drop the data
```

Development credentials, ports and how to reset are in [`infra/README.md`](infra/README.md).

## Loading the extension

`npm run build` writes `apps/extension/dist/`. Load that directory unpacked at `chrome://extensions` with
developer mode on.

That default build is the shippable one. For live-testing use `npm run build:dev -w @mprelist/extension`,
which additionally defines `__DEV__` and so keeps the service worker's manual test hooks (`__relist`,
`__setEndpoints`, …). They are *eliminated* from the default build, not merely inert in it — hooks that can
delete a user's ad have no business in a published extension.
[`docs/live-testing.md`](docs/live-testing.md) drives the whole flow through them.

## Where to start reading

- [`docs/backlog.md`](docs/backlog.md) — the work breakdown, mapped to GitHub issues #9–#55.
- [`docs/adr/`](docs/adr/README.md) — the decisions. If the backlog disagrees with an ADR, the ADR wins.
- [`docs/enforcement-contract.md`](docs/enforcement-contract.md) — the wire contract between extension and API.
- [`docs/adr/0015-frozen-internal-api-golden-tests.md`](docs/adr/0015-frozen-internal-api-golden-tests.md) —
  why `apps/extension/src/content/marktplaats-api.golden.test.ts` asserts request bytes, and what you may
  not change without deliberately re-recording them.
