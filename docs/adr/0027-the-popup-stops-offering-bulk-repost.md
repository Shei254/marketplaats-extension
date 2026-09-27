# ADR-0027: The popup stops offering bulk repost, and the mechanism stays

**Status:** Superseded by [ADR-0038](0038-bulk-repost-leaves-the-extension.md) (2026-09-27) — its own
"ships to anybody before T70" trigger fired with the Web Store submission. Accepted 2026-09-07.
**Scope:** `apps/extension`'s popup, and nothing else. **Refines
[ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md)**, which built the feature, and leaves
[ADR-0026](0026-a-feature-flag-is-a-field-spelled-once.md)'s operator field standing. No API, no schema, no
worker and no catalog change. [T70](https://github.com/Shei254/marketplaats-extension/issues/155) is the
ticket that undoes it.

**Unlike most decisions here, this one is cheap to reverse** — it is one constant — and it is written down
anyway, because the thing a reader will actually meet is a complete, tested subsystem with no way into it.
That is the question this file answers, and a one-word switch is exactly the kind of change that leaves no
trace of having been a decision.

## Context
[ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) shipped bulk repost in T68
([#147](https://github.com/Shei254/marketplaats-extension/issues/147)) — a paid entitlement, a queue the
service worker owns, an alarm that advances it, and a selection the popup caps.
[ADR-0026](0026-a-feature-flag-is-a-field-spelled-once.md) gave the operator the cap as a number field in T69
([#153](https://github.com/Shei254/marketplaats-extension/issues/153)). Both landed in the two days before
this, and neither has been in front of a user, because **go-live has not happened**: T55–T58 are the
milestone, and the extension is not in the Web Store.

**The reason for withdrawing it is scope, and it is worth saying that plainly**, because the alternatives a
reader will assume are the alarming ones. Nothing found bulk dangerous, nothing found it broken, and no
review asked for it. Day one is a narrower surface to support: one ad, one button, one countdown.

**What the evidence actually covers.** `batch-runner.test.ts`, `batching.test.ts` and forty popup tests
exercise the queue, the cap and the screen — all of them against a stubbed Marktplaats.
[`click-through.md`](../click-through.md)'s slice E is the walk against real ads, it is the only thing that
can prove delete-first over a queue, and `backlog.md` names it as T68's outstanding work. It has not been
performed. That does not make bulk risky; it makes it unproven, which is a poor thing to be carrying into a
first release rather than a reason for alarm.

**There is a trap in the obvious way to switch it off.** The popup already has a state for a plan without
bulk, and it is deliberately not an absence: the boxes are **drawn disabled** beside a line pointing at Plans,
because [ADR-0007](0007-quota-enforcement.md)'s conversion argument applied one screen further in is "the
difference between a feature a free user knows to want and one they never learn exists". So writing
`{"bulk": false}` onto every tier — the catalog's own off switch, one admin edit away — produces that state
on *every* account: a screen advertising a feature no plan on sale can grant, with a See plans link to plans
that do not include it. **Not entitled and not offered are different facts**, and only one of them was ever
built.

## Decision
**The popup does not draw a selection at all. One constant says so, and nothing else moves.**

```ts
// batching.ts, beside bulkFor
export const BULK_OFFERED = false;
```

Read once, as `Popup({ worker, offerBulk = BULK_OFFERED })`. Four surfaces go with it: the tick on each row,
the *Select all* header, the action bar under the list, and the free-tier line pointing at Plans. The
signed-in screen is what it was before T68 — a search box, the ad list, and a Repost button per row.

### Nothing that implements bulk is edited
`AdList`, `SelectionHeader`, `BatchBar` and the rest of `batching.ts` are untouched, and so is every line of
the worker, the API and the catalog. That is not restraint; it is what the seam already permitted.
`AdList`'s `selection` and `runStates` props are optional and documented as "a surface that is not offering
one" — the off state was built in T68 and had one caller passing an object. **The change is that the caller
stops.**

### The forty tests stay, and keep passing
`Popup.test.tsx`'s batch block sets the seam in a `beforeEach` and no test body changes, which is the same
proof T69 used when it left `batching.test.ts` untouched across a rewrite of its reader: if the assertions
still pass, no behaviour moved. One test is added, that the boxes are gone when nothing asks for them.

**A suite covering a screen no user can reach is the point rather than the cost.** The thing being preserved
here is not the code — git has that — it is the forty sentences describing what the screen *does*, which are
most of T68's popup half and are not recoverable from a diff.

### The worker is still asked one question
`worker.batchState()` stays, called once when the signed-in screen appears, **and its answer is thrown away**.
It is there for the badge: a run that stopped while the popup was closed leaves a ✓ or a ! on the toolbar, and
`BatchRunner.state()` is what takes it down (ADR-0025 — "opening the popup is the moment that job is
finished"). Without the call, a mark left by the build before this one sits there until the extension is
reloaded, explained by nothing on any screen.

What does **not** stay: the run's row states, so a batch that was genuinely mid-flight at upgrade paints
nothing rather than painting busy rows under a bar that is no longer there; `batchShape()`, which fed a
duration estimate that has nowhere to appear; and the one-second poll, which nothing can now start.

### Rejected
**Deleting the wiring outright**, leaving `SelectionHeader.tsx`, `BatchBar.tsx` and `batching.ts` in the tree
with no importer. Revival is a revert, which sounds cheaper than it is: the forty tests go with it, and the
honest answer to "does this still work?" becomes *nobody knows* — for a subsystem whose reason for being
withdrawn is that it is unproven.

**A build-time define** (`__BULK_UI__`, the shape `__DEV__` already has). It would strip the UI from the
shipped bundle, and `scripts/build.test.ts` already asserts absence by text search. But a define is on or off
for the whole suite: vitest would define it true and then no test would ever cover the screen users actually
get. `__DEV__` guards a dev/prod boundary; this is a product decision, and the two should not share a
mechanism.

**Turning the flag off in the catalog** — `{"bulk": false}` on Pro and Power. It is the Context's trap, it
destroys catalog data an operator would have to retype, and `V8__seed_bulk_entitlement.sql` seeds only where
the key is null, so a restored dump would re-grant silently.

**Keeping the bar for a leftover run**, so one can still be watched and stopped. It would mean editing
`BatchBar` to suppress its "Repost the remaining N" offer — a way back into a batch through a screen that has
no way in — which is exactly the file this decision undertakes not to touch.

## Consequences
- **Positive: the mechanism keeps its meaning.** The entitlement still grants, `authorize` still refuses
  `batch: true` without it, and the admin cap still says what a tier holds. Nothing sends `batch: true`, so
  the whole path is inert rather than revoked.
- **Positive: revival is one word and forty green tests**, not an archaeology exercise.
- **Negative: go-live asks for the `alarms` permission for a feature no user can reach.** It is the batch
  runner's only user and it cannot be dropped — `service-worker.ts` registers `chrome.alarms.onAlarm` at the
  top level, so a missing permission throws before anything else starts and takes the extension down with it.
  **T58 has to decide what the store listing says**, and `backlog.md`'s permission table still justifies it by
  naming bulk repost.
- **Negative: `/admin` has a control that changes nothing a user sees.** T69's `Bulk repost [ N ] at a time`
  is two days old and still correct about the catalog; an operator setting it will see no effect anywhere,
  and this is the only place that says why.
- **Negative: the popup carries code for a screen it will not draw**, and a reader who greps for `BatchBar`
  finds a component with one conditional caller. That is the price of the forty tests, paid deliberately.
- **Negative: a run genuinely in flight at upgrade finishes with no Stop button.** It is bounded — the queue
  ends, the badge comes down on the next popup open — and there is exactly one machine that can be in that
  state, since nothing is installed anywhere else.
- **Untouched: the API, the wire, the schema, the catalog, the worker and the dev hooks.** `__startBatch`,
  `__batchState` and `__stopBatch` still reach the queue in a dev build, which is what keeps the mechanism
  exercisable by hand while no surface offers it.

## Revisit if
- **Go-live is stable** — T58 listed, and real users through the single-repost path without incident. That is
  the trigger, and [T70](https://github.com/Shei254/marketplaats-extension/issues/155) is the ticket: flip
  `BULK_OFFERED`, then walk slice E against real ads, so the boxes
  come back proven rather than come back and then get tested.
- **Anything needs a second state of "not offered".** One constant is a switch; two would be the flag
  registry ADR-0026 rejected, and the argument there — that its shape is unknowable until the second member
  exists — applies here word for word.
- **The extension ships to anybody before T70.** Then a leftover run is no longer one machine's problem, and
  the badge argument above needs a second look.
- **Bulk stays withdrawn past the first paying users.** At that point the honest thing is not a constant but a
  decision to remove the feature, and this ADR becomes the wrong shape for it.
