import { UiStyles } from "@mprelist/ui";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import type { WireRelistOutcome } from "../background/messages";
import type { HandoffAnswer } from "../api/subscribing";
import { ASSUMED_RAILS, type BatchShape } from "../domain/batch-estimate";
import type { BatchRun } from "../domain/batch-run";
import { BULK_PACE } from "../domain/relist-pace";
import { BatchBar } from "./BatchBar";
import { bulkFor, offerSelection, offerUnstarted, pickUpTo, rowStatesFor, type BulkSelection } from "./batching";
import { ADS_LOADING, describeAdsFailure, type AdsView } from "./ads";
import { adListCss, planCardCss, popupCss } from "./popup-styles";
import { AdList } from "./AdList";
import { SearchBox } from "./SearchBox";
import { ALL, noMatches, sameShowing, useSearchBox, type Showing } from "./searching";
import { PlanCards } from "./PlanCards";
import {
  handoffFailure,
  MANAGING,
  NOT_OPENING,
  PLANS_LOADING,
  waysToPay,
  type Handoff,
  type PlansView,
} from "./plans";
import { LOADING, screenFor, type Screen, type WorkerPort } from "./screen";
import {
  LoadingScreen,
  OutdatedScreen,
  PlansScreen,
  SignedInScreen,
  SignedOutScreen,
  UnavailableScreen,
} from "./screens";

/**
 * The popup, which asks the worker one question and renders the answer.
 *
 * **One question, not two.** It would be natural to ask "am I signed in?" and then
 * "what is my plan?", and that pair can disagree — a session held here while the
 * API refuses the token is a popup that says signed in and shows nothing. The
 * display state already answers both: no session and a refused token both come
 * back as `signed-out`, from the one call that had to be made anyway.
 *
 * Nothing here talks to Chrome. The worker arrives as a port (`screen.ts`), so
 * every route through this component is reachable in a test without a browser —
 * and `popup.tsx`, the entry that does touch `chrome.runtime`, stays four lines
 * long.
 */
