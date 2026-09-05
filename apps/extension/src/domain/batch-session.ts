/**
 * Whether the worker has already woken in this browser session (T68, #147;
 * ADR-0025).
 *
 * **The drop-on-restart rule needs a signal, and the event is not one.** A run is
 * dropped when the browser restarts, and `chrome.runtime.onStartup` is the
 * announcement of that — but a listener's callback runs *after* the module scope
 * that registered it, and module scope is where the worker asks a live run to get
 * its alarm back. On the first wake of a new session those two are in a race that
 * module scope always wins, and what it wins is one delete-first repost of an ad
 * nobody has thought about since yesterday: the exact outcome the rule exists to
 * prevent, fired before the listener that was going to prevent it ever ran.
 *
 * So the question is asked of the session rather than inferred from the order two
 * callbacks happen to run in. A port and not a flag in the worker, because a
 * worker is evicted every thirty idle seconds and a flag in one is a fresh `false`
 * on every wake — which would read as a restart each time and drop the run it woke
 * up to advance.
 *
 * The real one is `chrome-batch-session.ts`. It sits beside {@link BatchStore} for
 * the reason it differs from it: both are where a batch is written down, and the
 * whole of the distinction is that this one is emptied when the browser closes.
 */
export interface BatchSession {
  /**
   * True the first time it is asked in a browser session, and false every time
   * after.
   *
   * **Asking is what claims it**, which is why the verb is `claim`: two callers
   * cannot both be told they are first, and a caller that asks without acting on
   * the answer has spent the one chance anybody had to notice the restart.
   */
  claimFirstWake(): Promise<boolean>;
}
