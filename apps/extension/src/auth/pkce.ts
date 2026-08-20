import { bytesToBase64Url } from "../shared/base64";

/**
 * PKCE (RFC 7636) and the `state` parameter.
 *
 * The verifier never leaves the worker until the token exchange, and the URL the
 * user's browser is sent to carries only its SHA-256. That is the whole mechanism:
 * an authorization code intercepted on the way back is worthless without the
 * verifier, which is why a public client is allowed to do this at all.
 *
 * `state` is a separate value with a separate job — it is the one thing that ties
 * the redirect we are handed back to the request we made.
 */

/** 32 random bytes, base64url — 43 characters, inside RFC 7636's 43–128. */
export function createVerifier(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The `S256` challenge for a verifier: base64url(SHA-256(ascii(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

/** The `state` parameter: unguessable, and only ever compared with itself. */
export function createState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}
