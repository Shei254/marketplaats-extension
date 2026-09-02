import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_STACK, readDeployment } from "./deployment.mjs";

/**
 * `deployment.json` is the file that decides where a published extension talks
 * (T56, #87, and ADR-0024). Neither address can be served to it — the config
 * document is fetched *from* `apiBaseUrl`, and signing in precedes the first
 * fetch of it — so a wrong value here is a Web Store review to correct, and the
 * `426` lever cannot even announce it: saying so needs the API the stranded
 * build can no longer find.
 *
 * That is why every check below throws rather than warns. The build stops, the
 * way an unresolved `{{brand.…}}` token stops it (T48, #78) — one file, one
 * resolver, one failure mode.
 */

const DEPLOYED = { apiBaseUrl: "https://api.example.test", issuer: "https://auth.example.test/realms/mprelist" };

async function deploymentOf(contents: unknown): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "mprelist-deployment-"));
  const file = join(dir, "deployment.json");
  await writeFile(file, JSON.stringify(contents));
  try {
    return await readDeployment(pathToFileURL(file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("readDeployment's contract", () => {
  it("reads a deployment that names both addresses", async () => {
    await expect(deploymentOf(DEPLOYED)).resolves.toMatchObject(DEPLOYED);
  });

  it("drops $-prefixed keys, which are notes to whoever edits it", async () => {
    const deployment = await deploymentOf({ ...DEPLOYED, $note: "read me" });
    expect(Object.keys(deployment)).not.toContain("$note");
  });

  it("refuses a file missing an address, naming the one it wants", async () => {
    await expect(deploymentOf({ apiBaseUrl: DEPLOYED.apiBaseUrl })).rejects.toThrow(/issuer/);
  });

  it("refuses an empty address as firmly as a missing one", async () => {
    await expect(deploymentOf({ ...DEPLOYED, apiBaseUrl: "" })).rejects.toThrow(/apiBaseUrl/);
  });

  it("refuses something that is not a URL at all", async () => {
    await expect(deploymentOf({ ...DEPLOYED, apiBaseUrl: "api.example.test" })).rejects.toThrow(/apiBaseUrl/);
  });

  it("refuses plain HTTP, which the realm would answer 403 to anyway", async () => {
    // `sslRequired: external` means Keycloak refuses non-local plain HTTP, so an
    // `http://` issuer here ships a build that cannot sign anybody in.
    await expect(deploymentOf({ ...DEPLOYED, issuer: "http://auth.example.test/realms/mprelist" }))
      .rejects.toThrow(/https/);
  });

  it("refuses the local stack, which is the mistake that ships silently", async () => {
    // The whole reason this file exists: `npm run build` used to emit an extension
    // that talked to localhost, and nothing about it looked wrong until it was
    // installed from the Web Store on somebody else's machine.
    await expect(deploymentOf({ ...DEPLOYED, apiBaseUrl: "https://localhost:8080" }))
      .rejects.toThrow(/localhost/);
    await expect(deploymentOf({ ...DEPLOYED, issuer: "https://127.0.0.1:8081/realms/mprelist" }))
      .rejects.toThrow(/127\.0\.0\.1/);
  });

  it("refuses a trailing slash on the API, which would make every path a double one", async () => {
    // Every call is `${baseUrl}/api/…`, so a trailing slash is `//api/client-config`
    // — which some servers answer and ours does not.
    await expect(deploymentOf({ ...DEPLOYED, apiBaseUrl: "https://api.example.test/" }))
      .rejects.toThrow(/trailing/);
  });

  it("refuses an issuer that names no realm", async () => {
    // Keycloak's discovery document lives under `/realms/<name>`, and an issuer
    // without one fails at the first fetch with a 404 that reads as an outage.
    await expect(deploymentOf({ ...DEPLOYED, issuer: "https://auth.example.test" }))
      .rejects.toThrow(/realms/);
  });

  it("refuses a trailing slash on the issuer, which is not the string Keycloak stamps", async () => {
    // The `iss` claim is compared as text, and Keycloak mints it without the slash.
    await expect(deploymentOf({ ...DEPLOYED, issuer: "https://auth.example.test/realms/mprelist/" }))
      .rejects.toThrow(/trailing/);
  });
});

describe("the local stack's own addresses", () => {
  it("are what `build:dev` compiles in, and are the ones this file refuses to deploy", async () => {
    // Held here rather than asserted loosely, because the two builds differing by
    // exactly these two values is the whole of the split (`scripts/build.mjs`).
    expect(LOCAL_STACK).toEqual({
      apiBaseUrl: "http://localhost:8080",
      issuer: "http://localhost:8081/realms/mprelist",
    });
    await expect(deploymentOf(LOCAL_STACK)).rejects.toThrow();
  });
});

describe("the real deployment.json", () => {
  it("passes every check above, so `npm run build` produces a shippable extension", async () => {
    await expect(readDeployment()).resolves.toBeDefined();
  });

  it("names the realm the extension's auth config signs into", async () => {
    // Two files that must agree; `src/auth/auth-config.test.ts` holds the other
    // end of it against the realm export itself.
    const { issuer } = await readDeployment();
    expect(issuer).toMatch(/\/realms\/mprelist$/);
  });
});
