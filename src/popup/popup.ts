import {
  NoMarktplaatsTabError,
  RelayMarktplaatsClient,
} from "../adapters/relay-marktplaats-client";
import {
  NotAuthenticatedError,
  SpikePendingError,
  type MarktplaatsClient,
} from "../domain/marktplaats-client";
import type { ListingSummary } from "../domain/types";

/**
 * Popup surface (ADR-0004, issue #2): lists the user's own ads. The relist action
 * per ad is wired in issue #7. Rendering the live list needs the real
 * MarktplaatsClient, which is pending the read spike (#2) — until then the client
 * throws SpikePendingError and the popup shows a clear pending state.
 */
const statusEl = document.getElementById("status") as HTMLDivElement;
const listEl = document.getElementById("ads") as HTMLUListElement;

function showStatus(message: string): void {
  statusEl.textContent = message;
  statusEl.hidden = false;
  listEl.hidden = true;
}

function renderAds(ads: ListingSummary[]): void {
  if (ads.length === 0) {
    showStatus("You have no active ads.");
    return;
  }
  listEl.replaceChildren(
    ...ads.map((ad) => {
      const li = document.createElement("li");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = ad.title;
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = formatEuro(ad.priceCents);
      li.append(title, price);
      return li;
    }),
  );
  statusEl.hidden = true;
  listEl.hidden = false;
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

async function load(client: MarktplaatsClient): Promise<void> {
  try {
    renderAds(await client.listMyAds());
  } catch (error) {
    if (error instanceof NoMarktplaatsTabError) {
      showStatus("Open marktplaats.nl in a tab, then reopen this popup.");
    } else if (error instanceof NotAuthenticatedError) {
      showStatus("Please log in to Marktplaats first, then reopen this popup.");
    } else if (error instanceof SpikePendingError) {
      showStatus("Live ad listing is not wired up yet (endpoints pending spike #2/#3).");
    } else {
      showStatus("Could not load your ads. Please try again.");
    }
  }
}

void load(new RelayMarktplaatsClient());
