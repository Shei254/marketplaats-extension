/**
 * Which Keycloak, and as whom.
 *
 * One definition, imported by the worker and by the tests that hold it to the
 * realm export — `realm.test.ts` reads `infra/keycloak/mprelist-realm.json` and
 * asserts this client is actually in it, is public, and requires the PKCE method
 * we send. A client id that no longer matches the realm fails there rather than
 * as an `invalid_client` in a browser window somebody has to be watching.
 *
 * These are the **local stack's** values (infra/README.md). Nothing is deployed
 * yet — T55 (#86) is what deploys it, and #36 is what will serve this as client
 * config instead of building it in. Until one of those lands, a build points at
 * localhost, which is exactly what iteration 1 says it is: the loop on one
 * machine.
 */
export interface AuthConfig {
  /** The OIDC issuer. Its discovery document is what everything else is read from. */
  issuer: string;
  clientId: string;
  /**
   * `openid` and nothing else — deliberately, but this is not what keeps the
   * user's name and email out of the token.
   *
   * ADR-0001/0005 draw the boundary at not sending personal data to our own API,
   * which identifies a user by `sub` and has never needed anything else. Asking
   * for the narrowest scope is the half of that we can state from here. The other
   * half is not ours: Keycloak adds a client's **default client scopes** whatever
   * the request asks for, and `profile` and `email` are attached to every client
   * a realm creates unless the client names its own — so for as long as it did
   * not, this request asked for `openid` and was answered with an address (#108).
   * `mprelist-extension` now names them, and `auth-config.test.ts` reads the realm
   * export to hold it to that.
   */
  scope: string;
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  issuer: "http://localhost:8081/realms/mprelist",
  clientId: "mprelist-extension",
  scope: "openid",
};
