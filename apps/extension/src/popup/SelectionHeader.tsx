import { Button } from "@mprelist/ui";
import { useEffect, useRef, type JSX } from "react";

import { describeHidden, describeSelectAll, describeSelectAllTick, type BulkSelection } from "./batching";

/**
 * The line over the ad list: tick everything the plan allows, and read back how
 * much of the cap is spent (T68, #147; ADR-0025).
 *
 * **It exists because a cap with no sentence is indistinguishable from a bug.**
 * The boxes alone can only express a limit by going dead — an eleventh row that
 * will not tick, a whole list that will not tick when the period has nothing left
 * — and a control that stops responding with no words near it is the exact shape
 * of something broken. This is where the number is said out loud, before anybody
 * meets it.
 *
 * **And because ten ticks is not a feature.** A plan that reposts twenty-five at a
 * time sells a single act, and twenty-five clicks to start it is the act performed
 * by hand — which is what the extension exists to stop.
 *
 * Drawn on a plan that does not include bulk too, disabled with the boxes it is
 * about: the conversion argument that keeps those boxes on screen (ADR-0007) is
 * the same one that keeps this row, and a header that vanished would make the
 * locked list look like a list with nothing to select rather than one the user
 * cannot select from yet.
 */
export function SelectionHeader({
  count,
  rowsShown,
  hidden,
  bulk,
  frozen,
  onSelectAll,
  onClear,
}: {
  /** How many ads are ticked right now, including any this list is not showing. */
  count: number;
  /** How many rows are on screen — the ceiling Select all works against, with the cap. */
  rowsShown: number;
  /** How many of the ticked ads a search has taken off the screen. */
  hidden: number;
  /**
   * What the plan allows, or `null` when it does not include bulk at all — which is
   * the row drawn inert beside the boxes it is about, and explained by the line
   * pinned under the list.
   */
  bulk: BulkSelection | null;
  /** A run is going, so the selection has already been made and is being worked through. */
  frozen: boolean;
  onSelectAll: () => void;
  onClear: () => void;
}): JSX.Element {
  const { label, hint } = describeSelectAll(count, bulk, rowsShown);
  const cap = bulk?.cap ?? 0;
  /**
   * How many ads Select all could leave ticked — what is on screen, or the cap,
   * whichever runs out first. A list of two ads on a plan that reposts ten is
   * *full* at two, and a box that stayed unchecked after ticking everything there
   * is would be telling the user their click had not worked.
   */
  const reach = Math.min(rowsShown + hidden, cap);
  const all = reach > 0 && count >= reach;
  const disabled = bulk === null || frozen || reach === 0;
  const note = describeHidden(hidden);

  return (
    <div className="popup-select-all">
      <div className="popup-select-all-row">
      {/* On the label and not on the box: Chrome draws no tooltip for a disabled
          control, and every reason this row is disabled is a reason somebody is
          hovering it. */}
      <label className="popup-select-all-label" title={describeSelectAllTick(bulk, frozen, all, reach)}>
        <TriStateBox
          checked={all}
          // Some but not all: the platform's own third state, which says "part of
          // this list" in the one glyph everybody already reads that way.
          partial={count > 0 && !all}
          disabled={disabled}
          // Named for what pressing it does rather than for what it is, because
          // the two differ here: the box that unticks a full selection is the
          // same box that ticks an empty one. A box that can do neither is named
          // for what it is instead — there is no action to announce.
          ariaLabel={selectAllLabel(all, reach)}
          onChange={all ? onClear : onSelectAll}
        />
        <span className="popup-select-all-text">{label}</span>
      </label>
      {count > 0 && !frozen ? (
        <Button shape="rect" tone="ghost" onClick={onClear} title="Vink alle rijen uit.">
          Wissen
        </Button>
      ) : hint !== null && !frozen ? (
        // Not while a run is going. The cap is about a selection somebody is
        // making, and during a run there is none to make — the bar under the list
        // is saying what is happening instead, and a second number up here would
        // be answering a question nobody is asking yet.
        <span className="popup-select-all-hint">{hint}</span>
        ) : null}
      </div>
      {note ? <p className="popup-select-all-note">{note}</p> : null}
    </div>
  );
}

function selectAllLabel(all: boolean, reach: number): string {
  if (reach === 0) return "Alles selecteren";
  return all ? "Selectie wissen" : `Selecteer de eerste ${reach} advertenties om te herplaatsen`;
}

/**
 * A checkbox in the third state the DOM has and JSX does not.
 *
 * `indeterminate` is a property and never an attribute, so React cannot set it
 * from the markup and there is no way to express it but reaching for the node.
 * Worth the ref rather than a drawn substitute: this is the glyph every list on
 * every platform uses for "some of these", and a bespoke dash in a box would be
 * a picture of a checkbox that screen readers announce as neither.
 */
function TriStateBox({
  checked,
  partial,
  disabled,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  disabled: boolean;
  ariaLabel: string;
  onChange: () => void;
}): JSX.Element {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={box}
      type="checkbox"
      className="popup-select-all-tick"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
    />
  );
}
