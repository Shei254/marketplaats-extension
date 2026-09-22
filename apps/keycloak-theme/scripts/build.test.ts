import { decodePng } from "@mprelist/ui/icon-png";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { THEME_NAME, themeTypes } from "../src/theme";

/**
 * The emitted theme, asserted against the bytes rather than against the module
 * that produced them.
 *
 * What the rest of the suite can see is a string and a map; what Keycloak reads
 * is a directory of files in the layout it expects, with the images actually the
 * sizes the templates say they are. Those are different claims, and this is the
 * only place the second one can be made.
 *
 * Into a temp directory, because the real one is committed — `git diff
 * --exit-code` in CI is what proves *that* copy is this build's output, and a
 * suite that rewrote it would be asserting against its own side effect.
 */
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const types = themeTypes();

let outdir: string;

beforeAll(async () => {
  outdir = await mkdtemp(join(tmpdir(), "mprelist-keycloak-theme-"));
  build();
}, 60_000);

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
});

function build(): void {
  execFileSync("node", ["scripts/build.mjs", "--outdir", outdir], {
    cwd: workspaceRoot,
    stdio: "pipe",
  });
}

const rootOf = (type: string): string => join(outdir, THEME_NAME, type);

describe("the built theme", () => {
  it("emits one directory per type the registry declares, and no other", async () => {
    // The registry in `src/theme.ts` is the list; a directory here that is not
    // in it is a type Keycloak would offer and nothing tests, and one missing is
    // a realm setting that resolves to the built-in theme without saying so.
    expect((await readdir(join(outdir, THEME_NAME))).sort()).toEqual(
      types.map(({ type }) => type).sort(),
    );
  });

  it.each(types)("lays $type out the way Keycloak reads a theme", async ({ type, resources, icons }) => {
    // `themes/<name>/<type>/…`, with the properties file at the type's root and
    // everything a browser fetches under `resources`. Keycloak does not report a
    // theme in the wrong shape — it reports one it could not find.
    const root = rootOf(type);
    expect((await stat(join(root, "theme.properties"))).isFile()).toBe(true);
    for (const path of [...Object.keys(resources), ...Object.keys(icons)]) {
      expect((await stat(join(root, "resources", path))).isFile(), path).toBe(true);
    }
  });

  it.each(types)("inherits $type from base, and serves a stylesheet if it names one", async ({ type }) => {
    // `parent=base` is the load-bearing half of both types: `base` carries the
    // flow and styles none of it, so there is nothing to undo.
    const root = rootOf(type);
    const properties = await readFile(join(root, "theme.properties"), "utf8");
    expect(properties).toContain("parent=base");
    // **Only where one is declared.** `email` has no stylesheet and cannot have
    // one: a theme's `resources/` are served over HTTP to a browser, and a mail
    // is rendered once and handed to an SMTP server with no URL to fetch from.
    // Its styling is inline, which is `src/email/styles.ts` and ADR-0035.
    const [, styles] = /^styles=(.+)$/m.exec(properties) ?? [];
    if (styles) {
      expect((await stat(join(root, "resources", styles))).isFile()).toBe(true);
    }
  });

  it.each(types)("writes $type's message bundles where Keycloak looks for them", async ({ type, messages }) => {
    // `messages/` at the type's root, beside `theme.properties` — not under
    // `resources/`, which is the browser's. A bundle in the wrong place is not
    // an error: Keycloak finds the parent theme's value and the mail goes out
    // in Keycloak's own words, looking exactly as intended.
    for (const [name, contents] of Object.entries(messages)) {
      expect(await readFile(join(rootOf(type), "messages", name), "utf8"), name).toBe(contents);
    }
  });

  it.each(types)("copies the templates that sit beside $type's source, nesting and all", async ({ type }) => {
    // The `.ftl` files in `src/<type>/` are the ones that type replaces, which
    // is the whole reason that directory carries Keycloak's spelling of the type.
    //
    // **Compared by relative path rather than by name** (T82). A login theme's
    // templates sit flat at the type's root; an email theme's sit under `html/`,
    // and Keycloak loads them from exactly there. Listing one level would pass
    // this test on an email type by finding nothing on either side.
    const ftl = (paths: string[]): string[] =>
      paths.filter((path) => path.endsWith(".ftl")).map((path) => path.split(sep).join("/")).sort();
    const source = ftl(await readdir(join(workspaceRoot, "src", type), { recursive: true }));
    const emitted = ftl(await readdir(rootOf(type), { recursive: true }));
    expect(emitted).toEqual(source);
    expect(emitted.length, `${type} replaces no template at all`).toBeGreaterThan(0);
  });

  it.each(types)("draws every icon $type declares at the size it declares it", async ({ type, icons }) => {
    for (const [path, size] of Object.entries(icons)) {
      const bytes = new Uint8Array(await readFile(join(rootOf(type), "resources", path)));
      const image = decodePng(bytes);
      expect({ path, width: image.width, height: image.height }).toEqual({
        path,
        width: size,
        height: size,
      });
    }
  });

  it("serves the design system's own sheet, not a copy of it", async () => {
    const css = await readFile(join(rootOf("login"), "resources", "css", "login.css"), "utf8");
    expect(css).toContain("--mp-accent:");
    expect(css).toContain(".mp-btn--primary");
    expect(css).toContain(".login-stage");
  });

  it("empties the output directory rather than replacing it", async () => {
    // Not housekeeping. Both compose files bind-mount this directory into a
    // running Keycloak, and a bind mount follows the inode: a build that removed
    // and recreated it would leave the container reading the directory that used
    // to be there, and Keycloak answers a theme it cannot find by quietly serving
    // its own. Found by doing exactly that.
    const before = await stat(outdir);
    build();
    expect((await stat(outdir)).ino).toBe(before.ino);
    expect((await stat(join(rootOf("login"), "theme.properties"))).isFile()).toBe(true);
  });
});
