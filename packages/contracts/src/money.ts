/**
 * Amounts, as this API carries them and as people read and write them (T66).
 *
 * **The wire unit is the currency's smallest one** — 999 is €9.99 — which is what
 * every `amount` in this contract means, on `PlanPrice`, `NewPrice`, `NewPlan` and
 * `UntaggedPrice` alike. Nobody reads or writes money that way, so every client
 * has to convert, and this is the conversion said once beside the field it is
 * about. `PlanPrice.amount` has always pointed here in words — *"turning it into
 * one is a rounding decision and the place to make it is next to the currency's
 * own rules"* — and this is that place.
 *
 * **It lives in the contract package rather than in either client** because both
 * of them do it: the popup renders a plan card and `/admin` creates one, and two
 * copies of a rounding rule is the pair that drifts. It is also why these are the
 * only functions here that are not types — they read and write one wire field, so
 * they are the contract's own vocabulary rather than a general money library.
 *
 * **No display formatting lives here.** `Intl` renders an amount with its symbol
 * and its separators, and each surface wants its own: a form field cannot hold
 * `€ 9,99` and read it back, while a plan card should show exactly that. So this
 * hands over the number ({@link majorUnitsOf}) or the plain digits
 * ({@link inMajorUnits}), and the client decides how it reads — the same division
 * `interval` and `currency` already keep, where the API sends Stripe's vocabulary
 * and the client spells it.
 */

/**
 * How many decimal places this currency has, asked of `Intl` rather than assumed.
 *
 * **This is why the conversion is not `* 100`.** A yen has no minor unit at all and
 * a Kuwaiti dinar has three, so a hardcoded hundred prices a plan a hundred times
 * wrong in exactly the accounts that would notice. `Intl` already carries the table
 * — CLDR's — and reading it beats keeping a second copy of Stripe's zero-decimal
 * list here, which is a list that changes without this repository hearing about it.
 *
 * Two for a code `Intl` will not take: the catalog is priced in what the Stripe
 * account settles in, that is a real ISO code, and two is right for all but a
 * handful of them. A throw here would blank the form over a currency the operator
 * cannot change anyway.
 */
export function decimalsIn(currency: string): number {
  try {
    // Optional in the type and always set in practice for a currency format; the
    // `?? 2` is the same fallback the `catch` below makes, said where the type
    // needs it rather than argued about.
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * `"9,99"` → `999`, in whatever the currency's smallest unit is — or `null` for
 * anything that is not an amount.
 *
 * **The digits are read as digits, never multiplied.** `Math.round(4.35 * 100)` is
 * `434`: the float nearest 4.35 is below it, and a cent disappears into an
 * immutable Stripe Price. Padding the fraction out to the currency's length and
 * concatenating cannot lose one, which is why it is done the long way.
 *
 * **A comma is a decimal separator here.** This is a Dutch marketplace and `9,99`
 * is how the operator writes it; the popup already formats money `nl-NL` for the
 * same reason. There is no thousands separator on the way in — `1.000,00` is
 * refused rather than guessed at, because the two conventions disagree about which
 * mark means what and guessing wrong is a factor of a thousand.
 *
 * **More decimal places than the currency has is refused, not rounded.** Rounding
 * charges an amount nobody typed, and the Price it would create cannot be edited
 * afterwards.
 */
export function amountInMinorUnits(typed: string, currency: string): number | null {
  const written = typed.trim().replace(",", ".");
  // Deliberately not `Number()`: it takes `1e3`, `0x10`, `Infinity` and a leading
  // `+`, none of which is an amount somebody meant to type into a price field.
  const amount = /^(\d+)(?:\.(\d*))?$/.exec(written);
  if (!amount) return null;
  const places = decimalsIn(currency);
  const fraction = amount[2] ?? "";
  if (fraction.length > places) return null;
  return Number(amount[1] + fraction.padEnd(places, "0"));
}

/**
 * `999` → `9.99`: the amount as a number, for whatever is going to format it.
 *
 * **What `Intl.NumberFormat` wants.** It formats major units — `format(9.99)` with
 * `currency: "EUR"` gives `€ 9,99` — so a client rendering money needs the
 * division, and doing it as `/ 100` at the call site is the hundred this module
 * exists to stop being written down. A yen amount divided by a hundred is a price
 * a hundred times too small on a plan card somebody is deciding to pay from.
 *
 * A number rather than a string because its one caller feeds it straight to
 * `Intl`, and a string would only be parsed back.
 */
export function majorUnitsOf(minor: number, currency: string): number {
  return minor / 10 ** decimalsIn(currency);
}

/**
 * `999` → `"9.99"`: the amount as a form field can hold it again.
 *
 * A plain decimal rather than `Intl`'s rendering, and with a point rather than the
 * comma {@link amountInMinorUnits} accepts — this is what goes *into* an input, so
 * it has to be something the browser's own `type="number"` will take.
 */
export function inMajorUnits(minor: number, currency: string): string {
  const places = decimalsIn(currency);
  if (places === 0) return String(minor);
  // No sign to carry: every amount that reaches this is one Stripe reported or one
  // `amountInMinorUnits` produced, and neither can be negative.
  const digits = String(minor).padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
