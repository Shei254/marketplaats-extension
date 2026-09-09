# ADR-0028: A repost puts back what it can, and says what it cannot

**Status:** Accepted (2026-09-07)
**Scope:** `apps/extension`'s relist orchestrator, internal-API layer and popup list. **Refines
[ADR-0002](0002-relist-mechanic.md)**, whose delete-and-recreate this constrains, and rides in
[ADR-0003](0003-relist-safety-and-snapshot.md)'s durable snapshot. No API, no schema, no quota and no gate
change. [T71](https://github.com/Shei254/marketplaats-extension/issues/157) is the work.

**This is a safety net, not a feature**, and the framing is what makes the second half of this file — the
table of what a repost *cannot* put back — part of the decision rather than an appendix to it.

## Context

A repost is **delete-and-recreate** ([ADR-0002](0002-relist-mechanic.md)): Marktplaats offers no on-demand
relist, so the mechanic deletes the ad and posts an identical one, and the new listing's recency is what puts
it back on top.

**The new ad is not identical.** It comes back without the `Gereserveerd` flag — the marker a seller sets when
they have promised the item to a buyer. So an item that was off the market goes quietly back onto it, **as a
side-effect of our own mechanic**, and nothing on the screen says so. The seller believes the item is
promised; a stranger can buy it.

`CapturedAd.reserved` had been in the capture since the POC spikes, read by nothing. `ListingSummary` dropped
it on the way to the popup, so the row could not draw it either. Nobody had looked at the field, which is the
same reason nobody had written down what else a repost destroys.

**Two things are being decided here**, and separating them is the point:

1. **What the mechanic restores**, and what it deliberately does not.
2. **What a failure to restore costs**, and who is told.

## Decision

### A reposted ad keeps the flag it had

The orchestrator sets `reserved` back on the ad a repost created, in `createFromSnapshot` — shared by the
fresh path, `retry()` and `resumeSnapshot()`, so a relist that crashed and was resumed hours later re-reserves
too, because `reserved` rides in the durable snapshot.

**The rule is domain state, so it lives in the orchestrator** rather than in `createAd`. The alternative —
`createAd` answering with the new listing's id, and the reserve following from that — would have survived the
refinement below untouched, and is rejected because it hides a rule about what a repost *means* inside the
HTTP layer.

`MarktplaatsClient` gains `reserveAd(itemId)` and `createAd` keeps returning `void`.
`PUT /seller/api/reserve-ad` carries `{"itemId": …}` — the `deleteAd` body minus the `reason` — and takes
`request()`'s mutating branch, so the CSRF header and the one 403/419 refresh-and-retry come for free. **The
flag is only ever set, never cleared**: a fresh ad is never reserved, so whether the endpoint is a toggle or a
setter is a question this never has to answer.

No gate, no quota, no pacing. It is not a relist and `authorize` never hears about it.

### The new ad is found by diffing `listMyAds`, and one addition is not a guess

`createAd` returns no id. Marktplaats answers the create with a redirect chain through
`/payments/orderOverview/…?orderId=…` — the order for the *free placement*, not the ad — ending on
`/seller/view/:id`.

Reading that final URL off `res.url` is exact and free, and **it depends on the middle hop being a server
redirect rather than a browser navigation, which nobody has observed.** So what ships is a `listMyAds` diff
around the create: snapshot the ids before, again after, and the single addition is the new ad.

**Exactly one addition, or nothing happens.** Zero means we could not find it — list lag, or T37's open
pagination question. More than one means somebody posted an ad by hand in another tab inside the window, and
**reserving the wrong ad marks an unrelated *live* listing as promised to a buyer**, which is a worse outcome
than the one this whole decision exists to prevent. Never guess.

**Accepted cost, recorded so it is not later read as an oversight:** when the `res.url` refinement lands, the
two list calls and the diff come out of the orchestrator and its suites change with them.

**And the known hazard:** a batch reposts through the same worker, so a diff taken around one create can in
principle see an id another repost made. The runner is strictly sequential and the diff window is one request
wide, so this needs two creates to interleave — but it is a real property of the mechanism, and one of the
reasons the refinement exists.

### It fails silently, and that is a decision rather than an omission

A failed reserve does not reach the popup. The outcome stays `{ status: "relisted" }` and the backend report
stays `SUCCESS`, because **the repost did succeed**: the ad is live and the quota unit is rightly spent.
Reporting `FAILED_AFTER_DELETE` because a flag did not stick would lie to the breakage canary — the one
signal that tells us delete-and-recreate has stopped working.

**The cost is real and is accepted.** The seller believes an item is off the market when it is not. It is
mitigated only by a log line carrying the listing id and which of the four cases it was: the list before, the
list after, an ambiguous diff, or the `PUT` itself. Promoting this to something visible is a local change
inside `createFromSnapshot` if the silence ever bites.

### The popup says which ads are reserved, in a badge and not a row style

`ListingSummary` gains `reserved`, and the row draws `<Badge tone="accent">Gereserveerd</Badge>` **first in
the meta line**, ahead of the price chip, titled *"Reserved for a buyer. Reposting keeps it reserved."*

**Not a row tint and not a left rail**, which was the first instinct: `.popup-ad[data-ticked="true"]` is
already `background: var(--mp-hover)` plus `box-shadow: inset 2px 0 0 var(--mp-accent)`, and
`[data-state="busy"]` uses that same background. A reserved row styled either way would be indistinguishable
from *selected* and from *currently reposting*.

**First position rather than last**, so the badges line up in a column and twenty ads can be scanned for the
reserved ones — the scannability the left rail would have given, bought without touching it. It costs the
price chip its alignment across rows, which is the trade. `accent` rather than `neutral` because `Vraagprijs`
is already neutral and two greys of the same weight read as one smudge.

### What a repost cannot put back, and one thing it must not

`reserved` is the first entry on a list nobody had written down. Set `CapturedAd` against the 36 fields
`createAd` posts:

| Field | What it is | Restorable? |
|---|---|---|
| `reserved` | Gereserveerd | **This decision** |
| `buyItNowEnabled` | "Direct kopen" | Probably a `createAd` form field |
| `escrowAllowed` | a second protection flag; `isBuyerProtectionActiveOnListing` *is* posted, this is not | Probably a form field |
| `isMultiLingual` | only `title_nl-NL` / `description_nl-NL` go out — a bilingual ad loses its second language | Probably two more form fields |
| `adFeatures[]` | Topper, Dagtopper, urgency, etalage | **No, deliberately** |

**`adFeatures` is why the policy is not "restore everything".** Restoring a Dagtopper spends the seller's
money without asking, which is a worse harm than the one being fixed and is not ours to choose. The rule is
therefore *restore what the seller decided, never what the seller paid for.*

**The three form-field candidates are their own ticket and are not built here.** They are edits to
`createAd`'s form, whose field order is load-bearing and observed-only, and which
[`internal-api-findings.md`](../internal-api-findings.md) already calls "the likeliest breakage in the whole
layer, and the one that costs a listing". Bundling a safe endpoint call behind three speculative edits to that
form puts the safe part at risk for nothing.

### Vocabulary: the ad concept is Dutch, the quota concept keeps the noun

`relist-orchestrator.ts` already says "the reservation the backend took", and the glossary carries
**UsageReservation**, **Settle / Refund**, **Reconciliation** and **Grace window** — a different concept
entirely, in the same file. So the glossary gains **Gereserveerd (Reserved ad)** with `_Avoid_: reservation,
hold`: the quota concept is always the noun ("a reservation", "the unit"), the ad concept always the Dutch
adjective or "reserved ad", and never "a reservation".

Dutch as the disambiguator is what the glossary already does for **Advertentie**, **Mijn Advertenties**,
**"Opnieuw plaatsen"** and **Verkopen Omhoog**. Code keeps `reserved` and `reserveAd`, because those are
Marktplaats's own names and the internal-API layer mirrors them so a DevTools payload and our source read the
same.

### Rejected

- **`createAd` returns the new listing id.** Would survive the `res.url` refinement untouched — the strongest
  argument for it — and is rejected because it puts a domain rule in the HTTP layer: "a reposted ad keeps its
  flag" would then be something the transport knew and the orchestrator did not.
- **Reading `res.url` now.** It is the better mechanism and is the refinement. It is not this ticket, because
  it rests on an unobserved claim about a redirect chain, and shipping the safety net behind an unverified
  observation is how the net does not exist.
- **Reporting `FAILED_AFTER_DELETE` when the reserve fails.** Makes the silence visible at the cost of
  corrupting the only signal that says the mechanic is broken. A flag that did not stick is not a relist that
  failed.
- **Guessing when the diff is ambiguous** — taking the newest, or the one whose title matches. Reserving an
  unrelated live listing is a worse harm than losing the flag, and a title match cannot tell two reposts of the
  same ad apart.
- **Restoring `adFeatures` too.** Spends the seller's money without asking. Not a partial implementation: it
  is the boundary of the policy.
- **A row tint or a left rail for a reserved ad.** Both collide with states the row already draws.

## Consequences

- **A reposted ad that was reserved stays reserved**, on the fresh path and on a resume hours later, at the
  cost of two `listMyAds` calls per reposted *reserved* ad. An unreserved ad costs nothing extra.
- **A reposted ad still loses `buyItNowEnabled`, `escrowAllowed` and `isMultiLingual`.** That was already true
  and was invisible; it is now written down in two places with a ticket against it.
- **The orchestrator now knows about `listMyAds` on its success path**, which it did not before. This is the
  seam the refinement will move, and it is where the two suites will change with it.
- **A failed reserve is visible only in a log.** If sellers report promised items going back on sale, this is
  the first place to look, and `createFromSnapshot` is where making it visible would go.
- **`ListingSummary` carries `reserved` across the relay**, so any future surface — the injected buttons of
  T41/T42 — gets the fact for free.

## Revisit if

- **The create's middle hop is confirmed a server redirect.** Then `res.url` replaces the diff, both failure
  modes above disappear, and the two list calls go with them.
- **A reserve failure is ever reported by a real seller.** The silence has bitten and the outcome should say
  so.
- **`listMyAds` turns out to be paginated** (T37, [#46](https://github.com/Shei254/marketplaats-extension/issues/46)).
  A new ad on an unrequested page reads as zero additions, so the flag would be lost silently on exactly the
  accounts with the most ads.
- **Marktplaats starts creating ads that carry state from a previous listing.** The "only ever set" simplifying
  assumption is the first thing that stops being true.
