/**
 * The handle a plan is stored under, made from the name an operator typed.
 *
 * **Nobody types a tier code any more.** It used to be a field beside the name,
 * which asked an operator to invent an identifier and to know that it goes in
 * Stripe as `metadata.tier_code` and is, on any plan, the one thing about it no
 * screen can change afterwards — that last part being true of a *plan*, which has
 * a Price, and not of the one tier that has none (see below). Two fields where the second is always a
 * flattened copy of the first is a field that can disagree with itself — "Pro
 * Plus" filed under `starter` — and the form had a validation message about
 * lower-case letters to show for it.
 *
 * **The edit form derives it too** (T76, ADR-0031). A tier with no Price has given
 * Stripe no copy of its code, so nothing freezes it and it may follow the name — in
 * practice the **free tier** and nothing else, since every other tier has a Price by
 * the time anybody can edit it. Deriving rather than reviving the typed field keeps
 * the rule above intact: the operator names the plan, this says what it is filed
 * under, and the two cannot disagree because one is the other. The trade is that on
 * that one row a rename stops being cosmetic, which is what the sentence below is
 * for.
 *
 * **It is still shown, never hidden.** The form prints what a name will be stored
 * as while it is being typed, because the code either turns up in Stripe and
 * becomes permanent there, or — on a tier with no Price — is about to move under
 * an operator who thought they were editing a label. Derived is not the same as
 * secret, and it is least secret in the moment it changes.
 *
 * **What it is not**: unique, and not a routing table either. Uniqueness is the
 * API's, which answers `409` for a code the catalog already holds (T61, #127) — and
 * that refusal now means "you already have a plan by roughly this name", which is a
 * better sentence than the one it used to mean. `order` is the same shape of fact
 * and lives in the same place: `tierCodeFrom("Order")` is right to answer `order`,
 * and it is `AdminCatalog` that knows the API is mapped on that segment (ADR-0031).
 */

/**
 * Lower case, accents folded, everything that is not a letter or a digit collapsed
 * to a single hyphen, and no hyphen at either end.
 *
 * The output is either empty or matches `/^[a-z0-9-]+$/`, which is what the API
 * (`NewPlanInStripe`) and Stripe's metadata both take. Empty is a real answer, for
 * a name with no letter or digit in it at all — the caller says so rather than
 * sending it.
 */
export function tierCodeFrom(name: string): string {
  return (
    name
      // "Pró" is two code points after this, and the second is the accent — which
      // the class below then drops. Without it the accented letter is not `a-z`
      // and becomes a hyphen, so "Pró" would file under `pr-`.
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}
