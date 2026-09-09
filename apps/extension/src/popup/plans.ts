import { inMajorUnits, majorUnitsOf, type Plan, type PlanPrice } from "@mprelist/contracts";

import type { HandoffAnswer } from "../api/subscribing";

/**
 * The plan cards, as the popup holds them (T52, #83).
 *
 * Three states and no fourth, like the ad list: loading, here, or not gettable.
 * **An empty list is `ready` with nothing in it** and not a failure — nothing is
 * on sale, which is true of every stack whose Stripe Prices have not been created
 * yet (T22, #28), and saying "unavailable" there would report a fault that is not
 * there.
 *
 * The failure carries no message of its own because there is only one:
 * `GET /api/plans` is all-or-nothing by construction (T49, #80) — one price Stripe
 * could not fetch takes the whole answer with it, so there is never a partial list
 * to explain and never a per-card reason.
 */
export type PlansView =
  | { status: "loading" }
  | { status: "ready"; plans: Plan[]; paymentMethods: string[] }
  | { status: "failed" };

export const PLANS_LOADING: PlansView = { status: "loading" };

/**
 * A hand-off to Stripe in progress, or the reason the last one did not happen.
 *
 * **`opening` is usually the last state this popup is ever in.** The worker opens
 * the tab, the tab takes focus, and the page holding this is destroyed — which is
 * expected (ADR-0017) and the reason the button says "Opening…" rather than
 * anything that implies it will come back. A `failed` means the popup outlived the
 * attempt, which only happens when there was nothing to open.
 *
 * `what` is the tier code being bought, or {@link MANAGING} for the Customer
 * Portal, so exactly one control on the screen can show itself busy.
 */
export type Handoff =
  | { kind: "idle" }
  | { kind: "opening"; what: string }
  | { kind: "failed"; message: string };

export const NOT_OPENING: Handoff = { kind: "idle" };

/** What `Handoff.what` holds while the Portal is opening — no tier is a code. */
export const MANAGING = "manage-billing";

/**
 * What to say when a hand-off did not open anything.
 *
 * Both routes answer `404` and `503` and mean different things by the first one,
 * which is why the caller says which it asked: for Checkout a `404` is a plan that
 * is no longer on sale — what a client holding yesterday's cards gets, and nobody's
 * error — and for the Portal it is an account Stripe has never billed, which is
 * every free user who has not bought anything. Neither is a fault to apologise for,
 * so neither sentence does.
 *
 * `signed-out` and `outdated` are not here: they are screens, not notes, and the
 * popup takes them somewhere else entirely.
 */
export function handoffFailure(answer: HandoffAnswer, asked: "checkout" | "portal"): string | null {
  if (answer.status === "gone") {
    return asked === "checkout"
      ? "That plan isn’t on sale any more."
      : "You haven’t paid for anything yet, so there’s nothing to manage.";
  }
  if (answer.status === "unavailable") {
    return asked === "checkout"
      ? "Checkout couldn’t be opened. Try again in a moment."
      : "Your billing page couldn’t be opened. Try again in a moment.";
  }
  return null;
}

/**
 * "€ 9,99" — Dutch formatting, for `formatEuro`'s reason one file over: these are
 * amounts on a Dutch marketplace and the two surfaces should not spell money two
 * ways.
 *
 * The currency is Stripe's own lower-case ISO code and `Intl` wants it upper-case.
 * A code `Intl` does not know throws a `RangeError` rather than returning
 * something odd, so the fallback is the amount beside the code — which is a plan
 * card nobody can misread, where a thrown error would be a blank screen over a
 * currency somebody chose in the Stripe dashboard.
 *
 * **The division is the contract's, not this file's** (T66). `amount` is in the
 * currency's smallest unit, and how many of those make one is a fact about the
 * currency rather than about this card — a yen has no minor unit at all, so the
 * `/ 100` that used to be written here rendered ¥1200 as ¥12 on the screen
 * somebody decides to pay from. `/admin` writes the same amounts through the same
 * module, so the plan an operator prices and the card a buyer reads cannot
 * disagree about what the number means.
 */
export function priceOf(price: PlanPrice): string {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(majorUnitsOf(price.amount, price.currency));
  } catch {
    return `${inMajorUnits(price.amount, price.currency)} ${price.currency.toUpperCase()}`;
  }
}

/**
 * What a tier with no repost cap grants, in the words both surfaces use for it
 * (T73, ADR-0029) — the plan card that sells it, and the strip of somebody already
 * on it.
 *
 * Written once because it is the *same sentence about the same fact*: a buyer
 * comparing cards and then subscribing should read what they were sold, and two
 * spellings a screen apart is how "Unlimited reposts" quietly becomes "Unlimited
 * relists" on one of them.
 *
 * A `used` count beside it — "Unlimited · 137 this period" — is the better screen
 * and is deliberately not built here: it needs a number `/api/me` does not send,
 * and T73 was already changing that wire shape.
 */
