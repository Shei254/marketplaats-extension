import { describe, expect, it } from "vitest";

import { fromWireError, toWireError } from "../content/messages";
import { SignInCancelledError, SignInFailedError } from "./errors";

/**
 * A sign-in happens in the worker and is asked for from the popup, so the only
 * thing the popup ever sees of a failure is what survived `chrome.runtime`'s JSON.
 * An `Error` does not survive it — which is why the mapping exists, and why these
 * two staying apart across it is worth an assertion rather than an assumption:
 * T29 (#38) renders a cancelled sign-in as the signed-out screen and a failed one
 * as "we could not reach the login server", and it can only tell them apart here.
 */
describe("a sign-in failure crossing the worker boundary", () => {
  it("is still a cancellation on the other side", () => {
    const wire = toWireError(new SignInCancelledError());

    expect(wire.code).toBe("SIGN_IN_CANCELLED");
    expect(fromWireError(wire)).toBeInstanceOf(SignInCancelledError);
  });

  it("is still a failure on the other side, with Keycloak's own words", () => {
    const wire = toWireError(new SignInFailedError("Keycloak refused the sign-in: invalid_client"));

    expect(wire.code).toBe("SIGN_IN_FAILED");
    const rebuilt = fromWireError(wire);
    expect(rebuilt).toBeInstanceOf(SignInFailedError);
    expect(rebuilt.message).toBe("Keycloak refused the sign-in: invalid_client");
  });

  it("does not flatten one into the other", () => {
    expect(fromWireError(toWireError(new SignInFailedError("x")))).not.toBeInstanceOf(
      SignInCancelledError,
    );
  });
});
