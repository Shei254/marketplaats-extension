import { useCallback, useEffect, useState } from "react";

/**
 * The search box over the ad list (T31, #40) — what it means, and when it fires.
 *
 * **The filtering is Marktplaats's, not ours.** Whether `listMyAds` pages is an
 * open spike (`docs/enforcement-contract.md`), so a box that filtered the rows
 * that happened to have arrived would quietly fail to find an ad the seller can
 * see on their own dashboard — and would get worse as an account got bigger,
 * which is exactly the account that needs it. Search is a `query` parameter on
 * the same path (`docs/internal-api-findings.md`), so this costs one request and
 * answers with the same rows.
 *
 * Which means every keystroke is a request to marktplaats.nl in the user's own
 * session, and that is what the two rules below are for.
 */

/**
 * A request per keystroke is a request per keystroke. 400ms is the ticket's
 * number and it is the usual one: long enough that "fiets" is one search rather
 * than five, short enough that a person who has stopped typing does not notice
 * having waited.
 *
 * The gap is measured from the **last** keystroke rather than the first, so a
 * slow typist gets one search and not one per pause.
 */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Under two characters the box is not a filter yet: one letter matches most of
 * an account, and searching for it is a request whose answer nobody wanted.
 *
 * Trimmed first, so a space is not a character — a query of `" "` would otherwise
 * be a whole-account search dressed as a filter.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * What the list is showing: everything, or the matches for a query.
 *
 * A value rather than a boolean beside a string, because the two are read
 * together everywhere — the empty screen says something different in each case,
 * and a reload after a relist has to repeat whichever of them is on the screen.
 */
export type Showing = { kind: "all" } | { kind: "search"; query: string };

export const ALL: Showing = { kind: "all" };

/**
 * What a box holding `raw` is asking for. Anything under the minimum is the whole
 * list — including the empty box, which is how clearing one gets the ads back.
 */
export function showingFor(raw: string): Showing {
  const query = raw.trim();
  return query.length < MIN_QUERY_LENGTH ? ALL : { kind: "search", query };
}

export function sameShowing(one: Showing, other: Showing): boolean {
  if (one.kind === "all" || other.kind === "all") return one.kind === other.kind;
  return one.query === other.query;
}

/** What to say when a search matched nothing — never "you have no active ads". */
export function noMatches(query: string): string {
  return `No ads match “${query}”.`;
}

/**
 * The box, and what it has settled on.
 *
 * `typed` is what the field shows and moves on every keystroke; `showing` is what
 * the list should be asked for and moves on the debounce. Keeping them apart is
 * what makes the field feel immediate while the network does not.
 *
 * **Going back to the whole list is not debounced.** Clearing the box, or
 * deleting back under the minimum, has no request to save and nothing to wait
 * for: the ads are already there to be shown. Waiting 400ms to un-filter would be
 * a delay bought with nothing.
 */
export function useSearchBox(delayMs: number = SEARCH_DEBOUNCE_MS): {
  typed: string;
  showing: Showing;
  type: (raw: string) => void;
  clear: () => void;
} {
  const [typed, setTyped] = useState("");
  const [showing, setShowing] = useState<Showing>(ALL);

  useEffect(() => {
    const wanted = showingFor(typed);
    // Already showing it — which is every keystroke that changes nothing the
    // search cares about, a trailing space being the ordinary one.
    if (sameShowing(wanted, showing)) return;
    if (wanted.kind === "all") {
      setShowing(ALL);
      return;
    }
    const timer = setTimeout(() => setShowing(wanted), delayMs);
    return () => clearTimeout(timer);
  }, [typed, showing, delayMs]);

  const clear = useCallback(() => {
    setTyped("");
    setShowing(ALL);
  }, []);

  return { typed, showing, type: setTyped, clear };
}
