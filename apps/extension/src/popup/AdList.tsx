import { Button, Note, Skeleton } from "@mprelist/ui";
import { useCallback, useState, type JSX } from "react";

import type { ListingSummary } from "../domain/types";
import { formatEuro, type AdsView } from "./ads";
import { IDLE, refusalNote, refusedTone, rowStateFor, type RowState } from "./relisting";
import type { WorkerPort } from "./screen";

/**
 * The ad list, and the Repost button on each row (T30a #39, T30b #79).
 *
 * **One relist at a time.** While a row is running every other row's button is
 * locked, which is the POC popup's behaviour and the reason it had it: a
 * distracted click on three rows in a row is three ads deleted before the first
 * has been posted again, and delete-first (ADR-0003) makes that irreversible in a
 * way a slow queue would not. It is serialisation and **not pacing** — putting a
 * human-shaped gap between relists is T46 (#54), and a backend can refuse a call
 * that came too soon but cannot make one arrive at a plausible moment.
 *
 * The row state lives here rather than in each row, for the same reason: the lock
 * is a property of the list, and a row that owned its own state could not know
 * another was running.
 */
export function AdList({
  view,
  worker,
  onRelisted,
}: {
  view: AdsView;
  worker: WorkerPort;
  /** Called after a successful relist: the ad list and the quota have both moved. */
  onRelisted: () => void;
}): JSX.Element {
  const [running, setRunning] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, RowState>>({});

  const start = useCallback(
    async (listingId: string, action: "relist" | "retry") => {
      setRunning(listingId);
      setStates((current) => ({ ...current, [listingId]: { kind: "busy" } }));

      let state: RowState;
      try {
        const outcome = action === "relist" ? await worker.relist(listingId) : await worker.retry(listingId);
        state = rowStateFor(outcome);
      } catch (error) {
        // The worker itself did not answer. Nothing ran, so this is the same
        // shape as a refusal to start rather than a relist that failed halfway.
        state = {
          kind: "failed",
          tone: "error",
          action: "relist",
          message: `Nothing was reposted. ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      setStates((current) => ({ ...current, [listingId]: state }));
      setRunning(null);
      // The list is stale the moment one of them is reposted — the ad has a new
      // id — and so is the quota. Both come back from the one reload.
      if (state.kind === "done") onRelisted();
    },
    [worker, onRelisted],
  );

  if (view.status === "loading") return <LoadingRows />;
  if (view.status === "failed") {
    return (
      <div className="popup-ads-failed">
        <Note tone="error">Could not load your ads. {view.message}</Note>
      </div>
    );
  }
  if (view.ads.length === 0) {
    // An account with no ads is an answer, not a failure — and a spinner left
    // turning over one is the version of this screen that looks broken.
    return <p className="popup-ads-empty">You have no active ads.</p>;
  }

  return (
    <ul className="popup-ads">
      {view.ads.map((ad) => (
        <AdRow
          ad={ad}
          key={ad.id}
          state={states[ad.id] ?? IDLE}
          locked={running !== null && running !== ad.id}
          onStart={start}
        />
      ))}
    </ul>
  );
}

/**
 * One ad: what it is called, what it costs, and what its Repost button is doing.
 *
 * The title is truncated by CSS rather than by cutting the string, so the whole of
 * it stays in the DOM — a `title` attribute carries it to a tooltip, which is the
 * only way to read a long one in a 360px window.
 */
export function AdRow({
  ad,
  state,
  locked,
  onStart,
}: {
  ad: ListingSummary;
  state: RowState;
  /** Another row is relisting, so this one may not start. */
  locked: boolean;
  onStart: (listingId: string, action: "relist" | "retry") => void;
}): JSX.Element {
  const action = state.kind === "failed" ? state.action : "relist";
  return (
    <li className="popup-ad" data-state={state.kind}>
      <div className="popup-ad-row">
        <div className="popup-ad-info">
          <span className="popup-ad-title" title={ad.title}>
            {ad.title}
          </span>
          <span className="popup-ad-price">{formatEuro(ad.priceCents)}</span>
        </div>
        <Button
          tone={toneFor(state, locked)}
          title={tooltipFor(state, ad.title)}
          onClick={() => onStart(ad.id, action)}
        >
          {labelFor(state)}
        </Button>
      </div>
      <RowNote state={state} />
    </li>
  );
}

function RowNote({ state }: { state: RowState }): JSX.Element | null {
  switch (state.kind) {
    case "done":
      return <Note tone="ok">Reposted. Reloading your ads…</Note>;
    case "failed":
      return <Note tone={state.tone}>{state.message}</Note>;
    case "refused":
      return <Note tone="warn">{refusalNote(state.locked)}</Note>;
    default:
      return null;
  }
}

/**
 * Which button this is. The tones carry their own glyphs (`@mprelist/ui`), and
 * every inert one is disabled by the component rather than by this caller —
 * which is what stops a locked row being clickable at all.
 */
function toneFor(state: RowState, locked: boolean): "primary" | "busy" | "done" | "retry" | "locked" | "cooldown" {
  switch (state.kind) {
    case "busy":
      return "busy";
    case "done":
      return "done";
    case "failed":
      return "retry";
    case "refused":
      return refusedTone(state.locked);
    case "idle":
      return locked ? "locked" : "primary";
  }
}

function labelFor(state: RowState): string {
  switch (state.kind) {
    case "busy":
      return "Reposting…";
    case "done":
      return "Reposted";
    case "failed":
      // "Retry" is a resume from the snapshot — the ad is already gone and this is
      // what puts it back. "Try again" starts over on an ad that is still there.
      return state.action === "retry" ? "Retry" : "Try again";
    default:
      return "Repost";
  }
}

/**
 * The hover text, which is where the sentence that matters goes: **Repost deletes
 * the ad first** (ADR-0002), and a button that says only "Repost" does not say so
 * anywhere. The POC popup put it here and this keeps it.
 */
function tooltipFor(state: RowState, title: string): string {
  if (state.kind === "idle") {
    return `Delete “${title}” and post it again, so it lands back on top.`;
  }
  return labelFor(state);
}

/** The shape of the answer while it is on its way — the canvas's Loading artboard. */
function LoadingRows(): JSX.Element {
  return (
    <ul className="popup-ads">
      {[78, 62, 88].map((width) => (
        <li className="popup-ad" key={width}>
          <div className="popup-ad-row">
            <div className="popup-ad-info" style={{ flex: 1 }}>
              <Skeleton width={`${width}%`} height={11} />
              <Skeleton width={60} height={10} className="popup-ad-price" />
            </div>
            <Skeleton width={74} height={28} shape="pill" />
          </div>
        </li>
      ))}
    </ul>
  );
}
