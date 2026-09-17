import { inMajorUnits, majorUnitsOf, type DisplayState, type Plan, type PlanPrice } from "@mprelist/contracts";

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
  | { status: "ready";
  plans: Plan[]; paymentMethods: string[] }
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
      ? "Dat abonnement wordt niet meer aangeboden."
      : "Je hebt nog niets betaald, dus er is niets te beheren.";
  }
  if (answer.status === "unavailable") {
    return asked === "checkout"
      ? "Het afrekenen kon niet worden geopend. Probeer het zo opnieuw."
      : "Je betaalpagina kon niet worden geopend. Probeer het zo opnieuw.";
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
 * spellings a screen apart is how "Onbeperkt herplaatsen" quietly becomes
 * "Onbeperkt opnieuw plaatsen" on one of them.
 *
 * A `used` count beside it — "Onbeperkt · 137 deze periode" — is the better screen
 * and is deliberately not built here: it needs a number `/api/me` does not send,
 * and T73 was already changing that wire shape.
 */
export const UNLIMITED_REPOSTS = "Onbeperkt herplaatsen";

/**
 * "50 herplaatsingen per maand" — what the plan grants, per the period it is
 * billed over.
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
 * **An unlimited tier names no rhythm** (T73, ADR-0029). "Onbeperkt herplaatsen
 * per maand" would be inviting the reader to look for the limit the sentence is there
 * to say does not exist — and the button beside it already says which rhythm they
 * would be paying at. It is the same string the popup's own strip draws for the
 * plan somebody is already on.
 */
export function grantOf(plan: Plan, interval: string): string {
  if (plan.relistQuotaPerPeriod === null) return UNLIMITED_REPOSTS;
  const relists = `${plan.relistQuotaPerPeriod} herplaatsing${plan.relistQuotaPerPeriod === 1 ? "" : "en"}`;
  return `${relists} ${every(interval)}`;
}

/**
 * Whether the plan somebody is on grants no reposts at all — asked once here so
 * that the strip, the prompt and the ad list cannot spell it three ways (T32, #41).
 *
 * The `plan` here is the **Display state**, the subscription `GET /api/me`
 * describes, and not the `Plan` the rest of this module prices — the same two
 * senses `screens.tsx`'s `grantLine` already lives with, and the types keep them
 * apart.
 *
 * **`=== 0`, never a falsy test.** `null` is unlimited (ADR-0029), so `!grant`
 * reads the plan on which nothing may be reposted and the plan on which everything
 * may as the same one — and would lock the most generous tier in the catalog.
 *
 * **It asks the grant and never the remainder**, which is the whole of what a
 * control may be locked on. A grant is the Tier's own property: nothing its holder
 * does moves it, only an operator or a purchase. `quotaRemaining` goes back *up*
 * without anybody acting — a `FAILED_BEFORE_DELETE` refunds its unit and so does
 * reconciliation — so a button disabled on that is one a refund has already made
 * wrong, until somebody presses Vernieuwen.
 *
 * The state is reachable two ways and neither is exotic: an operator withdrawing
 * the free tier is a quota of 0 on the default one (ADR-0019), and every
 * subscription that ends falls back there (ADR-0018).
 */
export function grantsNothing(plan: DisplayState): boolean {
  return plan.relistQuotaPerPeriod === 0;
}

/**
 * "€ 9,99 per maand" — one of a plan's rhythms, as its own button says it (T62,
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
      return "per dag";
    case "week":
      return "per week";
    case "month":
      return "per maand";
    case "year":
      return "per jaar";
    default:
      // Stripe's own word, untranslated and deliberately: a new interval should
      // read oddly rather than be silently called something it is not.
      return `per ${interval}`;
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
  ["card", "creditcard"],
  ["bancontact", "Bancontact"],
  ["sepa_debit", "SEPA-incasso"],
];

/**
 * "Je kunt betalen met iDEAL, PayPal, creditcard of SEPA-incasso." — or nothing
 * at all.
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
 * "of sepa_debit" in the one line whose job is to reassure is worse than absent,
 * and the API logs the whole offered set whenever it refreshes — so a method
 * nobody has named is visible where an operator is, not where a buyer is.
 */
export function waysToPay(methods: readonly string[]): string | null {
  const named = WAYS_TO_PAY.filter(([token]) => methods.includes(token)).map(([, name]) => name);
  if (named.length === 0) return null;
  if (named.length === 1) return `Je kunt betalen met ${named[0]}.`;
  return `Je kunt betalen met ${named.slice(0, -1).join(", ")} of ${named[named.length - 1]}.`;
}
