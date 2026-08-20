import {
  ApiRequestError,
  NoMarktplaatsTabError,
  RelayMarktplaatsClient,
} from "../adapters/relay-marktplaats-client";
import type {
  BackgroundResponse,
  RelistRequest,
  WireRelistOutcome,
} from "../background/messages";
import { fromWireError } from "../content/messages";
import {
  AdNotFoundError,
  NotAuthenticatedError,
  SpikePendingError,
} from "../domain/marktplaats-client";
import type { ListingSummary } from "../domain/types";

/**
 * Popup surface (ADR-0004, issues #2/#7): lists the user's own ads, each with a
 * Repost button. The button does not relist here — it asks the background service
 * worker to, so closing the popup mid-relist cannot strand an ad between the
 * delete and the re-create (ADR-0003). One relist runs at a time; the others are
 * locked meanwhile so a distracted click can't fan out into several deletes.
 */
const statusEl = document.getElementById("status") as HTMLDivElement;
const listEl = document.getElementById("ads") as HTMLUListElement;
const refreshEl = document.getElementById("refresh") as HTMLButtonElement;
const bannerEl = document.getElementById("banner") as HTMLDivElement;

const client = new RelayMarktplaatsClient();

/** Every rendered row, so a running relist can lock the rest of the list. */
const rows: { lock(locked: boolean): void }[] = [];

type RowState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  /** `action` is what the button retries with: a fresh relist, or a resume from the snapshot. */
  | { kind: "failed"; message: string; tone: "error" | "warn"; action: RelistRequest["kind"] };

function showStatus(message: string): void {
  statusEl.textContent = message;
  statusEl.hidden = false;
  listEl.hidden = true;
}

function renderAds(ads: ListingSummary[]): void {
  rows.length = 0;
  if (ads.length === 0) {
    showStatus("You have no active ads.");
    return;
  }
  listEl.replaceChildren(...ads.map(createRow));
  statusEl.hidden = true;
  listEl.hidden = false;
}

function createRow(ad: ListingSummary): HTMLLIElement {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "row";

  const info = document.createElement("div");
  info.className = "info";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = ad.title;
  title.title = ad.title;
  const price = document.createElement("span");
  price.className = "price";
  price.textContent = formatEuro(ad.priceCents);
  info.append(title, price);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "repost";

  const note = document.createElement("p");
  note.className = "note";
  note.hidden = true;

  row.append(info, button);
  li.append(row, note);

  let state: RowState = { kind: "idle" };
  let locked = false;

  function setState(next: RowState): void {
    state = next;
    render();
  }

  function render(): void {
    li.dataset.state = state.kind;
    button.replaceChildren();
    delete button.dataset.locked;
    note.hidden = state.kind !== "failed" && state.kind !== "done";

    switch (state.kind) {
      case "idle":
        button.dataset.variant = "idle";
        button.textContent = "Repost";
        button.title = `Delete "${ad.title}" and post it again, so it lands back on top.`;
        break;
      case "busy": {
        button.dataset.variant = "busy";
        const spinner = document.createElement("span");
        spinner.className = "spinner";
        button.append(spinner, document.createTextNode("Reposting…"));
        button.title = "Reposting…";
        break;
      }
      case "done":
        button.dataset.variant = "done";
        button.textContent = "Reposted";
        button.title = "This ad has been reposted.";
        note.dataset.tone = "ok";
        note.textContent = "Reposted. Reloading your ads…";
        break;
      case "failed":
        button.dataset.variant = state.action === "retry" ? "retry" : "idle";
        button.textContent = state.action === "retry" ? "Retry" : "Try again";
        button.title = button.textContent;
        note.dataset.tone = state.tone;
        note.textContent = state.message;
        break;
    }

    button.disabled = state.kind === "busy" || state.kind === "done" || locked;
    // Grey out only the rows a running relist is holding back; a finished row keeps its own colour.
    if (locked && state.kind !== "busy" && state.kind !== "done") button.dataset.locked = "";
  }

  async function repost(): Promise<void> {
    const action = state.kind === "failed" ? state.action : "relist";
    let reposted = false;
    showBanner(null);
    setState({ kind: "busy" });
    setRelistRunning(true);
    try {
      const outcome = await ask({ kind: action, listingId: ad.id });
      reposted = outcome.status === "relisted";
      setState(describeOutcome(outcome));
    } catch (error) {
      // The request never reached a verdict. After a retry the ad is already
      // deleted, so it stays recoverable rather than being called untouched.
      setState(
        action === "retry"
          ? {
              kind: "failed",
              tone: "warn",
              action: "retry",
              message: `Retry failed. Your ad is still saved in the extension. ${describeError(error)}`,
            }
          : {
              kind: "failed",
              tone: "error",
              action: "relist",
              message: `Nothing was reposted — your ad is untouched. ${describeError(error)}`,
            },
      );
    } finally {
      setRelistRunning(false);
    }

    // Reloading rebuilds every row, so the confirmation moves to the banner.
    if (reposted) {
      await load(`Reposted “${ad.title}”. It can take a moment to show up below.`);
    }
  }

  button.addEventListener("click", () => void repost());

  rows.push({
    lock(next: boolean) {
      locked = next;
      render();
    },
  });
  render();
  return li;
}

