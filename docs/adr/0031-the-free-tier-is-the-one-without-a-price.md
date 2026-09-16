# ADR-0031: The free tier is the one without a price, and an operator edits it

**Status:** Accepted (2026-09-16)
**Scope:** `tier.code`, [`TierEdit`](../../apps/api/src/main/java/com/mprelist/catalog/TierEdit.java),
`PUT /api/admin/tiers/{code}`, and the edit and price forms on the admin catalog screen.
**Refines [ADR-0014](0014-tier-catalog-and-entitlements.md)**, whose `code` this makes conditionally
editable, and **[ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md)**, whose "no free tier is a
quota of 0" is untouched and is the reason this ADR is narrow. No schema change, no migration, no new
constraint. Nothing in the extension, the gate, the reservation or Stripe changes. T76 is the work.

**The decision is that the free tier stays a derived fact and gains no flag**, and that setting one is
editing the single row that has no price — which an operator could nearly do already, and could not
discover.

## Context

The question this came from was *"how is an admin meant to set free tiers"*, and it has never had an answer
written down. Working it out turned up one gap, one dead end and one sentence in the code that is simply
untrue.

**A tier cannot be created without a price, by anyone, through any path.** There are exactly two:
`POST /api/admin/plans`, whose `NewPlanInStripe` refuses an empty rhythm list in its constructor — *"A plan
nobody can be charged for is not one; state what it costs and how often"* — and the `price.created` webhook,
which adopts a tier *from* a Price and so cannot produce one lacking it. `AdministerTiers` says the same
thing from the other side: *"What it deliberately cannot do: create a tier, delete one, or set a price."*

**So the free tier is `V2__seed_tier_catalog.sql`'s `free` row, on every deployment, forever.** It is not
something an operator makes. It is a migration artefact they inherit, and the only reason the product has one
at all.

**Deletion is where this session went first, and it is a dead end.** `subscription.tier_id` carries no delete
rule, and `V1` states the consequence where the column is declared: *"a tier with subscribers cannot be
dropped, and retiring one is the data migration ADR-0014 says it is"*. The free tier has **every** user on it,
so Postgres refuses the delete on any deployment that has ever been used. Deleting it is possible only before
the first sign-in, and even then it removes the default tier — `TierCatalog.defaultTier()` throws,
`ProvisionOnFirstLogin` *"catches nothing"*, and nobody can sign in at all. A route that works only on an
empty deployment and breaks it if used is not an operator tool.

**Grandfathering was weighed and is the one alternative that works today.** Create a second priceless tier,
make it the default, and old accounts stay pointing at the old row while new ones get the new. It needs no
user migration and no delete — the previous default keeps its subscribers precisely because nothing can move
them. It was rejected because it answers a different question: an operator raising the free grant from 3 to 5
means it for the people already on 3, and editing the row does that for nothing, since every subscription
points at a uuid that does not change. Grandfathering also grows the catalog by a permanent, unreachable,
undeletable row per change.

**What an operator could already set, and nobody had said so:** the free tier's name, its quota (including
`0`, which is how ADR-0019 spells "there is no free tier", and `null`, which is how ADR-0029 spells
unlimited), its feature flags and its position. **What they could not set is its code**, which says `free`
because a migration said so in August.

## Decision

### There is one free tier, and it is not enforced anywhere

A tier is free exactly when it has no `tier_price` row. Derived, never declared — this is the fourth time
this repository has refused to store a fact it can compute, after `tier-code.ts` on name-versus-code,
`TierEdit` on `isDefault`, and `unlimitedRelists` beside a nullable quota in
[ADR-0029](0029-unlimited-is-null-and-zero-still-grants-nothing.md).

**And "at most one" needs no constraint, because it is already unsayable.** Both creation paths require a
price, nothing deletes, and the seed writes exactly one. A trigger asserting it would be a second statement
of an invariant the write paths already cannot violate — and the first thing to go stale if a third creation
path is ever added, since it would fail at the database instead of at the design. This is `isDefault`'s
argument reused: *"there is no request anybody can send that leaves the catalog with none"*, arrived at by
shaping the routes rather than by guarding them.

### The code follows the name, while there is no price to freeze it

`TierEdit` gains `code`, and the rule is one line: **it may change exactly while the tier has no
`tier_price` row.** The guard is the `not exists (select 1 from tier_price where tier_id = ?)` V7's trigger
already writes.

Once a tier has a Price, Stripe holds a copy of the code in `metadata.tier_code`, and that copy is how the
sync finds the tier again. Renaming underneath it would leave the tier holding Prices whose metadata names
something else, and the next `price.updated` would adopt the old code as a **new draft tier** — the tier
split in two, by a rename. The alternative weighed was to retag every Price in the same operation; it was
rejected because a local commit plus N Stripe calls half-fails into exactly the split it is trying to
prevent, and the sync cannot read a catalog in that state.

**The code is derived from the name and never typed**, which keeps
[`tier-code.ts`](../../apps/web/src/admin/tier-code.ts)'s rule intact rather than carving an exception into
it: *"Two fields where the second is always a flattened copy of the first is a field that can disagree with
itself."* `tierCodeFrom` is already the function, already normalises accents and case, and already prints
what a name will be filed under while it is being typed — *"derived is not the same as secret"*.

