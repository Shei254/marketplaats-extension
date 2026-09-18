import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng, iconSet } from "@mprelist/ui/icon-png";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import brand from "../../../brand.json";
import { ICON_MASTER, SITE_ICONS } from "./icons";

/**
 * The tab icon (T48, #78), which is the same mark the extension's toolbar icon
 * is and comes from the same master — one file in `brand/`, resized at build
 * time, so this site holds no copy of the artwork to fall behind a redraw.
 *
 * Two claims, and only the second needs a build: that `index.html` and the build
 * agree on which files exist, and that the files are there and are the size they
 * are declared at. A favicon nobody notices is missing is exactly the kind of
 * thing a test that only read the source would go on passing about.
 */

const workspace = fileURLToPath(new URL("..", import.meta.url));

describe("what index.html declares", () => {
  it("links exactly the icons the build emits, at the sizes it emits them", async () => {
    const html = await readFile(join(workspace, "index.html"), "utf8");
    const linked = [...html.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)]
      .map((tag) => /href="\/([^"]+)"/.exec(tag[0])?.[1])
      .sort();

    expect(linked).toEqual(Object.keys(SITE_ICONS).sort());
  });
});

describe("the image that builds it", () => {
  it("copies the artwork into the build context, since the build now reads it", async () => {
    // The context is the repository root and `.dockerignore` is what stops that
    // meaning the working tree, so what reaches the image is exactly what the
    // `COPY` lines name (`apps/web/Dockerfile`). Before the icons this build read
    // one file above the workspace, `brand.json`, and the line copying it was
    // enough; the first thing that file pointed *at* would have failed the image
    // build and nothing else here would have noticed — `npm run build` on a
    // developer's machine has the whole tree.
    const dockerfile = await readFile(join(workspace, "Dockerfile"), "utf8");
    const copied = [...dockerfile.matchAll(/^COPY (?!--from)(\S+)/gm)].map((line) => line[1] ?? "");

    expect(copied.some((path) => brand.icon === path || brand.icon.startsWith(`${path}/`)))
      .toBe(true);
  });
});

describe("the built site", () => {
  let dist: string;

  beforeAll(async () => {
    // The real build, through Vite's own API and into a temp directory — so
    // `dist/` is left as whoever is serving it left it, and so this reads
    // `vite.config.ts` rather than a second configuration written here.
    dist = await mkdtemp(join(tmpdir(), "mprelist-web-"));
    await build({
      root: workspace,
      logLevel: "silent",
      build: { outDir: dist, emptyOutDir: true },
    });
  }, 120_000);

  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it("carries an icon of every size it declares, drawn from the brand's own master", async () => {
    const drawn = iconSet(await readFile(ICON_MASTER), Object.values(SITE_ICONS));

    for (const [path, size] of Object.entries(SITE_ICONS)) {
      const bytes = await readFile(join(dist, path));
      const icon = decodePng(bytes);

      expect([icon.width, icon.height], `${path} is not ${size}×${size}`).toEqual([size, size]);
      expect(bytes, `${path} is not the brand's artwork`).toEqual(Buffer.from(drawn.get(size)!));
    }
  });

  it("serves them from the site root, where the link tags say they are", async () => {
    // Emitted beside `index.html` rather than into Vite's hashed `assets/`, which
    // nginx caches for a year on the strength of the name changing with the bytes
    // (`nginx.conf.template`). A favicon is requested by a browser that never read
    // the HTML — and by iOS, at a fixed name — so it cannot carry a hash.
    const html = await readFile(join(dist, "index.html"), "utf8");

    for (const path of Object.keys(SITE_ICONS)) {
      expect(html).toContain(`href="/${path}"`);
    }
  });
});
