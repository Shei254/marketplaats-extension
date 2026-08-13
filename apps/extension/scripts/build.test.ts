import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    // Named, so the search below cannot pass by having quietly stopped covering
    // a bundle — an empty or shrunken set would otherwise sail through the loop.
    expect(Object.keys(production.bundles).sort()).toEqual([
      "background.js",
      "content.js",
      "popup.js",
    ]);

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
});
