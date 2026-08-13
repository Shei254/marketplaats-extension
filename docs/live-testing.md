# Live-testing the POC against real Marktplaats

The extension is fully wired **except** the actual Marktplaats internal endpoints,
which are unknown until discovered in a browser (spikes #2/#3/#4). Endpoints are
**runtime config** — you paste them in; no source edit or rebuild needed to retune.

> ⚠️ delete + re-create is destructive and against Marktplaats's terms (ADR-0002).
> Use a **throwaway ad on a test account**.

## 1. Build & load
```
npm install             # from the repo root — npm workspaces
npm run build           # emits apps/extension/dist/
```
`chrome://extensions` → enable Developer mode → **Load unpacked** → pick `apps/extension/dist/`.

## 2. Discover the endpoints (DevTools)
Log in to marktplaats.nl, open **Mijn Advertenties**, DevTools → **Network** →
filter **Fetch/XHR**, then do each action by hand and record method + URL + headers
+ request/response body:

| Action | Fills |
|---|---|
| Load "Mijn Advertenties" | `listMyAds` (+ response → ListingSummary mapping) |
| Open an ad's edit view | `captureAd` (+ detail → draft, photo URLs) |
| Delete a throwaway ad | `deleteAd` + the CSRF header/token source |
| Post a new ad (with photo) | `uploadPhoto` (multipart → media id) and `createAd` |

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

## 3. Configure the extension
Either the **Options page** (`chrome://extensions` → this extension → *Details* →
*Extension options*) — paste each path (use `:id` where the ad id goes) and the
CSRF source — **or** the service-worker console:
```js
await __setEndpoints({
  listMyAds: "/my-account/api/l/my-ads",
  captureAd: "/api/ads/:id",
  deleteAd:  "/api/ads/:id",
  createAd:  "/api/ads",
  uploadPhoto: "/api/pictures",
  csrf: { mode: "meta", name: "csrf-token", header: "x-csrf-token" },
});
```

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
Open the service-worker console (`chrome://extensions` → *Inspect views: service worker*):
```js
await __getEndpoints();          // sanity-check config
await __relist("<throwaway-ad-id>");
```
Watch it capture → snapshot → delete → re-create. Then verify safety for real:
force the create to fail (e.g. temporarily break `createAd`), confirm the snapshot
survives and `await __retry("<id>")` restores the ad — the ADR-0003 guarantee.

## Response-shape mapping
The `TODO(spike …)` comments in `apps/extension/src/content/marktplaats-api.ts` mark where the
real JSON field names go (ad id, price, photo URLs, media id, create payload).
Fill those once from the captured responses.

## Where things run
- **content script** (in the page): makes the real fetches, has session + CSRF.
- **relay client** (popup/worker): messages the content script; rebuilds typed errors.
- **orchestrator** (worker): delete-first state machine (unit-tested, unchanged).
- **snapshot store**: `chrome.storage.local` (base64 photos).
