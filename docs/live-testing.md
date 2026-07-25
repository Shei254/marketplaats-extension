# Live-testing the POC against real Marktplaats

The extension is fully wired **except** the actual Marktplaats internal endpoints,
which are unknown until discovered in a browser (spikes #2/#3/#4). Endpoints are
**runtime config** — you paste them in; no source edit or rebuild needed to retune.

> ⚠️ delete + re-create is destructive and against Marktplaats's terms (ADR-0002).
> Use a **throwaway ad on a test account**.

## 1. Build & load
```
npm install
npm run build           # emits dist/
```
`chrome://extensions` → enable Developer mode → **Load unpacked** → pick `dist/`.

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

Note the **host** (may be an `api.` subdomain — already covered by
`host_permissions`) and where the **CSRF token** lives (a `<meta>`, a readable
cookie, or none).

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
Keep a marktplaats.nl tab open (the content script relays through it). Open the
service-worker console (`chrome://extensions` → *Inspect views: service worker*):
```js
await __getEndpoints();          // sanity-check config
await __relist("<throwaway-ad-id>");
```
Watch it capture → snapshot → delete → re-create. Then verify safety for real:
force the create to fail (e.g. temporarily break `createAd`), confirm the snapshot
survives and `await __retry("<id>")` restores the ad — the ADR-0003 guarantee.

## Response-shape mapping
The `TODO(spike …)` comments in `src/content/marktplaats-api.ts` mark where the
real JSON field names go (ad id, price, photo URLs, media id, create payload).
Fill those once from the captured responses.

## Where things run
- **content script** (in the page): makes the real fetches, has session + CSRF.
- **relay client** (popup/worker): messages the content script; rebuilds typed errors.
- **orchestrator** (worker): delete-first state machine (unit-tested, unchanged).
- **snapshot store**: `chrome.storage.local` (base64 photos).
