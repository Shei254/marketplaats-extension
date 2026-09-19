import { componentCss } from "@mprelist/ui";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import brand from "../../../../brand.json";
import { loginCss } from "./css";
import { ICONS } from "./index";

const directory = fileURLToPath(new URL("./", import.meta.url));
/**
 * The templates, with their FreeMarker comments taken out. Every assertion below
 * is about what a browser is sent, and a template is allowed to *explain* the
 * thing it must not render — the comment in `template.ftl` naming
 * `realm.displayName` is the reason that page does not use it.
 */
const templates = readdirSync(directory)
  .filter((name) => name.endsWith(".ftl"))
  .map((name) => ({
    name,
    source: readFileSync(`${directory}${name}`, "utf8").replace(/<#--[\s\S]*?-->/g, ""),
  }));

describe("the templates this theme replaces", () => {
  it("are the shell and nothing else", () => {
    // Everything else — the sign-in form, registration, the reset chain, the
    // error pages — is Keycloak's, styled through `theme.properties`. A second
    // file here would be this repository owning a piece of an authentication
    // flow it did not write and would have to re-check at every upgrade.
    expect(templates.map(({ name }) => name)).toEqual(["template.ftl"]);
  });

  it("ask for no image the build does not draw", () => {
    // The mirror of the extension build's "the manifest is the list": a size the
    // template links and the build does not emit is a 404 on the one page a user
    // cannot skip, and it is invisible until somebody loads it.
    for (const { name, source } of templates) {
      for (const [, path] of source.matchAll(/\$\{url\.resourcesPath\}\/(img\/[\w.-]+)/g)) {
        expect(Object.keys(ICONS), `${name} → ${path}`).toContain(path);
      }
    }
  });

  it("draw the mark at the size they declare, so the browser reserves the right box", () => {
    const [template] = templates;
    expect(template?.source).toMatch(/width="48" height="48"/);
    expect(ICONS["img/logo-48.png"]).toBe(48);
    // And the 2x, which is the whole reason there are two.
    expect(ICONS["img/logo-96.png"]).toBe(2 * 48);
  });

  it("name no class that nothing styles", () => {
    const styled = `${componentCss}\n${loginCss}`;
    for (const { name, source } of templates) {
      for (const [, value] of source.matchAll(/class="([^"]*)"/g)) {
        const literal = (value ?? "").replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean);
        for (const className of literal.filter((one) => /^(mp|login)-/.test(one))) {
          expect(styled, `${name} → ${className}`).toMatch(new RegExp(`\\.${className}\\b`));
        }
      }
    }
  });

  it("hold no copy of the brand, and render the realm's label nowhere", () => {
    for (const { name, source } of templates) {
      // The name arrives as a theme property, generated from `brand.json`. A
      // template that spelled it would be the second copy T48 removed, and this
      // one is committed — so it would also be the copy that survives a rename.
      expect(source, name).not.toContain(brand.name);
      expect(source, name).not.toContain(brand.domain);
      // `realm.displayName` is an administrator's label for the realm: it reads
      // "Marktplaats Relist (development)" on the local stack, and leading a page
      // with "Marktplaats" is what `brand.json` says this product must never do.
      expect(source, name).not.toContain("realm.displayName");
      expect(source, name).not.toContain("loginTitleHtml");
    }
  });
});
