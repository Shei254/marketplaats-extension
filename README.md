# Marktplaats Relist

Relist your Marktplaats ads to regain top ranking. A Chrome MV3 extension does the relisting in the page
under the user's own session; a Spring Boot API gates it on subscription and quota.

Monorepo, one deployable per workspace ([ADR-0011](docs/adr/0011-repository-layout.md)):

| Path | What | State |
|---|---|---|
| `apps/extension` | Chrome MV3 extension (esbuild, TypeScript) | the POC, working; signing in — Authorization Code + PKCE against the realm, driven from the service worker, with the session in `chrome.storage.local` and renewed at call time rather than on a timer, one refresh in flight at a time ([ADR-0010](docs/adr/0010-extension-authentication.md)); and the authorization gate — the pure function that decides whether a relist may happen, and fails closed on everything but a fresh `200`; the popup is React now, on `packages/ui`, routing between sign-in, the plan `GET /api/me` answers with, "unavailable", and the user's own ads beneath it — the Repost button on each row is T30b |
| `apps/api` | Spring Boot, Gradle, Java 21, Flyway | six modules with the boundary check, the schema, the seeded tier catalog and what each of its tiers grants, the resource server every route is closed behind, the account and free subscription a first sign-in provisions, both ends of the gate — `POST /api/relist/authorize` reserves a unit before anything is deleted and `POST /api/relist/complete` settles or refunds it against what the extension reports, with pacing rails saying how fast one account may relist and a scheduled reconciliation handing back the units nobody ever reports on — and `GET /api/me`, the unsigned snapshot both clients render after signing in, which grants nothing and spends nothing; and the `ADMIN` guard over `/api/admin/**`, a rule the `admin` module publishes and the filter chain applies, so the routes T53 adds are closed by being written there; `GET /api/plans` is next |
| `apps/web` | React SPA: public pages (Stripe success/cancel, privacy, terms) + an authenticated `/admin` corner. **No customer login** — plans and Checkout are in the popup ([ADR-0017](docs/adr/0017-web-surface-and-subscribing.md)) | reserved — T50 |
| `packages/contracts` | API types shared by both clients | the enforcement contract's wire shapes — denial reasons, `authorize`, `complete`, `/api/me` — held to [`docs/enforcement-contract.md`](docs/enforcement-contract.md) and to the API's own enums by its tests |
| `packages/ui` | design tokens + components (popup and `apps/web`) | the token sheet, generated as CSS, and the base controls — `Button`, `IconButton`, `Icon`, `Note`, `Skeleton`, `Spinner`. Light and dark, held to [`docs/design/`](docs/design/README.md) by its tests. No consumer yet; the popup is T29 |
| `infra` | docker-compose: Postgres + Keycloak | working, and the `mprelist` realm imports on first start |
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

`apps/api` is built with `./gradlew`, not npm, so the root scripts above never touch it:

```bash
cd apps/api && ./gradlew test
```

The wrapper fetches Gradle, and a Java 21 toolchain if the machine has none, on first run. Those tests start
a Postgres of their own, so they need a Docker daemon but not the stack below. That mixed Gradle + npm
toolchain is the cost ADR-0011 accepted, and CI below is where it is paid;
[`apps/api/README.md`](apps/api/README.md) covers the build in full.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml), on every push to `master` and every pull request.
**Two jobs, and neither waits for the other** — no artefact crosses between Gradle and npm and no version is
shared, so a broken extension test has no business withholding the backend's verdict:

| Job | Runs | Needs |
|---|---|---|
| `npm workspaces` | `npm ci`, then the three root scripts above | nothing but Node |
| `apps/api` | `./gradlew build` — the suite, then the boot jar | a Docker daemon, which the runner has |

The Node version is pinned in [`.nvmrc`](.nvmrc) rather than in the workflow, so `nvm use` and CI read one
file instead of two copies; Java is 21, which is the toolchain `apps/api/build.gradle.kts` already states.

