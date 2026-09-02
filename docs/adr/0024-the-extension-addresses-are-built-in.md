# ADR-0024: The extension's own addresses are built in, and the served configuration may never carry them

**Status:** Accepted (2026-09-02)
**Scope:** Extension. **Refines [ADR-0013](0013-remote-client-configuration.md)** by recording what its
document may not carry, and why that is a property of the sequence rather than of the implementation.
T56 ([#87](https://github.com/Shei254/marketplaats-extension/issues/87)) builds it.

## Context
Two constants decide where a published extension talks:

```
apps/extension/src/api/api-config.ts:18    baseUrl: "http://localhost:8080"
apps/extension/src/auth/auth-config.ts:38  issuer: "http://localhost:8081/realms/mprelist"
```

Both files carry the same comment, in almost the same words: *"#36 is what will serve this as client config
instead of building it in."* [#36](https://github.com/Shei254/marketplaats-extension/issues/36) shipped, and
deliberately did not. ADR-0013's 2026-08-23 amendment says what the document actually carries — the nine
Marktplaats paths, the CSRF rules and the pacing window — and states plainly that they "live in the extension
and nowhere else."

Nor does the build inject them: `scripts/build.mjs`'s `define` block covers `__DEV__` and
`process.env.NODE_ENV` and nothing else. So **`npm run build` today produces an extension that talks to
localhost, and there is no way to build a shippable one.** `docs/click-through.md` already records this as
what its Go-Live script "does not check, and cannot yet".

That is a Go-Live blocker, and a blocker alone needs a ticket rather than an ADR. What needs an ADR is the
second half: **the fix both of those comments propose cannot work**, and the next person to read them will
propose it again.

## Decision
**Both addresses are build-time, resolved from a committed `deployment.json` the way `brand.json` already
is — and the served client-config document may never carry either of them.**

### The rejection, first, because it is what will be re-proposed

**`baseUrl` cannot be served, because it is the address the served document is fetched from.**
`client-config.ts:121` requests `${this.config.baseUrl}/api/client-config`. An extension that does not
already know where the API is cannot ask the API where it is.

**`issuer` cannot be served either, for a different reason: order.** Signing in is what produces the token
every API call carries, so sign-in *precedes* the first client-config fetch. A document that arrives after
sign-in cannot have told the extension which realm to sign into.

Neither is a limitation of how #36 was built. Both are properties of the sequence, and they would hold
against any implementation.

### The mechanism
**`deployment.json` at the repository root, beside `brand.json`**, resolved by the build the same way and
failing the build the same way. T48 ([#78](https://github.com/Shei254/marketplaats-extension/issues/78))
established the pattern and `scripts/brand.test.ts` holds it there: a token that does not resolve **fails the
build** rather than shipping as literal braces. The same guard is what stops a release from silently
carrying `localhost` into the Web Store. `build:dev` keeps the local stack's addresses, which is the split
`__DEV__` already draws between the two builds.

**Committed, not environment.** These are public URLs and not secrets, so git is where they belong — and the
consequence is the reason rather than a side effect: moving from one deployment's hostnames to another's
becomes **one reviewable commit**, in the one part of this product where the change cannot be undone without
a Chrome Web Store review.

## Consequences
- **The domain must be final before the extension is submitted.** This is the whole practical weight of the
  decision. It is why [ADR-0020](0020-deployment.md)'s successor work sequences the domain ahead of T58
  (#89), and why the backlog already has T60 (#91) upstream of both.
- **Negative, and sharp: if the API's address moves after publication, the compatibility lever cannot reach
  the builds that are stranded.** T43's `X-Mprelist-Client` and its `426 Upgrade Required` are the one thing
  this API can say to a release that has to stop — but saying it requires the build to reach the API, which
  is precisely what a moved address prevents. The 426 lever assumes the address is the fixed point. It is.
- **Negative:** ADR-0013's whole purpose was turning a multi-day Web Store review into a config deploy. That
  value is undiminished for what it covers — Marktplaats moving a path — and simply absent for our own
  addresses. The two failure modes look alike from a user's seat and are nothing alike to fix.
- **Negative:** deployment addresses now live in two files that must agree and nothing checks —
  `deployment.json` for the extension, `production.env` for the stack. There is no test that can close this,
  because `production.env` is never committed. The click-through is where it is caught: a real build, signing
  in against the deployed realm.
- **Positive:** the shipped artefact is reproducible from a checkout. Rebuilding last month's release means
  checking out last month's commit, not remembering last month's flags.
- **Consequence for the publish runbook — a cycle that has to be broken deliberately.** The production realm
  registers `https://<id>.chromiumapp.org/` and imports on first start; the Web Store assigns an id different
  from the one this repository's key derives, and only once a store item exists; creating that item needs a
  built extension, which needs the deployed addresses, which need the realm. Break it by creating the store
  item as an **unpublished draft** with any buildable zip, reading the assigned id, running
  `npm run extension-key -w @mprelist/extension -- set <key>`, and only then first-starting the production
  realm. `infra/README.md` § Deploying carries the ordered steps.

## Revisit if
- The extension has to reach more than one deployment — a staging stack beside production — at which point
  `deployment.json` becomes a set of named profiles and the build selects one, rather than the file being
  edited between builds.
- MV3 ever gains a first-party mechanism for per-deployment configuration that is not remotely hosted code.
  Nothing here is a complaint about the ban in ADR-0013; the constraint above is ordering, not policy, and
  would survive the ban being lifted.
