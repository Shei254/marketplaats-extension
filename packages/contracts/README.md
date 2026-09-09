# `packages/contracts` — the API's wire types

The shapes `docs/enforcement-contract.md` describes, in TypeScript, consumed by **both** clients (ADR-0011)
so a contract change lands atomically in one commit instead of twice with a gap in between.

**That document is the source of truth; this package is a restatement of it** — and a restatement that agrees
only with itself is exactly what it exists to prevent. So the suite reads both originals out of the working
tree: the contract document, and the API's own Java enums.

| Asserted against | What would otherwise drift |
|---|---|
| every `` `4xx CODE` `` in `docs/enforcement-contract.md` | a denial the document names and no client maps |
| `enforcement/internal/ReasonCode` + `identity`'s filter chain | a code the backend can send and this package has never heard of |
| `enforcement/internal/RelistOutcome` | an outcome `/complete` would refuse |
| `subscription/SubscriptionStatus` | a status the popup cannot describe |

The quiet failure those cover: a denial code the backend added and this package has not reaches the extension
as "something went wrong, try again" — for a user who could have fixed it in one click. Nothing throws, and
the first report is a support ticket.

## What is in it

`enforcement.ts`, and for now that is all of it: the denial reasons and their bodies, `authorize`'s request
and its authorization, `complete`'s request and the `{quotaRemaining, resetAt}` both it and the gate answer
with, the seven subscription statuses, and the `GET /api/me` display state.

Both of the endpoints this file used to name as missing now exist and are in it: `GET /api/plans` (T49,
[#80](https://github.com/Shei254/marketplaats-extension/issues/80)) and `GET /api/client-config` (T27,
[#36](https://github.com/Shei254/marketplaats-extension/issues/36)), each typed when its route was written.
**Nothing here is written ahead of the endpoint it describes** — that is a guess which later reads as a
contract, and it stays the rule for the next one.

**Every quota on the read side is `number | null`** since T73
([ADR-0029](../../docs/adr/0029-unlimited-is-null-and-zero-still-grants-nothing.md)): `null` is an unlimited
tier and `0` still grants nothing. TypeScript's strict-null does for the four clients what `Integer` does for
the server — it names every reader of a quota rather than leaving them to be found. The **write** side is the
one place this file cannot say what it means: on the admin `PUT` and `POST`, leaving `relistQuotaPerPeriod`
out is a `400` and sending it as an explicit `null` is unlimited, and an optional property and an explicit
`null` are the same declaration here — so the field stays required and the rule is written on the type.

**Dates travel as ISO-8601 strings**, exactly as they arrive. Parsing them into `Date` here would make this a
decoder with an opinion about clocks, and what every consumer actually does with `resetAt` is render it.

## Consuming it

```ts
import { DENIAL_REASONS, type DisplayState } from "@mprelist/contracts";
```

No build step and no `dist/`: both consumers bundle — esbuild for the extension, Vite for `apps/web` — so
`exports` points at TypeScript source. `apps/extension/src/gate/contracts.bundling.test.ts` proves the
extension's own bundler resolves that entry point, which vitest resolving it does not.

```bash
npm run typecheck -w @mprelist/contracts
npm test -w @mprelist/contracts
```

## The standing constraint

Shared source is **not** lockstep releases. Extension releases take days and API deploys take minutes
(ADR-0011), so the API stays backward-compatible with older installed builds: **removing or renaming a field
here is a versioning decision** ([#52, T43](https://github.com/Shei254/marketplaats-extension/issues/52)), not
a refactor. Adding one is free.
