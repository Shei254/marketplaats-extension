import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBrand } from "./brand.mjs";
import { LOCAL_STACK, readDeployment } from "./deployment.mjs";
import { extensionIdFromKey } from "./extension-key.mjs";
import { DEV_HOOK_NAMES } from "../src/background/dev-hooks";
import { installChromeStub, type ChromeStub } from "../src/testing/chrome-stub";

/**
 * The dev hooks are a build-time decision (T04, #12), so the only honest place
 * to assert it is the emitted bundle: `if (__DEV__)` has to fold away, not ship
 * and evaluate false. Asserting on the source would prove nothing — a guard that
 * esbuild failed to eliminate reads exactly the same.
 *
 * Three claims, and they are not the same claim:
 *   - no production bundle *contains* a hook name (a text search over every
 *     emitted .js — this is what someone auditing the shipped artifact does, and
 *     they audit the whole artifact, not the file we happened to suspect);
 *   - the dev bundle actually *installs* them (importing the emitted worker —
 *     a text search cannot tell `if (true)` from `if (false)`, since both leave
 *     the string "__relist" in the file);
 *   - neither bundle installs anything *else*. That last one is why the global
 *     assertions are a before/after diff rather than a lookup of known names: a
 *     ninth hook assigned outside the worker's `hooks` map is invisible to a
 *     check that can only ask about names it already knows. The map's totality
 *     over `DEV_HOOK_NAMES` catches drift inside the map, but that is a compile
 *     error, and neither esbuild nor vitest typechecks — so it is not something
 *     a green `npm test` has any right to imply.
 *
 * The names come from `DEV_HOOK_NAMES` rather than a copy kept here, because a
 * copy would make this suite pass by knowing less.
 *
 * Both builds go to a temp directory so the real dist/ is left where it was.
 */
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

interface BuiltExtension {
  dir: string;
  files: string[];
  /** Every emitted .js file by name — "no hook ships" is a claim about all of them. */
  bundles: Record<string, string>;
}

async function buildInto(mode: "production" | "dev"): Promise<BuiltExtension> {
  const dir = await mkdtemp(join(tmpdir(), "mprelist-build-"));
  execFileSync(
    "node",
    ["scripts/build.mjs", "--outdir", dir, ...(mode === "dev" ? ["--dev"] : [])],
    { cwd: workspaceRoot, stdio: "pipe" },
  );

  const files = (await readdir(dir)).sort();
  const bundles: Record<string, string> = {};
  for (const name of files.filter((file) => file.endsWith(".js"))) {
    bundles[name] = await readFile(join(dir, name), "utf8");
  }

  return { dir, files, bundles };
}

/**
 * Own enumerable `__`-prefixed globals. `Object.assign(globalThis, hooks)` is the
 * shape a hook install takes, so anything a bundle adds this way shows up here —
 * including a name this file has never heard of, which is the point.
 */
function devGlobals(): Set<string> {
  return new Set(Object.keys(globalThis).filter((key) => key.startsWith("__")));
}

function globalsAddedSince(before: Set<string>): string[] {
  return [...devGlobals()].filter((key) => !before.has(key)).sort();
}