export function Popup({ worker }: { worker: WorkerPort }): JSX.Element {
  const [screen, setScreen] = useState<Screen>(LOADING);
  const [ads, setAds] = useState<AdsView>(ADS_LOADING);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<PlansView>(PLANS_LOADING);
  const [handoff, setHandoff] = useState<Handoff>(NOT_OPENING);
  /** The search box, and what it has settled on asking for (T31, #40). */
  const { typed, showing, type, clear } = useSearchBox();
  /** The batch the worker is running, or the one it has finished (T68, #147). */
  const [run, setRun] = useState<BatchRun | null>(null);
  /** Which rows are ticked, before there is a run to work through them. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The gap and the rails an estimate is made of, after whatever the API served.
   *
   * Held rather than asked per keystroke: it is a setting, so it changes when a
   * deployment does and never while somebody is ticking boxes. What this build
   * ships with is the starting value and the answer for every client that has
   * never fetched a document, which is most of them on most days.
   */
  const [batchShape, setBatchShape] = useState<BatchShape>(() => ({ gap: BULK_PACE, rails: ASSUMED_RAILS }));
  /** What the list is showing right now, so a reload can repeat it. */
  const displayed = useRef<Showing>(ALL);
  /**
   * Which ad request is the current one.
   *
   * Every keystroke past the debounce starts a request, and they do not come back
   * in the order they left: "fi" against a big account can answer after "fiets"
   * did, and a list that took whichever landed last would show matches for a query
   * the box no longer holds. So each call takes a number and only the newest one
   * is allowed to write the screen — the others are answers to questions nobody
   * is asking any more.
   */
  const latest = useRef(0);

  /**
   * The list, however it is being asked for. One function for both, because they
   * are one thing to the screen: a `ready` view of rows, and the same two failures.
   */
  const showAds = useCallback(
    async (want: Showing) => {
      displayed.current = want;
      const mine = ++latest.current;
      setAds(ADS_LOADING);
      try {
        const found = want.kind === "all" ? await worker.ads() : await worker.searchAds(want.query);
        if (mine === latest.current) setAds({ status: "ready", ads: found });
      } catch (error) {
        // The list failing does not take the plan down with it: the two come from
        // different places — ours and Marktplaats's — and a user whose quota is
        // fine should be told that, beside the reason their ads are missing.
        if (mine === latest.current) setAds({ status: "failed", message: describeAdsFailure(error) });
      }
    },
    [worker],
  );

  /**
   * The plan first, then the ads — and the ads **only** when there is a session.
   *
   * Not an ordering preference: the ad list is a request to marktplaats.nl in the
   * user's own session, and `docs/enforcement-contract.md` has a signed-out popup
   * make none. Asking in parallel would be faster and would send that request on
   * behalf of somebody who is not signed in.
   *
   * Refreshing repeats **whatever is on the screen**, search included: a box with
   * a query in it and a button that quietly emptied it would be two controls
   * disagreeing about what the user asked for.
   */
  const load = useCallback(async () => {
    setBusy(true);
    const answer = await worker.displayState();
    setScreen(screenFor(answer));

    if (answer.status !== "ready") {
      setAds(ADS_LOADING);
      setBusy(false);
      return;
    }

    await showAds(displayed.current);
    setBusy(false);
  }, [worker, showAds]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A settled box asks for its matches — but only once there is a session, for
   * the reason `load` gives: this is a request to marktplaats.nl, and a signed-out
   * popup makes none.
   */
  useEffect(() => {
    if (screen.screen !== "signed-in") return;
    if (sameShowing(showing, displayed.current)) return;
    void showAds(showing);
  }, [showing, screen.screen, showAds]);

  /** The ads alone — what a finished relist invalidates, since the ad has a new id. */
  const reloadAds = useCallback(() => showAds(displayed.current), [showAds]);

  /**
   * The run, and the quota it has spent along the way.
   *
   * **The number comes off the run rather than from a second `/api/me`**, exactly
   * as one relist's does (T32, #41): the worker keeps what the last `/complete`
   * answered with, because the popup is shut for most of a batch and would
   * otherwise be showing the count it opened with while four relists were spent.
   */
  const showRun = useCallback((next: BatchRun | null) => {
    setRun(next);
    const quota = next?.quota;
    if (!quota) return;
    setScreen((current) =>
      current.screen === "signed-in" ? { ...current, plan: { ...current.plan, ...quota } } : current,
    );
  }, []);

  const running = run !== null && run.stop === null;

  /**
   * What the worker is holding, asked once when this screen appears — because a
   * popup may well be opened *onto* a run that started before it, which is the
   * ordinary case rather than the edge one.
   */
  useEffect(() => {
    if (screen.screen !== "signed-in") return;
    void worker.batchState().then(showRun);
    void worker.batchShape().then(setBatchShape);
  }, [screen.screen, worker, showRun]);

  /**
   * And asked again every second while one is going.
   *
   * **Polled rather than pushed**, which is a property of where the run lives: the
   * worker cannot tell a popup that has been closed anything, so this surface has
   * to be able to ask what it missed — and once it can, a push adds nothing but a
   * second path to keep working. It stops the moment the run does, so an ordinary
   * popup with no batch in it sends nothing at all.
   */
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      void worker.batchState().then(showRun);
    }, 1000);
    return () => clearInterval(tick);
  }, [running, worker, showRun]);

  /**
   * **The list reloads once, at the end** — not per success.
   *
   * A reposted ad comes back with a new id, so reloading mid-run would reshuffle
   * the rows under a queue that is holding the old ones. Waiting until the run has
   * stopped is what keeps "the ad you selected" and "the ad being reposted" the
   * same thing for the whole of it.
   */
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    setSelected(new Set());
    void load();
  }, [running, load]);

  /**
   * What this plan lets somebody select, or nothing when it does not include bulk
   * at all — which is the free tier, and is what draws the boxes disabled beside a
   * line pointing at Plans (ADR-0007's conversion surface, one screen further in).
   *
   * Read here rather than where it is drawn because the cap is a number *this*
   * component acts on: Select all applies it, and the list below holds the order
   * but not the entitlement.
   */
  const bulk = screen.screen === "signed-in" ? bulkFor(screen.plan) : null;
  const cap = bulk?.cap ?? 0;

  const toggleSelected = useCallback((listingId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(listingId)) next.add(listingId);
      return next;
    });
  }, []);

  /**
   * The ticked ads, in the order they will actually be attempted (T68, #147).
   *
   * **A selection survives a search, and this is where that costs something.** The
   * alternative — pruning the set to whatever the list is showing — was tried and
   * is worse: picking ten ads out of forty is a job for the search box, and a query
   * that silently unticked the three already chosen would make the only workable
   * way to do it impossible. So a tick persists, and the two things that would
   * otherwise lie about it are fixed instead of the selection: the count includes
   * what is off-screen, and the header says how many that is.
   *
   * The order is the screen's for the ads on it, then the rest in the order they
   * were ticked (`Set` keeps insertion order). Somebody who ticks the bottom row
   * first has still read the list top to bottom, and a queue that ran backwards
   * would look like a bug from the first ad.
   */
  const listed = ads.status === "ready" ? ads.ads : [];
  const chosen = [
    ...listed.filter((ad) => selected.has(ad.id)).map((ad) => ad.id),
    ...[...selected].filter((listingId) => !listed.some((ad) => ad.id === listingId)),
  ];
  /** How many of them this list is not showing — the number the header names. */
  const hidden = chosen.length - listed.filter((ad) => selected.has(ad.id)).length;

  /**
   * Tick as much of the list as the plan still allows, top down (T68, #147).
   *
   * **Additive, not a replacement.** The cap is applied here because this is the
   * only place that holds the plan — the list knows the order the ads are in and
   * nothing about the entitlement — and it is applied to what is *left* of it, so
   * pressing Select all after ticking two rows by hand adds eight rather than
   * throwing those two away. Top down rather than any cleverer rule: the ten a Pro
   * user gets are the ten they were already looking at.
   */
  const selectAll = useCallback(
    (listingIds: string[]) =>
      setSelected((current) => {
        const room = cap - current.size;
        const adding = pickUpTo(
          listingIds.filter((listingId) => !current.has(listingId)),
          room,
        );
        return adding.length === 0 ? current : new Set([...current, ...adding]);
      }),
    [cap],
  );

  const clearSelected = useCallback(() => setSelected(new Set()), []);

  /**
   * Start a run over the ads named, in the order the list is showing them.
   *
   * The order is the screen's rather than the order they were ticked: somebody who
   * ticks the bottom row first has still read the list top to bottom, and a queue
   * that ran backwards would look like a bug from the first ad.
   */
  const startBatch = useCallback(
    async (listingIds: string[]) => {
      if (listingIds.length === 0) return;
      showRun(await worker.startBatch(listingIds));
      setSelected(new Set());
    },
    [worker, showRun],
  );

  /**
   * Start the ticked rows — **as many of them as the plan can still pay for.**
   *
   * The boxes cap a selection as it is being made, and that is not the same as
   * capping it as it is started: the quota falls live from `/complete` (T32, #41),
   * so a single repost pressed on a row while five are ticked leaves a selection
   * larger than the cap and every box still ticked. The offer is what the button
   * drew and what this starts, which is the only arrangement where the number on
   * the button is a promise.
   */
  const startSelected = useCallback(() => {
    if (bulk === null) return;
    const offer = offerSelection(chosen, bulk, batchShape);
    if (offer?.kind !== "repost") return;
    void startBatch(offer.listingIds);
  }, [chosen, bulk, batchShape, startBatch]);

  const stopBatch = useCallback(() => {
    void worker.stopBatch().then(showRun);
  }, [worker, showRun]);

  const dismissBatch = useCallback(() => {
    void worker.dismissBatch().then(() => showRun(null));
  }, [worker, showRun]);

  /**
   * Start again over the ads a stopped run never reached — a person, not a queue.
   *
   * **Capped like every other start**, and here rather than only in the bar that
   * drew the button: this path never touches the checkboxes, so it is the one
   * route by which a selection larger than `min(quotaRemaining, upTo)` could reach
   * the worker. The offer decides how many, and this starts exactly those.
   */
  const repostUnstarted = useCallback(() => {
    const offer = offerUnstarted(run, bulk);
    if (offer?.kind !== "repost") return;
    void startBatch(offer.listingIds);
  }, [run, bulk, startBatch]);

  /**
   * What a finished attempt does to the screen.
   *
   * **The quota comes from `/complete`'s own answer, not from a second
   * `/api/me`** (T32, #41): the call that spent the unit already told us what is
   * left, and asking again would be a second read of the same subtraction — one
   * that can disagree with the first if a relist lands in between. `/api/me` is
   * still what the popup opens with; this is what keeps it true afterwards.
   */
  const onOutcome = useCallback(
    (outcome: WireRelistOutcome) => {
      if ("quota" in outcome && outcome.quota) {
        const quota = outcome.quota;
        setScreen((current) =>
          current.screen === "signed-in"
            ? { ...current, plan: { ...current.plan, ...quota } }
            : current,
        );
      }
      if (outcome.status === "relisted") void reloadAds();
    },
    [reloadAds],
  );

  /**
   * The plan cards, and the screen they are on (T52, #83).
   *
   * The screen is switched **before** the answer arrives, so the cards load in
   * front of the user rather than the button hanging until they do — the list is a
   * network call and this popup has a loading state for exactly that.
   *
   * `signed-out` and `outdated` are not plans-screen states: they are the same
   * events `/api/me` reports and get the same screens, through the same function.
   * A token that expired between opening the popup and clicking here is the
   * ordinary way that happens.
   */
  const seePlans = useCallback(async () => {
    setHandoff(NOT_OPENING);
    setPlans(PLANS_LOADING);
    setScreen((current) =>
      current.screen === "signed-in" ? { screen: "plans", plan: current.plan } : current,
    );

    const answer = await worker.plans();
    if (answer.status === "signed-out" || answer.status === "outdated") {
      setScreen(screenFor(answer));
      return;
    }
    setPlans(
      answer.status === "ready"
        ? { status: "ready", plans: answer.plans, paymentMethods: answer.paymentMethods }
        : { status: "failed" },
    );
  }, [worker]);

  const backToAds = useCallback(() => {
    setHandoff(NOT_OPENING);
    setScreen((current) =>
      current.screen === "plans" ? { screen: "signed-in", plan: current.plan } : current,
    );
  }, []);

  /**
   * Buying a plan, and managing one already bought — one function, because from
   * here they are the same act: ask the worker for a Stripe page, and be destroyed
   * by the tab it opens.
   *
   * **The busy state is set before the call and never cleared on success**, which
   * is deliberate rather than an omission. The popup is gone by then (ADR-0017),
   * so there is nothing to clear and no state a user will ever see; an answer that
   * *does* come back is news that nothing opened, and that is the only thing this
   * has left to render.
   */
  const openStripe = useCallback(
    async (what: string, ask: () => Promise<HandoffAnswer>, asked: "checkout" | "portal") => {
      setHandoff({ kind: "opening", what });
      const answer = await ask();
      if (answer.status === "signed-out" || answer.status === "outdated") {
        setHandoff(NOT_OPENING);
        setScreen(screenFor(answer));
        return;
      }
      const failure = handoffFailure(answer, asked);
      setHandoff(failure ? { kind: "failed", message: failure } : NOT_OPENING);
    },
    [],
  );

  /**
   * Buying one rhythm of one plan (T62, #128).
   *
   * The busy key is the pair rather than the tier code, because a plan sold monthly
   * and annually has two buttons and only the one that was pressed should say
   * "Opening…".
   */
  const upgrade = useCallback(
    (tierCode: string, interval: string) =>
      void openStripe(`${tierCode}:${interval}`, () => worker.checkout(tierCode, interval), "checkout"),
    [openStripe, worker],
  );

  const manageBilling = useCallback(
    () => void openStripe(MANAGING, () => worker.portal(), "portal"),
    [openStripe, worker],
  );

  const signIn = useCallback(async () => {
    setBusy(true);
    try {
      await worker.signIn();
    } catch (error) {
      // A window the user closed is not a failure to report — they are already
      // looking at the screen that says what to do about it. Anything else is,
      // and it is shown where they clicked rather than in a console.
      setBusy(false);
      setScreen({ screen: "signed-out", failure: reportable(error) });
      return;
    }
    await load();
  }, [worker, load]);

  const signOut = useCallback(async () => {
    setBusy(true);
    await worker.signOut().catch(() => undefined);
    setBusy(false);
    // Straight to the signed-out screen rather than re-asking: sign-out is the one
    // transition this popup already knows the answer to, and asking would put a
    // failed call between the user and the screen they just asked for.
    setScreen({ screen: "signed-out" });
    // And the box goes with the session. Whoever signs in next — the same person
    // on a second account, or somebody else at this machine — should not find the
    // list already filtered by a word they never typed.
    clear();
    displayed.current = ALL;
  }, [worker, clear]);

  return (
    <>
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: `${popupCss}\n${adListCss}\n${planCardCss}` }} />
      <div className="mp-root">
        {body(screen, {
          load,
          signIn,
          signOut,
          busy,
          ads,
          worker,
          onOutcome,
          plans,
          handoff,
          seePlans,
          backToAds,
          upgrade,
          manageBilling,
          typed,
          showing,
          onType: type,
          onClearSearch: clear,
          run,
          selected,
          onToggleSelected: toggleSelected,
          onSelectAll: selectAll,
          onClearSelection: clearSelected,
          onStartBatch: startSelected,
          onStopBatch: stopBatch,
          onDismissBatch: dismissBatch,
          onRepostUnstarted: repostUnstarted,
          batchShape,
          bulk,
          hidden,
          chosen,
        })}
      </div>
    </>
  );
}

