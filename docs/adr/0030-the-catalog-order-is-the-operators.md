# ADR-0030: The catalog order is the operator's, and it is one sequence

**Status:** Accepted (2026-09-10)
**Scope:** The `tier` catalog, `GET /api/plans`, `GET /api/admin/tiers`, a new `PUT /api/admin/tiers/order`,
and the admin catalog screen. **Refines [ADR-0014](0014-tier-catalog-and-entitlements.md)**, which made the
catalog ours without ever saying what order it is in. No change to what a tier grants, to the gate, to
Stripe, or to anything the extension runs — `PlansOnOffer`, `subscribing.ts` and `PlanCards` already render
the API's order and keep doing so.
[T75](https://github.com/Shei254/marketplaats-extension/issues/164) is the work.

**The decision is that the order of the plan cards stops being derived and starts being stated**, and the
rest of this file is the shape that took.

## Context

The order of the plan cards has never been a decision anybody made. It is
`order by relist_quota_per_period, code`, written twice — in
[`TierRows.published()`](../../apps/api/src/main/java/com/mprelist/catalog/internal/TierRows.java), which
feeds `GET /api/plans` and the popup, and in `TierRows.everyTier()`, which feeds `GET /api/admin/tiers` and
the admin table. The second says of itself that the repetition is deliberate: *"the same `order by` as
`published()` rather than a second opinion about how a catalog reads"*. That instinct is right and this ADR
keeps it; what changes is the clause.

**Nobody has noticed the rule because the seed hides it.** `V2__seed_tier_catalog.sql` writes `free` 3,
`pro` 50, `power` 200 — in that order — so on every deployment that exists, grant order, creation order and
the order an operator would have chosen are the same three rows. They come apart on the first tier granting
100, which lands between Pro and Power however recently it was made and whatever it costs. The grilling
session that produced this ADR opened with the belief that the popup was in creation order; it is not, and
the fact that the belief was survivable for that long is the clearest evidence that the order was never
designed.

**What no derived rule can express is which plan you want bought.** Putting the middle plan first, or the
entry plan last, is an editorial act about conversion. It is not a function of quota, of amount, or of code,
so no `order by` over the columns we have can state one — and the two cheaper alternatives were weighed on
exactly that:

- **Order by amount instead of quota.** The cards are a price comparison sorted by grant, which is a real
  mismatch: a generous-but-cheap tier sorts last today. `PlansOnOffer` holds every amount before it renders
  — its all-or-nothing rule guarantees that — so this is a sort in one Java method with no column, no route
  and no screen. It is a better derived rule and it is still a derived rule. Rejected because it does not
  answer the question, and because it would have to be undone the first time somebody wanted Pro first.
- **A manual tie-break only** — keep grant order as the spine, let the operator settle rows that share a
  quota (today decided alphabetically by code). Much smaller. Rejected for the same reason: it cannot put
  Pro above Power, which is the entire request.
- **A `featured` boolean** that floats one tier to the top. Rejected as the shape this repository has now
  refused four times — `tier-code.ts` on name-versus-code, `TierEdit` on `isDefault`, the free-tier checkbox
  weighed in the ADR-0029 session, and `unlimitedRelists` beside a nullable quota there. Two fields where
  one is derivable from the other is a pair that can disagree, and a boolean answers "first" without ever
  answering "and then what".

## Decision

### Every tier carries a position, including the ones no buyer sees

`tier` gains **`position integer not null`**. It is on every row — `free`, which is never a plan card, and
every draft the sync invented — and `GET /api/plans` renders the subsequence of it that is published.

Ordering only the published rows was the alternative, and it is worse in a way that only shows later:
publishing is a checkbox on a form an operator opens for other reasons, so a tier taken off sale for an
afternoon would lose its place and come back somewhere new. A position that survives a publish toggle is a
position an operator can trust, and the cost is that dragging `free` above `pro` changes nothing a buyer
sees. The admin table already says which rows those are — the State column carries the Draft and Published
badges — so the screen is not asked to grow anything to stay honest.

The term is **Catalog order** and not *plan order*. A **Plan** is a Tier joined with its Stripe Prices
(ADR-0019), and the free tier and every draft carry a position while being no Plan at all; borrowing the
word would undo the split that ADR drew.

### One route, carrying the whole sequence

**`PUT /api/admin/tiers/order`**, body `{ "codes": [...] }` — every tier in the catalog, in order, applied
as one statement.

This follows the precedent `isDefault` set and follows it for the same reason. `TierEdit` deliberately
excludes that flag because it is *"a property of the catalog rather than of one row"*, and order is more so:
moving one row necessarily moves others, so a `position` field on the per-tier `PUT` would turn one drag
into N requests the client sequences itself, non-atomically, leaving a half-applied order nobody chose if
the third one fails.

**One refusal — `409`, empty body — for a list that is not precisely the catalog's set.** A code the catalog
does not hold and a tier the list forgot are the same event from the only caller's point of view: the screen
is stale, and the answer is to reload it. Splitting them into `404` and `409` would be two codes for one
recovery. It also does the concurrency work for free: if the Stripe sync drafted a tier while the screen was
open, the write fails loudly instead of silently dropping the new tier wherever the renumbering happens to
leave it.

**No `position` field on `AdminTier`.** The array is already in order; a number beside it is the same fact
spelled twice, and this is the discipline [ADR-0026](0026-a-feature-flag-is-a-field-spelled-once.md) is
named for. The client sends codes and reads order, and there is no number anywhere for the two to disagree
about.

### A tier nobody placed goes last

`TierRows`' insert — the single path a `price.created` for an unknown `tier_code` takes — sets
`coalesce(max(position), 0) + 1`. A draft appears at the bottom of the admin table, which is where a new
thing to deal with belongs, and it cannot reach the plan cards at all until somebody publishes it.

**So `position` is `not null` and the grant-order rule retires rather than surviving as a fallback.** The
alternative was a nullable column read as `order by position nulls last, relist_quota_per_period, code`,
which keeps today's behaviour for anything untouched. It is rejected because it leaves two ordering rules in
the system forever, and because the hybrid reads as arbitrary at the moment somebody looks: a €2 plan
dragged once outranks a €50 plan nobody touched, and nothing on the screen says why. `V10` backfills every
existing row from `relist_quota_per_period, code`, so the catalog on deploy is the catalog before it and
nothing moves. It is `V10` because T73's `V9__unlimited_reposts.sql` is the number below it — the only thing
this decision ever needed from that one, and it landed on master the same day.

### `position` is not `unique`, and that is a departure worth naming

Read as **`order by position, code`**. Distinctness is guaranteed by there being exactly one writer — the
route above rewrites every row as 1..N in a single statement — rather than by the database.

This repository's habit is the opposite, and V1, V5, V7 and V9 all argue for it: an invariant a query has to
remember is one a later query forgets. It is departed from here because the only unwriteable version is the
one V7 has already rejected on this schema. Swapping two rows violates a non-deferrable `unique (position)`
mid-statement, so the constraint would have to be `deferrable initially deferred` — and V7 says why that is
a trap: *"a transaction that rolls back never commits, so the check never runs and a test asserting the
invariant passes having checked nothing"*, which is exactly what `BaselineSchemaTest` caught. A constraint
whose test is theatre is worse than a documented single writer.

The `, code` tie-break is what makes the absence safe rather than merely tolerable: two rows sharing a
position read as a stable alphabetical pair, not as a list that reshuffles between requests.

### The drop is the commit, and the buttons are not a consolation prize

Rows get a drag handle and native HTML5 `draggable`, plus an up/down `IconButton` pair. The drop, or the
click, sends the whole sequence; the row moves optimistically and snaps back with a `Note` if the write is
refused.

**No drag library.** [ADR-0021](0021-design-system-stays-ours.md) refused shadcn partly on the grounds that
*"Radix is behaviour we are not using"*, and a dnd library would be the first behaviour dependency in
`apps/web`. It would also buy no test coverage: `happy-dom` 20.11.2 ships `PointerEvent` and `DataTransfer`
but **no `DragEvent`**, and `getBoundingClientRect` returns zeros, so neither a hand-rolled pointer drag nor
a library's can be unit-tested here.

That fact is the reason the buttons exist, and it is two reasons rather than one. They are the keyboard path
— a drag-only table is a screen an operator cannot work from a keyboard — and they are the half of the
feature the vitest suite can actually hold. **The drag layer is covered by `click-through.md` and nothing
else**, which is the gate [ADR-0016](0016-vertical-slices-and-review-gates.md) already makes primary.

### What is deliberately not built

A live preview of the plan cards beside the table. It is the honest answer to *"how will this look"* and it
costs a second implementation of `PlanCards` in a second app, with no plan-card component in `packages/ui`
to share — and it would carry a known lie regardless, since `PlanCards` renders a `CurrentPlanCard` **above**
the API's list for any viewer whose own tier is not on sale. That card's place is per-viewer and no admin
screen can ever set it.

## Consequences

- **Positive.** The order of the plan cards becomes something somebody decided, in one place, readable off
  one screen. The admin table and the popup still read alike, which is the property `everyTier()` was
  already protecting. Nothing in the extension changes, and nothing in Stripe does: an order was never
  Stripe's, exactly as a quota was never Stripe's (ADR-0014).
- **Negative.** A derived fact becomes stored state, so a catalog restored from a dump carries an order
  somebody chose months ago, and a tier added in the meantime sits at the bottom regardless of price.
  The `unique` this schema would normally carry is absent, so a duplicate position is invisible rather than
  refused — the single writer is a convention held by review, not by the database.
- **Negative, and it is the honest cost of the drag.** Part of a shipped screen has no automated test and
  will not get one while `apps/web` runs on happy-dom. If reordering breaks, the suite stays green.
- **Untouched by design.** ADR-0029's aside that unlimited's `null` "sorts last under Postgres's default …
  so ADR-0029 cost this clause nothing" is a dated record of a clause this ADR replaces, and is not
  rewritten ([README](README.md)). An unlimited tier now sits wherever the operator put it.

## Revisit if

`apps/web` gains a real browser test runner — the drag layer becomes testable and the click-through step can
retire — or the catalog grows past the handful of rows a whole-sequence `PUT` is cheap for.
