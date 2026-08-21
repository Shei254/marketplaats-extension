# What the Marktplaats spikes found

The internal API this extension drives, as the POC spikes ([#3](https://github.com/Shei254/marketplaats-extension/issues/3),
[#4](https://github.com/Shei254/marketplaats-extension/issues/4)) discovered it — written down at last
(**T45**, [#53](https://github.com/Shei254/marketplaats-extension/issues/53)), because until now it existed
only as code, inline comments, and whatever the person who ran the spikes still remembered.

**This is the note you want at 23:00 when relisting has broken and you are authoring a config fix.**
[`live-testing.md`](live-testing.md) is how to *discover* what Marktplaats is doing now; this is what it was
doing when the mechanic was proved, so you can tell what changed.

## How to read a claim here

Marktplaats publishes none of this and guarantees none of it. Every line below is one of three things, and
they are **not** equally strong:

| | |
|---|---|
| **Observed** | seen against the live site during the spikes, and load-bearing enough that the code carries a comment saying so — the `createAd` field order is the clearest case (`MOVED: Placed up here to match the working payload order`) |
| **Frozen** | recorded in the golden fixtures and asserted byte-for-byte by `marktplaats-api.golden.test.ts` ([ADR-0015](adr/0015-frozen-internal-api-golden-tests.md)). A frozen claim is what we *send*; it is not proof the site still accepts it |
| **Coded** | true of `marktplaats-api.ts` today and never separately observed — a shape the parser accepts, which is not the same as a shape the site emits |

The distinction is the whole value of this file. A golden test proves a regression is *ours*; only the live
site can say whether what we send still works, and the only end-to-end check available is **destructive**
(ADR-0002/0003) — a failed re-create costs a real listing.

**Nothing here has been re-verified since the spikes.** Treat every path as a hypothesis when something
breaks, and confirm it in DevTools before writing a config override.

---

## The endpoints

The defaults live in [`apps/extension/src/shared/endpoint-config.ts`](../apps/extension/src/shared/endpoint-config.ts)
and every one of them is overridable at runtime (ADR-0013) — see [Fixing a breakage](#fixing-a-breakage).
All requests go out with `credentials: "include"`, from a content script running on `marktplaats.nl`, so the
user's own session cookie is what authenticates them. **Observed** paths, **frozen** methods and bodies:

| Operation | Method | Path | Answers with |
|---|---|---|---|
| `listMyAds` | GET | `/my-account/sell/api/listings` | JSON `{ ads: [...] }`; the code reads `data.ads ?? []` |
| `searchAd` | GET | `/my-account/sell/api/listings?query=…` | the same shape, filtered. **The same path** — search is a query parameter, not an endpoint |
| `captureAd` | GET | `/seller/view/:id` | **HTML**, scraped. See below |
| `deleteAd` | DELETE | `/seller/api/delete-ad` | body ignored. Carries a JSON body, which is unusual for a DELETE |
| `createAd` | POST | `/plaats/ads` | a redirect or a 200 with **no JSON to read** — reaching the end of the call is the success signal |
| `createAdPage` | GET | `/plaats/1744/1745` | **HTML**, scraped for `signature` / `timestamp` / `tmsid` |
| `uploadPhoto` | POST | `/plaats/api/image/upload` | JSON `{ id, imageUrl, largeImageUrl, extraLargeImageUrl, valid }` |
| `getBuckets` | GET | `/plaats/api/v1/category-aggregate/:parentCategoryId/buckets` | JSON array of `{ id, … }` |
| `getBucketCategories` | GET | `/plaats/api/v1/category-aggregate/:parentCategoryId/buckets/:bucketId/categories` | JSON array of `{ id, … }` |

**Two of the nine are HTML.** That is the fragile half: a JSON endpoint changes shape loudly and a scraped
page changes shape silently, because the page still renders perfectly well for a human.

**`/plaats/1744/1745` is a category-specific form** — 1744 is *Fietsen en Brommers*, 1745 is *Herenfietsen*,
which is the category the spike's test ad happened to be in. `getCreateFormAttributes` GETs that one page
**whatever category the ad being created is in**, so every `signature`/`timestamp`/`tmsid` we send is scraped
from a bicycle form. Nobody has established whether the signature is category-scoped. It worked for the
spike's ads; a car ad (`isCarAd`) is the likeliest place for it to stop working, and that is a hypothesis
rather than a finding.

---

## The session and the CSRF token

**Mode `fetch`, and the header is `x-mp-xsrf`.** Both **observed**. The token is not in a meta tag and not in
a readable cookie: it is fetched from a page and pulled out of the hydration payload.

The source page in the defaults is `https://www.marktplaats.nl/plaats/1/2` — an absolute URL, and the only
absolute one in the config, so a config override that makes it relative changes which origin it is read from.

**The extraction is a chain of three, and the order surprises people** ([`csrf.ts`](../apps/extension/src/content/csrf.ts)):

1. **Every `<script>` in the fetched page** is scanned for the words `xsrf`/`csrf` (case-insensitive), and
   the first match of `/['"]?(?:xsrf|csrf)[_A-Z]*[tT]oken['"]?\s*[:=]\s*['"]([^'"]+)['"]/` wins. This is the
   path that runs in practice — the token sits in a hydration blob as `"xsrfToken":"…"` (**frozen**: that is
   the shape the fixture carries and the golden suite exercises).
2. **The same regex over the raw HTML**, for a token in a meta tag or an attribute rather than in a script.
3. **Only then the configured `extractor`** — which in the defaults is a DOM selector,
   `input[name='xsrf.token']`. So the extractor you would edit first is the one that runs **last**. If you
   are overriding CSRF config and nothing changes, this is why.

**The token travels twice on `createAd`**: as the `x-mp-xsrf` header *and* as an `xsrf.token` form field.
Both are **frozen**. Sending only one has not been tried.

**Refresh and retry** (**coded**, and asserted **frozen**): a `403` or `419` on a mutating request triggers
exactly one refresh-and-retry. A second refusal is raised as `NotAuthenticatedError`. GETs never carry the
header. Concurrent callers share one in-flight refresh — the pattern `ensureCsrfToken` exists for — and the
cached token is dropped whenever the stored endpoint config changes.

---

## `captureAd`: scraping the seller-view page

`GET /seller/view/:id` returns HTML. The ad is read out of it by trying, in order (**coded**):

1. `script#__NEXT_DATA__[type="application/json"]` — parsed as JSON.
2. `script#__APOLLO_STATE__[type="application/json"]` — parsed as JSON.
3. any inline `<script>` containing `window.__CONFIG__`, isolated with
   `/window\.__CONFIG__\s*=\s*(\{[\s\S]*?\});?\s*(<\/script>|$|window\.)/`.

Then `windowConfig.listing ?? windowConfig` — so the payload may either wrap the ad under `listing` or *be*
the ad. Both shapes are **frozen** in the fixtures; which one the live site emits today is unknown, and the
three-way parser is itself the record that the spikes met more than one.

**A 200 with no recognisable payload is `AdNotFoundError`.** A 404 is not: it falls through to the generic
`ApiRequestError`, because `captureAd` does not pass `notFoundIsMissing`. Only `deleteAd` does. So "the ad is
gone" reads as two different errors depending on how it is gone — worth knowing when reading a bug report.

After the parse, one capture makes **`1 + P + 1 + B` requests**: the page, one per gallery photo, one
`getBuckets`, and one `getBucketCategories` per bucket returned.

---

## Category → bucket: an N-request fan-out per capture

The captured ad carries `categoryInformation.{categoryId, parentCategoryId}` but **not** the `bucketId` the
create form wants. Resolving it (**coded**):

1. `getBuckets(parentCategoryId)` → the parent's buckets.
2. For **every** bucket, in parallel, `getBucketCategories(parentCategoryId, bucketId)` → its categories.
3. The first bucket whose categories contain `categoryId` wins.

So a parent category with twelve buckets costs twelve requests, every time an ad in it is captured. Nothing
is cached between captures. There is no index endpoint we know of that answers "which bucket holds category
X" directly; if one exists, finding it removes the fan-out.

**A bucket request that fails is swallowed** (logged, treated as "no match"), so a partial outage degrades to
"no bucket resolved" rather than to an error. No match at all raises `SpikePendingError` — which is a message
saying the mapping failed, not a crash, and was written after a `null` bucket produced an opaque `TypeError`.

**`createAd` falls back to bucket `9`** when the draft carries none (`draft.bucketId || 9`). 9 is not a
universal default; it is what the spike's ads resolved to often enough to be worth a fallback. An ad created
under the wrong bucket is a real risk here and would not fail loudly.

---

## `createAd`: the field order is load-bearing

This is the finding the whole layer is built around, and it is the one that cost the most to establish.
**Observed**: the body is `application/x-www-form-urlencoded` and Marktplaats rejects orderings that carry
the same fields in a different sequence. The code's own `MOVED:` comments are the record of that trial and
error:

- `url` is emitted **immediately after the description**, not with the other empty fields.
- `packageSize` comes **before** the price details, not after the shipping price.
- `price.minimumBidPrice` comes **before** `price.typeValue`.
- `contactInformation.phoneNumberSwitch` comes **before** the `syi-address-*` fields.
- `bucket` is grouped **between `l1` and `l2`**, not after the category names.
- `tmsid`, `timestamp`, `signature` are **last**, in that order.

Which exact orderings were tried and refused is *not* recorded — the comments say "to match the working
payload order" and no failing variant was kept. That is the gap this note cannot close, and the reason the
golden test freezes the sequence byte-for-byte: nobody can re-derive it cheaply.

The full sequence for a maximal ad is **frozen** in `marktplaats-api.golden.test.ts` (`FULL_PAIRS`, 35 fields
for two photos). Its shape:

```
images.ids, images.urls        ×P, then one trailing empty `images.ids`
title_nl-NL, description_nl-NL, url
singleSelectAttribute[type]    ← the `type` attribute, else the category name
deliveryMethod                 ← only if the draft has one
buyerProtectionAllowed=on      ← only when true; omitted entirely when false
shippingMethod ×carriers, packageSize=M, shippingDetails.{price,provider}
                               ← the whole block only when a shipping option is selected
Dropdown-prijstype, price.minimumBidPrice, price.typeValue, previousPriceType
price.biddingEnabled=on        ← only when true; omitted entirely when false
contactInformation.sellerName, contactInformation.phoneNumberSwitch=false
syi-address-radio-home, address-index-filter, contactInformation.postCode
bundle-selection=FREE, selectedBundle=FREE
xsrf.token
l1, bucket, l2, l2CategoryFullName
tmsid, timestamp, signature
```

**Booleans are omitted, not sent as `false`.** `buyerProtectionAllowed` and `price.biddingEnabled` appear
only when true; the checkbox convention (`on`) is what the form uses. `phoneNumberSwitch` is the exception
and is sent as the string `"false"`.

**Constants nobody has questioned**, all **frozen** and none understood: `packageSize=M`,
`shippingDetails.provider=other`, `syi-address-radio-home=syi-address-nl`, `address-index-filter=syi-address-nl`,
`bundle-selection=FREE`, `selectedBundle=FREE`, and `deleteAd`'s `reason=NO_DEAL_VIA_MP`. Each is a value the
spike found in a working request and copied. `packageSize=M` in particular is sent for **every** shipped ad
regardless of the carrier option's own weight band.

**Carriers are deduplicated and lowercased** — `carrierId || code`, `Set`, `toLowerCase()` — so two DHL
options produce one `shippingMethod=dhl`.

**There is no response to read.** Reaching the end of `createAd` *is* the success signal; the layer never
parses what comes back, and the new ad's id is never learned. That is why the popup reloads the list after a
relist rather than showing the new ad directly.

---

## Photos

**Download** (`downloadPhoto`, one per gallery URL, in parallel):

1. `fetch(url, { credentials: "include" })`. On a 2xx the bytes are taken as they are, and the filename is
   the last path segment of the URL.
2. **Otherwise a canvas fallback**: an `<img crossOrigin="anonymous">` is loaded, drawn to a canvas, and read
   back with `canvas.toBlob(…, "image/jpeg", 0.95)`.

**A photo that took the fallback is not byte-identical to the original.** It is re-encoded as JPEG at quality
0.95 and its mime type is rewritten to `image/jpeg` — so a PNG comes back as a JPEG, transparency is lost,
and every image is generationally recompressed. The relisted ad's photos are then *visually* the same and
*not* the same file.

**When the fallback triggers** is not recorded from observation. From the code it is: the fetch threw, or it
answered non-2xx and fell through. Both need the image host to allow the request — and the fallback needs it
to send CORS headers, or the canvas is tainted and `toBlob` throws. Nobody has established how often the
first path fails in practice, which means nobody knows how often photos are being recompressed. **If photo
quality is ever reported as degraded, this is the first thing to check.**

**Upload** (`uploadPhoto`, one request per photo, before the create): `multipart/form-data` with `name`
**before** `imageData` — order **frozen** — answering with the media id and URLs that become
`images.ids` / `images.urls`.

---

## Failure modes, and what they look like

The symptom is almost never at the site of the cause. This table is the point of the note.

| What you see | Most likely cause | Where to look |
|---|---|---|
| `SpikePendingError: Endpoint 'X' is not set` | a config override wrote a partial config that dropped a key, or a build added an endpoint the stored config predates | `__getEndpoints()` in the worker console |
| `SpikePendingError: CSRF token extraction failed` | the source page no longer carries the token in a script, or its shape stopped matching the regex chain | fetch `/plaats/1/2` in DevTools and search the HTML for `xsrfToken` |
| `NotAuthenticatedError` | signed out of Marktplaats — **or** a CSRF refresh that did not help, since a second 403 lands here | check you are logged in on marktplaats.nl first |
| `AdNotFoundError` from a capture | the seller-view page answered 200 and carried **no recognisable hydration payload** — a rename of `__NEXT_DATA__`, or a move to streamed/RSC rendering | open `/seller/view/<id>` and look for the three script shapes |
| `ApiRequestError(captureAd, 404)` | the ad really is gone. Not `AdNotFoundError`, because only `deleteAd` maps 404 that way | — |
| `SpikePendingError: Could not resolve a mapped bucket` | the category-aggregate endpoints moved or changed shape, or the ad's category genuinely has no bucket | call `getBuckets` for the parent id by hand |
| `createAd` 4xx after a clean capture and delete | **the field order or a scraped attribute** — the likeliest breakage in the whole layer, and the one that costs a listing | compare the emitted body against `FULL_PAIRS`; then re-record from a real create in DevTools |
| a relisted ad in the wrong category | the bucket fell back to `9`, or the fan-out matched the wrong bucket | the capture logs the resolved bucket |
| photos visibly softer after a relist | the canvas fallback ran — see above | network tab: did the direct image fetch fail? |
| everything 403s at once | Marktplaats hardened something, or the account is flagged | stop. This is the outcome ADR-0008's pacing exists to avoid, and what T46 ([#54](https://github.com/Shei254/marketplaats-extension/issues/54)) is for |

**The one that matters most is the fourth-from-last.** A failed create happens *after* the delete, so it is
the failure mode ADR-0003's snapshot exists for: the ad is recoverable from the extension, and the row says
so. It is also the failure a golden test cannot catch, because the bytes we send did not change — the site
did.

---

## Fixing a breakage

Today: `__setEndpoints` in a `npm run build:dev` worker console, which writes **overrides** (not a resolved
config) into `chrome.storage.local`. The content script drops its cached config and CSRF token when that key
changes, so the next call picks the new path up without a reload. [`live-testing.md`](live-testing.md) § 3
walks it.

Tomorrow: `GET /api/client-config` (T27, [#36](https://github.com/Shei254/marketplaats-extension/issues/36))
serves the same shape from the backend, so a path change is a deploy rather than a Web Store release. It is
deferred until there are real users to hotfix for — which is exactly when this note stops being background
reading and starts being the thing somebody opens under time pressure.

---

## What nobody has established

Open questions, each with a ticket where there is one:

- **Is `listMyAds` paginated?** The code does `data.ads ?? []` and never asks for a second page. An account
  with many ads may silently show a prefix of them. T37 ([#46](https://github.com/Shei254/marketplaats-extension/issues/46)).
- **Is there a stable Marktplaats account identifier?** Blocks multi-account as a sellable entitlement.
  T38 ([#47](https://github.com/Shei254/marketplaats-extension/issues/47)).
- **How do you tell an ad on a page is the user's own?** Needed before anything is injected into the site.
  T39 ([#48](https://github.com/Shei254/marketplaats-extension/issues/48)).
- **Is the create-ad signature category-scoped?** We scrape one bicycle form for every ad. No ticket.
- **What does a rejected `createAd` actually answer?** No status, body or shape has been recorded — which is
  why the failure table above says "compare and re-record" rather than naming one. No ticket.
- **How often does the direct photo fetch fail?** Decides whether recompression is an edge case or the normal
  path. No ticket.
- **What are Marktplaats's own rate limits?** ADR-0008 paces on the assumption there are some. None has been
  observed, and no number here came from the site.
