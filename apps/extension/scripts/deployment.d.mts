/**
 * Types for `deployment.mjs`. Hand-written for the same reason as `brand.d.mts`:
 * `allowJs` would pull every script here into strict checking, including ones
 * nothing is asking to change.
 */

/**
 * The two addresses a build compiles in. `readDeployment` verifies both are
 * present, absolute, `https`, not the build machine's own, and free of the
 * trailing slash that would make every API path a double one — so the
 * declaration is a checked claim rather than a hopeful one.
 */
export interface Deployment {
  /** Our own API, with no trailing slash: every call is `${apiBaseUrl}/api/…`. */
  apiBaseUrl: string;
  /** The OIDC issuer, `…/realms/<name>`, spelled as Keycloak stamps it into `iss`. */
  issuer: string;
  [key: string]: string;
}

/** The local stack's addresses, which `npm run build:dev` compiles in. */
export declare const LOCAL_STACK: Readonly<Deployment>;

/** Reads the root `deployment.json`, dropping `$`-prefixed notes. Throws on anything unshippable. */
export declare function readDeployment(url?: URL): Promise<Deployment>;
