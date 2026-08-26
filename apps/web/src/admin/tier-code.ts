/**
 * The handle a plan is stored under, made from the name an operator typed.
 *
 * **Nobody types a tier code any more.** It used to be a field beside the name,
 * which asked an operator to invent an identifier and to know that it is
 * permanent, goes in Stripe as `metadata.tier_code`, and is the one thing about a
 * plan no screen can change afterwards. Two fields where the second is always a
 * flattened copy of the first is a field that can disagree with itself — "Pro
 * Plus" filed under `starter` — and the form had a validation message about
 * lower-case letters to show for it.
 *
 * **It is still shown, never hidden.** The form prints what a name will be stored
 * as while it is being typed, because the code is permanent and turns up in Stripe:
 * derived is not the same as secret.
 *
 * **What it is not**: unique. Uniqueness is the API's, which answers `409` for a
 * code the catalog already holds (T61, #127) — and that refusal now means "you
 * already have a plan by roughly this name", which is a better sentence than the
 * one it used to mean.
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
