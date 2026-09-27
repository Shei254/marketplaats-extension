# ADR-0038: Bulk repost leaves the extension, and the API keeps its half

**Status:** Accepted (2026-09-27)
**Scope:** `apps/extension` only. **Supersedes [ADR-0027](0027-the-popup-stops-offering-bulk-repost.md)**, and
retires [ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md)'s client half. No API, contract,
schema or catalog change. [T70](https://github.com/Shei254/marketplaats-extension/issues/155) becomes a
rebuild rather than a flip.

## Context
ADR-0027 withdrew bulk repost from the popup with one constant and kept everything underneath: the batch
runner, its alarm, its two storage keys, the toolbar badge, the popup's selection and forty tests describing
it. Its case for keeping them was that revival would be "one word and forty green tests".

**It named the conditions that end that case, and one has arrived.** *"The extension ships to anybody before
T70"* — the Web Store submission (T58) is exactly that. Two costs ADR-0027 accepted were bearable only while
nothing was installed anywhere:

- **The `alarms` permission justifies a feature no user can reach.** The batch runner was `chrome.alarms`'s
  only user, and it could not be dropped while the runner was wired: `service-worker.ts` registered
  `onAlarm` at module scope, so a missing permission threw before anything else started. The Web Store's
  review asks for the narrowest permissions a product needs, and a permission whose honest justification is
  "for a feature we switched off" is the kind it rejects.
- **The storage disclosure had two keys it could not explain.** `batchWoken` in `chrome.storage.session` was
  written on every worker wake whether or not a run existed, and `batchRun` in `chrome.storage.local` was
  reachable only through a dev hook. The listing says what the extension stores; a sentence that is true only
  if you ignore two keys is not one to submit.

ADR-0027's rejection of deletion rested on the tests: that without them "the honest answer to 'does this
still work?' becomes *nobody knows*." The answer was already *nobody knows* against real ads —
`click-through.md`'s slice E was never walked, and every one of those tests stubs Marktplaats. What deletion
loses is a suite describing unproven behaviour, and git keeps that suite.

## Decision
**Every part of bulk repost that lives in `apps/extension` is removed, with the `alarms` permission.**

Gone: `BatchRunner` and its alarm, store, session marker and toolbar badge; the popup's selection, header,
bar and `batching.ts`; the `start-batch`, `batch-state`, `stop-batch`, `dismiss-batch` and `batch-shape`
messages; the `__startBatch`, `__batchState` and `__stopBatch` dev hooks; `BULK_PACE`; the orchestrator's
second pacer and `relist(…, batch)`; `authorize`'s `batch` argument; the served config's `bulkPacing` and
`rails` readers; and the selection's CSS.

**`scripts/build.test.ts` now asserts no shipped bundle mentions `chrome.alarms` or `storage.session`.** The
first is a crash, not just a policy problem: an alarm listener coming back without the permission takes the
worker down at load. The second keeps the store listing's sentence about storage true.

### The API keeps its half
`features.bulk`, the `batch` field on `POST /api/relist/authorize`, `403 BULK_NOT_ENTITLED`, the served
`bulkPacing` and `rails`, and `/admin`'s bulk cap all stay. They are not in the store review, nothing sends
`batch`, and removing them is a Java, web, contracts and migration change with no user-visible effect. The
extension's gate still maps `BULK_NOT_ENTITLED` to `not-in-plan`, because the contract still names it and a
denial it cannot read must still refuse.

The served config reader **ignores** `bulkPacing` and `rails` rather than validating them. It used to refuse
a whole document over a malformed `bulkPacing`; a build that does not use the field must not lose its
endpoints and pacing over it.

## Consequences
- **Positive: the manifest asks for `storage`, `unlimitedStorage` and `identity`, and each has a user-facing
  reason.** The storage disclosure is four things again: the session, the snapshot, the pacing deadline and
  the served config.
- **Positive: the worker has one thing to do on startup** — resume an interrupted relist — and no ordering
  argument between dropping a run and resuming one.
- **Negative: T70 is a rebuild.** Reviving bulk means restoring the client from git history (the tree before
  this ADR's commit) against a popup and worker that will have moved on, re-adding `alarms`, and justifying it
  in a store update. The design in ADR-0025 is still the design; the code is what has to be redone.
- **Negative: `/admin` still has a control that changes nothing a user sees**, exactly as ADR-0027 recorded,
  and the API still serves two config blocks no client reads.
- **Negative: a developer machine with a leftover run keeps a stale `batchRun` key and possibly a toolbar
  mark** until the extension is reinstalled. Nothing ever shipped, so that is the only kind of machine that
  can be in that state.

## Revisit if
- **Bulk is wanted again.** Then T70 re-adds the client, and the question of whether the API half is still
  the right shape is asked with it rather than assumed.
- **Bulk is abandoned for good.** Then the API half, the contract's `batch` field, the admin cap and the V8
  seed should go too, in one change of their own.