export const UNLIMITED_REPOSTS = "Unlimited reposts";

/**
 * "50 relists a month" — what the plan grants, per the period it is billed over.
 *
 * The interval is Stripe's vocabulary (`day`, `week`, `month`, `year`) and is read
 * rather than assumed: a yearly Price is a thing the dashboard can create, and a
 * card that called it monthly would be off by twelve. Anything else is rendered as
 * Stripe spelled it — a new interval should read oddly rather than be silently
 * called a month.
 *
 * Since T62 (#128) the rhythm is passed in rather than taken off the plan: a plan
 * has several, and what a quota line describes is the one being looked at.
 *
 * **An unlimited tier names no rhythm** (T73, ADR-0029). "Unlimited reposts a
 * month" would be inviting the reader to look for the limit the sentence is there
 * to say does not exist — and the button beside it already says which rhythm they
 * would be paying at. It is the same string the popup's own strip draws for the
 * plan somebody is already on.
 */
export function grantOf(plan: Plan, interval: string): string {
  if (plan.relistQuotaPerPeriod === null) return UNLIMITED_REPOSTS;
  const relists = `${plan.relistQuotaPerPeriod} relist${plan.relistQuotaPerPeriod === 1 ? "" : "s"}`;
  return `${relists} ${every(interval)}`;
}

/**
 * "€ 9,99 a month" — one of a plan's rhythms, as its own button says it (T62,
 * #128).
 *
 * A plan may be sold monthly and annually, and what a buyer is choosing between is
 * two amounts against two rhythms — so each price says both, rather than a card
 * saying one amount and a toggle elsewhere deciding which.
 */
export function priceAndRhythmOf(price: PlanPrice): string {
  return `${priceOf(price)} ${every(price.interval)}`;
}

function every(interval: string): string {
  switch (interval) {
    case "day":
      return "a day";
    case "week":
      return "a week";
    case "month":
      return "a month";
    case "year":
      return "a year";
    default:
      return `every ${interval}`;
  }
}

/**
 * The ways to pay this popup can spell, in the order it says them (T65, #137).
 *
 * **Membership and order are both editorial, and between them they are the whole
 * of the editorial decision.** iDEAL leads: this is a Dutch marketplace, iDEAL is
 * how most of the country pays online, and ADR-0006 chose Stripe over a card-only
 * arrangement precisely to keep it. PayPal is next as the name a hesitant buyer
 * recognises fastest, then card. Deciding this here rather than at the API is the
 * same division `priceOf` and `grantOf` already keep: the backend sends Stripe's
 * vocabulary and the client decides how it reads.
 *
 * **A method that does not belong in the sentence is left out of this list**, where
 * the omission is explicit and reviewable — rather than dropped by position, which
 * would edit the sentence by whatever happened to sort last.
 *
 * **Wallets are deliberately absent.** `apple_pay`, `google_pay` and `link` are
 * usually turned on and are not what somebody hesitating over a subscription is
 * looking for — naming them would pad the sentence, and the sentence is
 * non-exhaustive on purpose. Leaving a method out never makes it false; only
 * naming one that is off would.
 */
const WAYS_TO_PAY: ReadonlyArray<readonly [token: string, name: string]> = [
  ["ideal", "iDEAL"],
  ["paypal", "PayPal"],
  ["card", "card"],
  ["bancontact", "Bancontact"],
  ["sepa_debit", "SEPA Direct Debit"],
];

/**
 * "Pay with iDEAL, PayPal, card or SEPA Direct Debit." — or nothing at all.
 *
 * **`null` is an ordinary answer and renders no sentence**: Stripe could not be
 * asked, or it offers only methods this popup has no name for. The plan cards are
 * unaffected either way, which is the whole reason `GET /api/plans` carries this
 * beside them rather than refusing the lot (T65, #137).
 *
 * Every method this popup can spell is named, in `WAYS_TO_PAY`'s order. The
 * sentence stays non-exhaustive because that list leaves the wallets out, not
 * because it is truncated — a buyer meets the rest at Checkout regardless, and this
 * line is there to get them to it rather than to enumerate it.
 *
 * A token that is not in `WAYS_TO_PAY` is dropped rather than shown raw — a
 * departure from `grantOf` and `priceOf` above, and worth saying why. Those render
 * what Stripe spelled because the alternative was *mistranslation*: an unknown
 * interval called "a month" is a lie about money. Here the alternative is silence,
 * "or sepa_debit" in the one line whose job is to reassure is worse than absent,
 * and the API logs the whole offered set whenever it refreshes — so a method
 * nobody has named is visible where an operator is, not where a buyer is.
 */
export function waysToPay(methods: readonly string[]): string | null {
  const named = WAYS_TO_PAY.filter(([token]) => methods.includes(token)).map(([, name]) => name);
  if (named.length === 0) return null;
  if (named.length === 1) return `Pay with ${named[0]}.`;
  return `Pay with ${named.slice(0, -1).join(", ")} or ${named[named.length - 1]}.`;
}
