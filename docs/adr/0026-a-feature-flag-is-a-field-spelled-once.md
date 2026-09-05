# ADR-0026: A feature flag is a field an operator types, and the flag itself is spelled once

**Status:** Accepted (2026-09-06)
**Scope:** `apps/web`'s admin catalog, `packages/contracts`, and the popup's reader.
**Refines [ADR-0014](0014-tier-catalog-and-entitlements.md)**, which owns the `features` column and the admin
CRUD over it. Builds on [ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md), which put the
first value in that column. T69 builds it. No API and no schema change.

## Context
[ADR-0014](0014-tier-catalog-and-entitlements.md) gave the tier an open `features` object so that "adding a
flag is an admin edit rather than a migration and a deploy" (`V1__baseline_schema.sql`). T54
([#85](https://github.com/Shei254/marketplaats-extension/issues/85)) built the admin form over it as a JSON
textarea and wrote down why, in the form itself:

> The flags are a JSON textarea, which is honest rather than lazy: `features` is an open object, every tier
> carries `{}` today, and no flag has an implementation behind it. A set of checkboxes would be inventing a
> schema this product has not decided on, **and the day it does is the day this becomes a real control.**

That was true when it was written and both halves of it have since stopped being true.
[ADR-0025](0025-bulk-repost-is-entitled-queued-and-paced-wider.md) decided `bulk`,
`V8__seed_bulk_entitlement.sql` seeded it as `{"upTo": 10}` and `{"upTo": 25}`, and T68 shipped two readers of
it. The column has a schema now. It covers one key, and one key is enough to make a textarea the wrong control:
the operator who sets a quota with a number field sets the cap *beside* it by typing punctuation.

**The rule already has three implementations and one of them is a person.** `Entitlement.grants` answers
whether a flag is granted; `batching.ts`'s `upToIn`/`bulkFor` answers that *and* how many; and the third is an
operator's fingers in a textarea, which is the only one with no test behind it and the only one that can
write a shape the other two disagree about.

**There is a trap in the obvious design.** `upToIn` reads `upTo` only when it is an integer above zero, and
`bulkFor` treats an unreadable value as a grant capped by the quota alone — deliberately, because "a popup
that refused the feature over a value it did not recognise would be second-guessing a permission it did not
issue". So `{"bulk": {"upTo": 0}}` does not mean *no bulk*. It means *bulk, up to the whole quota*. A number
field where 0 means none would ship the exact inverse of what the operator intended.

## Decision
**The cap is a number field; the flag is spelled once in `packages/contracts`; and "off" is written `false`.**

### The flag is spelled once, in `@mprelist/contracts`
A new `features.ts` beside `money.ts` carries the key, the grant shape, a reader (`bulkIn`), a writer
(`withBulk`) and the predicate the form needs (`isExpressible`). The popup adopts the reader — `bulkFor`
becomes that call plus the quota clamp, and `upToIn` is deleted.

This is where it goes because `contracts` is already both things it needs to be: it already carries behaviour
rather than only shapes (`money.ts` is a module of pure functions with its own suite), and it already holds
TypeScript restatements to the API's own Java source, by reading that source in a test (`enforcement.test.ts`,
`repoFile`). `Entitlement.java` cannot import a TypeScript package, so **the third implementation stays**, and
it is pinned the way the denial enums already are: a test that reads the Java and fails when the rule moves.

**Rejected: a registry of known flags** — a descriptor table the form renders controls from generically. It is
what "we can add to it as we add features" literally asks for, and it is a framework over a set of size one
whose second member does not exist. `enforcement.ts`'s own rule is against exactly this: "a type written ahead
of the endpoint it describes is a guess that later reads as a contract". Adding `scheduling` will cost a
reader and a control instead of a table row, which puts the work where the feature is.

**Rejected: validating flag names in the API.** It would make the invariant
`andNoTierPromisesAFeatureThatDoesNotExist` asserts into something enforced rather than merely tested — and it
would make adding a flag a deploy, which is the one thing `V1`'s comment says the `jsonb` column exists to
avoid.

### "Off" is `{"bulk": false}`, not a deleted key
Both readers already answer *not granted* for `false`, and `Entitlement.java` already names it as the
spelling: "`false` is what they write to turn one off".

The deciding reason is not readers, though — it is the seed. `V8__seed_bulk_entitlement.sql` writes only
`where features -> 'bulk' is null`, and says of itself that "the way to take bulk off a tier for good is the
admin edit ADR-0014 makes the catalog's owner rather than a migration nobody re-runs". If the admin edit
deletes the key, that sentence is false: a restored dump or a hand-run re-grants bulk on a tier an operator
deliberately stripped. Writing `false` leaves the key present, the seed skips the row, and V8's promise holds.
Flyway's checksum means V8 cannot be edited to say otherwise, so the alternative was a lie in a file that
cannot be corrected.

### The number field owns the value only when it can represent the whole truth
This single invariant is the whole of the form's behaviour, and each of the three rules below is a reading of
it rather than a separate decision.

The field is `Bulk repost [ N ] at a time`. **Empty means the tier has no bulk**, and whole numbers of 1 and
above are the only thing accepted — **0 is refused**, for the reason in the Context: it is not the off switch
it looks like. There is **no maximum**; how big a plan sells is the operator's judgement, and Power's 25 is
already past the burst rail by a decision ADR-0025 made with its eyes open.

An `Advanced · edit as JSON` disclosure keeps every shape reachable, including the ones the field cannot say.
It is **a mode, not a mirror**: expanding it seeds the textarea from the current object and disables the
number, collapsing parses back, and exactly one control owns the value at any moment. Therefore the form
**opens expanded** when the stored object is not expressible, and **refuses to collapse** while it is not —
saying why, in place.

Without that, a tier storing `{"bulk": true}` — a grant the popup deliberately honours — opens showing an
empty box, and the next save revokes bulk for everyone on that tier with nothing on screen having said so.

**Rejected: a form total over `features`**, dropping whatever it cannot show. It is the honest reading of a
`PUT` that replaces the object wholesale, and its first act would be the silent revocation above.

**Rejected: preserving the remainder invisibly and merging it back on save.** Nothing is lost, and the
operator sees an empty box while the form writes `{"bulk": true}` — which is the one thing a mode switch
exists to make impossible.

**Rejected: a live two-way mirror.** It reformats the operator's JSON under their cursor on every keystroke in
the number field, and mid-edit invalid JSON leaves the number showing something — stale, blank, or last-good,
each of which is wrong in some case.

### The fieldset, not a page
It replaces the JSON field inside the tier form, and the same component goes into the create form — which
retires the hardcoded `features: {}` there, so a plan is created with its cap in one act rather than two.
Not a page of its own: `admin-nav.ts` already made this call once, collapsing the unadopted-Prices page into a
warning on the catalog, because "a whole page for a list that is empty on a well-kept account is a door most
operators open once". A flag is a property of one tier and belongs in the form that edits one.

## Consequences
- **Positive: the cap is set with the same gesture as the quota**, in the same form and the same save, and a
  new plan can be created complete instead of created and then edited.
- **Positive: one reader instead of two, and the proof is a test that does not change.** `batching.test.ts` is
  left untouched across the popup's adoption of `bulkIn`; if it still passes, no behaviour moved.
- **Positive: `V8`'s claim about the admin edit becomes true**, which is the difference between documentation
  and a comment that is wrong on any machine that restores a dump.
- **Negative: two spellings of "no bulk" now exist in the catalog** — a seeded Free reads `{}` and a Pro
  edited off reads `{"bulk": false}`. Both readers already answer identically for both, and the alternative
  cost the seed its idempotence, so this is the cheaper asymmetry. `isExpressible` accepts both.
- **Negative: the Advanced textarea is still a loaded gun.** `{"bulk": 0}` and `{"bulk": "yes"}` are grants to
  both the popup and the API, and nothing here closes that — the escape hatch can still write them. Recorded
  so it is not later read as an oversight.
- **Negative: a third implementation of the rule stays in Java by construction**, held by a test that reads
  source rather than by a type. That is a test, not a guarantee, and it fails on a rewrite rather than on a
  rename.
- **Negative: the second flag costs more than a table row** — a reader, a control and a seed. That is the
  registry's price paid later, deliberately, on the argument that its shape is unknowable until `scheduling`
  exists.
- **Negative: a disclosure that declines to close is unusual**, and the refusal has to read as an explanation
  rather than as a broken control. It is the one place in this form where the UI says no to a gesture.
- **Untouched: the API, the wire and the schema.** `features` stays open `jsonb` and a permissive `Map`, and
  `andNoTierPromisesAFeatureThatDoesNotExist` is unaffected — it reads a freshly-migrated catalog, not an
  edited one, so an operator's `{"bulk": false}` never reaches it.

## Revisit if
- **`scheduling` is built.** It is the second flag, and the second flag is the only thing that can say whether
  the rejected registry was right. If its control is a checkbox and `bulk`'s is a number, one fieldset holding
  both is the moment to look again.
- **A flag needs something other than one number** — an enum, a list, a pair. The fieldset assumes one control
  per flag, and that assumption is untested against a flag that does not exist.
- **The Advanced hatch goes unused.** If nothing in the catalog is ever unexpressible, the disclosure, the
  auto-expand and the refused collapse are three behaviours earning nothing, and the form can become total.
- **A second writer of `features` appears** — an import, a bulk edit, a migration tool. "Spelled once" is a
  claim about there being one writer, and a Java-side writer would need the rule to have a Java home rather
  than a Java test.
- **Removing a flag key entirely becomes something operators need.** By construction there is no longer a way
  to do it from the form: `false` is as off as the UI goes, and a deleted key needs a migration or `psql`.
