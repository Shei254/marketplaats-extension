import { Button, Icon, Note, Spinner, UiStyles } from "@mprelist/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { BRAND } from "../brand";
import { siteCss } from "../site-styles";
import { AdminApi } from "./admin-api";
import { AdminCatalog } from "./AdminCatalog";
import { ADMIN_ROLE, DEFAULT_ADMIN_CONFIG, type AdminConfig } from "./admin-config";
import { LOADING, type AdminScreen } from "./admin-screen";
import { beginSignIn, completeSignIn, isOperator, signOut } from "./admin-session";
import { adminCss } from "./admin-styles";
import type { Http } from "./discovery";

/**
 * The admin corner — **the only authenticated part of `apps/web`** (ADR-0017, T54,
 * #85), and the last ticket in slice D.
 *
 * <h2>Everything from the browser arrives as a prop</h2>
 *
 * The query string, the storage, the navigation and `fetch` are all handed in, so
 * every route through this component — including the two that end in a full page
 * navigation — is reachable in a test without a browser. `main.tsx` is the one
 * file that supplies the real ones, which is the same split the popup has with
 * `popup-entry.tsx` and this site has with its own entry.
 *
 * <h2>A sign-in is what a page load turns out to be</h2>
 *
 * There is no button. Arriving at `/admin` signed out *is* the request to sign in,
 * so the first thing this does is ask whether the load it is in the middle of is a
 * redirect coming back from Keycloak. If it is, it finishes it; if it is not, it
 * starts one. That is why `signing-in` is a screen — the page is about to be
 * navigated away from, and half a second of nothing looks like a hang.
 *
 * <h2>This component is the session, and nothing else is</h2>
 *
 * What is on screen once somebody is signed in — the sidebar, which page is
 * showing, the forms — belongs to `AdminCatalog` and the shell it renders. Here
 * there are four screens, and every one of them is a sentence about a session that
 * does not exist yet: two waits and the two ways this build can fail to become
 * one. They are drawn on a bar with the brand and nothing else, because there is
 * nothing to navigate between and a sidebar would be a list of doors that are all
 * locked.
 *
 * <h2>The role decides a screen and never a permission</h2>
 *
 * `ADMIN` is enforced by the API on every route under `/api/admin` (#27), server
 * side, before routing. What the check here buys is that somebody signed in as the
 * wrong person is told so, instead of being shown an empty catalog and a row of
 * `403`s — and that they are offered the one thing that helps, which is signing in
 * as somebody else.
 */
