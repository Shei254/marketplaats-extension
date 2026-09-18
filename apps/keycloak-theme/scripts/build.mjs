import { iconSet } from "@mprelist/ui/icon-png";
import { build as bundle } from "esbuild";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

/**
 * The Keycloak theme, emitted.
 *
 * What comes out is a directory Keycloak reads as a theme: `<name>/<type>/`, and
 * inside each type a `theme.properties`, the resources a browser fetches, and
 * the `.ftl` files that type replaces. Everything in it is derived — from
 * `brand.json` and from `@mprelist/ui` — so redrawing the artwork or renaming
 * the product is still the one-file edit T48 (#78) made it. See
 * docs/adr/0033-the-login-page-is-ours-and-is-generated.md.
 *
 * **This script decides nothing.** It makes directories, writes bytes and
 * resizes a PNG; what a type *contains* is `src/theme.ts`'s, where the suite can
 * read it without running a build. Adding a type is therefore a directory under
 * `src/` and a line in that file, and nothing here changes.
 *
 * **`src/theme.ts` is TypeScript and this is not**, which is the one awkward
 * seam here and is worth stating rather than working around. The stylesheets are
 * `@mprelist/ui`'s token sheet plus its component sheet plus a type's own rules,
 * and those are TypeScript source — the design system is consumed as source by
 * all three of its consumers, which bundle. Node cannot import it, so this
 * script bundles it the way the extension's build bundles the extension, with
 * esbuild, and imports the result. `icon-png` needs none of that: it is `.mjs`
 * precisely so that a build script can call it, which is the same reason it
 * lives in `packages/ui` at all.
 *
 * `--outdir` exists for `scripts/build.test.ts`, so the suite can build without
 * writing over the committed directory.
 */
const { values } = parseArgs({
  options: { outdir: { type: "string", default: "theme" } },
});

const { outdir } = values;

/** Where `brand.json` and its artwork are, from this file. */
const repoRoot = new URL("../../../", import.meta.url);
const sourceDir = new URL("../src/", import.meta.url);

const theme = await loadTheme();
const types = theme.themeTypes();

// **The output directory itself is emptied, never removed.** Both compose files
// bind-mount it into a running Keycloak, and a bind mount follows the inode
// rather than the path: deleting and recreating it leaves the container holding
// the directory that used to be there — the theme stops being found, Keycloak
// logs "Failed to find LOGIN theme" and quietly serves its built-in one, and the
// only way back is a restart.
await mkdir(outdir, { recursive: true });
for (const entry of await readdir(outdir)) {
  await rm(`${outdir}/${entry}`, { recursive: true, force: true });
}

// The mark, resized once from the one master `brand.json` names, at the union of
// every size any type asks for. `iconSet` refuses a master that is not what a
// committed one is — 8-bit, RGB or RGBA, not interlaced, and no smaller than the
// largest size asked of it — by name, so a re-export in the wrong mode stops the
// build rather than emitting a worse icon.
const master = new Uint8Array(await readFile(new URL(theme.ICON_MASTER, repoRoot)));
const drawn = iconSet(master, [
  ...new Set(types.flatMap(({ icons }) => Object.values(icons))),
]);

let templateCount = 0;

for (const { type, properties, resources, icons } of types) {
  const root = `${outdir}/${theme.THEME_NAME}/${type}`;
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/theme.properties`, properties);

  for (const [path, contents] of Object.entries(resources)) {
    await mkdir(dirname(`${root}/resources/${path}`), { recursive: true });
    await writeFile(`${root}/resources/${path}`, contents);
  }

  for (const [path, size] of Object.entries(icons)) {
    await mkdir(dirname(`${root}/resources/${path}`), { recursive: true });
    await writeFile(`${root}/resources/${path}`, drawn.get(size));
  }

  // The templates this type replaces, copied rather than templated: the brand
  // reaches them as theme properties, so there is nothing in them to substitute
  // and they stay files an editor can check the FreeMarker of. They are the
  // `.ftl` files in `src/<type>/`, which is why that directory is named for
  // Keycloak's own spelling of the type rather than for anything of ours.
  const templateDir = new URL(`${type}/`, sourceDir);
  const templates = (await readdir(templateDir)).filter((name) => name.endsWith(".ftl"));
  for (const name of templates) {
    await copyFile(new URL(name, templateDir), `${root}/${name}`);
  }
  templateCount += templates.length;
}

console.log(
  `Built the ${theme.THEME_NAME} theme into ${outdir}/ — `
    + `${types.length} type(s) (${types.map(({ type }) => type).join(", ")}), `
    + `${templateCount} template(s), ${drawn.size} icon size(s). `
    + `Keycloak reads it on the next page load; each realm asks for it by name.`,
);

/**
 * `src/theme.ts`, bundled and evaluated.
 *
 * Imported from a `data:` URL rather than through a file, so there is no
 * intermediate artefact to clean up or to accidentally ship. Nothing is left
 * external except Node's own built-ins, which resolve from a `data:` module
 * because `node:fs` is an absolute URL where a bare specifier would not be.
 */
async function loadTheme() {
  const bundled = await bundle({
    entryPoints: [new URL("theme.ts", sourceDir).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    external: ["node:*"],
  });
  const [output] = bundled.outputFiles;
  const encoded = Buffer.from(output.text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}
