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
need do nothing; the first `__setEndpoints` call clears it. Re-apply by hand any
override you still want.

## 4. Run a relist

### From the popup (one click)
Keep a marktplaats.nl tab open and click the extension icon. Each ad row has a
**Repost** button: it asks the **background worker** to run the relist (never the
popup itself — closing the popup mid-relist must not strand an ad between the
delete and the re-create), and shows the outcome on the row:

| Row shows | Meaning |
|---|---|
| *Reposting…* | in flight; the other rows are locked until it finishes |
| **Reposted** | `relisted` — snapshot cleared, then the list reloads under a green banner |
| *Nothing was reposted…* + **Try again** | `failed-before-delete` — the original ad is untouched |
| *Your ad was removed but…* + **Retry** | `failed-recoverable` — snapshot kept; Retry re-creates from it |

A create answers with 200/201/a redirect and no JSON, so `createAd` returns
nothing: not throwing *is* the success signal, and there is no new-ad id anywhere
in the relist contract. The reloaded list may not show the new ad immediately if
Marktplaats hasn't indexed it yet — the banner says so.

### From the console
Same service-worker console as step 3 — again, only in a `build:dev` build:
```js
await __listAds();               // what the popup would render
await __captureAd("<id>");       // capture only, nothing destructive
await __relist("<throwaway-ad-id>");
```
Watch it capture → snapshot → delete → re-create. Then verify safety for real:
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
