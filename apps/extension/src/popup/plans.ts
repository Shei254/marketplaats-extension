import type { Plan, PlanPrice } from "@mprelist/contracts";

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
  | { status: "ready"; plans: Plan[] }
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
 */
export function priceOf(price: PlanPrice): string {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.amount / 100);
  } catch {
    return `${(price.amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
}

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
 */
export function grantOf(plan: Plan, interval: string): string {
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