interface Handlers {
  load: () => void;
  signIn: () => void;
  signOut: () => void;
  busy: boolean;
  ads: AdsView;
  worker: WorkerPort;
  onOutcome: (outcome: WireRelistOutcome) => void;
  plans: PlansView;
  handoff: Handoff;
  seePlans: () => void;
  backToAds: () => void;
  upgrade: (tierCode: string, interval: string) => void;
  manageBilling: () => void;
  /** What the search box shows, what it settled on, and the two ways to change it. */
  typed: string;
  showing: Showing;
  onType: (raw: string) => void;
  onClearSearch: () => void;
  /** The batch (T68, #147): what is running, what is ticked, and the four verbs. */
  run: BatchRun | null;
  selected: ReadonlySet<string>;
  onToggleSelected: (listingId: string) => void;
  /** Tick as much of the list as the cap allows, top down — the header's verb. */
  onSelectAll: (listingIds: string[]) => void;
  onClearSelection: () => void;
  onStartBatch: () => void;
  onStopBatch: () => void;
  onDismissBatch: () => void;
  onRepostUnstarted: () => void;
  batchShape: BatchShape;
  /** What the plan lets somebody select, or nothing when it does not include bulk. */
  bulk: BulkSelection | null;
  /** How many ticked ads the list is not showing, because a search has narrowed it. */
  hidden: number;
  /** What is ticked altogether, in run order — what the bar offers and what a run gets. */
  chosen: readonly string[];
}