There are **no path filters**, deliberately. Both jobs read inputs from outside the directory they are named
for — the API suite reads `infra/docker-compose.yml` and the Keycloak realm out of the working tree, the
extension build reads the root `brand.json` — so a filter would keep a second copy of both lists, and a
stale filter fails *silently*: a green run that looked at nothing.

## The local stack

Nothing in `apps/extension` needs it — the extension talks to Marktplaats, not to us. The backend does:

```bash
docker compose -f infra/docker-compose.yml up -d --wait   # Postgres on 5432, Keycloak on 8081
docker compose -f infra/docker-compose.yml down           # -v to also drop the data
```

`apps/api` will not start without it: Flyway migrates `mprelist` on startup and there is nowhere else to
point. Keycloak brings up the `mprelist` realm with it — three clients, the `ADMIN` role and two development
users — imported from [`infra/keycloak/`](infra/keycloak) on **first start only**, which is why the extension
id the redirect URI is built from has to be in the environment of that first `up`:

```bash
MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension) \
  docker compose -f infra/docker-compose.yml up -d --wait
```

That id is **derived, not stored**: T44 pinned it with a `key` in the extension manifest, and
`npm run extension-id` recomputes it from that key rather than reading a copy somebody kept in sync by hand.
Unset, sign-in from a real extension is refused rather than misrouted, and changing it afterwards means
`down -v`. Development credentials, ports, the realm and how to reset are in
[`infra/README.md`](infra/README.md).

## Loading the extension

`npm run build` writes `apps/extension/dist/`. Load that directory unpacked at `chrome://extensions` with
developer mode on.

The id Chrome shows there is **pinned by the `key` in the manifest**, so it is the same on every machine and
every checkout — not the path-derived one an unkeyed extension gets. `npm run extension-id -w
@mprelist/extension` prints what it should be; if Chrome disagrees, the manifest is not the one that was
loaded. The Web Store will assign a different id at publish, which is a one-command switch
(`extension-key … set`) and T56's job — see [`infra/README.md`](infra/README.md#your-extension-id).

The extension's user-facing name comes from the root [`brand.json`](brand.json). `public/manifest.template.json`
and `popup.html` carry `{{brand.name}}` tokens that the build resolves, so renaming the product before launch
is one edit and a rebuild — and a token that does not resolve **fails the build** rather than shipping as
literal braces. That is separate from
`mprelist`, the internal identifier frozen into `com.mprelist`, `@mprelist/*`, the Keycloak realm and the
database. The brand must never lead with "Marktplaats" — Web Store policy forbids trademark use that implies
endorsement, so it belongs in the description.

That default build is the shippable one. For live-testing use `npm run build:dev -w @mprelist/extension`,
which additionally defines `__DEV__` and so keeps the service worker's manual test hooks (`__relist`,
`__setEndpoints`, …). They are *eliminated* from the default build, not merely inert in it — hooks that can
delete a user's ad have no business in a published extension.
[`docs/live-testing.md`](docs/live-testing.md) drives the whole flow through them.

## Where to start reading

- [`docs/backlog.md`](docs/backlog.md) — the work breakdown. Cut into **vertical slices**: iteration 1 is the
  whole loop — sign in, get gated, pay, get unlocked — running locally against Stripe **test mode**, and
  **Go-Live** is its own milestone ([ADR-0016](docs/adr/0016-vertical-slices-and-review-gates.md)).
- [`docs/click-through.md`](docs/click-through.md) — the manual script each slice must pass. **A slice is done
  when its script has been walked, not when its tickets close.**
- [`docs/adr/`](docs/adr/README.md) — the decisions. If the backlog disagrees with an ADR, the ADR wins.
- [`docs/enforcement-contract.md`](docs/enforcement-contract.md) — the wire contract between extension and API.
- [`docs/adr/0015-frozen-internal-api-golden-tests.md`](docs/adr/0015-frozen-internal-api-golden-tests.md) —
  why `apps/extension/src/content/marktplaats-api.golden.test.ts` asserts request bytes, and what you may
  not change without deliberately re-recording them.
