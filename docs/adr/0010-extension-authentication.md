# ADR-0010: Extension authentication — launchWebAuthFlow + PKCE, extension as public client

**Status:** Accepted (2026-08-13)
**Scope:** Full app. Refines ADR-0005, which chose Keycloak but never said how an MV3 extension obtains a token.

## Context
ADR-0005 made Keycloak the identity provider and Spring Boot an OAuth2 resource server, but left the client
side of that exchange undefined. A Chrome MV3 extension is an unusual OIDC client: it has no stable web
origin, its service worker is evicted aggressively, and under ADR-0007 **the user is the adversary**.

Three approaches were weighed:
1. `chrome.identity.launchWebAuthFlow` driving Authorization Code + PKCE against Keycloak directly.
2. A backend-brokered (BFF) exchange, where Spring performs the code exchange, retains Keycloak tokens
   server-side, and mints its own token for the extension.
3. A session cookie on our API domain.

The usual objection to (1) — "don't put refresh tokens in a client" — carries much less weight here. A user
reading their own refresh token out of extension storage gains nothing they don't already have; they own the
credentials that minted it. The threat model that justifies a BFF (protecting a token from *someone else*)
does not apply.

## Decision
**`chrome.identity.launchWebAuthFlow` with Authorization Code + PKCE.** The extension is a Keycloak
**public client**; the redirect URI is `https://<extension-id>.chromiumapp.org/`. The extension holds the
access token and a rotating refresh token in extension storage and sends a Keycloak bearer to our API —
exactly what `docs/enforcement-contract.md` already assumes.

## Consequences
- **Positive:** Standard, documented path with the least moving parts; no token-broker to build or operate;
  the API stays a plain OAuth2 resource server with no second token type to model.
- **Negative / operational:**
  - The **extension ID must be pinned** — via a `key` in the manifest, or by publishing first — or the
    registered redirect URI breaks when the extension moves or is rebuilt elsewhere. See below.
  - The MV3 service worker sleeps, so **token refresh must be on-demand at call time**, never on a timer.
  - Revocation is only as fast as the access-token TTL; central kill-switch behaviour would need the BFF.
- The dashboard is a separate Keycloak client; only the extension uses the `chromiumapp.org` redirect.

## Obtaining the extension ID before the extension is finished
The redirect URI is `https://<extension-id>.chromiumapp.org/`, which looks like it requires a published
extension. It does not — the ID and the release are independent.

| Approach | ID stability | Cost |
|---|---|---|
| **Create a Web Store item as an unpublished draft**, then copy its public key from the dashboard into `manifest.json` as `"key"` | **Permanent** — local unpacked builds share the ID with the eventual published extension | One-time $5 developer registration; no review, no publishing, drafts stay private |
| **Generate your own RSA key** and base64 its public half into `manifest.json`'s `"key"` | Stable across machines and reloads, but **the Web Store assigns a different ID at upload** — Google signs with their key, not yours | Free; costs one redirect-URI change at publish time, which is easy to forget and presents as an auth bug |
| **Do nothing** | An unpacked extension with no `"key"` derives its ID from the **absolute directory path** — stable per machine and checkout, different for every developer | Free; register each developer's ID in a dev-only Keycloak client |

**Recommended sequence:** start on the third row to unblock development, move to the first before any shared
or staging environment exists. Do **not** solve this with a wildcard redirect URI in Keycloak — it works, but
an open redirect target on a public OAuth client is not something to carry into production.

**This is not a blocker on other work.** Only a *stable* redirect URI depends on it; the popup rebuild,
golden-payload tests, monorepo move, and backend modules all proceed independently.

## Revisit if
Central, immediate session revocation becomes a requirement, or a second IdP has to be supported without
shipping an extension update → move to the backend-brokered (BFF) option, which confines that change to
the server.

## What T44 actually did (2026-08-20)
The recommended sequence above was "start on the third row, move to the first before any shared environment".
**We took the second row instead** — our own RSA key, generated locally, its public half committed as `key`
in `apps/extension/public/manifest.template.json`. The id is `dolloiambeojifmnofjchofbnepodiof`.

(That file was `public/manifest.json` when T44 landed; T48 renamed it to a template and the build now resolves
brand tokens into it. `key` passes through untouched, which `scripts/build.test.ts` asserts against the
emitted manifest.)

Why not the third row: it is per-machine and per-checkout, and the id is baked into a redirect URI in a realm
that imports on **first start only**. "Free" is only free until the second machine, and the failure it
produces then is an `Invalid parameter: redirect_uri` a long way from its cause.

Why not the first: a Web Store developer account was not in hand, and the account is wanted for the listing
anyway (T58) rather than for this. Deferring it costs one redirect-URI change at publish, which is the stated
cost of this row.

**That cost is paid for by making the switch one command rather than a hunt.** `scripts/extension-key.mjs`
holds the id in exactly one place — it is *derived* from the manifest key, never stored — so:

```bash
npm run extension-key -w @mprelist/extension -- set <the Web Store public key>   # at publish
MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension)          # everywhere else
```

Nothing in the repository, in `infra/README.md`, or in a developer's shell history holds a literal copy that
could go stale. The one place our derivation is checked against Chrome's is step 1 of
[`../click-through.md`](../click-through.md) — a unit test can only prove we are self-consistent.

**Confirmed 2026-08-20:** the extension was loaded unpacked and Chrome showed
`dolloiambeojifmnofjchofbnepodiof`, matching `npm run extension-id`. So the derivation in
`scripts/extension-key.mjs` is not merely self-consistent — it agrees with the implementation that matters.

**The remaining risk is the one this ADR named:** forgetting the switch at publish. It is written into
[#87 (T56 · Domain, TLS, and the production realm)](https://github.com/Shei254/marketplaats-extension/issues/87)
rather than left to memory, because the production realm is built from scratch there and is the last moment
the id can be got right for free.
