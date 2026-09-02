/**
 * Which Keycloak, and as whom.
 *
 * One definition, imported by the worker and by the tests that hold it to the
 * realm export — `realm.test.ts` reads `infra/keycloak/mprelist-realm.json` and
 * asserts this client is actually in it, is public, and requires the PKCE method
 * we send. A client id that no longer matches the realm fails there rather than
 * as an `invalid_client` in a browser window somebody has to be watching.
 *
 * **The issuer is compiled in, and it could not be served** (T56, #87,
 * ADR-0024). Signing in is what produces the token every API call carries, so it
 * precedes the first fetch of the served client-configuration document — a
 * document that arrives after sign-in cannot have said which realm to sign into.
 * The value is `deployment.json`'s in `npm run build` and the local stack's in
 * `npm run build:dev`, and `scripts/deployment.mjs` is what refuses to ship one
 * that would strand a published build.
 *
 * The client id is not a deployment's to choose: it is what the realm export
 * declares, in every realm, which is why it stays a literal here.
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
  issuer: __AUTH_ISSUER__,
  clientId: "mprelist-extension",
  scope: "openid",
};
