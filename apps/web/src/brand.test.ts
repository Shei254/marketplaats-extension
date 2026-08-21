import { describe, expect, it } from "vitest";

import brandJson from "../../../brand.json";
import { BRAND, resolveBrandTokens } from "./brand";

describe("the brand", () => {
  it("is the root brand.json and not a copy of it", () => {
    // The point of T48 (#78) is that renaming the product is one edit. A literal
    // anywhere in this workspace would be a second place to remember.
    expect(BRAND.name).toBe(brandJson.name);
    expect(BRAND.supportEmail).toBe(brandJson.supportEmail);
  });

  it("carries no `$note`, which is documentation for whoever edits the file", () => {
    expect(Object.keys(BRAND)).toEqual(["name", "tagline", "domain", "supportEmail"]);
  });
});

describe("resolving a template", () => {
  it("replaces every token", () => {
    expect(resolveBrandTokens("<title>{{brand.name}}</title>")).toBe(
      `<title>${BRAND.name}</title>`,
    );
    expect(resolveBrandTokens("{{ brand.domain }} · {{brand.supportEmail}}")).toBe(
      `${BRAND.domain} · ${BRAND.supportEmail}`,
    );
  });

  it("refuses a key brand.json does not have", () => {
    expect(() => resolveBrandTokens("{{brand.slogan}}")).toThrow(/no `slogan`/);
  });

  it("refuses a token left standing", () => {
    // A `<title>` reading `{{brand.name}}` is what a Web Store reviewer would see.
    // Failing the build is cheaper than shipping that quietly.
    expect(() => resolveBrandTokens("{{ brand name }}")).toThrow(/unresolved template token/);
  });
});
