import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The dev hooks are a build-time decision (T04, #12), so the only honest place
 * to assert it is the emitted bundle: `if (__DEV__)` has to fold away, not ship
 * and evaluate false. Asserting on the source would prove nothing — a guard that
 * esbuild failed to eliminate reads exactly the same.
 *
 * Two claims, and they are not the same claim:
 *   - the production bundle does not *contain* the hooks (a text search — this
 *     is what someone auditing the shipped artifact checks);
 *   - the dev bundle actually *installs* them (importing the emitted worker —
 *     a text search cannot tell `if (true)` from `if (false)`, since both leave
 *     the string "__relist" in the file).
 *
 * Both builds go to a temp directory so the real dist/ is left where it was.
 */
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

const HOOKS = [
  "__relist",
  "__captureAd",
  "__listAds",
  "__retry",
  "__resume",
  "__searchAd",
  "__getEndpoints",
  "__setEndpoints",
];

interface BuiltExtension {
  dir: string;
  files: string[];
  background: string;
}

async function buildInto(...args: string[]): Promise<BuiltExtension> {
  const dir = await mkdtemp(join(tmpdir(), "mprelist-build-"));
  execFileSync("node", ["scripts/build.mjs", "--outdir", dir, ...args], {
    cwd: workspaceRoot,
    stdio: "pipe",
  });
  return {
    dir,
    files: (await readdir(dir)).sort(),
    background: await readFile(join(dir, "background.js"), "utf8"),
  };
}

/**
 * Enough of the extension API for the worker's top level: it registers three
 * runtime listeners and constructs the orchestrator. Nothing here is ever fired,
 * so no relist can run — the listeners are registered and left alone.
 */
function installChromeStub(): void {
  const event = { addListener: () => {} };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { onStartup: event, onInstalled: event, onMessage: event },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: event,
    },
  };
}

function installedHooks(): string[] {
  const global = globalThis as unknown as Record<string, unknown>;
  return HOOKS.filter((hook) => typeof global[hook] === "function");
}

describe("extension build", () => {
  let production: BuiltExtension;
  let dev: BuiltExtension;
  let hooksAfterProduction: string[];
  let hooksAfterDev: string[];

  beforeAll(async () => {
    installChromeStub();
    production = await buildInto();
    dev = await buildInto("--dev");

    // Production first: the two share one globalThis, so this order is what lets
    // "the dev build installed them" be distinguished from "production did".
    await import(pathToFileURL(join(production.dir, "background.js")).href);
    hooksAfterProduction = installedHooks();
    await import(pathToFileURL(join(dev.dir, "background.js")).href);
    hooksAfterDev = installedHooks();
  }, 60_000);

  afterAll(async () => {
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

  it("leaves no trace of a manual test hook in the production bundle", () => {
    for (const hook of HOOKS) {
      expect(production.background).not.toContain(hook);
    }
  });

  it("installs no manual test hook when the production worker runs", () => {
    expect(hooksAfterProduction).toEqual([]);
  });

  it("installs every manual test hook when the --dev worker runs", () => {
    expect(hooksAfterDev).toEqual(HOOKS);
  });
});
