/**
 * How long to wait before the next relist, and the thing that waits (T46, #54).
 *
 * **The backend cannot do this.** Its rails (#25) can *refuse* a relist that came
 * too soon; they cannot make one arrive at a moment a person plausibly clicked.
 * ADR-0008 wants human-shaped pacing precisely because driving Marktplaats's
 * internal API skips every interaction signal a real click leaves behind
 * (ADR-0004), so a run of relists arriving 300ms apart is machine-shaped in the
 * one dimension we still control. This is that dimension, and it is client-side
 * or it is nowhere.
 *
 * **It is not the same thing as serialisation.** The popup already runs one
 * relist at a time (#79) — that stops a distracted user deleting three ads at
 * once, and it is what `popup.ts:186` had. Serialising a queue makes the calls
 * consecutive; it does not put a gap between them.
 *
 * **What it protects, and what it does not.** The gap is drawn to sit above the
 * backend's `minimum-interval` rail, so consecutive relists stop *discovering*
 * that rail — which is the point of criterion 3 on the ticket: a user should meet
 * a cooldown because they were unusual, not because the extension is faster than
 * a person can click. The burst cap (ten an hour) is a different shape and stays
 * the backend's to enforce; no inter-action gap short enough to be usable can keep
 * somebody under it, and the cooldown row (#41) is what says so when it bites.
 *
 * **Both numbers are settings and neither is a constant.** {@link HUMAN_PACE} is
 * what a build ships with; `mprelist.client-config.pacing` on the API replaces it
 * on any deployment without a store release, and the rail underneath is
 * `mprelist.safety.minimum-interval`. The one rule that holds between them is that
 * the floor here stays above that rail — the two are held to each other by this
 * file's own suite and by `apps/api`'s, since neither side can read the other's.
 */

