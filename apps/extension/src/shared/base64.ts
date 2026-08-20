/** Byte <-> base64 helpers, shared by the snapshot store and the content-script relay
 *  (chrome.storage and chrome.runtime messaging both need JSON-safe strings, not
 *  Uint8Array). btoa/atob are available in both the service worker and page contexts. */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * base64url (RFC 4648 §5) — the alphabet OAuth uses, since `+`, `/` and `=` all
 * mean something else inside a URL. Used by PKCE, where a padded or plus-carrying
 * verifier is a `code_verifier` the server hashes to something else entirely.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
