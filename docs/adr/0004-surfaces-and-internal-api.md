# ADR-0004: Relist surfaces and internal-API engine

**Status:** Accepted (2026-07-25)

## Context
Two UX surfaces were considered for triggering a relist: a content-script icon injected into Marktplaats pages, and an extension popup panel listing all of the user's ads. A popup panel cannot drive controls on a page that isn't open, so it forces the extension to call Marktplaats's internal endpoints directly rather than simulate DOM clicks.

## Decision
- **Surfaces:** Both — (1) a **popup panel** that lists all of the user's ads with a per-ad relist action (no page navigation), and (2) **in-page injected icons** on the dashboard and public listing pages. Both are POC scope.
- **Engine:** A single **internal-API replay** layer. The extension calls Marktplaats's own "my listings," "delete ad," and "create ad" endpoints in the background using the user's already-authenticated session cookies. Both surfaces call this same layer.

## Consequences
- **Positive:** "One click, all my listings, relist from here" flow with no navigation; a single engine serves both surfaces; internal-API replay is less fragile than DOM-click simulation and enables the panel overview.
- **Negative / risks:**
  - Requires `marktplaats.nl` **host permission**.
  - May require replaying a **CSRF/session token** that Marktplaats expects on internal calls (an early spike).
  - Internal endpoints are private and unversioned → can change without notice; needs resilient parsing and clear failure states.
  - Background API calls lack the UI-interaction signals of real clicks → potentially easier for anti-bot to flag. Same actions/session as ADR-0002, so no new ToS category, but note the heightened detectability.
- Functionally identical delete+recreate to ADR-0002/0003; only the trigger origin changes.

## Open spikes
1. CSRF/session-token requirements for internal delete/create calls.
2. Photo re-upload fidelity (carried from ADR-0003).
