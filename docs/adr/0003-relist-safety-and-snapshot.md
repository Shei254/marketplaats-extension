# ADR-0003: Relist safety — delete-first ordering with durable client-side snapshot

**Status:** Accepted (2026-07-25)

## Context
The relist mechanic is destructive delete + re-create (ADR-0002). The overriding constraint is that a failure must never leave the user with no listing. Two orderings were considered: create-first (never at zero, but a duplicate window that Marktplaats may reject) and delete-first (no duplicate window, but a data-loss gap if re-create fails). The captured snapshot needs a durable home to make delete-first recoverable, and the POC is meant to run with no backend (ADR-0001).

## Decision
1. **Ordering: delete-first.** Capture the full ad → delete the old ad → create the identical new ad, with retry-and-restore if the create step fails. No duplicate window (avoids Marktplaats duplicate detection), and it is always possible on Marktplaats.
2. **Snapshot storage: client-side only** — `chrome.storage.local` with the `unlimitedStorage` permission, holding all captured fields plus photo blobs. The POC therefore needs no backend.

## Consequences
- **Positive:** No duplicate ad ever exists; no server required for the POC; snapshot survives a browser crash so a failed re-create can be retried or the ad restored.
- **Negative:** A data-loss gap exists between delete and successful re-create; the snapshot does **not** survive machine loss or profile wipe (accepted for POC). Photo blobs can be large — must respect storage quotas.
- **Required behaviour:** The relist flow must be a resumable state machine (captured → deleted → creating → done) so an interrupted operation restores rather than silently drops the ad.
- Cross-device / server-backed snapshot mirroring is explicitly deferred to a later ADR once accounts exist.

## Open spike
Photo re-upload fidelity: can the content script obtain full-resolution originals and re-upload them to a new ad? Must be validated early — it gates the whole mechanic.