function body(screen: Screen, handlers: Handlers): JSX.Element {
  const { load, signIn, signOut, busy, ads, worker, onOutcome } = handlers;
  const { plans, handoff, seePlans, backToAds, upgrade, manageBilling } = handlers;
  const { typed, showing, onType, onClearSearch } = handlers;
  const { run, selected, onToggleSelected, onStartBatch, onStopBatch, onDismissBatch } = handlers;
  const { onSelectAll, onClearSelection, onRepostUnstarted, batchShape, bulk, hidden, chosen } = handlers;
  switch (screen.screen) {
    case "loading":
      return <LoadingScreen />;
    case "signed-out":
      return <SignedOutScreen onSignIn={signIn} busy={busy} failure={screen.failure} />;
    case "unavailable":
      return <UnavailableScreen onRetry={load} busy={busy} />;
    case "outdated":
      // No retry button, deliberately: nothing this popup can do makes an old build
      // acceptable, and a button that cannot work is worse than none (T43, #52).
      return <OutdatedScreen />;
    case "signed-in": {
      const running = run !== null && run.stop === null;
      return (
        <SignedInScreen
          plan={screen.plan}
          onRefresh={load}
          onSignOut={signOut}
          onSeePlans={seePlans}
          onManageBilling={manageBilling}
          handoff={handoff}
          busy={busy}
        >
          <SearchBox value={typed} onType={onType} onClear={onClearSearch} />
          <AdList
            view={ads}
            worker={worker}
            onOutcome={onOutcome}
            empty={showing.kind === "search" ? noMatches(showing.query) : undefined}
            selection={{
              selected,
              onToggle: onToggleSelected,
              onSelectAll,
              onClear: onClearSelection,
              frozen: running,
              bulk,
              hidden,
            }}
            runStates={rowStatesFor(run)}
          />
          {bulk === null ? (
            <p className="popup-foot popup-batch-locked">
              Reposting several at once is part of the paid plans.{" "}
              <button type="button" className="popup-link" onClick={seePlans}>
                See plans
              </button>
            </p>
          ) : (
            <BatchBar
              run={run}
              chosen={chosen}
              bulk={bulk}
              shape={batchShape}
              onStart={onStartBatch}
              onStop={onStopBatch}
              onDismiss={onDismissBatch}
              onRepostUnstarted={onRepostUnstarted}
            />
          )}
        </SignedInScreen>
      );
    }
    case "plans":
      return (
        <PlansScreen
          onBack={backToAds}
          onManageBilling={manageBilling}
          handoff={handoff}
          // Only once the cards are here. While they are loading there is nothing
          // for the sentence to be about, and a screen that announced how to pay
          // above three skeletons would be describing a page that is not there yet.
          payWith={plans.status === "ready" ? waysToPay(plans.paymentMethods) : null}
        >
          <PlanCards
            view={plans}
            current={screen.plan}
            handoff={handoff}
            onUpgrade={upgrade}
            onRetry={seePlans}
          />
        </PlansScreen>
      );
  }
}

/**
 * What to show the user about a failed sign-in, or nothing when they cancelled it.
 *
 * The distinction survived the worker boundary as a typed wire code (#32), and
 * this is what it was kept for: a closed window leaves the screen exactly as it
 * was, and a real failure says so in Keycloak's own words, which name what is
 * misconfigured better than any sentence invented here.
 */
function reportable(error: unknown): string | undefined {
  if (error instanceof Error && error.name === "SignInCancelledError") return undefined;
  return error instanceof Error ? error.message : "Sign-in did not work. Try again.";
}
