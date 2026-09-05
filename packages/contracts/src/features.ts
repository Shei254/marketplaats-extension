/**
 * `tier.features`, as the two ends that read it and the one form that writes it
 * all understand it (T69, #153; ADR-0026).
 *
 * **One key, and it is here because there are three implementations of what it
 * means.** `Entitlement.grants` answers whether a flag is granted, the popup's
 * `bulkFor` answers that and how many, and the third is an operator's fingers in a
 * JSON textarea — the only one with no test behind it, and the only one that can
 * write a shape the other two disagree about. This is the reader those two adopt
 * and the writer that form gets, so the shape is decided once. The Java stays,
 * because `Entitlement.java` cannot import a TypeScript package; it is pinned the
 * way the denial enums already are, by a test that reads the source
 * (`features.test.ts`).
 *
 * **It lives beside `money.ts` for the same reason that does.** This package
 * already carries behaviour rather than only shapes, and this is behaviour about
 * one wire field — `features`, on `DisplayState`, `AdminTier`, `TierEdit` and
 * `NewPlan` alike — rather than a general flag library.
 *
 * **There is no registry of known flags here, deliberately.** A descriptor table
 * the admin form renders controls from is a framework over a set of size one whose
 * second member does not exist, and `enforcement.ts`'s own rule is against exactly
 * that: a type written ahead of the thing it describes is a guess that later reads
 * as a contract. `scheduling` will cost a reader and a control, which puts the work
 * where the feature is.
 *
 * **The column stays open on both sides.** Nothing here is validated by the API —
 * `features` is `jsonb` and a permissive `Map`, so that adding a flag stays an
 * admin edit rather than a migration and a deploy (`V1__baseline_schema.sql`).
 * These functions are what the clients agree to *mean*, not what the API enforces.
 */

/**
 * Reposting several ads in one act (ADR-0025) — the flag `V8__seed_bulk_entitlement.sql`
 * writes, `RelistGate` refuses on, and the popup draws checkboxes for.
 *
 * The same constant as `Entitlement.BULK`, and the test beside this holds the two
 * spellings together.
 */
export const BULK = "bulk";

/** The key inside the flag that carries how many at a time. */
const UP_TO = "upTo";

/**
 * What a tier's `bulk` flag grants.
 *
 * **`upTo` is `null` on a real grant**, which is not the same as no grant: the API
 * said yes — that is the half it owns — and `{"upTo": N}` is the shape the seed
 * writes rather than a shape this contract promises. A client that refused the
 * feature over a value it did not recognise would be second-guessing a permission
 * it did not issue, so the unreadable case is *granted, and capped by nothing this
 * flag says*.
 */
export type BulkGrant = { granted: false } | { granted: true; upTo: number | null };

/**
 * What this `features` object grants for bulk.
 *
 * **Not granted is exactly three things: absent, `null` and `false`** — the rule
 * `Entitlement.grants` states in Java, said here once for both clients. A JSON
 * `null` is what an operator writes when they have named a flag and said nothing
 * about it, and `false` is what they write to turn one off; anything else is a
 * grant, whatever shape it has.
 *
 * **The number is read only from `{"upTo": <whole number above zero>}`.** Zero is
 * not a smaller grant and is not the off switch it looks like — it is *granted,
 * capped by the quota alone*, which is why {@link isExpressible} refuses to let a
 * number field claim it.
 */
export function bulkIn(features: Readonly<Record<string, unknown>>): BulkGrant {
  const flag = features[BULK];
  if (flag == null || flag === false) return { granted: false };
  return { granted: true, upTo: upToIn(flag) };
}

function upToIn(flag: unknown): number | null {
  if (typeof flag !== "object" || flag === null) return null;
  const upTo = (flag as Record<string, unknown>)[UP_TO];
  return typeof upTo === "number" && Number.isInteger(upTo) && upTo > 0 ? upTo : null;
}

/**
 * The same flags with `bulk` set to a cap, or turned off.
 *
 * **Off is `{"bulk": false}` and never a deleted key**, which is a decision about
 * a migration rather than about readers — both readers already answer identically
 * for a missing key and a `false` one. `V8__seed_bulk_entitlement.sql` writes only
 * `where features -> 'bulk' is null` and says of itself that the admin edit is the
 * durable way to take bulk off a tier. Delete the key and that sentence is false:
 * a restored dump re-grants bulk on a tier somebody deliberately stripped. Flyway
 * validates V8's checksum, so it cannot be edited to say otherwise.
 *
 * The other keys are carried through rather than dropped. In practice there are
 * none — the form only calls this while {@link isExpressible} holds, which is what
 * stops this being the silent merge ADR-0026 rejected — but a writer that quietly
 * emptied the object would be a worse thing to have lying around than one that
 * does what its name says.
 */
export function withBulk(
  features: Readonly<Record<string, unknown>>,
  upTo: number | null,
): Record<string, unknown> {
  return { ...features, [BULK]: upTo === null ? false : { [UP_TO]: upTo } };
}

/**
 * Whether a number field could hold this whole object and give it back unchanged.
 *
 * **This is the admin form's one invariant, and it is a question about the whole
 * object rather than about `bulk`.** The field says a cap or says nothing, so the
 * three shapes it can represent are `{}`, `{"bulk": false}` and
 * `{"bulk": {"upTo": N}}`. Everything else — `{"bulk": true}`, `{"bulk": null}`,
 * `{"bulk": {"upTo": 0}}`, a second flag nothing here knows about — is content the
 * field would show as an empty box while the next save wrote something the
 * operator never saw. Which is why the form opens on the JSON hatch when this is
 * false, and refuses to close it while it stays false.
 *
 * `{"bulk": null}` is deliberately *not* expressible even though it grants nothing:
 * the empty box would write `false` over a value nobody asked it to change. It is
 * one word away in the hatch.
 */
export function isExpressible(features: Readonly<Record<string, unknown>>): boolean {
  const named = Object.keys(features);
  if (named.length === 0) return true;
  if (named.length > 1 || named[0] !== BULK) return false;
  const flag = features[BULK];
  if (flag === false) return true;
  if (typeof flag !== "object" || flag === null || Array.isArray(flag)) return false;
  return Object.keys(flag).length === 1 && upToIn(flag) !== null;
}