/** The randomised gap, as a range. Both ends in milliseconds. */
export interface PacingWindow {
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * The built-in window, and what a build paces with until a deployment says
 * otherwise.
 *
 * **10 to 30 seconds**, uniform. It was 45 to 90 until 2026-08, which was drawn
 * against a 30s rail on the API and turned every second repost into most of a
 * minute of watching a countdown. The rail moved with it — `minimum-interval` is
 * 5s now — and the floor here is what has to stay above that one: a gap that could
 * come in under the rail hands the user the very cooldown this exists to keep them
 * away from. 10s over a 5s rail is double the room a request and two disagreeing
 * clocks need, and it is the number the ticket asked for.
 *
 * **The ceiling is what keeps this from being a metronome**, which the floor alone
 * cannot do: a fixed gap is as machine-shaped as no gap at all, only slower
 * (ADR-0008). Three times the floor leaves a spread wide enough for that and still
 * averages 20s, which is a wait a person will sit through.
 *
 * **Changing it needs no store release.** An operator's `pacing` block reaches
 * `RelistPacer` as a source rather than a value (T27, #36), and this window is
 * what that source answers with when nothing has been served — which is every
 * deployment on every day nobody has tuned one. On the API it is two settings,
 * `MPRELIST_PACING_MIN_MS` and `MPRELIST_PACING_MAX_MS`, and a restart.
 */
export const HUMAN_PACE: PacingWindow = { minMs: 10_000, maxMs: 30_000 };

/**
 * Where the window comes from **at the moment it is needed**, which since T27
 * (#36) is not the moment the pacer was built.
 *
 * A worker constructs its pacer once, at module scope, and then lives for about
 * thirty seconds; a served document arrives on its own schedule and is read out
 * of `chrome.storage.local` by whoever needs it. A window fixed at construction
 * would therefore be whatever was stored when this particular wake happened to
 * start, which is not a rule anybody wrote down.
 *
 * A plain {@link PacingWindow} is still accepted and is what every test passes:
 * the pacer's own behaviour is the same either way, and a suite that had to wrap
 * every window in a function to say the same thing would be paying for a seam it
 * is not testing.
 */
export type PacingWindowSource = PacingWindow | (() => PacingWindow | Promise<PacingWindow>);

/**
 * A gap drawn from the window. **Randomised, not fixed** — a constant 60s gap is
 * as machine-shaped as no gap at all, just slower, and it is the pattern rather
 * than the speed that a rhythm detector would have to miss.
 *
 * Uniform over the range. Nothing here is trying to model a person's click
 * intervals, which are not uniform; what it is trying to do is not be a metronome.
 *
 * @param random a source in `[0, 1)` — `Math.random` in the worker, something a
 * test can say the value of
 */
export function drawGap(window: PacingWindow, random: () => number): number {
  const { minMs, maxMs } = validated(window);
  return Math.round(minMs + (maxMs - minMs) * clampToUnit(random()));
}

/**
 * What is left of a gap, in milliseconds, and never negative.
 *
 * **Clamped to the window's own ceiling**, which is not defensive tidiness: the
 * deadline is read back out of `chrome.storage.local`, which under ADR-0007 the
 * user can write and which outlives the code that wrote it. A value from a machine
 * whose clock jumped forward a month would otherwise lock relisting until the
 * calendar caught up. Nothing here is a security boundary — the user is delaying
 * themselves — so the safe reading of a nonsensical deadline is the longest
 * *sensible* wait, not the longest one it says.
 */
export function gapLeft(nextAllowedAt: number | null, now: number, window: PacingWindow): number {
  if (nextAllowedAt === null || !Number.isFinite(nextAllowedAt)) return 0;
  return Math.min(Math.max(0, nextAllowedAt - now), validated(window).maxMs);
}

/**
 * When the next relist may start, kept somewhere that outlives the worker.
 *
 * It has to be persisted: an MV3 worker is torn down about 30 seconds after it
 * goes idle, so a deadline held in a variable would be forgotten between two
 * relists a user makes a minute apart — which is exactly the pair this exists to
 * space out.
 */
export interface PaceMemory {
  read(): Promise<number | null>;
  write(nextAllowedAt: number): Promise<void>;
}

/** What the orchestrator holds. Two verbs: wait your turn, and take one. */
export interface RelistPacing {
  /** Resolves when a relist may start — immediately, if enough time has passed. */
  pause(): Promise<void>;
  /** Called when a relist actually begins, which is what the next gap is measured from. */
  startedRelisting(): Promise<void>;
  /** How long {@link pause} would wait right now, for a surface that wants to show it. */
  msBeforeNextRelist(): Promise<number>;
}

/**
 * The pacer, and the only thing in the extension that sleeps on purpose.
 *
 * **The gap is measured from when a relist starts, not from when it finishes.**
 * That is what makes it comparable with the backend's rail, which counts from the
 * reservation `authorize` takes — measuring from the end would make the real
 * interval the gap *plus* however long a relist happened to take, which is a
 * number neither side knows.
 *
 * The gap is also drawn *then*, at the start, rather than when the next relist is
 * asked for. So the deadline is a fact by the time anybody reads it, and the
 * countdown a popup renders and the wait the worker performs are the same number
 * rather than two draws that would disagree.
 */
export class RelistPacer implements RelistPacing {
  constructor(
    private readonly memory: PaceMemory,
    private readonly window: PacingWindowSource = HUMAN_PACE,
    private readonly clock: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
    private readonly sleep: (ms: number) => Promise<void> = timeout,
  ) {}

  async msBeforeNextRelist(): Promise<number> {
    return gapLeft(await this.memory.read(), this.clock(), await this.currentWindow());
  }

  async pause(): Promise<void> {
    const left = await this.msBeforeNextRelist();
    if (left > 0) await this.sleep(left);
  }

  async startedRelisting(): Promise<void> {
    await this.memory.write(this.clock() + drawGap(await this.currentWindow(), this.random));
  }

  /**
   * The window this call is paced by. Asked once per call and never held: a pacer
   * that cached it would go on using the window it saw first for as long as the
   * worker happened to live, which is the thing a served document exists to be
   * able to change.
   */
  private async currentWindow(): Promise<PacingWindow> {
    return typeof this.window === "function" ? this.window() : this.window;
  }
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampToUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function validated(window: PacingWindow): PacingWindow {
  const { minMs, maxMs } = window;
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 0 || maxMs < minMs) {
    throw new Error(`A pacing window has to run forwards from zero, not ${minMs}–${maxMs}`);
  }
  return window;
}
