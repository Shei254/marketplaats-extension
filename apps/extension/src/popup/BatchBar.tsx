import { Button, Note } from "@mprelist/ui";
import type { JSX } from "react";

import type { BatchShape } from "../domain/batch-estimate";
import type { BatchRun } from "../domain/batch-run";
import { describeProgress, describeSelection, describeStop, type BulkSelection } from "./batching";

/**
 * The bar under the ad list: what a selection would cost before it is started,
 * and what a run is doing once it has been (T68, #147; ADR-0025).
 *
 * **It is one strip in three states rather than three components**, because to the
 * user it is one thing — the place a batch is decided, watched and read about —
 * and a screen that moved the run somewhere else would leave them looking for it
 * after the popup had been closed and reopened.
 *
 * The free tier never reaches this component at all: with no `bulk` on the plan the
 * boxes are drawn disabled beside a line pointing at Plans, and nothing can be
 * ticked to bring a bar up. That line lives on the list, next to the control it is
 * about.
 */
export function BatchBar({
  run,
  selected,
  bulk,
  shape,
  onStart,
  onStop,
  onDismiss,
  onRepostUnstarted,
}: {
  /** The run the worker holds, or nothing — including one that has already stopped. */
  run: BatchRun | null;
  /** How many rows are ticked right now. */
  selected: number;
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
  if (run !== null && run.stop === null) return <RunningBar run={run} onStop={onStop} />;
  if (run !== null) return <StoppedBar run={run} onDismiss={onDismiss} onRepost={onRepostUnstarted} />;
  if (selected === 0) return null;
  return <SelectionBar selected={selected} bulk={bulk} shape={shape} onStart={onStart} />;
}

/**
 * Before it starts: how many, how long, and whether it will pause.
 *
 * **The duration is said before the button is pressed**, which is the condition
 * ADR-0025 attached to letting a Power batch be twenty-five ads: a two-hour
 * unattended run is a reasonable thing to choose and an unreasonable thing to
 * discover.
 */
function SelectionBar({
  selected,
  bulk,
  shape,
  onStart,
}: {
  selected: number;
  bulk: BulkSelection;
  shape: BatchShape;
  onStart: () => void;
}): JSX.Element {
  const { label, note } = describeSelection(selected, shape.rails, shape.gap);
  return (
    <div className="popup-batch" data-state="selecting">
      <div className="popup-batch-row">
        <Button shape="rect" tone="primary" onClick={onStart} title="Repost the ads you have ticked, one after another.">
          {label}
        </Button>
      </div>
      {selected >= bulk.cap ? <p className="popup-batch-note">{capNote(bulk)}</p> : null}
      {note ? <p className="popup-batch-note">{note}</p> : null}
    </div>
  );
}

/**
 * Why the boxes stopped ticking, which is a different sentence depending on which
 * of the two numbers ran out — and only one of them is something a bigger plan
 * fixes.
 */
function capNote(bulk: BulkSelection): string {
  if (bulk.upTo !== null && bulk.cap >= bulk.upTo) {
    return `Your plan reposts ${bulk.upTo} at a time.`;
  }
  return `That is all the relists you have left this period.`;
}

/**
 * While it runs.
 *
 * **The popup is closed for most of a run**, so what this is really for is the
 * moment somebody opens it again: it has to answer "is it still going" without
 * their having to work it out from the rows. The toolbar badge is what says so
 * while nothing is open.
 */
function RunningBar({ run, onStop }: { run: BatchRun; onStop: () => void }): JSX.Element {
  return (
    <div className="popup-batch" data-state="running">
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
    </div>
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
function StoppedBar({
  run,
  onDismiss,
  onRepost,
}: {
  run: BatchRun;
  onDismiss: () => void;
  onRepost: () => void;
}): JSX.Element {
  const why = describeStop(run.stop?.reason ?? "finished");
  const unstarted = run.stop?.unstarted ?? [];
  return (
    <div className="popup-batch" data-state="stopped">
      <div className="popup-batch-row">
        <span className="popup-batch-progress">{describeProgress(run)}</span>
        <Button shape="rect" tone="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {why ? <Note tone={run.stop?.reason === "finished" ? "ok" : "warn"}>{why}</Note> : null}
      {unstarted.length > 0 ? (
        <div className="popup-batch-row">
          <Button shape="rect" tone="primary" onClick={onRepost}>
            {`Repost the remaining ${unstarted.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
