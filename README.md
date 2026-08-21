# Marktplaats Relist

Relist your Marktplaats ads to regain top ranking. A Chrome MV3 extension does the relisting in the page
under the user's own session; a Spring Boot API gates it on subscription and quota.

Monorepo, one deployable per workspace ([ADR-0011](docs/adr/0011-repository-layout.md)):

| Path | What | State |
|---|---|---|
| `apps/extension` | Chrome MV3 extension (esbuild, TypeScript) | the POC, working; signing in — Authorization Code + PKCE against the realm, driven from the service worker, with the session in `chrome.storage.local` and renewed at call time rather than on a timer, one refresh in flight at a time ([ADR-0010](docs/adr/0010-extension-authentication.md)); and the authorization gate — the pure function that decides whether a relist may happen, and fails closed on everything but a fresh `200`; the popup is React now, on `packages/ui`, routing between sign-in, the plan `GET /api/me` answers with, "unavailable", and the user's own ads beneath it, each with a Repost button that runs one relist at a time — with a randomised 45–90s gap between consecutive ones, waited out in the worker and counted down on the row that is waiting — and shows what became of it, over a strip reading "2 of 3 relists left" that moves from `/complete`'"'"'s own answer rather than a second `GET /api/me` |
| `apps/api` | Spring Boot, Gradle, Java 21, Flyway | seven modules with the boundary check, the schema, the seeded tier catalog and what each of its tiers grants, the resource server every route is closed behind, the account and free subscription a first sign-in provisions, both ends of the gate — `POST /api/relist/authorize` reserves a unit before anything is deleted and `POST /api/relist/complete` settles or refunds it against what the extension reports, with pacing rails saying how fast one account may relist and a scheduled reconciliation handing back the units nobody ever reports on — and `GET /api/me`, the unsigned snapshot both clients render after signing in — what the tier grants beside what is left of it — which grants nothing and spends nothing; the `ADMIN` guard over `/api/admin/**`, a rule the `admin` module publishes and the filter chain applies, so the routes T53 adds are closed by being written there; and `POST /api/stripe/webhook`, the one route no token reaches — a Price created in the Stripe dashboard and tagged with a tier code fills in that tier and publishes it, or drafts one at quota 0 that sells nothing, and never writes a quota either way; and the compatibility lever — every client names its build in `X-Mprelist-Client`, and one older than the minimum this API serves is answered `426` before its request runs, which is the one thing that can be said to a release that has to stop; `GET /api/plans`, the published tiers joined with what Stripe says they cost — cached, never stored, and `503` rather than a guessed amount when Stripe cannot say; and `POST /api/checkout`, which turns a tier code into a Stripe session URL, refuses anything not on that same published list, and carries our own account id so the payment can be traced back to somebody — which is what the other half of the webhook then pulls on: a subscription starting, renewing, falling into dunning or ending is mirrored onto the subscriber's row, with a card that is still being retried keeping the tier it paid for and an end putting them back on the free one rather than locking them out; and `POST /api/portal`, which hands back a Stripe Customer Portal URL for whoever the token names — the card, the invoices and cancelling are Stripe's own pages, and the only question this API answers is which customer is asking, so somebody who cancelled or whose card is failing still reaches theirs |
| `apps/web` | React SPA: public pages (Stripe success/cancel/billing, privacy, terms) + an authenticated `/admin` corner. **No customer login** — plans and Checkout are in the popup ([ADR-0017](docs/adr/0017-web-surface-and-subscribing.md)) | React + Vite, one build: the frame, the route table, the three pages Stripe redirects to — the payment landed, nothing was charged, or the change is saved and the plan takes a moment to catch up — and the privacy policy and terms the Web Store listing needs, marked `[PLACEHOLDER]` on their face until a lawyer has read them. Nothing on any of them asks who the visitor is, and a test walks the directory to say so. `/admin` is T54 |
| `packages/contracts` | API types shared by both clients | the enforcement contract's wire shapes — denial reasons, `authorize`, `complete`, `/api/me` — held to [`docs/enforcement-contract.md`](docs/enforcement-contract.md) and to the API's own enums by its tests |
| `packages/ui` | design tokens + components (popup and `apps/web`) | the token sheet, generated as CSS, and the base controls — `Button`, `IconButton`, `Icon`, `Note`, `Skeleton`, `Spinner`. Light and dark, held to [`docs/design/`](docs/design/README.md) by its tests. Both surfaces are built from it — the popup and `apps/web` |
| `infra` | docker-compose: Postgres + Keycloak | working, and the `mprelist` realm imports on first start |
| `docs` | ADRs, specs, glossary, backlog | — |

