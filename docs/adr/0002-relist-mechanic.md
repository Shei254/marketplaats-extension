# ADR-0002: Relist mechanic — delete + re-create

**Status:** Accepted (2026-07-25)

## Context
Unlike Vinted (where dotb thrives on free frequent bumps), Marktplaats restricts free reposting and steers sellers to paid promotion (Topper/Dagtopper/Admarkt); it historically prohibits "herplaatsen" (delete-and-repost to fake freshness). Three mechanics were considered for the relist action: (A) native "opnieuw plaatsen", (B) delete + re-create an identical ad, (C) automate a paid boost.

## Decision
The relist action **deletes the existing ad and creates an identical fresh one**, resetting its recency timestamp so it re-appears near the top of recency-sorted results.

## Consequences
- **Positive:** Actually resets ranking for free (the real value users want); reliable, visible effect — a strong demo.
- **Negative / risks (accepted, to be mitigated by design):**
  - **ToS violation:** This is precisely what Marktplaats tries to prevent. User accounts face flag/ban risk; the business faces cease-&-desist and an anti-bot arms race.
  - **Destructive:** Loses the ad's URL, view statistics, and saved-by-others count.
  - **Data-loss hazard:** If re-create fails after delete, the user loses the listing entirely. The flow MUST be designed so this cannot happen (see ADR on relist safety/ordering).
  - **Fidelity dependency:** An "identical" repost requires capturing every field — title, description, price, category, attributes, location, and especially **photos** (must be re-fetched and re-uploaded). Photo re-upload feasibility is an explicit POC spike.
    **The repost was never identical, and 2026-09-07 is when that was written down**: `reserved`,
    `buyItNowEnabled`, `escrowAllowed`, `isMultiLingual` and `adFeatures` are captured and posted by nothing.
    [ADR-0028](0028-a-repost-puts-back-what-it-can.md) restores the first, refuses the last on purpose, and
    lists the rest.
  - **Duplicate detection:** Marktplaats may auto-detect near-identical reposts and block/flag them.
- Because execution is client-side (ADR-0001), the ban risk lands on the user's own account, not on our infrastructure — but the product is the proximate cause and must warn users.

## Revisit if
Duplicate-detection makes delete+recreate unreliable, or legal risk proves unacceptable → fall back to (A) native relist or pivot to (C) paid-boost convenience layer.
