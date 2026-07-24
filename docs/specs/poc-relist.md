# Spec: Proof of Concept — Client-side Relisting Extension

> Status: ready-for-agent
> Implements: ADR-0001, ADR-0002, ADR-0003, ADR-0004, and the safety-pacing portion of ADR-0008 (first-use consent warning removed per 2026-07-25 decision).
> Terms: `docs/glossary.md`. This is the FIRST deliverable; the full app (auth, subscriptions, quota enforcement in `docs/specs/quota-enforcement.md`) comes after.

## Problem Statement

A Marktplaats seller's listing sinks in recency-sorted results over time, losing visibility. The free way to regain a top position is to relist, but Marktplaats makes this tedious and does not offer convenient on-demand relisting. Sellers want a one-click way to push a chosen listing back to the top from wherever they already are. Before investing in a full subscription product, the business needs to prove the core mechanic works end-to-end and safely on real Marktplaats listings.

## Solution

A standalone Chrome (Manifest V3) browser extension with no backend and no login. It runs in the user's own browser and rides their existing Marktplaats session. The user can relist one of their own listings in a single click, from two surfaces: a popup panel that lists all their ads, and an icon injected next to their ads on Marktplaats pages. A relist is performed as delete-first + re-create: the extension captures the listing, stores a durable snapshot locally, deletes the ad, then creates an identical fresh ad — resetting its recency so it ranks near the top. If the re-create fails, the snapshot lets the user retry or restore, so a failure never leaves them with no listing. On first use, the extension shows an honest consent warning about the account-ban risk.

## User Stories

1. As a Marktplaats seller, I want to relist one of my listings in a single click, so that it returns to the top of recency-sorted results without manual re-entry.
2. As a seller, I want to open the extension and see all my current listings in one panel, so that I can relist any of them without navigating Marktplaats pages.
3. As a seller browsing my own ads on Marktplaats, I want a relist icon next to each of my listings, so that I can relist in context.
4. As a seller, I want the relisted ad to be identical to the original (title, description, price, category, attributes, location, photos), so that I don't lose listing content.
5. As a seller, I want my listing's photos re-uploaded on the new ad, so that the relisted ad looks the same to buyers.
6. As a seller, I want the extension to capture and save my full listing before it deletes anything, so that my data is safe if something goes wrong.
7. As a seller, if the re-create step fails, I want to retry or restore my listing from the saved snapshot, so that I never end up with no listing at all.
8. As a seller, if a relist is interrupted (browser closed/crashed mid-operation), I want the extension to resume or let me restore from the snapshot when I return, so that I recover cleanly.
9. As a seller, I want clear feedback on each relist (in progress, success, failed-and-recoverable), so that I know the state of my listing.
10. As a seller, I want the extension to only act on my own listings, so that I can't accidentally affect ads that aren't mine.
11. As a seller, I want the relist to use my already-logged-in Marktplaats session, so that I don't have to enter any credentials into the extension.
12. As a seller who isn't logged in to Marktplaats, I want the extension to tell me to log in first, so that I understand why it can't act.
13. As a seller, I want a relist that fails before the delete to leave my original ad completely untouched, so that a pre-delete failure costs me nothing.
14. As a developer, I want the relist logic isolated behind a testable orchestrator, so that the data-safety guarantees can be verified without a live Marktplaats.
15. As the business, I want to prove that Marktplaats's internal delete and create endpoints can be driven from the extension using the user's session, so that we know the mechanic is technically viable.
16. As the business, I want to prove that a listing's photos can be fetched and re-uploaded, so that we know an identical repost is achievable.
17. As a seller, I want the extension to avoid hammering Marktplaats (basic pacing between actions), so that a relist looks less automated and is gentler on my account.

## Implementation Decisions

