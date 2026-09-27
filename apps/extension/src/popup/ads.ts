import {
  ApiRequestError,
  NoMarktplaatsTabError,
  StaleMarktplaatsTabError,
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
  /** `noTab` when it failed for want of a marktplaats.nl tab, which pending rows say too. */
  | { status: "failed"; message: string; noTab?: boolean }
  /**
   * Every marktplaats.nl tab is a **Stale tab** (ADR-0039): not a failure but a
   * step, and one the popup can take for the user — reloading `tabId`.
   */
  | { status: "stale"; tabId: number };

export const ADS_LOADING: AdsView = { status: "loading" };

/**
 * What a **Stale tab** says (ADR-0039). A step rather than an error: right after
 * installing, every marktplaats.nl tab already open is one, and this is the
 * first thing a new user reads.
 */
export const STALE_TAB = "Nog één stap: vernieuw je Marktplaats-pagina, dan kan AdBump aan de slag.";

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
    return "Open marktplaats.nl in een tabblad en probeer het opnieuw.";
  }
  if (error instanceof StaleMarktplaatsTabError) {
    return STALE_TAB;
  }
  if (error instanceof NotAuthenticatedError) {
    return "Log eerst in op Marktplaats en probeer het opnieuw.";
  }
  if (error instanceof AdNotFoundError) {
    return "Marktplaats heeft deze advertentie niet meer.";
  }
  if (error instanceof SpikePendingError) {
    // Its message names the endpoint that is unset, which is the whole diagnosis
    // for the person live-testing (docs/live-testing.md).
    return error.message;
  }
  if (error instanceof ApiRequestError) {
    return `Marktplaats heeft het verzoek geweigerd (HTTP ${error.status}).`;
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

/**
 * What one row says about its price: the kind of price it is, the number where
 * there is one, and whether bids are taken on top.
 *
 * Three fields rather than one sentence, because the row draws them at three
 * weights — a chip, a number, an aside — and a string joined here would arrive as
 * one flat grey line.
 */
export interface PriceLine {
  /**
   * Marktplaats's own word for the kind of price, which is the word the seller
   * picked in the dropdown. `null` for a `priceType` this payload has never sent,
   * where the only label to hand would be a wire constant.
   */
  label: string | null;
  /**
   * Already formatted, and `null` where the type has no number — either because
   * it genuinely has none (`FREE`) or because none of the fields it does carry is
   * one we can stand behind (`FAST_BID`, `MIN_BID`; see below).
   */
  amount: string | null;
  /** Only ever true where `label` does not already say it. */
  bidding: boolean;
}

/**
 * Which of those a listing gets.
 *
 * **Three of the four types this list sends carry no useful `priceCents`**, and
 * until this existed all three rendered "€ 0,00": a free ad, an ad priced in its
 * description and an ad taking bids were three different things drawn as the same
 * wrong number. So the rule is *name the kind first and show a number only where
 * there is one* — "Gratis" is the whole truth about that ad, and a zero beside it
 * would take it back.
 *
 * The labels are Dutch because they are quotations. These are the words on the
 * seller's own dropdown on marktplaats.nl, and an English translation would leave
 * the popup naming a thing the site calls something else — the same reason
 * `formatEuro` writes nl-NL.
 *
 * `MIN_BID` rides with `FAST_BID` even though only the second has been seen in
 * this payload: `createAd` accepts both, they are the two the site treats as
 * bidding, and a bid type falling through to the default would be the "€ 0,00" bug
 * again under a name nobody was looking for.
 */
export function describePrice(ad: ListingSummary): PriceLine {
  switch (ad.priceType) {
    case "FIXED":
      return { label: "", amount: formatEuro(ad.priceCents), bidding: ad.biddingEnabled };
    case "FAST_BID":
    case "MIN_BID":
      // **The chip and no number** (T67). This branch used to draw
      // `vanaf € X` from `minimumBidPriceCents || priceCents`, and both halves of
      // that were wrong: `minimumBidPriceCents` is the minimum bid *placed* on the
      // ad rather than the floor its seller set, so an ad with bids showed a
      // bidder's number as the seller's own; and a bid ad's `priceCents` is not
      // reliably its asking price either — the live rows carry `0`, the golden
      // capture fixture carries 12500, and which is which has not been
      // established. There is no number here we can stand behind, so the row says
      // the one thing that is true. See `docs/internal-api-findings.md`
      // § `listMyAds`.
      return { label: "Bieden", amount: null, bidding: false };
    case "FREE":
      return { label: "Gratis", amount: null, bidding: ad.biddingEnabled };
    case "SEE_DESCRIPTION":
      return { label: "Zie beschrijving", amount: null, bidding: ad.biddingEnabled };
    default:
      // A type Marktplaats has added since. Printing the constant at a seller is
      // worse than saying nothing, and a 0 under a type we cannot name is not a
      // fact about the ad — it is the absence of one.
      return {
        label: null,
        amount: ad.priceCents > 0 ? formatEuro(ad.priceCents) : null,
        bidding: ad.biddingEnabled,
      };
  }
}
