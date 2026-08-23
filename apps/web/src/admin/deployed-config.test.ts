import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_CONFIG } from "./admin-config";
import { deployedConfig } from "./deployed-config";

const ORIGIN = "https://admin.example.com";
const workspace = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("what a deployment may say about where things are", () => {
  it("says nothing, and the defaults stand", () => {
    for (const nothing of [{}, undefined, null, "", "not an object", 7]) {
      expect(deployedConfig(nothing, ORIGIN)).toEqual({
        ...DEFAULT_ADMIN_CONFIG,
        redirectUri: `${ORIGIN}/`,
      });
    }
  });

  it("names the two addresses, and they are used", () => {
    const config = deployedConfig(
      { issuer: "https://auth.example.com/realms/mprelist", apiBaseUrl: "https://api.example.com" },
      ORIGIN,
    );

    expect(config.issuer).toBe("https://auth.example.com/realms/mprelist");
    expect(config.apiBaseUrl).toBe("https://api.example.com");
  });

  it("names one of them, and the other keeps the built-in", () => {
    const config = deployedConfig({ apiBaseUrl: "https://api.example.com" }, ORIGIN);

    expect(config.issuer).toBe(DEFAULT_ADMIN_CONFIG.issuer);
    expect(config.apiBaseUrl).toBe("https://api.example.com");
  });

  /**
   * The one that makes the deployed `/config.js` work at all: nginx substitutes an unset variable as a
   * blank rather than leaving the key out, so every key is always present and an empty one has to mean the
   * same as an absent one.
   */
  it("names one of them empty, which is not naming it", () => {
    const config = deployedConfig({ issuer: "", apiBaseUrl: "   " }, ORIGIN);

    expect(config.issuer).toBe(DEFAULT_ADMIN_CONFIG.issuer);
    expect(config.apiBaseUrl).toBe(DEFAULT_ADMIN_CONFIG.apiBaseUrl);
  });

  /** `discovery.ts` compares the issuer a document declares against this one exactly. */
  it("names an issuer with a trailing slash, which would otherwise sign nobody in", () => {
    const config = deployedConfig(
      { issuer: "https://auth.example.com/realms/mprelist/", apiBaseUrl: "https://api.example.com/" },
      ORIGIN,
    );

    expect(config.issuer).toBe("https://auth.example.com/realms/mprelist");
    expect(config.apiBaseUrl).toBe("https://api.example.com");
  });

  it("names something that is not a string, which is not an address", () => {
    expect(deployedConfig({ issuer: 8081, apiBaseUrl: ["https://api.example.com"] }, ORIGIN)).toEqual({
      ...DEFAULT_ADMIN_CONFIG,
      redirectUri: `${ORIGIN}/`,
    });
  });

  /**
   * The realm the issuer names is ours and the client in it is `mprelist-dashboard` wherever it is
   * deployed, so there is no request a deployment can make about it — the same reason no request to
   * `apps/api` carries a currency.
   */
  it("names a client id, which is not a thing a deployment decides", () => {
    expect(deployedConfig({ clientId: "somebody-elses-client" }, ORIGIN).clientId)
      .toBe(DEFAULT_ADMIN_CONFIG.clientId);
  });

  /**
   * Where the browser comes back to is where the browser already is. The realm registers the origin root
   * and matches it exactly, so this is the value that cannot disagree with reality — and a deployment
   * naming a different one would be naming one Keycloak refuses.
   */
  it("names a redirect URI, and the origin the page is served from wins", () => {
    expect(deployedConfig({ redirectUri: "https://somewhere.else/" }, "https://admin.example.com").redirectUri)
      .toBe("https://admin.example.com/");
    expect(deployedConfig({}, "https://admin.example.com/").redirectUri).toBe("https://admin.example.com/");
  });
});

/**
 * The other end of the same wire. `/config.js` is answered by two different things — a committed file on a
 * development machine, a `return 200` from nginx in the deployed image — and both have to be saying what
 * the function above reads.
 */
describe("the file that carries it", () => {
  it("is committed as the empty patch, which is what a development machine serves", () => {
    const committed = workspace("public/config.js");

    expect(committed).toContain("window.__MPRELIST_WEB_CONFIG__ = {}");
    // Never a real address: this file is served by `vite dev` and shipped inside the image, where nginx
    // answers the same path instead. A value here would be a second deployment nobody deployed.
    expect(committed).not.toMatch(/https?:\/\//);
  });

  it("is loaded by every page, before the bundle that reads it", () => {
    const html = workspace("index.html");

    expect(html.indexOf('<script src="/config.js"></script>')).toBeGreaterThan(0);
    expect(html.indexOf('src="/config.js"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });

  it("is answered by the deployed image with exactly the keys this reads", () => {
    const served = /window\.__MPRELIST_WEB_CONFIG__ = \{(.*?)\};/.exec(workspace("nginx.conf.template"));
    if (!served) throw new Error("nginx.conf.template no longer answers /config.js with a patch");

    const keys = [...served[1]!.matchAll(/"(\w+)":"\$\{(\w+)\}"/g)].map(([, key, variable]) => [key, variable]);

    expect(Object.fromEntries(keys)).toEqual({
      issuer: "MPRELIST_WEB_ISSUER",
      apiBaseUrl: "MPRELIST_WEB_API_BASE_URL",
    });
  });

  /**
   * And every variable it substitutes is declared in the image. An *undefined* name is left standing by
   * envsubst as a literal `${…}`, which nginx then reads as a variable of its own and refuses to start on —
   * so this is the difference between an unconfigured image serving the defaults and one that serves
   * nothing at all.
   */
  it("is answered from variables the image always defines", () => {
    const dockerfile = workspace("Dockerfile");

    for (const variable of ["MPRELIST_WEB_ISSUER", "MPRELIST_WEB_API_BASE_URL"]) {
      expect(dockerfile).toContain(`ENV ${variable}=""`);
    }
    expect(dockerfile).toContain("ENV NGINX_ENVSUBST_FILTER=^MPRELIST_WEB_");
  });

  /**
   * The obligation `docs/backlog.md` states for T55 (#86): one build, one `index.html`, so a host left on
   * its default returns 404 for `/success` — the page a customer lands on after the money has moved.
   */
  it("and every path this site has is answered with the one index.html", () => {
    expect(workspace("nginx.conf.template")).toContain("try_files $uri /index.html");
  });
});
