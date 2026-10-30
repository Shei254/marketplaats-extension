import { UiStyles } from "@mprelist/ui";
import { waysToPay } from "@mprelist/contracts";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import type { WireRelistOutcome } from "../background/messages";
import type { HandoffAnswer } from "../api/subscribing";
import { NoMarktplaatsTabError, StaleMarktplaatsTabError } from "../adapters/relay-marktplaats-client";
import type { PendingRepost } from "../domain/types";
import { ADS_LOADING, describeAdsFailure, type AdsView } from "./ads";
import { adListCss, planCardCss, popupCss } from "./popup-styles";
import { AdList } from "./AdList";
import { SearchBox } from "./SearchBox";
import { ALL, noMatches, sameShowing, useSearchBox, type Showing } from "./searching";
import { PlanCards } from "./PlanCards";
import {
  grantsNothing,
  handoffFailure,
  MANAGING,
  NOT_OPENING,
  PLANS_LOADING,
  type Handoff,
  type PlansView,
} from "./plans";
import { LOADING, screenFor, type Screen, type WorkerPort } from "./screen";
import {
  LoadingScreen,
  NoTierScreen,
  OutdatedScreen,
  PlansScreen,
  SignedInScreen,
  SignedOutScreen,
  UnavailableScreen,
} from "./screens";
import {PendingNotice} from "./PendingNotice";

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
  /** Reposts that did not finish, which the ad list draws above the ads (ADR-0039). */
  const [pending, setPending] = useState<PendingRepost[]>([]);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<PlansView>(PLANS_LOADING);
  const [handoff, setHandoff] = useState<Handoff>(NOT_OPENING);
  /** The search box, and what it has settled on asking for (T31, #40). */
  const { typed, showing, type, clear } = useSearchBox();
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
      // Beside the list rather than after it: these come from the worker's own
      // storage, and are shown even when the list cannot be had at all.
      const holding = worker.pendingReposts();
      try {
        if (want.kind === "all") {
          const page = await worker.ads();
          if (mine === latest.current) {
            setAds({ status: "ready", ads: page.ads, total: page.totalNumberOfResults });
          }
        } else {
          // Search isn't paged: total equals what arrived, so `AdList` never shows the button.
          const found = await worker.searchAds(want.query);
          if (mine === latest.current) setAds({ status: "ready", ads: found, total: found.length });
        }
      } catch (error) {
        if (mine === latest.current) setAds(failedAds(error));
      }
      const held = await holding;
      if (mine === latest.current) setPending(held);
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
  /**
   * The catalog, fetched without deciding which screen shows it.
   *
   * Two screens want it now: the plans screen somebody navigated to, and the
   * `no-tier` one they were sent to (T77, ADR-0032) — so the fetch is separated
   * from the navigation `seePlans` also does. It sits above `load` because `load`
   * calls it.
   */
  const loadPlans = useCallback(async () => {
    setPlans(PLANS_LOADING);
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

  const load = useCallback(async () => {
    setBusy(true);
    const answer = await worker.displayState();
    setScreen(screenFor(answer));

    if (answer.status !== "ready") {
      setAds(ADS_LOADING);
      // **The one non-`ready` answer that still needs a second call.** `no-tier`
      // now offers the catalog rather than telling somebody to wait for an
      // operator (T77, ADR-0032), and the cards are `GET /api/plans` — which this
      // screen is reached without ever passing through, so nothing else would
      // fetch them. Fired without awaiting: the screen is already correct and the
      // cards draw their own skeletons into it.
      if (answer.status === "no-tier") void loadPlans();
      setBusy(false);
      return;
    }

    await showAds(displayed.current);
    setBusy(false);
  }, [worker, showAds, loadPlans]);

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

  /** Drop a pending repost at the user's word, and draw what is left. */
  const letGo = useCallback(
    async (listingId: string) => {
      await worker.letGo(listingId);
      setPending(await worker.pendingReposts());
    },
    [worker],
  );

  /** Reload a **Stale tab** and ask for the list again once it has a content script. */
  const reloadMarktplaats = useCallback(
    async (tabId: number) => {
      setAds(ADS_LOADING);
      await worker.reloadMarktplaats(tabId);
      await reloadAds();
    },
    [worker, reloadAds],
  );

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
      // Any attempt can start, finish or change a pending repost.
      else void worker.pendingReposts().then(setPending);
    },
    [reloadAds, worker],
  );

  const onSettled = useCallback(() => {
    void reloadAds();
    void worker.pendingReposts().then(setPending);
  }, [reloadAds, worker]);

  const retryPending = useCallback(
      async (listingId: string) => {
        try {
          onOutcome(await worker.retry(listingId));
        } catch {
          setPending(await worker.pendingReposts());   // the notice stays; nothing is lost
        }
      },
      [worker, onOutcome],
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
    setScreen((current) =>
      current.screen === "signed-in" ? { screen: "plans", plan: current.plan } : current,
    );
    await loadPlans();
  }, [loadPlans]);

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
          pending,
          letGo,
          reloadMarktplaats,
          worker,
          onOutcome,
          plans,
          handoff,
          seePlans,
          loadPlans,
          backToAds,
          upgrade,
          manageBilling,
          typed,
          showing,
          onType: type,
          onClearSearch: clear,
          retryPending,
          onSettled
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
  pending: PendingRepost[];
  letGo: (listingId: string) => void;
  reloadMarktplaats: (tabId: number) => void;
  worker: WorkerPort;
  onOutcome: (outcome: WireRelistOutcome) => void;
  plans: PlansView;
  handoff: Handoff;
  seePlans: () => void;
  /** Re-fetch the catalog without navigating — the `no-tier` screen's retry. */
  loadPlans: () => void;
  backToAds: () => void;
  upgrade: (tierCode: string, interval: string) => void;
  manageBilling: () => void;
  /** Opnieuw on a pending-repost notice. (Was read inside `body` without being passed in.) */
  retryPending: (listingId: string) => void;
  /** A repost this popup did not start has finished. */
  onSettled: () => void;
  /** What the search box shows, what it settled on, and the two ways to change it. */
  typed: string;
  showing: Showing;
  onType: (raw: string) => void;
  onClearSearch: () => void;
}

