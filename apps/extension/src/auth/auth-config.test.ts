import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_AUTH_CONFIG } from "./auth-config";

/**
 * This module's configuration is only half of a sign-in. The other half is in two
 * files it cannot import — the realm Keycloak is started from, and the manifest
 * Chrome loads — and every way they can disagree fails at a distance:
 *
 *   - a client id that is not in the realm → `invalid_client`, in a browser window;
 *   - a realm that does not require S256 → PKCE silently stops protecting anything;
 *   - a manifest without `identity` → `chrome.identity` is undefined at the moment
 *     a user clicks sign in.
 *
 * So they are asserted against each other here. The realm export is read out of
 * the working tree, which is the same arrangement `apps/api`'s suite has with
 * `infra/` and one of the reasons CI carries no path filters (see the root README).
 */
const read = (path: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));

interface RealmClient {
  clientId: string;
  publicClient?: boolean;
  standardFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  attributes?: Record<string, string>;
}

const realm = read("../../../../infra/keycloak/mprelist-realm.json") as {
  realm: string;
  clients: RealmClient[];
};
const manifest = read("../../public/manifest.template.json") as { permissions: string[] };

const client = realm.clients.find((entry) => entry.clientId === DEFAULT_AUTH_CONFIG.clientId);

describe("the realm this build signs into", () => {
  it("has the client this build calls itself", () => {
    expect(client, `no ${DEFAULT_AUTH_CONFIG.clientId} client in the realm export`).toBeDefined();
  });

  it("is the realm the configured issuer names", () => {
    expect(DEFAULT_AUTH_CONFIG.issuer).toMatch(new RegExp(`/realms/${realm.realm}$`));
  });

  it("keeps that client public and on the code flow", () => {
    // A public client is the whole premise of ADR-0010 — there is no secret an
    // extension could keep — and the code flow is the only one we drive.
    expect(client?.publicClient).toBe(true);
    expect(client?.standardFlowEnabled).toBe(true);
  });

  it("requires the PKCE method this module sends", () => {
    // Without this attribute Keycloak accepts a code exchange with no verifier at
    // all, and the challenge we send becomes decoration.
    expect(client?.attributes?.["pkce.code.challenge.method"]).toBe("S256");
  });

  it("refuses the password grant, so there is no weaker way in beside this one", () => {
    expect(client?.directAccessGrantsEnabled ?? false).toBe(false);
  });

  it("registers the redirect URI Chrome hands us, and only that shape", () => {
    // `chrome.identity.getRedirectURL()` answers `https://<id>.chromiumapp.org/`,
    // trailing slash included; Keycloak matches redirect URIs exactly.
    expect(client?.redirectUris ?? []).toHaveLength(1);
    expect(client?.redirectUris?.[0]).toMatch(/^https:\/\/\S+\.chromiumapp\.org\/$/);
  });

  it("registers the extension as a web origin, which is what makes the token call legal", () => {
    // The exchange is a cross-origin `fetch` from the service worker, and the
    // manifest asks for no host permission on Keycloak. What allows it is CORS,
    // and what allows CORS is this line. Drop it and sign-in fails at the
    // exchange, after a successful login, with a message about Access-Control.
    expect(client?.webOrigins?.some((origin) => origin.startsWith("chrome-extension://"))).toBe(true);
  });
});

describe("the manifest", () => {
  it("asks for the identity permission the flow is driven through", () => {
    expect(manifest.permissions).toContain("identity");
  });

  it("still asks for the storage the session is kept in", () => {
    expect(manifest.permissions).toContain("storage");
  });
});
