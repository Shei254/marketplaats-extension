import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import brand from "../../../../brand.json";
import { palette } from "@mprelist/ui";
import { themeTypes } from "../theme";

const directory = fileURLToPath(new URL("./", import.meta.url));

/** Every `.ftl` under `src/email/`, by its path relative to it — what the build copies. */
function templatePaths(prefix = ""): string[] {
  return readdirSync(`${directory}${prefix}`, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? templatePaths(`${prefix}${entry.name}/`)
      : entry.name.endsWith(".ftl")
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

/**
 * The templates, with their FreeMarker comments taken out — a template is allowed
 * to *explain* the thing it must not render, and this one explains at length why
 * there is no mark in it.
 */
const templates = templatePaths().map((path) => ({
  path,
  source: readFileSync(`${directory}${path}`, "utf8").replace(/<#--[\s\S]*?-->/g, ""),
}));

const emitted = themeTypes().find(({ type }) => type === "email");
const declared = [...(emitted?.properties ?? "").matchAll(/^([\w]+)=/gm)].map(([, key]) => key);

describe("the mail's shell", () => {
  it("is one template, under the directory Keycloak reads it from", () => {
    // `html/` and not the type's root: an email theme's templates are nested by
    // medium, which is the thing that cost `scripts/build.mjs` a recursive walk.
    // A `text/template.ftl` would be a file Keycloak never loads — `base/email`
    // has no text shell, and each plain-text mail is a standalone one-liner.
    expect(templates.map(({ path }) => path)).toEqual(["html/template.ftl"]);
  });

  it("defines the macro the inherited templates call, and nests into it", () => {
    const [shell] = templates;
    expect(shell?.source).toMatch(/<#macro emailLayout>/);
    expect(shell?.source).toContain("<#nested>");
  });

  it("asks for no theme property the type does not emit", () => {
    // The mirror of the login templates' "ask for no image the build does not
    // draw". A property that is not written resolves to nothing through the `!`
    // default, so the mail arrives with `style=""` — unstyled, and silent.
    for (const { path, source } of templates) {
      for (const [, key] of source.matchAll(/\$\{properties\.([\w]+)/g)) {
        expect(declared, `${path} → properties.${key}`).toContain(key);
      }
    }
  });

  it("holds no colour, no size and no name of its own", () => {
    for (const { path, source } of templates) {
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(source, path).not.toContain(brand.name);
      expect(source, path).not.toContain(brand.domain);
      expect(source, path).not.toContain(palette.light.accent);
      // The realm's label is an administrator's, and naming it here is the fault
      // this whole type exists to remove from the mail.
      expect(source, path).not.toContain("realm.displayName");
      expect(source, path).not.toContain("realmName");
    }
  });

  it("carries no stylesheet, because no client would keep one", () => {
    for (const { path, source } of templates) {
      expect(source, path).not.toMatch(/<style|<link/i);
      // And no class attribute either: there is nothing to match it against.
      expect(source, path).not.toMatch(/\sclass="/);
    }
  });

  it("says where to read the terms and where to write, as the sign-in card does", () => {
    const [shell] = templates;
    expect(shell?.source).toContain("${properties.brandDomain!}/privacy");
    expect(shell?.source).toContain("${properties.brandDomain!}/terms");
    expect(shell?.source).toContain("mailto:${properties.brandSupportEmail!}");
  });
});
