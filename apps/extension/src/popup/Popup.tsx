import { UiStyles } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import type { WireRelistOutcome } from "../background/messages";
import type { HandoffAnswer } from "../api/subscribing";
import { ADS_LOADING, describeAdsFailure, type AdsView } from "./ads";
import { adListCss, planCardCss, popupCss } from "./popup-styles";
import { AdList } from "./AdList";
import { PlanCards } from "./PlanCards";
import {
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

  /**
   * The plan first, then the ads — and the ads **only** when there is a session.
   *
   * Not an ordering preference: the ad list is a request to marktplaats.nl in the
   * user's own session, and `docs/enforcement-contract.md` has a signed-out popup
   * make none. Asking in parallel would be faster and would send that request on
   * behalf of somebody who is not signed in.
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

    setAds(ADS_LOADING);
    try {
      setAds({ status: "ready", ads: await worker.ads() });
    } catch (error) {
      // The list failing does not take the plan down with it: the two come from
      // different places — ours and Marktplaats's — and a user whose quota is
      // fine should be told that, beside the reason their ads are missing.
      setAds({ status: "failed", message: describeAdsFailure(error) });
    }
    setBusy(false);
  }, [worker]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The ads alone — what a finished relist invalidates, since the ad has a new id. */
  const reloadAds = useCallback(async () => {
    setAds(ADS_LOADING);
    try {
      setAds({ status: "ready", ads: await worker.ads() });
    } catch (error) {
      setAds({ status: "failed", message: describeAdsFailure(error) });
    }
  }, [worker]);

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
    setPlans(answer.status === "ready" ? { status: "ready", plans: answer.plans } : { status: "failed" });
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

  const upgrade = useCallback(
    (tierCode: string) => void openStripe(tierCode, () => worker.checkout(tierCode), "checkout"),
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
  }, [worker]);

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
  upgrade: (tierCode: string) => void;
  manageBilling: () => void;
}

function body(screen: Screen, handlers: Handlers): JSX.Element {
  const { load, signIn, signOut, busy, ads, worker, onOutcome } = handlers;
  const { plans, handoff, seePlans, backToAds, upgrade, manageBilling } = handlers;
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
          <AdList view={ads} worker={worker} onOutcome={onOutcome} />
        </SignedInScreen>
      );
    case "plans":
      return (
        <PlansScreen onBack={backToAds} onManageBilling={manageBilling} handoff={handoff}>
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
