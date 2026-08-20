# Live-testing the POC against real Marktplaats

The endpoints the spikes discovered ship as `DEFAULT_ENDPOINT_CONFIG` in
`apps/extension/src/shared/endpoint-config.ts`, so the extension works out of the
box. They stay **runtime config**: when Marktplaats moves one, you paste the new
path in from the console — no source edit or rebuild needed to retune. (Backend-served
config replaces that console hook — [ADR-0013](adr/0013-remote-client-configuration.md), #36.)

> ⚠️ delete + re-create is destructive and against Marktplaats's terms (ADR-0002).
> Use a **throwaway ad on a test account**.

## 1. Build & load
```
npm install                          # from the repo root — npm workspaces
npm run build:dev -w @mprelist/extension   # emits apps/extension/dist/
```
`chrome://extensions` → enable Developer mode → **Load unpacked** → pick `apps/extension/dist/`.

**Use `build:dev`, not `build`.** The console hooks below exist only in that build;
plain `npm run build` emits the shippable extension, with the hooks eliminated at
build time rather than merely hidden (`apps/extension/scripts/build.mjs`).

## 2. Re-discover an endpoint (DevTools)
Only needed when something breaks — a call 404s, or the CSRF token stops being
found. Log in to marktplaats.nl, open **Mijn Advertenties**, DevTools → **Network** →
filter **Fetch/XHR**, then do the action by hand and record method + URL + headers
+ request/response body:

| Action | Fills |
|---|---|
| Load "Mijn Advertenties" | `listMyAds` (+ response → ListingSummary mapping) |
| Search from that page's box | `searchAd` — same path as `listMyAds`, plus a `query` param |
| Open an ad's edit view | `captureAd` (+ detail → draft, photo URLs) |
| Delete a throwaway ad | `deleteAd` + the CSRF header/token source |
| Open "Plaats je advertentie" | `createAdPage` — HTML, scraped for `signature`/`timestamp`/`tmsid` |
| Pick a top-level category there | `getBuckets` (`:parentCategoryId`) |
| Drill into one of its buckets | `getBucketCategories` (`:parentCategoryId`, `:bucketId`) |
| Post a new ad (with photo) | `uploadPhoto` (multipart → media id) and `createAd` |

That is all nine `EndpointName`s. The last three are not called by hand during a
relist — `createAd` needs the scraped form attributes, and re-creating a captured ad
fans out category → bucket to fill the `bucket` form field — so they break silently
in the middle of a create rather than at the first call.

Note the **host** (it may be an `api.` subdomain — see the CORS caveat below) and
where the **CSRF token** lives (a `<meta>`, a readable cookie, or none).

> ### ⚠️ Cross-subdomain CORS caveat
> The content script's `fetch`es run in the **page origin** (`www.marktplaats.nl`)
> and are therefore subject to **CORS**. Same-origin calls (`www` → `www`) are fine.
> But if an endpoint lives on a **different subdomain** (e.g. `api.marktplaats.nl`)
> and that host doesn't return CORS headers allowing the `www` origin, the call is
> **blocked by the browser** — you'll see a CORS error in the page console, not a
> clear app message. Two mitigations, decided during the spike:
> 1. Prefer the **same-origin** variant of the endpoint if one exists.
> 2. Otherwise route that specific call through the **background service worker**,
>    whose `fetch` is *not* CORS-bound for hosts in `host_permissions`. The content
>    script would read the CSRF token from the page and hand it to the worker to
>    perform the request. (Not wired yet — capture the real host first.)

## 3. Override what changed
In the service-worker console (`chrome://extensions` → *Inspect views: service worker*):
```js
await __getEndpoints();                        // what the layer will actually call
await __setEndpoints({ deleteAd: "/seller/api/remove-ad" });
await __setEndpoints({ csrf: { mode: "meta", name: "csrf-token", header: "x-csrf-token" } });
```
Only the keys you pass are stored, and successive calls accumulate. Everything you
never overrode keeps following the build, so a later build that corrects a *different*
endpoint's default still reaches you. `__setEndpoints` returns the overrides now in
effect; `__getEndpoints` shows the paths they resolve to. Drop them all and go back to
the built-in defaults with:
```js
await chrome.storage.local.remove("endpointOverrides");
```
The `csrf` object is replaced wholesale, never merged — the four modes carry
different fields, so pass a complete one. The POC Options page that also wrote this
config is gone (ADR-0013); `__setEndpoints` is the whole surface until #36 lands.

**If you live-tested before this change**, your profile is under the old
`endpointConfig` key, and it holds a *resolved* config — all nine endpoints frozen
at the defaults of whatever build first wrote it, which is the bug overrides fixed.
Nothing reads that key any more, so you are already back on the build's defaults and
need do nothing. Re-apply by hand any override you still want: the first
`__setEndpoints` call also sweeps the dead key — though only in a dev build, since
that is the only place the hook exists, so a production install keeps it forever,
inert and unread.

## 3b. Sign in

Sign-in runs in the **worker**, not the popup — `launchWebAuthFlow` opens a window, and the popup dies the
moment that window takes focus. Until the React popup lands (#38) the console is the way to drive it, in a
`build:dev` build:

```js
await __authState();   // { status: "signed-out" }
await __signIn();      // opens the real Keycloak window; sign in as `dev` / `dev`
await __authState();   // { status: "signed-in", expiresAt: … }
await __signOut();     // clears our session and ends Keycloak's
```

Once signed in, `__accessToken()` hands back a token that is usable *now* — refreshing first if the one held
has expired, which is the whole of T24 (#33) — so the backend can be driven by hand before any client calls it:

```js
const { token } = await __accessToken();
// then, in a terminal:
//   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/me | jq
```

It answers `{ status: "signed-out" }` when there is nothing to renew, and `{ status: "unavailable" }` when
Keycloak could not be reached — in which case the session is left alone rather than thrown away, so trying
again a minute later is the right move. It is also the one hook that hands over a secret: nothing here *logs*
one, and this has to be asked.

The stack has to be up, and it has to have been started with the extension id in the environment — the realm
imports on first start only, so a realm built without it refuses the redirect (`infra/README.md`). What that
failure looks like from here is `Invalid parameter: redirect_uri` in the Keycloak window.

`__signIn()` rejects with a `SignInCancelledError` if you close the window, and a `SignInFailedError` for
everything else, carrying Keycloak's own words — `invalid_client` means the realm has no such client,
`invalid_grant` a PKCE or redirect-URI mismatch. Nothing logs a token, a code or the PKCE verifier, so a
console you paste into an issue carries none of them.

## 4. Run a relist

### From the popup

The popup is React now (#38, #39): sign in, the plan and what is left of it, and
the user's own ads beneath it. **There is no Repost button yet** — the row's
idle / busy / done / failed machine and the one-relist-at-a-time lock are T30b
(#79), so until then a relist is run from the console below.

What the popup shows, and what each one proves:

| Screen | Means |
|---|---|
| **Sign in**, and nothing else | no session, or a token the API refuses. ADR-0007's refinement: signed out shows no quota, and asks Marktplaats for nothing |
| **Free · 2 relists left · resets 14 Sep** | `GET /api/me` answered. The number is the one the gate refuses on |
| the ads, with titles and prices | the content script reached Marktplaats in the user's own session |
| **You have no active ads.** | it reached Marktplaats and the account has none — an answer, not a failure |
| **Could not load your ads. Open marktplaats.nl in a tab…** | the relay had no tab to talk to. The other messages name a login, a pending spike's endpoint, or the HTTP status Marktplaats refused with |
| **Can't reach {brand} right now** | *our* backend is down, or answered something unreadable. Never a plan — fail-closed applies to display |

The last two are worth telling apart while testing: the ad list comes from
Marktplaats and the strip above it comes from our API, so one can fail while the
other is fine, and the screen says so rather than collapsing both into one error.

The strip says "2 relists left" rather than the canvas's "2 of 3": `/api/me`
carries what is left and not what the tier grants. See #41.

A create answers with 200/201/a redirect and no JSON, so `createAd` returns
nothing: not throwing *is* the success signal, and there is no new-ad id anywhere
in the relist contract.

### From the console
Same service-worker console as step 3 — again, only in a `build:dev` build:
```js
await __listAds();               // what the popup would render
await __captureAd("<id>");       // capture only, nothing destructive
await __relist("<throwaway-ad-id>");   // now goes through the gate: `{status:"refused"}` is an answer
await __apiMe();                 // the plan the popup is drawing, or why it is not
```
Since T26 (#35) that call **authorizes first**, so with the API down or the quota
spent it answers `{ status: "refused", locked: … }` and nothing is captured, let
alone deleted — which is the first thing worth checking, because it is the whole
of fail-closed. With permission granted, watch it capture → snapshot → delete →
re-create. Then verify safety for real:
force the create to fail (e.g. `await __setEndpoints({ createAd: "/nope" })`), confirm
the snapshot survives and `await __retry("<id>")` restores the ad — the ADR-0003
guarantee. `await __resume()` replays whatever a crash left half-done.

## Response-shape mapping
The mapping from Marktplaats's JSON to our types is in
`apps/extension/src/content/marktplaats-api.ts`, and the exact bytes each operation
emits are frozen by `marktplaats-api.golden.test.ts`
([ADR-0015](adr/0015-frozen-internal-api-golden-tests.md)) — read the test to see a
request without making one. What the spikes *observed*, including the known fidelity
limits, is #53's findings note; it does not exist yet.

## Where things run
- **content script** (in the page): makes the real fetches, has session + CSRF.
- **relay client** (popup/worker): messages the content script; rebuilds typed errors.
- **orchestrator** (worker): delete-first state machine (unit-tested, unchanged).
- **snapshot store**: `chrome.storage.local` (base64 photos).
