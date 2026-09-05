import type { PacingWindow } from "./relist-pace";

/**
 * How long a selection will take, before somebody commits to it (T68, #147;
 * ADR-0025).
 *
 * **This is a sentence on a screen and nothing else.** It gates nothing, refuses
 * nothing and is not consulted while a run is going: the real rail is the API's,
 * refused in the ordinary way with `RATE_LIMITED`, and the real gap is drawn by
 * the pacer. So being wrong here costs a wrong number in front of a user and
 * never a relist — which is why it is safe for the rails it reads to arrive over
 * the wire from a deployment that may have moved them.
 *
 * **It exists because of one number.** A Power batch of twenty-five is about two
 * hours, and ADR-0025 accepted that with its eyes open — on the condition that
 * somebody is told before they start rather than after. Ten fits inside one burst
 * window exactly, so Pro's own cap never sleeps mid-run, and the difference
 * between those two experiences is the whole reason this function is here.
 */

/**
 * The rails this build assumes when the API has not said otherwise — ten
 * authorizations inside a sliding hour (`mprelist.safety.burst-limit` and
 * `.burst-window`).
 *
 * A copy of somebody else's numbers, which everything else in this extension
 * refuses to keep. It is admitted here for the reason above: the copy feeds a
 * sentence, so a stale one is a wrong estimate rather than a wrong decision, and
 * the served `rails` block replaces it on the first refresh anyway.
 */
export const ASSUMED_RAILS: BurstRails = { burstLimit: 10, burstWindowMs: 60 * 60_000 };

export interface BurstRails {
  burstLimit: number;
  burstWindowMs: number;
}

/**
 * Everything a duration estimate is made of, as one value.
 *
 * The pair travels together because it is answered together — both halves come
 * out of the same served document, and a surface that asked for them separately
 * could quote a served gap against built-in rails from a document that had moved
 * between the two calls.
 */
export interface BatchShape {
  gap: PacingWindow;
  rails: BurstRails;
}

/**
 * Roughly how long reposting `count` ads will take, in milliseconds.
 *
 * **The burst rail is modelled the way the API enforces it**, which is what makes
 * "about two hours" come out of arithmetic rather than out of somebody's memory:
 * the wait is measured from the cap-th most recent relist, so the eleventh ad of a
 * run may not start until the first has fallen out of the sliding window. Getting
 * that wrong in the other direction — averaging the rail, or ignoring it — is how
 * a screen ends up promising twenty minutes for a run that sleeps for an hour in
 * the middle of it.
 *
 * The gap between two ads is the window's midpoint, because the draw is uniform
 * and this is an estimate; nothing is gained by simulating the randomness of a
 * number that is about to be rounded to "about 3 minutes".
 *
 * @param count how many ads are selected. One ad is zero — the first starts
 * immediately, and a run of one is not a run
 */
export function estimateBatchMs(count: number, gap: PacingWindow, rails: BurstRails): number {
  if (count <= 1) return 0;
  const averageGap = (gap.minMs + gap.maxMs) / 2;
  const startedAt: number[] = [];
  let at = 0;
  for (let ad = 0; ad < count; ad += 1) {
    if (ad > 0) at += averageGap;
    if (ad >= rails.burstLimit) {
      // The cap-th most recent has to fall out of the window before this one may
      // be authorized. `Math.max` rather than an assignment: on a run whose gaps
      // are already wider than the window, the rail costs nothing at all.
      at = Math.max(at, startedAt[ad - rails.burstLimit]! + rails.burstWindowMs);
    }
    startedAt.push(at);
  }
  return at;
}

/**
 * Whether a selection this size will have to sleep out a burst wait, which is a
 * different sentence rather than a longer one: "about two hours" is a duration
 * somebody may misread as continuous work, and "it will pause partway" is what
 * makes an unattended run make sense.
 */
export function sleepsMidRun(count: number, rails: BurstRails): boolean {
  return count > rails.burstLimit;
}

/**
 * The duration as a person would say it — "about 3 minutes", "about 2 hours".
 *
 * Deliberately coarse, and rounded to whatever unit makes the number small. The
 * estimate is built on an average gap and a rail that may have moved, so a
 * sentence reading "about 1 hour 47 minutes" would be claiming a precision the
 * arithmetic does not have — and a user deciding whether to start an unattended
 * run is choosing between "now" and "later", not scheduling around it.
 */
export function describeDuration(ms: number): string {
  // Anything short of a minute is "under a minute" rather than rounded up to one:
  // half a minute rounds to "about 1 minute", which is the only place this
  // sentence could overstate a wait, and the shortest runs are the ones somebody
  // is most likely to sit and watch.
  if (ms < 60_000) return "under a minute";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / (60 * 60_000));
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}