None of them is reserved any more — `apps/web` was the last, and T50 (#81) filled it. The pattern, if
another is ever added: the directory holds a README and nothing else, naming the ticket that fills it.

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

## Credentials, in one file

```bash
cp .env.example .env     # once. `.env` is gitignored and is never committed
```

One file for the whole repository, read by everything that runs anything:

| Reads it | How |
|---|---|
| `./gradlew bootRun`, `./gradlew test` | `apps/api/build.gradle.kts` loads it into the JVM each starts |
| the local stack | `docker compose --env-file .env …`, as below |

**Your shell still wins.** A variable you have exported is used as exported, in both — so a one-off
`MPRELIST_STRIPE_SECRET_KEY= ./gradlew bootRun` is still one line rather than an edit and an undo.

[`.env.example`](.env.example) is the documentation: every variable, what reads it, and what happens when it
is unset. Nothing in it is needed to run the suites — they start their own Postgres and Keycloak and fake
Stripe — and `apps/api` starts without any of it too, saying at WARN what it is missing. What the file is for
is the parts that talk to somebody else's system: Stripe test mode, the mail the realm sends, and the
extension id the realm is built around.

**A variable you have no value for is commented out, never written empty.** Compose passes an empty
assignment to Keycloak as a variable that is *defined and empty*, and the realm file's own defaults apply
only where a variable is *absent* — so `MPRELIST_SMTP_HOST=` means "no mail host", not "the default one".
A test holds the example to that rule, and to every variable `application.yml` and the compose file actually
read.

## The local stack

Nothing in `apps/extension` needs it — the extension talks to Marktplaats, not to us. The backend does:

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait   # Postgres 5432, Keycloak 8081
docker compose --env-file .env -f infra/docker-compose.yml down           # -v to also drop the data
```

`apps/api` will not start without it: Flyway migrates `mprelist` on startup and there is nowhere else to
point. Keycloak brings up the `mprelist` realm with it — three clients, the `ADMIN` role and two development
users — imported from [`infra/keycloak/`](infra/keycloak) on **first start only**, which is why the extension
id the redirect URI is built from has to be in the environment of that first `up`. That is what
`--env-file .env` is carrying, and it is **not optional**: without it compose looks for a `.env` beside the
compose file, finds none, and imports a realm whose redirect URI has no extension in it — fixable only by
`down -v`. Naming a file that does not exist is an error rather than a shrug, which is why the flag is the
safer half of that trade.

That id is **derived, not stored**: T44 pinned it with a `key` in the extension manifest, `.env.example`
ships what that key derives to, and a test fails the build if the two ever disagree. Recompute it yourself
with `npm run -s extension-id -w @mprelist/extension`, or override it for one command the way the shell
always wins:

```bash
MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension) \
  docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
```

Development credentials, ports, the realm and how to reset are in [`infra/README.md`](infra/README.md).

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

## Running the site

```bash
npm run dev -w @mprelist/web       # http://localhost:5173/success, /cancel and /billing
```

`apps/web` is where Stripe lands a browser after Checkout and after the Customer Portal, and the pages it
lands on ask nobody to sign in —
the popup holds the only session this product has ([ADR-0017](docs/adr/0017-web-surface-and-subscribing.md)).
It reads the same `brand.json` as the extension and is built from the same `packages/ui`, so the two surfaces
are one look. **One build, one `index.html`**: the router runs in the browser, so whatever serves `dist/` has
to answer `/success` with that file rather than a 404 — `vite dev` and `vite preview` already do, and T55
(#86) is where a real host is told to.

## Where to start reading

- [`docs/backlog.md`](docs/backlog.md) — the work breakdown. Cut into **vertical slices**: iteration 1 is the
  whole loop — sign in, get gated, pay, get unlocked — running locally against Stripe **test mode**, and
  **Go-Live** is its own milestone ([ADR-0016](docs/adr/0016-vertical-slices-and-review-gates.md)).
- [`docs/click-through.md`](docs/click-through.md) — the manual script each slice must pass. **A slice is done
  when its script has been walked, not when its tickets close.**
- [`docs/adr/`](docs/adr/README.md) — the decisions. If the backlog disagrees with an ADR, the ADR wins.
- [`docs/enforcement-contract.md`](docs/enforcement-contract.md) — the wire contract between extension and API.
- [`docs/internal-api-findings.md`](docs/internal-api-findings.md) — what the POC spikes found out about
  Marktplaats's own internal API: the endpoints, the CSRF chain, why `createAd`'s field order is load-bearing,
  and what each failure mode looks like from the outside. Read it the night relisting breaks.
- [`docs/adr/0015-frozen-internal-api-golden-tests.md`](docs/adr/0015-frozen-internal-api-golden-tests.md) —
  why `apps/extension/src/content/marktplaats-api.golden.test.ts` asserts request bytes, and what you may
  not change without deliberately re-recording them.
