/**
 * What a completed sign-in leaves behind, and where it is kept.
 *
 * The extension holds Keycloak's own tokens rather than a token of ours
 * (ADR-0010): it is a public client, and the usual objection to keeping a refresh
 * token in a client does not apply when the client belongs to the person who owns
 * the credentials that minted it.
 *
 * **Nothing in here is ever logged.** Not the tokens, not the authorization code,
 * not the PKCE verifier. A console line that reproduced an access token would put
 * it in a place `chrome.storage.local` is not — visible to anyone screen-sharing a
 * service-worker console, and pasted into an issue by anyone reporting a bug.
 */
export interface AuthSession {
  accessToken: string;
  /**
   * Rotating, and the realm spends it on use (`revokeRefreshToken`,
   * `refreshTokenMaxReuse: 0` — see infra/README.md). Null only if Keycloak
   * answered without one, which a public client doing code+PKCE should not.
   * Spending it is T24's (#33) job; this ticket only keeps it.
   */
  refreshToken: string | null;
  /** Kept for `id_token_hint` at sign-out, which is what ends the Keycloak session. */
  idToken: string | null;
  /** Epoch ms. The access token's own expiry, not the session's. */
  expiresAt: number;
  /** Epoch ms, so a later reader can tell a fresh session from a resurrected one. */
  obtainedAt: number;
}

/**
 * What a caller who only wants to know *whether* somebody is signed in should be
 * told.
 *
 * "Signed in" means a session is held, **not** that its access token is currently
 * fresh: the realm's access tokens last five minutes and an MV3 worker sleeps for
 * longer than that between one relist and the next, so a state that flipped to
 * signed-out on expiry would flap for every user who left the popup closed. Making
 * a stale access token usable again is refresh, which is T24 (#33).
 */
export type AuthState =
  | { status: "signed-in"; expiresAt: number }
  | { status: "signed-out" };

/**
 * What a caller who wants to *use* the session is given (T24, #33).
 *
 * Three answers rather than a token or null, because the two ways there is no
 * token are different facts about the world and lead to different screens. Being
 * signed out is the user's state and the sign-in button is the answer to it;
 * being unable to reach Keycloak is ours, the session is untouched, and the
 * answer is to try again in a moment — which is the same "unavailable, retry"
 * the enforcement contract asks a fail-closed display to show.
 *
 * Collapsing them would mean a flaky minute of network signing somebody out of a
 * session that is still perfectly good.
 */
export type AccessToken =
  | { status: "ready"; token: string }
  | { status: "signed-out" }
  | { status: "unavailable" };

/**
 * System boundary: where the session is persisted. The real one is
 * chrome.storage.local; the authenticator is tested against an in-memory fake,
 * the same arrangement `SnapshotStore` has.
 */
export interface SessionStore {
  read(): Promise<AuthSession | null>;
  write(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export function stateOf(session: AuthSession | null): AuthState {
  return session ? { status: "signed-in", expiresAt: session.expiresAt } : { status: "signed-out" };
}
