import { describe, expect, it } from "vitest";

import { challengeFor, createState, createVerifier } from "./pkce";

describe("PKCE", () => {
  it("derives the challenge RFC 7636 says it should", async () => {
    // Appendix B's worked example, verbatim. Pinned against the RFC rather than
    // against a second SHA-256 in the test, which would agree with any mistake
    // made in the same direction — and the failure it would hide is silent:
    // Keycloak simply refuses the exchange with `invalid_grant`, long after the
    // window the user typed their password into has closed.
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes a verifier the RFC's grammar accepts", () => {
    const verifier = createVerifier();
    // 43–128 characters of unreserved base64url. 32 random bytes lands on 43,
    // the minimum, which is the length the RFC's own example uses.
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("carries no character that changes meaning in a URL", () => {
    // base64, not base64url, is the bug this guards: `+` becomes a space when the
    // form body is parsed, so the server hashes something else and refuses.
    const values = Array.from({ length: 50 }, () => createVerifier() + createState());
    expect(values.join("")).not.toMatch(/[+/=]/);
  });

  it("does not repeat itself", () => {
    const verifiers = new Set(Array.from({ length: 100 }, () => createVerifier()));
    const states = new Set(Array.from({ length: 100 }, () => createState()));
    expect(verifiers.size).toBe(100);
    expect(states.size).toBe(100);
  });
});
