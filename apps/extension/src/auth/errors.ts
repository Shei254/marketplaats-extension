/**
 * The two ways signing in does not produce a session, kept apart because the UI
 * has to treat them differently (T29, #38).
 *
 * Closing the Keycloak window is not an error the user needs told about — they
 * did it on purpose, and the screen they are looking at is already the signed-out
 * one. Everything else is a failure worth showing, and worth *not* dressing up as
 * being signed out: "we could not reach the login server" and "you are not signed
 * in" lead a person to do different things.
 */
export class SignInCancelledError extends Error {
  constructor(message = "Sign-in was cancelled.") {
    super(message);
    this.name = "SignInCancelledError";
  }
}

export class SignInFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInFailedError";
  }
}
