import type { AdminConfig } from "../admin/admin-config";
import { beginSignIn, completeSignIn, signOut } from "../admin/admin-session";
import type { Http } from "../admin/discovery";
import type { Choice } from "../public/viewer";

/**
 * Signing a visitor in on `/`, and keeping them signed in across a reload
 * (T85, ADR-0036).
 *
 * **The token lives in memory and nowhere else**, as `admin-session.ts` argues:
 * nothing that opens an account is ever at rest where a script on this origin
 * could read it. What survives a reload is a **flag that carries no secret** —
 * "somebody signed in here" — and on load it buys one `prompt=none` round trip:
 * Keycloak answers from its own session without showing a page, or with
 * `login_required`, which clears the flag. A stranger has no flag and is never
 * redirected anywhere.
 *
 * **Same client and same exchange as the admin corner**, under a key of its own:
 * the realm sends both back to the origin root, and which in-flight record is
 * present is how `/` tells a returning buyer from a returning operator.
 */

/** This session's in-flight record, beside `mprelist.admin.sign-in`. */
export const IN_FLIGHT = "mprelist.site.sign-in";

/** The flag in `localStorage`: present means "try a silent sign-in on load". */
export const SIGNED_IN = "mprelist.site.signed-in";

/** The card pressed before signing in, in `sessionStorage` until the way back. */
export const CHOICE = "mprelist.site.choice";

export interface SessionDeps {
  config: AdminConfig;
  http: Http;
  /** `sessionStorage`: the in-flight record and the choice. */
  session: Storage;
  /** `localStorage`: the flag, and nothing else. */
  local: Storage;
  navigate: (url: string) => void;
  replaceUrl: (url: string) => void;
}

export type Start =
  | { kind: "arrived"; token: string; choice: Choice | null }
  | { kind: "signed-out"; notice: string | null }
  | { kind: "redirecting" };

/** Whether this address is Keycloak answering a sign-in this session started. */
export function customerArriving(search: string, session: Storage): boolean {
  const params = new URLSearchParams(search);
  return (params.has("code") || params.has("error")) && read(session, IN_FLIGHT) !== null;
}

/** What the page is, the moment it loads. */
export async function start(deps: SessionDeps, search: string): Promise<Start> {
  if (customerArriving(search, deps.session)) {
    // Whatever came back, the address it came back on is not one to leave in the
    // bar: a reload of `?code=` would try the exchange a second time.
    deps.replaceUrl("/");
    const error = new URLSearchParams(search).get("error");
    if (error && SILENT_REFUSALS.has(error)) {
      remove(deps.session, IN_FLIGHT);
      remove(deps.local, SIGNED_IN);
      const choice = takeChoice(deps.session);
      // A silent attempt that carried a choice was somebody pressing a button
      // whose token had lapsed. They meant it, so they are asked to sign in.
      if (choice) {
        await signIn(deps, choice);
        return { kind: "redirecting" };
      }
      return { kind: "signed-out", notice: null };
    }
    const arrival = await completeSignIn(search, deps.config, deps.http, deps.session, IN_FLIGHT);
    if (arrival.status === "signed-in") {
      write(deps.local, SIGNED_IN, "1");
      return { kind: "arrived", token: arrival.session.accessToken, choice: takeChoice(deps.session) };
    }
    remove(deps.local, SIGNED_IN);
    takeChoice(deps.session);
    return { kind: "signed-out", notice: "Inloggen is niet gelukt. Probeer het nog eens." };
  }
  if (read(deps.local, SIGNED_IN) !== null) {
    try {
      await beginSignIn(deps.config, deps.http, deps.session, deps.navigate, "/", {
        key: IN_FLIGHT,
        prompt: "none",
      });
      return { kind: "redirecting" };
    } catch {
      // Keycloak could not be found. The page is still worth drawing, signed out.
      return { kind: "signed-out", notice: null };
    }
  }
  return { kind: "signed-out", notice: null };
}

/**
 * Off to Keycloak, carrying the card they pressed if they pressed one. `silent`
 * is the lapsed-token case: they were signed in a minute ago.
 */
export async function signIn(deps: SessionDeps, choice?: Choice, silent = false): Promise<void> {
  if (choice) write(deps.session, CHOICE, JSON.stringify(choice));
  await beginSignIn(deps.config, deps.http, deps.session, deps.navigate, "/", {
    key: IN_FLIGHT,
    ...(silent ? { prompt: "none" as const } : {}),
  });
}

/** Keycloak's logout, which ends its session too — so the flag has nothing to find. */
export async function signOutCustomer(deps: SessionDeps): Promise<void> {
  remove(deps.local, SIGNED_IN);
  await signOut(deps.config, deps.http, deps.navigate);
}

/**
 * What Keycloak answers a `prompt=none` with when it would have to show a page.
 * Each means the same here: not signed in any more.
 */
const SILENT_REFUSALS = new Set([
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
]);

function takeChoice(session: Storage): Choice | null {
  const stored = read(session, CHOICE);
  remove(session, CHOICE);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<Choice>;
    return typeof parsed.tierCode === "string" && typeof parsed.interval === "string"
      ? { tierCode: parsed.tierCode, interval: parsed.interval }
      : null;
  } catch {
    return null;
  }
}

// Storage can throw — a private window, blocked site data — and none of what is
// kept here is worth failing the page over.

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Nothing: the visitor is signed out on their next visit, which is the safe way to be wrong.
  }
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to remove from a storage that cannot be reached.
  }
}
