import { Button, Note, Skeleton } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import type { WireRelistOutcome } from "../background/messages";

import type { ListingSummary } from "../domain/types";
import { formatEuro, type AdsView } from "./ads";
import { IDLE, PACING_NOTE, refusalNote, refusedTone, rowStateFor, type RowState } from "./relisting";
import type { WorkerPort } from "./screen";

/**
 * The ad list, and the Repost button on each row (T30a #39, T30b #79).
 *
 * **One relist at a time.** While a row is running every other row's button is
 * locked, which is the POC popup's behaviour and the reason it had it: a
 * distracted click on three rows in a row is three ads deleted before the first
 * has been posted again, and delete-first (ADR-0003) makes that irreversible in a
 * way a slow queue would not. That is serialisation and **not pacing**: the
 * human-shaped gap between relists arrived with T46 (#54) and is the worker's,
 * because a backend can refuse a call that came too soon but cannot make one
 * arrive at a plausible moment. What this list does with it is *show* it — a
 * wait nobody explained is indistinguishable from a hang.
 *
 * The row state lives here rather than in each row, for the same reason: the lock
 * is a property of the list, and a row that owned its own state could not know
 * another was running.
 */
export function AdList({
  view,
  worker,
  onOutcome,
  empty = "You have no active ads.",
}: {
  view: AdsView;
  worker: WorkerPort;
  /**
   * Every finished attempt, handed up whole. The plan strip belongs to the screen
   * above and moves on the quota this carries; the ad list is reloaded there too,
   * since a reposted ad has a new id.
   */
  onOutcome: (outcome: WireRelistOutcome) => void;
  /**
   * What an empty list means, which this component cannot know: an account with
   * no ads and a search that matched none are the same three states and two
   * different sentences (T31, #40). The default is the first, because the list
   * without a query is what this was before there was a box.
   */
  empty?: string;
}): JSX.Element {
  const [running, setRunning] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, RowState>>({});
  /**
   * When the account's cooldown ends, if one is running. **The whole list is
   * locked, not the row that met it**: the pacing rails are per user (ADR-0008),
   * so the next ad would be refused for the same reason and a button that offered
   * to try is a button that lies.
   */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(cooldownUntil, () => setCooldownUntil(null));
  /**
   * When the relist that is running will actually start, if the worker is pacing
   * it (T46, #54). **Only the running row shows this** — unlike a cooldown, which
   * is the account's and locks the list, this is one attempt waiting its turn, and
   * every other button is already locked because a relist is in flight.
   */
  const [pacingUntil, setPacingUntil] = useState<number | null>(null);
  const pacingSeconds = useCountdown(pacingUntil, () => setPacingUntil(null));

  const start = useCallback(
    async (listingId: string, action: "relist" | "retry") => {
      setRunning(listingId);
      setStates((current) => ({ ...current, [listingId]: { kind: "busy" } }));

      // The worker paces a relist before it starts (T46, #54); this asks how long
      // so the row can count it down. It is a question, not the wait itself — the
      // worker waits whether or not anybody asked, and would still wait if this
      // answer never came, which is why a failure to get one is 0 rather than a
      // reason not to start.
      //
      // Only for a fresh relist. A retry is usually a resume of an ad that is
      // already deleted, which is recovery and is not paced at all; asking would
      // draw a countdown for a wait that is not going to happen.
      if (action === "relist") {
        const waitMs = await worker.msBeforeNextRelist().catch(() => 0);
        if (waitMs > 0) setPacingUntil(Date.now() + waitMs);
      }

      let state: RowState;
      let outcome: WireRelistOutcome | null = null;
      try {
        outcome = action === "relist" ? await worker.relist(listingId) : await worker.retry(listingId);
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
      // Whatever the countdown still said, the attempt is over: an answer that
      // arrived early — a worker that could not pace, a refusal — must not leave
      // a clock ticking on a row that has finished.
      setPacingUntil(null);
      if (state.kind === "refused" && state.locked.state === "cooldown") {
        // A refusal carrying no seconds locks nothing: there is nothing to count,
        // and a lock for an unknown length is worse than letting the next attempt
        // be refused too. It becomes a cooldown that has already elapsed, which
        // `useCountdown` clears on its first read — one place decides that rather
        // than two agreeing.
        setCooldownUntil(Date.now() + (state.locked.retryAfter ?? 0) * 1000);
      }
      onOutcome(outcome ?? { status: "refused", locked: { state: "retry" } });
    },
    [worker, onOutcome],
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
    return <p className="popup-ads-empty">{empty}</p>;
  }

  return (
    <ul className="popup-ads">
      {view.ads.map((ad) => (
        <AdRow
          ad={ad}
          key={ad.id}
          state={states[ad.id] ?? IDLE}
          locked={(running !== null && running !== ad.id) || secondsLeft !== null}
          secondsLeft={secondsLeft}
          pacingSeconds={running === ad.id ? pacingSeconds : null}
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
  secondsLeft,
  pacingSeconds,
  onStart,
}: {
  ad: ListingSummary;
  state: RowState;
  /** Another row is relisting, or the account is in a cooldown, so this one may not start. */
  locked: boolean;
  /** Seconds until the account's cooldown ends, when one is running. */
  secondsLeft?: number | null;
  /**
   * Seconds until this row's own relist starts, while the worker is pacing it
   * (T46, #54). Different from the cooldown above in what it means and in who it
   * applies to: that one is the backend refusing the account, this one is us
   * deliberately not going yet.
   */
  pacingSeconds?: number | null;
  onStart: (listingId: string, action: "relist" | "retry") => void;
}): JSX.Element {
  const action = state.kind === "failed" ? state.action : "relist";
  // The row's own wait wins over the account's: this row is the one running, and
  // what it is waiting for is the number it should be counting down.
  const counting = pacingSeconds ?? secondsLeft ?? null;
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
          tone={counting != null ? "cooldown" : toneFor(state, locked)}
          title={tooltipFor(state, ad.title)}
          onClick={() => onStart(ad.id, action)}
        >
          {counting != null ? `${counting}s` : labelFor(state)}
        </Button>
      </div>
      <RowNote state={state} pacing={pacingSeconds != null} />
    </li>
  );
}

/**
 * The countdown on a cooldown, in whole seconds, ending itself when it runs out.
 *
 * A timer rather than a static number because a cooldown a user cannot see the end
 * of is indistinguishable from something broken — and when it reaches zero the
 * buttons come back on their own, which is the half that makes it a countdown
 * rather than a label.
 */
function useCountdown(until: number | null, onElapsed: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [until]);

  if (until === null) return null;
  const left = Math.ceil((until - now) / 1000);
  if (left <= 0) {
    // Cleared through the caller's state rather than here, so the elapsed
    // cooldown unlocks every row at once and this hook stays a function of time.
    queueMicrotask(onElapsed);
    return null;
  }
  return left;
}

function RowNote({ state, pacing }: { state: RowState; pacing?: boolean }): JSX.Element | null {
  // Said before anything else, because while it is true the row is "busy" and a
  // busy row says nothing at all — which is the hang this note exists to not be.
  if (pacing) return <Note tone="warn">{PACING_NOTE}</Note>;
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
