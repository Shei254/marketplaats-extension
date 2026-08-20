/**
 * Types for the one function `extension-key.mjs` exports.
 *
 * Hand-written rather than reached by `allowJs`, which would pull every script in
 * this directory into strict checking — including `build.mjs`, which no test
 * imports and which nothing is asking to change. This declares the surface the
 * test actually uses, and nothing else.
 */

/**
 * Chrome's extension-id derivation: SHA-256 the decoded public key, take the
 * first 16 bytes, render each nibble as a letter `a`–`p`.
 *
 * @param base64Spki the manifest's `key` — an RSA public key, DER
 *                   SubjectPublicKeyInfo, base64-encoded
 * @returns the 32-character id, matching `/^[a-p]{32}$/`
 */
export declare function extensionIdFromKey(base64Spki: string): string;