function body(screen: Screen, handlers: Handlers): JSX.Element {
  const { load, signIn, signOut, busy, ads, pending, letGo, reloadMarktplaats, worker, onOutcome, retryPending, onSettled } = handlers;
  const { plans, handoff, seePlans, loadPlans, backToAds, upgrade, manageBilling } = handlers;
  const { typed, showing, onType, onClearSearch } = handlers;
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
    case "no-tier":
      // It offers the catalog now rather than a wait (T77, ADR-0032): deleting the
      // *default* tier strands accounts while leaving every other tier on sale, so
      // for that half of this state buying one is the user's own way out. Where
      // nothing is on sale the screen falls back to the wait, which is the half
      // T77 was right about.
      return (
        <NoTierScreen view={plans}>
          <PlanCards
            view={plans}
            // On no tier there is no card of theirs to mark.
            current={null}
            handoff={handoff}
            onUpgrade={upgrade}
            onRetry={loadPlans}
          />
        </NoTierScreen>
      );
    case "signed-in":
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
          <PendingNotice pending={pending} onRetry={retryPending} />
          <SearchBox value={typed} onType={onType} onClear={onClearSearch} />
          <AdList
            view={ads}
            worker={worker}
            onOutcome={onOutcome}
            pending={pending}
            onLetGo={letGo}
            onReloadMarktplaats={reloadMarktplaats}
            onSettled={onSettled}
            empty={showing.kind === "search" ? noMatches(showing.query) : undefined}
            // The one thing the list is told about the plan, and it is the grant
            // rather than what is left of it (T32, #41). The screen above holds
            // the subscription; this hands down the single fact the rows lock on.
            //
            // Unconditional, including while a card is failing — where the strip
            // above carries the sentence rather than the prompt, because the
            // dunning prompt has the prompt slot. `grantLine` already puts the
            // zero-grant branch ahead of the failing-card one for exactly this
            // pair (ADR-0029), so the plan is named there and the buttons agree
            // with it.
            grantsNothing={grantsNothing(screen.plan)}
          />
        </SignedInScreen>
      );
    case "plans":
      return (
        <PlansScreen
          onBack={backToAds}
          onManageBilling={manageBilling}
          handoff={handoff}
          // Only once the cards are here. While they are loading there is nothing
          // for the sentence to be about, and a screen that announced how to pay
          // above three skeletons would be describing a page that is not there yet.
          payWith={plans.status === "ready" ? "Je kunt betalen met iDEAL | Wero, PayPal, creditcard en debitcard" : null}
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
  return error instanceof Error ? error.message : "Inloggen is niet gelukt. Probeer het opnieuw.";
}

/**
 * The list could not be had. A **Stale tab** is not a failure but a step the
 * popup can take (ADR-0039); no tab at all is remembered, because pending rows
 * say it too.
 */
function failedAds(error: unknown): AdsView {
  if (error instanceof StaleMarktplaatsTabError) return { status: "stale", tabId: error.tabId };
  return { status: "failed", message: describeAdsFailure(error), noTab: error instanceof NoMarktplaatsTabError };
}
