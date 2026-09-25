import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Account, Choice, SwitchAnswer, SwitchPreviewAnswer, Viewer } from "../public/viewer";
import { CustomerApi, type Fetch, type Me } from "./customer-api";
import { signIn, signOutCustomer, start, type SessionDeps } from "./customer-session";

/**
 * The landing page's visitor, as a React hook (T85, ADR-0036): who they are,
 * and what pressing each button does for them.
 *
 * `enabled` is `false` on every page but `/`. The success, cancel and billing
 * pages still learn nothing about who is looking, and a silent sign-in is not
 * worth a redirect on a page with no plan on it.
 */
export function useAccount(
  deps: SessionDeps & { apiBaseUrl: string; fetch: Fetch; search: string },
  enabled: boolean,
): Account {
  const [viewer, setViewer] = useState<Viewer>(enabled ? { kind: "checking" } : { kind: "signed-out" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Choice | "billing" | null>(null);
  const api = useRef<CustomerApi | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const again = useCallback((choice?: Choice) => {
    // The token lapsed while the page was open: one silent round trip, carrying
    // the card they pressed, and a purchase carries on when it comes back.
    api.current = null;
    setViewer({ kind: "checking" });
    void signIn(depsRef.current, choice, true);
  }, []);

  const shown = useCallback((me: Me, picked: Choice | null = null): Viewer | null => {
    switch (me.status) {
      case "ready":
        return { kind: "signed-in", tierCode: me.tierCode, paying: me.paying, rhythm: me.rhythm, picked };
      case "no-tier":
        return { kind: "signed-in", tierCode: null, paying: false, rhythm: null, picked: null };
      case "expired":
        again();
        return null;
      case "unavailable":
        setNotice("Je abonnement kon niet worden geladen. Vernieuw de pagina om het nog eens te proberen.");
        return { kind: "signed-in", tierCode: null, paying: false, rhythm: null, picked: null };
    }
  }, [again]);

  const buy = useCallback((choice: Choice) => {
    const signedIn = api.current;
    if (!signedIn) {
      setBusy(choice);
      void signIn(depsRef.current, choice);
      return;
    }
    setBusy(choice);
    setNotice(null);
    void signedIn.checkout(choice).then(async (opened) => {
      if (opened.status === "opened") return depsRef.current.navigate(opened.url);
      if (opened.status === "expired") return again(choice);
      setBusy(null);
      setNotice("Afrekenen kon niet worden geopend. Probeer het zo nog eens.");
      // A refusal may be a view gone stale — somebody who started paying in
      // another tab — so what they are shown is asked again.
      const viewerNow = shown(await signedIn.me());
      if (viewerNow) setViewer(viewerNow);
    });
  }, [again, shown]);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void start(depsRef.current, depsRef.current.search).then(async (started) => {
      if (!current) return;
      if (started.kind === "redirecting") return;
      if (started.kind === "signed-out") {
        setNotice(started.notice);
        setViewer({ kind: "signed-out" });
        return;
      }
      const { apiBaseUrl, fetch } = depsRef.current;
      api.current = new CustomerApi(apiBaseUrl, started.token, fetch);
      const me = await api.current.me();
      if (!current) return;
      // A card pressed while signed out carries on to Checkout — but only while
      // it is still a purchase. A payer is shown it instead: a Plan switch
      // charges a saved card, and signing in is not consent to that.
      const buying = started.choice && me.status !== "expired" && !(me.status === "ready" && me.paying);
      if (buying && started.choice) {
        buy(started.choice);
        return;
      }
      const viewerNow = shown(me, started.choice);
      if (viewerNow) setViewer(viewerNow);
    });
    return () => {
      current = false;
    };
  }, [enabled, buy, shown]);

  const manageBilling = useCallback(() => {
    const signedIn = api.current;
    if (!signedIn) return;
    setBusy("billing");
    setNotice(null);
    void signedIn.portal().then((opened) => {
      if (opened.status === "opened") return depsRef.current.navigate(opened.url);
      if (opened.status === "expired") return again();
      setBusy(null);
      setNotice("Het betaaloverzicht kon niet worden geopend. Probeer het zo nog eens.");
    });
  }, [again]);

  const previewSwitch = useCallback(async (choice: Choice): Promise<SwitchPreviewAnswer> => {
    const signedIn = api.current;
    if (!signedIn) return { status: "unavailable" };
    const answer = await signedIn.previewSwitch(choice);
    if (answer.status === "expired") {
      again();
      return { status: "unavailable" };
    }
    if (answer.status === "not-paying") {
      const viewerNow = shown(await signedIn.me());
      if (viewerNow) setViewer(viewerNow);
    }
    return answer;
  }, [again, shown]);

  const switchPlan = useCallback(async (choice: Choice): Promise<SwitchAnswer> => {
    const signedIn = api.current;
    if (!signedIn) return { status: "unavailable" };
    const answer = await signedIn.switchPlan(choice);
    switch (answer.status) {
      case "expired":
        again();
        return { status: "unavailable" };
      case "confirm":
        depsRef.current.navigate(answer.url);
        return { status: "confirming" };
      case "switched":
        void settle(signedIn, choice, setViewer, setNotice);
        return { status: "switched" };
      default:
        return answer;
    }
  }, [again]);

  const signOut = useCallback(() => {
    api.current = null;
    void signOutCustomer(depsRef.current);
  }, []);

  return useMemo(
    () => ({
      viewer,
      notice,
      busy,
      signIn: (choice?: Choice) => {
        if (choice) setBusy(choice);
        void signIn(depsRef.current, choice);
      },
      signOut,
      manageBilling,
      buy,
      previewSwitch,
      switchPlan,
    }),
    [viewer, notice, busy, signOut, manageBilling, buy, previewSwitch, switchPlan],
  );
}

/**
 * Waits for the webhook to move the plan, then shows it. The switch is Stripe's
 * the moment it answers, but the tier is ours only once `customer.subscription.updated`
 * has been mirrored — usually a second or two.
 */
async function settle(
  api: CustomerApi,
  choice: Choice,
  setViewer: (viewer: Viewer) => void,
  setNotice: (notice: string | null) => void,
): Promise<void> {
  let last: Me = { status: "unavailable" };
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
    last = await api.me();
    if (last.status === "ready" && last.tierCode === choice.tierCode && last.rhythm === choice.interval) {
      setViewer({ kind: "signed-in", tierCode: last.tierCode, paying: last.paying, rhythm: last.rhythm, picked: null });
      return;
    }
  }
  if (last.status === "ready") {
    setViewer({ kind: "signed-in", tierCode: last.tierCode, paying: last.paying, rhythm: last.rhythm, picked: null });
  }
  setNotice("Je overstap is gelukt. Het kan even duren voordat je nieuwe abonnement hier staat.");
}

const SETTLE_ATTEMPTS = 8;
const SETTLE_INTERVAL_MS = 1500;
