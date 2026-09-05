import { Button, Note } from "@mprelist/ui";
import type { JSX } from "react";

import type { BatchShape } from "../domain/batch-estimate";
import type { BatchRun } from "../domain/batch-run";
import {
  describeCap,
  describeProgress,
  describeStop,
  offerSelection,
  offerUnstarted,
  type BulkSelection,
} from "./batching";

/**
 * The bar under the ad list: what a selection would cost before it is started,
 * and what a run is doing once it has been (T68, #147; ADR-0025).
 *
 * **It is one strip in three states rather than three components**, because to the
 * user it is one thing — the place a batch is decided, watched and read about —
 * and a screen that moved the run somewhere else would leave them looking for it
 * after the popup had been closed and reopened. So the strip itself is drawn here,
 * once, and each state fills it: three components that each drew their own would be
 * three chances for the thing the user thinks of as one bar to be laid out three
 * ways.
 *
 * The free tier never reaches this component at all: with no `bulk` on the plan the
 * boxes are drawn disabled beside a line pointing at Plans, and nothing can be
 * ticked to bring a bar up. That line lives on the list, next to the control it is
 * about, and is pinned by the same `popup-foot` this is — it stands in the same
 * place and answers the same question.
 */
export function BatchBar({
  run,
  chosen,
  bulk,
  shape,
  onStart,
  onStop,
  onDismiss,
  onRepostUnstarted,
}: {
  /** The run the worker holds, or nothing — including one that has already stopped. */
  run: BatchRun | null;
  /**
   * The ads ticked right now, in the order a run would take them — the ids and not
   * a count, because the button's number and the run's contents have to be the
   * same fact (see {@link offerSelection}).
   */
  chosen: readonly string[];
  bulk: BulkSelection;
  /**
   * The gap and the rails the estimate is made of, as the API last served them —
   * so an operator who moves a rail changes this sentence with a restart rather
   * than a store release (ADR-0025).
   */
  shape: BatchShape;
  onStart: () => void;
  onStop: () => void;
  /** Forget a finished run, which is also what takes the toolbar badge down. */
  onDismiss: () => void;
  /** Start a fresh run over the ads a stopped one never got to. */
  onRepostUnstarted: () => void;
}): JSX.Element | null {
  if (run !== null && run.stop === null) {
    return (
      <div className="popup-foot popup-batch" data-state="running">
        <RunningRun run={run} onStop={onStop} />
      </div>
    );
  }
  if (run !== null) {
    // **A run that has ended must not swallow the next one.** A stopped run is
    // held until it is dismissed — that is what keeps its outcome readable after
    // the popup has been closed and reopened — and for as long as it was the only
    // thing this bar could draw, ticking boxes produced no button anywhere on the
    // screen. The boxes ticked; nothing happened; the feature looked broken, and
    // from the user's chair it was.
    //
    // So the summary stays and the offer moves: the moment anything is ticked,
    // the primary action is that selection rather than what the last run left
    // behind. Never both — two Repost buttons in one strip is a strip asking the
    // user to tell two batches apart before they have started either.
    return (
      <div className="popup-foot popup-batch" data-state="stopped">
        <StoppedRun run={run} onDismiss={onDismiss} />
        {chosen.length > 0 ? (
          <StartRow chosen={chosen} bulk={bulk} shape={shape} onStart={onStart} />
        ) : (
          <RepostUnstartedRow run={run} bulk={bulk} onRepost={onRepostUnstarted} />
        )}
      </div>
    );
  }
  if (chosen.length === 0) return null;
  return (
    <div className="popup-foot popup-batch" data-state="selecting">
      <StartRow chosen={chosen} bulk={bulk} shape={shape} onStart={onStart} />
    </div>
  );
}

/**
 * Before it starts: how many, how long, and whether it will pause.
 *
 * **The duration is said before the button is pressed**, which is the condition
 * ADR-0025 attached to letting a Power batch be twenty-five ads: a two-hour
 * unattended run is a reasonable thing to choose and an unreasonable thing to
 * discover.
 *
 * The button says what will actually be started rather than what is ticked, which
 * are the same number until the quota falls under a standing selection — a single
 * repost pressed on a row while five are ticked is all it takes.
 */
