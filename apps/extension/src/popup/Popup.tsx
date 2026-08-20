import { UiStyles } from "@mprelist/ui";
import { useCallback, useEffect, useState, type JSX } from "react";

import { popupCss } from "./popup-styles";
import { LOADING, screenFor, type Screen, type WorkerPort } from "./screen";
import { LoadingScreen, SignedInScreen, SignedOutScreen, UnavailableScreen } from "./screens";

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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setScreen(screenFor(await worker.displayState()));
    setBusy(false);
  }, [worker]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <style dangerouslySetInnerHTML={{ __html: popupCss }} />
      <div className="mp-root">{body(screen, { load, signIn, signOut, busy })}</div>
    </>
  );
}

interface Handlers {
  load: () => void;
  signIn: () => void;
  signOut: () => void;
  busy: boolean;
}

function body(screen: Screen, { load, signIn, signOut, busy }: Handlers): JSX.Element {
  switch (screen.screen) {
    case "loading":
      return <LoadingScreen />;
    case "signed-out":
      return <SignedOutScreen onSignIn={signIn} busy={busy} failure={screen.failure} />;
    case "unavailable":
      return <UnavailableScreen onRetry={load} busy={busy} />;
    case "signed-in":
      return <SignedInScreen plan={screen.plan} onRefresh={load} onSignOut={signOut} busy={busy} />;
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
