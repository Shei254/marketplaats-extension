import type { DisplayState, Plan } from "@mprelist/contracts";

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
 * so neither sentence does. Nor is `already-paying`, which only Checkout answers.
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
  if (answer.status === "already-paying") {
    // Checkout's alone (T83). The button it names is under the cards on this
    // same screen, and a switch there is prorated rather than charged twice.
    return "Je hebt al een betaald abonnement. Wissel of zeg op via Betaling beheren.";
  }
  if (answer.status === "unavailable") {
    return asked === "checkout"
      ? "Het afrekenen kon niet worden geopend. Probeer het zo opnieuw."
      : "Je betaalpagina kon niet worden geopend. Probeer het zo opnieuw.";
  }
  return null;
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