function StartRow({
  chosen,
  bulk,
  shape,
  onStart,
}: {
  chosen: readonly string[];
  bulk: BulkSelection;
  shape: BatchShape;
  onStart: () => void;
}): JSX.Element | null {
  const offer = offerSelection(chosen, bulk, shape);
  if (offer === null) return null;
  // Ticked rows and nothing left to spend on them. The sentence stands where the
  // button would have been: a control that does nothing is the shape of a bug, and
  // this is the same argument the selection header is built on.
  if (offer.kind === "blocked") return <p className="popup-batch-note">{offer.why}</p>;
  return (
    <>
      <div className="popup-batch-row">
        <Button shape="rect" tone="primary" onClick={onStart} title="Repost the ads you have ticked, one after another.">
          {offer.label}
        </Button>
      </div>
      {chosen.length >= bulk.cap ? <p className="popup-batch-note">{describeCap(bulk)}</p> : null}
      {offer.note ? <p className="popup-batch-note">{offer.note}</p> : null}
    </>
  );
}

/**
 * While it runs.
 *
 * **The popup is closed for most of a run**, so what this is really for is the
 * moment somebody opens it again: it has to answer "is it still going" without
 * their having to work it out from the rows. The toolbar badge is what says so
 * while nothing is open.
 */
function RunningRun({ run, onStop }: { run: BatchRun; onStop: () => void }): JSX.Element {
  return (
    <>
      <div className="popup-batch-row">
        <span className="popup-batch-progress">{describeProgress(run)}</span>
        <Button shape="rect" tone="ghost" onClick={onStop} title="Finish the ad that is running and start no more.">
          Stop
        </Button>
      </div>
      <p className="popup-batch-note">
        This keeps going with the popup closed. Reposts are spaced out so they look like clicks rather than a
        script.
      </p>
    </>
  );
}

/**
 * Once it has stopped, whether it finished or not.
 *
 * **The ads that were never started are offered rather than resumed**, which is
 * the whole of ADR-0025's browser-restart rule made visible: a queue that picked
 * itself up would be delete-first firing at ads nobody is thinking about, and a
 * button is a person deciding. It is the same offer for every stop, because from
 * here they are the same situation — some ads did not run, and only the user knows
 * whether they still want them to.
 */
function StoppedRun({ run, onDismiss }: { run: BatchRun; onDismiss: () => void }): JSX.Element {
  const why = describeStop(run.stop?.reason ?? "finished");
  return (
    <>
      <div className="popup-batch-row">
        <span className="popup-batch-progress">{describeProgress(run)}</span>
        <Button shape="rect" tone="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {why ? <Note tone={run.stop?.reason === "finished" ? "ok" : "warn"}>{why}</Note> : null}
    </>
  );
}

/**
 * The offer itself, which a finished run has nothing to make — **and which the cap
 * applies to, exactly as the boxes do.**
 *
 * This is the one way into a run that does not go through the checkboxes, so it is
 * the one place the cap has to be spelled a second time: a run stopped by a spent
 * quota otherwise offers to start every ad it never reached, against nothing left
 * to spend. What the button says is what will actually happen, down to the number.
 */
function RepostUnstartedRow({
  run,
  bulk,
  onRepost,
}: {
  run: BatchRun;
  bulk: BulkSelection;
  onRepost: () => void;
}): JSX.Element | null {
  const offer = offerUnstarted(run, bulk);
  if (offer === null) return null;
  // Ads left over that the plan cannot start any of yet. The sentence stands where
  // the button would have been rather than beside a dead one: a control that does
  // nothing is the shape of a bug, and this is the same argument the selection
  // header is built on.
  if (offer.kind === "blocked") return <p className="popup-batch-note">{offer.why}</p>;
  return (
    <>
      <div className="popup-batch-row">
        <Button shape="rect" tone="primary" onClick={onRepost}>
          {offer.label}
        </Button>
      </div>
      {offer.note ? <p className="popup-batch-note">{offer.note}</p> : null}
    </>
  );
}
