import { bulkIn, isExpressible, withBulk } from "@mprelist/contracts";
import { Button, Field, Input, Note, Textarea } from "@mprelist/ui";
import { useState, type JSX } from "react";

/**
 * The tier's feature flags, as a control rather than as punctuation (T69, #153;
 * ADR-0026).
 *
 * The flags were a JSON textarea, which was honest while `features` was an open
 * object with nothing behind it — and T68 put `bulk` in it, seeded it and shipped
 * two readers of it. So the operator who sets a quota with a number field was
 * setting the cap beside it by typing `{"bulk": {"upTo": 10}}`, where a typo is a
 * plan that sells the wrong thing or nothing at all.
 *
 * **One invariant, and everything below is a reading of it: the number field owns
 * the value only when it can represent the whole truth.** `isExpressible` is that
 * question. The form opens on the JSON hatch when the answer is no, refuses to
 * close it while the answer is still no, and refuses to open it while the number
 * is not a number — because a mode switch is exactly the moment ownership of the
 * value changes hands, and handing over something unreadable is how the two
 * controls start disagreeing.
 *
 * **A mode, not a mirror.** Exactly one control owns the value at a time: expanding
 * seeds the textarea from what the number says and disables the number, collapsing
 * parses the textarea back. A live two-way mirror would reformat an operator's JSON
 * under their cursor, and mid-edit invalid JSON leaves the number showing something
 * — stale, blank or last-good, each wrong in some case.
 *
 * **Where the state lives is the reason this is a hook and a component rather than
 * one controlled component.** Both forms validate on submit and report in one
 * place, so the parent needs to *ask* for the value, and `read()` is that question
 * asked of whichever control currently owns it.
 */

/** What the field is worth right now, or the sentence saying why it is not worth anything. */
type Reading = { features: Record<string, unknown> } | { problem: string };

export interface FeaturesField {
  /** Whether the JSON hatch is open, which is also which control owns the value. */
  expanded: boolean;
  /** The number field's text — empty is a tier with no bulk, never zero. */
  cap: string;
  /** The hatch's text, seeded on every open and parsed on every close. */
  json: string;
  /** Why the last mode switch did not happen, in place, until the next one does. */
  refusal: string | null;
  setCap: (typed: string) => void;
  setJson: (typed: string) => void;
  toggle: () => void;
  read: () => Reading;
}

/**
 * 0 is refused, and this is the one field where that needs saying out loud: it is
 * not the off switch it looks like. `bulkIn` reads a cap only from a whole number
 * above zero, so `{"upTo": 0}` is *granted, capped by the quota alone* — the exact
 * inverse of what somebody typing it into an empty-means-none field intends.
 */
const CAP_PROBLEM =
  "Bulk repost is a whole number of 1 or more, or empty for a tier that does not include it. " +
  "0 is not “none”: it grants bulk capped only by the quota.";

const JSON_PROBLEM = 'Feature flags have to be a JSON object, like {} or {"bulk": {"upTo": 10}}.';

/**
 * Said where the collapse was refused, and it names what the field can hold rather
 * than only what it cannot: the way out is one edit, and an operator who cannot see
 * which edit reads this as a broken control.
 */
const NOT_A_NUMBER =
  "These flags say more than a cap, so this stays open. The number field holds " +
  '{}, {"bulk": false}, or {"bulk": {"upTo": 10}} — anything else it would show as an empty box.';

export function useFeatures(stored: Record<string, unknown>): FeaturesField {
  /**
   * Whatever the field last agreed the object was, apart from `bulk`.
   *
   * In practice it is empty: it only moves on a successful collapse, and a collapse
   * only succeeds while `isExpressible` holds, which is a promise that there is
   * nothing else in there. It exists so that the writer is a writer rather than a
   * replacement — see `withBulk`.
   */
  const [base, setBase] = useState(stored);
  const [expanded, setExpanded] = useState(() => !isExpressible(stored));
  const [cap, setCap] = useState(() => capIn(stored));
  const [json, setJson] = useState(() => JSON.stringify(stored, null, 2));
  const [refusal, setRefusal] = useState<string | null>(null);

  const readCap = (): Reading => {
    const typed = cap.trim();
    if (!typed) return { features: withBulk(base, null) };
    const upTo = Number(typed);
    if (!Number.isInteger(upTo) || upTo < 1) return { problem: CAP_PROBLEM };
    return { features: withBulk(base, upTo) };
  };

  const readJson = (): Reading => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json.trim() || "{}");
    } catch {
      return { problem: JSON_PROBLEM };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { problem: JSON_PROBLEM };
    }
    return { features: parsed as Record<string, unknown> };
  };

  const toggle = (): void => {
    const reading = expanded ? readJson() : readCap();
    if ("problem" in reading) {
      setRefusal(reading.problem);
      return;
    }
    if (!expanded) {
      // The hatch opens showing what the number says, which is how the value is
      // handed over rather than re-derived: `{}` seeds as `{"bulk": false}` because
      // that is what an empty box means, and what a save from it would have written.
      setJson(JSON.stringify(reading.features, null, 2));
    } else {
      if (!isExpressible(reading.features)) {
        setRefusal(NOT_A_NUMBER);
        return;
      }
      setBase(reading.features);
      setCap(capIn(reading.features));
    }
    setRefusal(null);
    setExpanded(!expanded);
  };

  return {
    expanded,
    cap,
    json,
    refusal,
    setCap: (typed) => {
      setCap(typed);
      setRefusal(null);
    },
    setJson: (typed) => {
      setJson(typed);
      setRefusal(null);
    },
    toggle,
    read: () => (expanded ? readJson() : readCap()),
  };
}

/** The cap as a field holds it: a number, or nothing at all for a tier without bulk. */
function capIn(features: Record<string, unknown>): string {
  const grant = bulkIn(features);
  return grant.granted && grant.upTo !== null ? String(grant.upTo) : "";
}

/**
 * The fieldset both forms draw. `id` names it apart from the other form's, since
 * the two are never on screen together but their labels have to point somewhere.
 */
export function FeaturesFieldset({ field, id }: { field: FeaturesField; id: string }): JSX.Element {
  return (
    <div className="admin-features">
      <Field
        className="admin-features-cap"
        label="Bulk repost, at a time"
        hint="How many of their ads a subscriber may repost in one act. Empty means this tier does not include it."
      >
        <Input
          id={`${id}-bulk`}
          type="number"
          min={1}
          step={1}
          value={field.cap}
          // While the hatch is open the JSON owns the value, and a field showing a
          // number that is not the one being saved is the mirror this is not.
          disabled={field.expanded}
          onChange={(event) => field.setCap(event.target.value)}
        />
      </Field>
      <Button
        className="admin-features-hatch"
        shape="rect"
        tone="ghost"
        aria-expanded={field.expanded}
        aria-controls={field.expanded ? `${id}-features` : undefined}
        onClick={field.toggle}
      >
        {field.expanded ? "▴ Advanced · done editing as JSON" : "▾ Advanced · edit as JSON"}
      </Button>
      {field.expanded ? (
        <Field
          label="Feature flags, as JSON"
          hint="Every shape the column can hold. What the number field cannot say has to stay here."
        >
          <Textarea
            id={`${id}-features`}
            value={field.json}
            onChange={(event) => field.setJson(event.target.value)}
          />
        </Field>
      ) : null}
      {field.refusal ? <Note tone="warn">{field.refusal}</Note> : null}
    </div>
  );
}