describe("extension build", () => {
  let chromeStub: ChromeStub;
  let production: BuiltExtension;
  let dev: BuiltExtension;
  let addedByProduction: string[];
  let addedByDev: string[];

  beforeAll(async () => {
    chromeStub = installChromeStub();
    production = await buildInto("production");
    dev = await buildInto("dev");

    // Production first: the two share one globalThis, so this order is what lets
    // "the dev build installed them" be distinguished from "production did".
    const beforeAnyBundle = devGlobals();
    await import(pathToFileURL(join(production.dir, "background.js")).href);
    addedByProduction = globalsAddedSince(beforeAnyBundle);

    const beforeDevBundle = devGlobals();
    await import(pathToFileURL(join(dev.dir, "background.js")).href);
    addedByDev = globalsAddedSince(beforeDevBundle);
  }, 60_000);

  afterAll(async () => {
    chromeStub.restore();
    await rm(production.dir, { recursive: true, force: true });
    await rm(dev.dir, { recursive: true, force: true });
  });

  it("emits the five loadable files and no Options page", () => {
    // Deliberately exact: options.html/options.js coming back is the regression
    // this ticket removed, and a new asset should be a considered addition.
    expect(production.files).toEqual([
      "background.js",
      "content.js",
      "manifest.json",
      "popup.html",
      "popup.js",
    ]);
    expect(dev.files).toEqual(production.files);
  });

  it("declares no options_ui, which would point at a page that is no longer built", async () => {
    const manifest = JSON.parse(
      await readFile(join(production.dir, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).not.toHaveProperty("options_ui");
  });

  it("leaves no trace of a manual test hook in any production bundle", () => {
    // Pinned against the emitted file list, so the search below cannot pass by
    // having quietly stopped covering a bundle — an empty or shrunken set would
    // otherwise sail through the loop. Derived rather than a second literal list:
    // the test above is the one place the filenames are spelled out, and a copy
    // here could agree with itself while both drifted from what is emitted.
    expect(Object.keys(production.bundles).sort()).toEqual(
      production.files.filter((file) => file.endsWith(".js")),
    );

    for (const [name, source] of Object.entries(production.bundles)) {
      for (const hook of DEV_HOOK_NAMES) {
        expect(source, `${name} contains ${hook}`).not.toContain(hook);
      }
    }
  });

  it("installs nothing on globalThis when the production worker runs", () => {
    expect(addedByProduction).toEqual([]);
  });

  it("installs every manual test hook, and only those, when the --dev worker runs", () => {
    const global = globalThis as unknown as Record<string, unknown>;

    expect(addedByDev).toEqual([...DEV_HOOK_NAMES].sort());
    for (const hook of DEV_HOOK_NAMES) {
      expect(typeof global[hook], `${hook} is not callable`).toBe("function");
    }
  });

  /**
   * The brand is resolved at build time (T48, #78), so the emitted artefact is the
   * only honest place to assert it — scripts/brand.test.ts proves the resolver, and
   * a resolver nothing calls would pass every one of those tests.
   */
  it("resolves the brand into the emitted manifest and popup", async () => {
    const brand = await readBrand();
    const manifest = JSON.parse(await readFile(join(production.dir, "manifest.json"), "utf8")) as {
      name: string;
      description: string;
      action: { default_title: string };
    };

    expect(manifest.name).toBe(brand.name);
    expect(manifest.action.default_title).toBe(brand.name);
    expect(manifest.description).toBe(brand.tagline);
    expect(await readFile(join(production.dir, "popup.html"), "utf8")).toContain(brand.name);
  });

  /**
   * The version the manifest declares is the version the bundles name themselves
   * with (T43, #52). Two places read one file, and if they ever disagreed the
   * backend would be refusing a build by a number nobody could see in Chrome —
   * which is the one thing that would make the compatibility lever unusable.
   */
  it("names its own version in the bundle it ships, and it is the manifest's", async () => {
    const manifest = JSON.parse(await readFile(join(production.dir, "manifest.json"), "utf8")) as {
      version: string;
    };

    expect(manifest.version).toMatch(/^\d+(\.\d+){0,3}$/);
    expect(await readFile(join(production.dir, "background.js"), "utf8"))
      .toContain(`extension/${manifest.version}`);
  });

  /**
   * The two addresses are compiled in (T56, #87, ADR-0024), so — exactly as with
   * the brand — the emitted bundle is the only honest place to assert it.
   * `scripts/deployment.test.ts` proves the resolver, and a resolver nothing
   * called would pass every one of those tests while `npm run build` went on
   * emitting an extension that talks to the machine it was built on.
   */
  it("compiles deployment.json's addresses into the production bundles", async () => {
    const deployment = await readDeployment();

    expect(production.bundles["background.js"]).toContain(deployment.apiBaseUrl);
    expect(production.bundles["background.js"]).toContain(deployment.issuer);
  });

  it("and leaves no address of the build machine's own in any of them", () => {
    // The failure this ticket exists to remove, and it is silent in both
    // directions: a build carrying localhost works perfectly on the machine that
    // made it, and is inert on every machine that installs it from the Web Store.
    // Asserted over every emitted bundle rather than the two configs, because
    // what ships is the bundle.
    for (const [name, source] of Object.entries(production.bundles)) {
      expect(source, `${name} still points at the build machine`).not.toContain("localhost");
      expect(source, `${name} still points at the build machine`).not.toContain("127.0.0.1");
    }
  });

  it("while the dev build points at the local stack, which is the whole split", () => {
    // `npm run build:dev` is the build loaded unpacked against `infra`'s compose
    // stack (docs/live-testing.md). If both builds carried the same addresses,
    // one of the two workflows would be broken and nothing here would say which.
    expect(dev.bundles["background.js"]).toContain(LOCAL_STACK.apiBaseUrl);
    expect(dev.bundles["background.js"]).toContain(LOCAL_STACK.issuer);
  });

  it("leaves no unresolved token in anything it emits", async () => {
    // A template token that shipped would reach the Web Store listing as the
    // literal `{{brand.name}}`. Checked over every emitted file rather than the
    // two we happen to template, so a third one added later is covered by default.
    for (const name of production.files) {
      const contents = await readFile(join(production.dir, name), "utf8");
      expect(contents, `${name} carries an unresolved token`).not.toMatch(/\{\{\s*brand\./);
    }
  });

  it("emits every permission the template asks for", async () => {
    // The manifest is re-serialised from a parsed tree (T48), so what it grants is
    // something the build could silently drop. `identity` is the one this matters
    // most for: without it `chrome.identity` is undefined at the moment somebody
    // clicks sign in (T23, #32). Compared against the template rather than a list
    // here, so a permission added later is covered without editing this test.
    const template = JSON.parse(
      await readFile(new URL("../public/manifest.template.json", import.meta.url), "utf8"),
    ) as { permissions: string[] };
    const built = JSON.parse(await readFile(join(production.dir, "manifest.json"), "utf8")) as {
      permissions: string[];
    };

    expect(built.permissions).toEqual(template.permissions);
    expect(built.permissions).toContain("identity");
  });

  it("leaves no `process.env` in anything it emits", async () => {
    // React reads `process.env.NODE_ENV` to choose between its two
    // implementations, and `process` does not exist in a page or a service
    // worker: an unsubstituted reference is not a bigger bundle, it is a popup
    // that throws on load. `scripts/build.mjs` defines it for both builds, and
    // this is what would notice a third bundle being added without it.
    for (const [name, source] of Object.entries(production.bundles)) {
      expect(source, `${name} still reads process.env`).not.toContain("process.env");
    }
    for (const [name, source] of Object.entries(dev.bundles)) {
      expect(source, `${name} still reads process.env`).not.toContain("process.env");
    }
  });

  it("ships React's production implementation, not its development one", async () => {
    // The two differ by warnings, name-tracking and about half the bundle — 574kb
    // against 1.1mb here. `process.env.NODE_ENV` is what chooses between them, and
    // with it substituted the dead half folds away rather than shipping behind a
    // branch nobody takes.
    //
    // Asserted as a size ratio and a dev-only word rather than on a marker string,
    // which is React's to rename: what has to hold is that the shipped popup is
    // the smaller build and carries none of the other's warnings.
    const shipped = production.bundles["popup.js"] ?? "";
    const forTesters = dev.bundles["popup.js"] ?? "";

    expect(shipped).not.toContain("development");
    expect(forTesters).toContain("development");
    expect(shipped.length).toBeLessThan(forTesters.length * 0.75);
  });

  it("passes the pinned `key` through untouched", async () => {
    // The key is the extension id (T44, #13), which is the Keycloak redirect URI,
    // in a realm that imports once. Templating the manifest must not disturb it.
    const template = JSON.parse(
      await readFile(new URL("../public/manifest.template.json", import.meta.url), "utf8"),
    ) as { key: string };
    const built = JSON.parse(await readFile(join(production.dir, "manifest.json"), "utf8")) as {
      key: string;
    };

    expect(built.key).toBe(template.key);
    expect(extensionIdFromKey(built.key)).toMatch(/^[a-p]{32}$/);
  });
});