/**
 * Serialise relists: Marktplaats sees one delete+create at a time (the pacing
 * posture of ADR-0008), and the user cannot start a second one by accident while
 * the first is between delete and re-create.
 */
function setRelistRunning(running: boolean): void {
  refreshEl.disabled = running;
  for (const row of rows) row.lock(running);
}

function describeOutcome(outcome: WireRelistOutcome): RowState {
  switch (outcome.status) {
    case "relisted":
      return { kind: "done" };
    case "failed-before-delete":
      return {
        kind: "failed",
        tone: "error",
        action: "relist",
        message: `Nothing was reposted — your ad is untouched. ${describeError(
          fromWireError(outcome.error),
        )}`,
      };
    case "failed-recoverable":
      return {
        kind: "failed",
        tone: "warn",
        action: "retry",
        message: `Your ad was removed but posting it again failed. It is saved in the extension — press Retry. ${describeError(
          fromWireError(outcome.error),
        )}`,
      };
  }
}

function describeError(error: unknown): string {
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
    return error.message;
  }
  if (error instanceof ApiRequestError) {
    return `Marktplaats refused the request (HTTP ${error.status}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

/**
 * Ask the background worker to run a relist/retry and unwrap its typed answer.
 *
 * Typed to the relist half of the protocol: the worker also answers sign-in
 * questions now (T23, #32), and this popup — which T29 (#38) replaces — asks none
 * of them. The generic is what keeps `answer` a `WireRelistOutcome` here rather
 * than a union nobody would narrow.
 */
async function ask(request: RelistRequest): Promise<WireRelistOutcome> {
  const response = (await chrome.runtime.sendMessage(request)) as
    | BackgroundResponse<RelistRequest["kind"]>
    | undefined;
  if (!response) throw new Error("The extension's background worker did not answer.");
  if (!response.ok) throw fromWireError(response.error);
  return response.answer;
}

/** Reload the ad list. `banner` carries a confirmation across the re-render; null clears it. */
async function load(banner: string | null = null): Promise<void> {
  showBanner(banner);
  refreshEl.disabled = true;
  showStatus("Loading…");
  try {
    renderAds(await client.listMyAds());
  } catch (error) {
    showStatus(`Could not load your ads. ${describeError(error)}`);
  } finally {
    refreshEl.disabled = false;
  }
}

function showBanner(message: string | null): void {
  bannerEl.textContent = message ?? "";
  bannerEl.hidden = message === null;
}

refreshEl.addEventListener("click", () => void load());

void load();
