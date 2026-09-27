# ADR-0039: A pending repost is finished, never re-authorized

**Status:** Accepted (2026-09-27)
**Scope:** `apps/extension` only. Refines [ADR-0003](0003-relist-safety-and-snapshot.md)'s resume and
[ADR-0007](0007-quota-enforcement.md)'s reason for gating it; re-admits the `alarms` permission
[ADR-0038](0038-bulk-repost-leaves-the-extension.md) removed. No API, contract or schema change. T88.

## Context
A **Pending repost** is one whose **Durable snapshot** outlived the attempt: `captured` (the delete may not
have run) or `deleted` (the ad is gone and the create did not finish). Every failure *before* the delete
already clears its snapshot and refunds its unit, so every pending repost is the extension's own failure.

Three things about how they were finished did not hold up:

- **The resume could not reach Marktplaats when it ran.** It ran on `onStartup` and `onInstalled`. At
  startup Chrome is still restoring tabs; on install and update every open marktplaats.nl tab is a **Stale
  tab** — Chrome injects manifest content scripts only into pages loaded afterwards. Either way the resume
  logged "skipped" and did not come back until the next browser start, with the ad missing all that time.
- **A `captured` resume asked the gate for a second unit.** It re-authorized because finishing it could
  delete a listing, and the snapshot is in storage the user can write (ADR-0007). But the first unit is
  still reserved until Reconciliation, so a user on their last unit was refused by the unit we took for the
  same repost.
- **A pending repost was invisible.** The popup's **Opnieuw** lived in the popup's memory, and a `deleted`
  ad is not in `listMyAds`, so closing the popup hid it for good.

The spike that decides whether the gate can go was run on 2026-09-27 (`internal-api-findings.md`): a
deleted ad answers `captureAd` with **`410 Gone` from the first poll at 1.3 s**, for the whole 60 s, and
never a lingering `200`.

## Decision
**A pending repost is finished by putting the ad back, and never asks the gate.**

- `captured`, and `captureAd` still returns the ad: the delete never ran. **Cancel** — clear the snapshot
  and report `FAILED_BEFORE_DELETE` on the *original* grant, which refunds its unit now.
- `captured`, and `captureAd` answers `404` or `410`: the delete ran. Treat it as `deleted`.
- `captured`, and anything else: unknown. Keep the snapshot and try later — never drop the only copy.
- `deleted`: recreate, ungated, as before.

The resume can therefore delete nothing, and ADR-0007's objection falls away rather than being paid for: a
fabricated snapshot of a live ad is dropped, and one of an absent ad buys a create, which costs nothing on
Marktplaats.

**Before every create the snapshot records the ids of the user's ads, and before every retry they are
listed again.** Exactly one new ad carrying the snapshot's title and price means the last create landed
and only its reply was lost: the repost is done, and nothing is created twice. If the list cannot be
fetched, that retry is skipped.

**Retries are layered, and run only where they can succeed:**

1. In the worker, straight after the failure: about 2, 5 and 10 s.
2. `chrome.alarms`: 30 s, 2 min, then every 5 min. An alarm that finds no marktplaats.nl tab clears
   itself and waits for (3).
3. The content script's `ready` on every marktplaats.nl page load — which replaces `onStartup` and
   `onInstalled` as the resume's trigger, being the one moment a resume is certain to reach a live tab.
4. **Opnieuw** in the popup, at any time.

A create `4xx` or a `SpikePendingError` is deterministic — the same body gets the same answer — and marks
the snapshot `needsUser`: only Opnieuw retries it. Every other failure retries with no cap. A resume skips
a listing a repost is working on right now, and only one resume runs at a time.

**The popup shows every pending repost** at the top of the ad list, and every one but the one being retried
carries **Niet terugzetten**, which clears the snapshot after a confirmation.

**Stale tabs are the user's to reload, not ours to inject into.** The relay tries each marktplaats.nl tab
and uses the first that answers; if none does, the popup offers **Pagina vernieuwen**, which reloads it.
`chrome.scripting` would fix a stale tab silently, at the cost of a permission whose listing row said we
never use it; reloading needs no permission and never discards what the user was typing without asking.

## Consequences
- **Positive: quota can never block a pending repost**, the resume deletes nothing, and a pending repost is
  visible until it is put back or let go.
- **Negative: an interrupted repost of an ad that still exists is cancelled, not completed.** The user
  loses nothing — the unit comes back at once and the ad is untouched — but has to press Repost again.
- **`alarms` is back** (ADR-0038 removed it because its only user was unreachable). This user is the
  reason ADR-0003's snapshot exists, and the store listing names it. `scripts/build.test.ts` stops asserting
  its absence.
- **Every create costs one more `listMyAds`**, which only reserved ads paid before. The duplicate check is
  blind past the first page (T37) and fooled by the user posting an identical ad by hand in the same
  minute; both fail towards a missed repost, not a duplicate.
- **A `410` is "gone" here and nowhere else.** `captureAd` still reports it as an `ApiRequestError`; only the
  resume reads it as a fact about the ad.
