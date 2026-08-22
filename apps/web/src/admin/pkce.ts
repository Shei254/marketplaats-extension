/**
 * PKCE (RFC 7636) and the `state` parameter, for the browser (T54, #85).
 *
 * The verifier stays in this tab until the token exchange, and the URL Keycloak
 * sends the user to carries only its SHA-256. That is the whole mechanism: a code
 * intercepted on the way back is worthless without the verifier, which is what
 * lets a public client with no secret do this at all.
 *
 * **A second copy of the extension's `auth/pkce.ts`, deliberately.** These are
 * twenty lines implementing a published algorithm — there is no product decision
 * in any of them, and nothing here can drift away from the other copy in the way
 * a URL or a tier code could, because RFC 7636 is not going to change under us.
 * A `packages/auth` workspace for three functions would be a build, a tsconfig and
 * a test config to maintain for the privilege; the day a third consumer appears,
 * that is the move.
 */

/** base64url (RFC 4648 §5) — `+`, `/` and `=` all mean something else in a URL. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** 32 random bytes, base64url — 43 characters, inside RFC 7636's 43–128. */
export function createVerifier(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The `S256` challenge for a verifier: base64url(SHA-256(ascii(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * The `state` parameter: unguessable, and only ever compared with itself.
 *
 * A separate value with a separate job from the verifier — it is the one thing
 * tying the redirect we are handed back to the request this tab made, which is
 * what makes a code somebody else's browser obtained useless here.
 */
export function createState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}