export function AdminApp({
  config = DEFAULT_ADMIN_CONFIG,
  http = BROWSER_FETCH,
  storage,
  search,
  path,
  navigate,
  replaceUrl,
}: {
  config?: AdminConfig;
  http?: Http;
  /** Where the in-flight verifier and `state` live for the seconds of the redirect. */
  storage: Storage;
  /** The query this page loaded with — a redirect back from Keycloak carries `code`. */
  search: string;
  /** Where the operator was going, which survives the round trip in `sessionStorage`. */
  path: string;
  /** A full page navigation, to Keycloak and back. */
  navigate: (url: string) => void;
  /** Rewrites the address bar without a navigation, once a sign-in has landed. */
  replaceUrl: (url: string) => void;
}): JSX.Element {
  const [screen, setScreen] = useState<AdminScreen>(LOADING);

  /**
   * The two navigations, held so that this component's own callbacks are stable
   * whatever the caller passes.
   *
   * Every real caller hands these down as inline arrows — `BrowserAdminApp` does —
   * which makes them a new value on every render. Depended on directly, they would
   * make `start` new, which makes `AdminCatalog`'s loader new, which reloads the
   * catalog on every render of this component. Found by writing the test that
   * re-renders the shell, which is the only place that difference is visible.
   */
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const replaceUrlRef = useRef(replaceUrl);
  replaceUrlRef.current = replaceUrl;

  /**
   * One client per token, and **not one per render** — which is load-bearing rather
   * than tidy: `AdminCatalog` loads the catalog in an effect keyed on it, so a new
   * instance every render is a fetch every render. Keyed on the token itself, so a
   * sign-in that replaces the session replaces the client with it.
   */
  const token = screen.screen === "catalog" ? screen.session.accessToken : null;
  const api = useMemo(
    () => (token === null ? null : new AdminApi(config, () => token, http)),
    [token, config, http],
  );

  const start = useCallback(async () => {
    setScreen({ screen: "signing-in" });
    try {
      await beginSignIn(config, http, storage, (url) => navigateRef.current(url), path);
    } catch (unreachable) {
      setScreen({ screen: "failed", message: messageOf(unreachable) });
    }
  }, [config, http, storage, path]);

  /**
   * Whether the question below has been asked. **Asked once**, because it is a
   * question about the page *load* — "was this a redirect coming back from
   * Keycloak?" — and the answer cannot change while the page is open.
   *
   * <p>What it actually protects is a fresh visit under React's development
   * double-invoke: two runs mint two PKCE verifiers into one storage key, the
   * second overwrites the first, and whichever navigation the browser follows
   * carries a challenge for a verifier that is no longer there. The sign-in then
   * fails at the token endpoint, minutes later, with a message about neither.
   *
   * <p>It does <em>not</em> protect the returning half, and it took three attempts
   * at a test to establish that: a second run there finds the in-flight verifier
   * already spent and fails before reaching Stripe or Keycloak, so nothing is
   * exchanged twice with or without this. `main.tsx` does not use StrictMode today;
   * this is what makes adding it safe rather than a mystery.
   */
  const arrivalHandled = useRef(false);

  useEffect(() => {
    if (arrivalHandled.current) return;
    arrivalHandled.current = true;
    void (async () => {
      const arrival = await completeSignIn(search, config, http, storage);
      if (arrival.status === "failed") {
        setScreen({ screen: "failed", message: arrival.message });
        return;
      }
      if (arrival.status === "not-a-sign-in") {
        await start();
        return;
      }
      // The address bar still says `/?code=…&state=…`, which is the redirect URI
      // the realm registered rather than anywhere anybody asked to be. Rewritten
      // rather than navigated: a navigation would reload the page and throw away
      // the token this tab is now holding.
      replaceUrlRef.current(arrival.returnTo);
      setScreen(
        isOperator(arrival.session)
          ? { screen: "catalog", session: arrival.session }
          : { screen: "not-an-operator" },
      );
    })();
    // No cleanup that cancels this, deliberately, and the ref above is why. Under
    // StrictMode the effect is invoked twice: a `cancelled` flag would be set by
    // the first invocation's teardown, the guard would turn the second into a
    // no-op, and the screen would stay blank for ever — which is exactly what the
    // suite saw before this was written this way. The exchange runs once, and a
    // `setScreen` after an unmount is a no-op in React 18 and later.
  }, [search, config, http, storage, start]);


  const leave = useCallback(() => {
    setScreen(LOADING);
    void signOut(config, http, (url) => navigateRef.current(url)).catch((unreachable: unknown) => {
      setScreen({ screen: "failed", message: messageOf(unreachable) });
    });
  }, [config, http]);

  return (
    <>
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: `${siteCss}\n${adminCss}` }} />
      {screen.screen === "catalog" && api ? (
        // The signed-in surface brings its own frame — a sidebar, and the page it
        // is showing. Nothing above it decides what is on screen, which is what
        // keeps this component about the session and only about the session.
        <AdminCatalog api={api} onSignedOut={start} onSignOut={leave} />
      ) : (
        // The four screens that are not a session yet: a bar with the brand on it
        // and one sentence under it. There is nothing to navigate between, so
        // there is no navigation — a sidebar here would be a list of doors that
        // are all locked.
        <div className="mp-root admin-plain">
          <header className="admin-plain-bar">
            <span className="admin-brand">
              <span className="mp-mark admin-mark">
                <Icon name="site-logo" />
              </span>
              <span className="web-wordmark">{BRAND.name}</span>
              {/* What this build *is*, rather than part of the product's name. */}
              <span className="admin-brand-tag">admin</span>
            </span>
          </header>
          <div className="admin-page">{body(screen, { onRetry: start, onLeave: leave })}</div>
        </div>
      )}
    </>
  );
}

interface Handlers {
  onRetry: () => void;
  onLeave: () => void;
}

/**
 * Everything that is not a catalog: the two waits and the two ways this build can
 * fail to become a session. `catalog` is not here because it is not a message —
 * it is the whole surface, and it is rendered above.
 */
function body(screen: AdminScreen, { onRetry, onLeave }: Handlers): JSX.Element | null {
  switch (screen.screen) {
    case "loading":
      return (
        <div className="admin-centred">
          <Spinner size="lg" label="Loading" />
        </div>
      );
    case "signing-in":
      return (
        <div className="admin-centred">
          <Spinner size="lg" label="Signing in" />
          <p>Taking you to sign in…</p>
        </div>
      );
    case "failed":
      return (
        <div className="admin-centred">
          <h1>Sign-in didn’t work</h1>
          <Note tone="error">{screen.message}</Note>
          <Button shape="rect" tone="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    case "not-an-operator":
      return (
        <div className="admin-centred">
          <h1>Not your corner</h1>
          {/* Not a failure and not a retry: they are signed in, and signing in
              again returns the same person. The only useful move is to be
              somebody else, which is what the button does. */}
          <p>
            You’re signed in, but this account doesn’t have the <code>{ADMIN_ROLE}</code> role. Nothing
            here is available to it.
          </p>
          <Button shape="rect" tone="primary" onClick={onLeave}>
            Sign in as somebody else
          </Button>
        </div>
      );
    case "catalog":
      // Handled above, where the shell is. Reachable only in the frame between a
      // session landing and `api` being built from it, which is no frames at all.
      return null;
  }
}

/**
 * The real `fetch`, as a module constant rather than an inline default.
 *
 * A fresh arrow on every render would be a new dependency on every render, which
 * defeats the memo above and every effect keyed on it — the kind of bug that shows
 * up as a backend log full of identical requests rather than as anything on screen.
 */
const BROWSER_FETCH: Http = (url, init) => fetch(url, init);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
