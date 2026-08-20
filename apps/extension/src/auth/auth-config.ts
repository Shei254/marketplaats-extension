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
   * `openid` and nothing else — deliberately.
   *
   * Keycloak's default client scopes would put the user's name and email in the
   * token we send to our own API, and ADR-0001/0005 draw the boundary at not
   * sending personal data there. The API identifies a user by `sub` and has never
   * needed anything else; the narrowest scope that still yields an id token is
   * the one that keeps it that way.
   */
  scope: string;
}

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  issuer: "http://localhost:8081/realms/mprelist",
  clientId: "mprelist-extension",
  scope: "openid",
};
