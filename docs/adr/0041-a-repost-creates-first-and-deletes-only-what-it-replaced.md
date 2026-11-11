# ADR-0041: A repost creates first, and deletes only what a confirmed create replaced

**Status:** Accepted (2026-11-11)
**Scope:** `apps/extension`'s relist orchestrator, internal-API layer, pending-repost store and popup.
**Supersedes [ADR-0003](0003-relist-safety-and-snapshot.md)'s ordering and its durable snapshot**, refines
[ADR-0039](0039-a-pending-repost-is-finished-never-re-authorized.md)'s pending repost and replaces
[ADR-0028](0028-a-repost-puts-back-what-it-can.md)'s `listMyAds` diff. No API, contract or schema change: the
three outcome codes keep their names and their settle/refund effect.

## Context

ADR-0003 chose **delete-first** because a duplicate "may be rejected" by Marktplaats, and paid for it with a
gap: between the delete and a successful create the seller has **no ad**, and the stored snapshot is the
only copy. Every failure in that gap — a killed worker, a lost reply, a refused form, an uninstall that
wipes `chrome.storage.local` — is a seller whose listing the extension deleted. That is the one reputation a
repost tool cannot survive.

Two facts, both observed on 2026-11-11 against a live account over the Chrome DevTools Protocol:

- **Marktplaats accepts duplicates.** Near-identical test ads ("Band Recorder", "Bandrecorder 2",
  "BandRecorder3") are live side by side, and an exact duplicate posted by hand was accepted. ADR-0003's
  reason for the order was never tested and does not hold.
- **The create says which ad it made.** `POST /plaats/ads` answers `302 /payments/orderOverview/…
  ?previousAction=freeAdPlacement&…` then `302 /seller/view/<id>?previousAction=syiSuccess` then `200`, all
  server redirects inside the one `fetch` (`internal-api-findings.md`). So `res.url` carries the new ad's id
  exactly, and `syiSuccess` is Marktplaats's own success marker. ADR-0028 diffed `listMyAds` only because
  this had not been watched.

Delete-first also met a third problem the moment we wrote down that **we never pay on a seller's behalf**:
a create that stops at a payment page would come *after* the delete, leaving an ad we could not put back
for free.

## Decision

**A repost is capture → create → confirm → delete, and the delete happens only after a Confirmed create.**

### A Confirmed create

A create is **confirmed** when its followed redirect chain ends on `/seller/view/<id>` with
`previousAction=syiSuccess`. That `<id>` is the new ad — whatever else the seller's list holds, so a
duplicate the seller owns cannot be mistaken for it. `createAd` returns it.

- **A chain that ends anywhere else is not a create.** A payment page means the ad cannot be reposted for
  free, and **an ad that would cost money cannot be reposted**: nothing is deleted, the original stays live,
  the unit is refunded (`FAILED_BEFORE_DELETE`), and the user is told. No pre-check of
  `packageFreeActive`: the chain already answers safely, and that field has only ever been seen `true`.
- **A lost reply is unknown, not failed.** The ids of the seller's ads are recorded before every create, and
  before another is sent, the list is searched for exactly one new ad with the same trimmed title
  (ADR-0039's check, kept for this case alone). Ambiguity hands it to the user. Under create-first every
  failure of this check is an extra copy, never a missing one.

### The delete names only the id the user chose

The original is deleted by the `listingId` the repost started from, and **never by a match** — not a title,
not a diff. A seller's own duplicates are therefore never at risk.

### A pending repost holds ids, and in neither state is the ad missing

- **Create unconfirmed** — a create was sent and nothing confirmed it. It remembers the original's id, the
  ids listed before the create and when it was sent. Retried by ADR-0039's layered schedule; each retry
  first looks for the lost create, then **captures the original again** and creates from that.
- **Old ad still to delete** — the create was confirmed and the delete failed. It remembers the old and new
  ids. The delete is retried on the same schedule, **only while the new ad still answers**: if the seller
  removed the copy by hand, deleting the original would leave them with nothing, so the record is dropped.

**There is no stored draft and no photos.** The original is live until a confirmed create, so it is its own
backup; a retry posts what the seller has *now*, edits included. `unlimitedStorage` existed only for the
photo blobs.

### Quota and the canary

One report per grant, and the first wins (`/complete` is idempotent per `jti`):

| What happened | Report | Effect |
|---|---|---|
| No confirmed create, and none found | `FAILED_BEFORE_DELETE` | refund — nothing changed on Marktplaats |
| Confirmed create, original deleted | `SUCCESS` | settle |
| Confirmed create, original **not** deleted | `FAILED_AFTER_DELETE` | settle — the seller got the fresh ad the unit buys |

**`FAILED_AFTER_DELETE` keeps its name and changes its meaning**, to *"the create was confirmed and the
original could not be deleted"*. That is the breakage canary now — the sign that delete-and-recreate's
second half stopped working — and renaming it would move a frozen contract (ADR-0015) for a word. The
later delete retry is ungated and reports nothing.

### Gereserveerd goes on the exact id

A reserved original is re-reserved on the confirmed create's id, before the delete. ADR-0028's two list
calls, its "zero or two additions" cases and its interleaving hazard go with the diff.

### The old shape is drained, then removed

A build that ships this still reads ADR-0003-shaped snapshots and finishes them the old way — a `deleted`
one is recreated from its stored draft and photos, because for that seller it is the only copy — and never
writes that shape again. `unlimitedStorage` and that path leave together in a later release.

## Rejected

- **Delete-first with the redirect check.** Fixes confirmation but not the gap: every failure after the
  delete still leaves a seller without an ad, and a create that needs payment is found out too late.
- **A `packageFreeActive` pre-check.** Needed only while a delete came first; under create-first it is
  machinery guarding a case the chain already makes harmless.
- **Keeping the full snapshot.** Saves one capture on a retry, at the cost of the largest thing we store
  and of posting stale text over a seller's edit.
- **Reporting `SUCCESS` and leaving a failed delete to the seller.** A silent duplicate is exactly what gets
  an extension called spam.
- **Renaming `FAILED_AFTER_DELETE`.** Touches backend, contracts and golden payloads for a label.

## Consequences

- **Positive: no failure leaves a seller with fewer ads than they started with.** The worst case is two
  copies, visible in the popup until the old one goes.
- **Positive: the normal path is cheaper and exact** — no title matching, no list diff after the create, no
  snapshot write of photo blobs.
- **Negative: a seller at a free-placement limit cannot repost there.** Create-first needs one more slot,
  and a create that would cost money is refused by our own rule. Delete-first would have freed the slot.
- **Negative: for a second or two two copies are live**, and a buyer may message the one about to go — as
  with any delete, those messages go with it.
- **Unknown: whether a create that stops at payment leaves an unpaid draft** at Marktplaats. Harmless —
  the original is live — and not yet observed.
- `apps/api/README.md`'s line for `FAILED_AFTER_DELETE` ("the ad was deleted") is reworded; no code moves.
- `store/listing.md` drops its `unlimitedStorage` justification in the release that drops the permission.

## Revisit if

- **The chain stops ending on `syiSuccess`**, or the id leaves it. Confirmation falls back to the list
  check, and the ADR-0028 hazards return with it.
- **Marktplaats starts rejecting or penalising duplicates.** That was ADR-0003's fear; if it comes true,
  this order is wrong.
- **Sellers report hitting free limits** often enough that the lost reposts matter more than the gap did.
