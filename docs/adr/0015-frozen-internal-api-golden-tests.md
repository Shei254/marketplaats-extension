# ADR-0015: The internal-API layer is frozen by golden-payload characterization tests

**Status:** Accepted (2026-08-13)
**Scope:** `apps/extension` — the Marktplaats internal-API layer.

> **If you are about to "clean up" a golden test because it looks brittle or over-specified: don't.
> The brittleness is the point. Read this file first.**

## Context
The Marktplaats internal-API layer is simultaneously the most valuable and the least tidy code in the
project. `createAd` builds an `application/x-www-form-urlencoded` body whose **field order is load-bearing** —
its own comments record the discovery (`MOVED: Placed up here to match the working payload order`) — and it
depends on `signature`/`timestamp`/`tmsid` values scraped from a create-ad page. These payloads were
established empirically against the live site, and the only end-to-end verification available is
**destructive and irreversible**: a failed re-create loses a real listing, which is why ADR-0002/0003 exist.

That collides with restructuring the code: the layer must move into `apps/extension/`, shed a duplicated
`EMPTY_ENDPOINT_CONFIG` (which had drifted — the shared copy declared `getBucket` while the type declared
`getBuckets`), and gain remote config (ADR-0013).

## Decision
Before any restructuring, capture **golden-payload characterization tests**: stub `fetch` and assert on the
exact request each operation emits for fixed inputs — method, URL, every header, and the body **byte-for-byte
including form field order**. These are committed as the contract.

"Don't change the internal API calls" is thereby enforced by CI rather than by memory. Moving files, deleting
the duplicated config, wiring in remote config, and splitting the layer up are all safe; any change that
alters a single emitted byte fails the build.

## Consequences
- **Positive:** The two stated goals — "don't tweak the internal API calls" and "make the code clean and
  maintainable" — stop being in conflict. Runs in vitest with **no network and no Marktplaats account**.
  It is also the only safety net under which `createAd`'s 200 lines could ever be refactored.
- **Negative:** These tests are deliberately over-specified and will fail on cosmetic changes. That is the
  intended behaviour, not a defect — see the warning at the top of this file.
- **Important limitation:** a golden test proves you did not change what the code *sends*. It cannot prove
  that what it sends still *works* — only that a regression is ours rather than Marktplaats's. The signal for
  the latter is the `/complete` outcome telemetry (ADR-0007) and the fix is a config deploy (ADR-0013).
