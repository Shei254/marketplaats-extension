import {
  ApiRequestError,
  NoMarktplaatsTabError,
} from "../adapters/relay-marktplaats-client";
import {
  AdNotFoundError,
  NotAuthenticatedError,
  SpikePendingError,
} from "../domain/marktplaats-client";
import type { ListingSummary } from "../domain/types";

/**
 * The ad list, as the popup holds it (T30a, #39).
 *
 * Three states and no fourth: the list is loading, it is here, or it could not be
 * fetched and the user is told why. An empty list is **not** a failure — it is
 * `ready` with nothing in it, and the screen says "no active ads" rather than
 * leaving a spinner turning over an account that genuinely has none.
 *
 * The ads come from the user's own Marktplaats session through the content
 * script, so this costs us nothing and is **not subscription-gated**
 * (`docs/enforcement-contract.md`): a locked button beside a user's own ads is the
 * conversion surface, and there is nothing to convert beside an empty screen.
 */
export type AdsView =
  | { status: "loading" }
  | { status: "ready"; ads: ListingSummary[] }
  | { status: "failed"; message: string };

export const ADS_LOADING: AdsView = { status: "loading" };

/**
 * What to tell the user about a failure, in words about *their* situation rather
 * than ours.
 *
 * Ported from the POC popup, whose copy this is, and it survives the worker
 * boundary because the errors do: `fromWireError` rebuilds the type before this
 * ever sees it (#32's wire codes exist for the same reason). Both of the first two
 * are things only the user can fix, which is why they are the two that say what to
 * do rather than what went wrong.
 */
export function describeAdsFailure(error: unknown): string {
  if (error instanceof NoMarktplaatsTabError) {
    return "Open marktplaats.nl in a tab, then try again.";
  }
  if (error instanceof NotAuthenticatedError) {
    return "Log in to Marktplaats first, then try again.";
  }
  if (error instanceof AdNotFoundError) {
    return "Marktplaats no longer has this ad.";
  }
  if (error instanceof SpikePendingError) {
    // Its message names the endpoint that is unset, which is the whole diagnosis
    // for the person live-testing (docs/live-testing.md).
    return error.message;
  }
  if (error instanceof ApiRequestError) {
    return `Marktplaats refused the request (HTTP ${error.status}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * "€ 1.250,00" — Dutch formatting, because these are Marktplaats prices on a
 * Dutch marketplace and the number beside the title is the seller's own.
 */
export function formatEuro(cents: number): string {
  return EURO.format(cents / 100);
}

const EURO = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