**The cost is stated rather than mitigated, because it is real.** `V1` declares of `code` that *"`name` is
display text an admin may rewrite at any time, so it cannot be the thing anything references"*, and on this
one row the name now drives the handle: renaming the free tier changes its code, so `GET /api/me` sends a
different `tier.code` and the tier's own admin route moves. That was weighed against a typed field, which
keeps renames cosmetic at the price of reviving the field `tier-code.ts` deliberately deleted. Derived won on
the grounds that nothing in this system *stores* a tier code — `tier.code` is the only copy in our schema,
Stripe's is excluded by the guard above, and every client comparison is code-to-code (`PlanCards.tsx`'s
`plan.tier.code === current.tier.code`, `AdminCatalog.tsx`'s `tierIn`) rather than against a literal. A code
that moves breaks nothing; it only surprises,
and the form prints it while it moves.

### Three collisions, refused on the form

Derived codes make two of these reachable by ordinary naming, where before they were reachable by nobody.

1. **A code the catalog already holds.** Renaming the free tier to "Pro" derives `pro`.
2. **The reserved literal `order`.** `AdministerTiers` names this collision and dismisses it — *"at the cost
   of a tier coded `order` being uneditable through this API. Nothing creates one"* — which stops being true
   the moment a *name* creates one. The row it would create is the one row that can never be edited again,
   including to undo it. Both forms refuse it, and so do both write routes: `PUT …/tiers/{code}` and
   `POST …/plans`. A Price hand-tagged `metadata.tier_code = order` in Stripe is still adopted, because the
   webhook takes what Stripe says and a catalog that refused rows it had already been told about would be the
   worse failure.
3. **A name deriving to nothing**, which `NewPlanForm` already refuses on its own side.

All three are refused **on the form, before submit**, which is `NewPlanForm`'s existing habit and ADR-0029's:
*"Said here rather than sent to an API that would refuse a blank, which is a round trip to be told what is
already visible on this form."* The screen holds the whole catalog, so it can check every one of them without
asking. Auto-suffixing to `pro-2` was rejected as the *"quietly corrected"* ADR-0029 names as the thing not to
do, and it does nothing for `order` at all.

### `409` broadens by one sentence

The refusal on `PUT /api/admin/tiers/{code}` has meant *"this tier cannot go on sale as described"* —
`NothingToChargeAgainst` and `NothingToGrant`. A frozen code and a taken code are a third and fourth case, and
the route deliberately carries no `reason`, because *"a `reason` would be a second vocabulary on an API whose
codes are statements about a user"*.

**The sentence broadens to "the catalog cannot hold this tier as described"** rather than the cases getting a
status of their own. All four are one event to the only caller — the screen is stale, reload — which is the
same argument `PUT …/tiers/order` already uses to fold a `404` into its `409`. The form prevents all four, so
what reaches this is a stale tab, a script or a hand-run `curl`.

### Adding a price to the free tier warns, and then allows

The **Prices** button sits on the free tier's row like every other, and one click ends its freeness
permanently: the tier becomes sellable and its code freezes. Refusing it on the `isDefault` row was weighed —
it would make "the default tier is free" an invariant and the code guard total — and rejected because an
operator may genuinely want to start charging for what was free, and refusing would force them through a
default-tier swap that hands new accounts a paid tier for nothing while they do it.

So the form names both consequences before it writes: that this is the tier every new account is provisioned
onto and every ended subscription falls back to
([ADR-0018](0018-lapse-falls-back-to-the-default-tier.md)), and that its code becomes permanent. This is the
third warning of its shape on this screen, after ADR-0029's zero-grant and unlimited-default notes.

### Three comments that now read as contradictions

Two are corrected because they are about to be wrong, and one because it is **already** wrong:

- `TierEdit`'s *"No `code`… the seed upserts on it, the Price is tagged with it, and **a subscription's tier
  is found through it**"*. The third claim is false today and was when it was written: a subscription holds
  `tier_id`, a uuid, and `TierRows` looks the tier up by it (`where id = ?`, twice) and reads the code *out*
  of the row. Nothing anywhere finds a tier by code except the admin routes, which are keyed on it by path.
- `tier-code.ts`'s *"Nobody types a tier code any more"* stays true and gains a second reason.
- `V1`'s column comment is left alone. The file is checksummed by Flyway and the sentence is accurate about
  every tier that has a Price, which is every tier but one.

## Consequences

- **Positive.** The answer to "how do I set the free tier" becomes a row an operator edits, on a screen they
  already use, with no concept added to the domain. The catalog gains no flag, no column, no trigger and no
  migration — the whole change is a field on a wire shape, a guard, and three warnings.
- **Positive.** A deployment is no longer stuck with a noun a migration chose. A Dutch-facing product can call
  its free tier *Gratis* and have it filed that way.
- **Negative.** On one row, renaming is no longer cosmetic. An operator correcting a label changes the tier's
  code, `GET /api/me`'s payload and the tier's own admin path. The form prints the code while it moves, which
  is mitigation and not a fix.
- **Negative.** `409` on the edit route now covers four conditions with one empty body — no Price, no grant,
  a frozen code, a taken code — plus the reserved literal, which the route refuses itself because a routing
  table is not something `TierEdits` knows about. The screen tells them apart only because it checked first. A
  second client would have to check for itself or guess.
- **Deliberately not built.** A delete route; a second free tier; grandfathering; any way to move a user
  between tiers; `max_marktplaats_accounts` (still 1 everywhere until T38); and any enforcement of "exactly
  one free tier", which the write paths already make unsayable.

## Revisit if

A third tier-creation path appears — at which point "at most one free tier" stops being a consequence of the
routes and has to become a constraint — or a user-to-tier admin route is ever built, which is the one thing
that would make a second priceless tier reachable and grandfathering worth its permanent row.