- **Deliverable:** a single Chrome MV3 extension in TypeScript. No backend, no authentication, no subscription (ADR-0001). Firefox is out of scope (ADR-0009).
- **Relist engine (internal-API replay, ADR-0004):** an orchestrator drives the relist by calling Marktplaats's own internal endpoints — list-my-ads, delete-ad, create-ad — through a `MarktplaatsClient` interface, using the user's session cookies. Requires `marktplaats.nl` host permission.
- **Relist algorithm (delete-first + durable snapshot, ADR-0003):** capture the full listing → persist an AdSnapshot (all fields + photo blobs) to a `SnapshotStore` (`chrome.storage.local`, `unlimitedStorage`) → delete the old ad → create the identical ad → mark done and clear the snapshot. On create failure: keep the snapshot and expose retry/restore. The orchestrator is a resumable state machine (states: `captured → deleted → creating → done`, with `failed-recoverable`).
- **Surfaces (ADR-0004):** (1) a popup panel that lists the user's ads (fetched via the same internal-API engine) with a per-ad relist action, and (2) content-script-injected icons next to the user's ads on the "Mijn Advertenties" dashboard and on public ad pages the user owns. Both call the same orchestrator.
- **Ownership:** the extension only relists ads returned as the user's own by the internal list-my-ads call; it never acts on arbitrary ads.
- **Safety pacing (ADR-0008):** basic inter-action pacing/jitter as a light safety default (full SafetyPolicy/rate-limits are full-app). The first-use consent/ban-risk warning has been **removed from the POC** per product decision (2026-07-25); see the ADR-0008 amendment.
- **Interfaces to keep the engine testable:** `MarktplaatsClient` (real implementation calls the internal API; a fake is used in tests) and `SnapshotStore` (real implementation is `chrome.storage.local`; a fake is used in tests). The orchestrator depends only on these interfaces.
- **Boundary rule (ADR-0001):** the Marktplaats session never leaves the browser; there is nothing server-side in the POC.

### Spikes (viability gates — resolve before building surfaces)
- **CSRF/session token spike:** confirm the internal delete and create calls can be made from the extension with the user's session, including any required CSRF/session token. If not solvable, delete+recreate is not viable and the mechanic is reconsidered.
- **Photo re-upload spike:** confirm a listing's full-resolution photos can be fetched and re-uploaded to a new ad. If not, the "identical repost" is degraded and scope is revisited.

## Testing Decisions

- **What makes a good test:** assert only externally observable behavior of the relist orchestrator — the sequence and safety outcomes given a `MarktplaatsClient` and `SnapshotStore` — not private helpers or internal call bookkeeping.
- **Seam — the relist orchestrator (single automated seam).** Unit-test `relist(ad)` driven by a **fake `MarktplaatsClient`** and a **fake `SnapshotStore`**. Assertions:
  - the AdSnapshot is persisted **before** any delete call;
  - ordering is delete-then-create (delete-first);
  - a create failure leaves the snapshot intact and surfaces retry/restore, never zero listings;
  - a failure **before** delete leaves the original untouched;
  - an interrupted run (snapshot present, not `done`) resumes/restores on next invocation;
  - the `done` path clears the snapshot.
- **Manual verification gates (not automated):**
  - the two **spikes** (CSRF/session token; photo re-upload) verified against live Marktplaats;
  - the **MarktplaatsClient adapter** (real internal-API calls) — depends on MP's private, unversioned API, so verified manually via the spikes rather than unit tests;
  - **DOM icon injection** and **popup rendering** — manual QA on live Marktplaats.
- **Prior art:** none (greenfield). This orchestrator seam is the reference pattern for future extension logic tests; keep the `MarktplaatsClient`/`SnapshotStore` fakes reusable.

## Out of Scope

- Authentication, user accounts, Keycloak (ADR-0005) — the POC has no login.
- Subscriptions/billing (ADR-0006) and quota/subscription enforcement (`docs/specs/quota-enforcement.md`, ADR-0007).
- The web dashboard SPA and backend of any kind (ADR-0009) — the POC is client-only.
- Full SafetyPolicy: configurable rate limits, caps, multi-account pacing (ADR-0008) — only basic pacing is in the POC (the first-use consent warning was removed per product decision).
- Multi-Marktplaats-account management (ADR-0005 modeling) — POC acts on whatever account the browser session is logged into.
- Firefox port (ADR-0009).
- Cross-device/server-backed snapshot mirroring (deferred in ADR-0003).
- Native "opnieuw plaatsen" and paid-boost mechanics — the POC uses delete + re-create only (ADR-0002).

## Further Notes

- **Risk posture:** delete + re-create is what Marktplaats tries to prevent (ADR-0002); the POC accepts this with basic pacing only. The first-use consent/ban-risk warning was **removed per product decision (2026-07-25)**, so the POC does not warn users in-product about account-ban risk (full-app consent remains under ADR-0008). The two spikes are genuine go/no-go gates — if either fails, the mechanic (not just the POC) must be reconsidered.
- **Sequencing:** build order is Spikes → relist orchestrator (+ tests) → surfaces + consent. The full app (this repo's other spec) begins only after the POC proves the mechanic.
