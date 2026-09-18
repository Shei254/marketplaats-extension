import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { escapeHtml, readBrand, readIconMaster, resolveJson, resolveTokens } from "./brand.mjs";

/**
 * The brand is provisional until T60 (#91), so the thing worth testing is not
 * which name is in the file — it is that changing it stays a one-file edit, and
 * that a build cannot ship a half-resolved template or a name that would get the
 * listing pulled.
 */

const BRAND = { name: "Bumpr", tagline: "Relist your ads.", domain: "example.test" };

describe("resolveTokens", () => {
  it("replaces every occurrence, not just the first", () => {
    expect(resolveTokens("{{brand.name}} — {{brand.name}}", BRAND)).toBe("Bumpr — Bumpr");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(resolveTokens("{{ brand.name }}", BRAND)).toBe("Bumpr");
  });

  it("throws on a key brand.json does not have, naming it", () => {
    // A typo'd token would otherwise render as the empty string, and "" is a
    // perfectly good product name as far as a JSON file is concerned.
    expect(() => resolveTokens("{{brand.nmae}}", BRAND)).toThrow(/nmae/);
  });

  it("throws on a token it does not recognise rather than leaving it standing", () => {
    // Shipping the literal `{{version}}` to the Web Store is the failure this
    // prevents; a silent pass-through is how it would happen.
    expect(() => resolveTokens("{{version}}", BRAND)).toThrow(/unresolved/);
  });

  it("leaves text with no tokens exactly as it was", () => {
    expect(resolveTokens("plain { not a token } text", BRAND)).toBe("plain { not a token } text");
  });

  it("escapes with the supplied function, for markup", () => {
    expect(resolveTokens("<h1>{{brand.name}}</h1>", { name: 'A & B "C"' }, escapeHtml)).toBe(
      "<h1>A &amp; B &quot;C&quot;</h1>",
    );
  });
});

describe("resolveJson", () => {
  it("resolves strings anywhere in the tree and leaves everything else alone", () => {
    const resolved = resolveJson(
      { name: "{{brand.name}}", version: 3, nested: { list: ["{{brand.domain}}", true, null] } },
      BRAND,
    );
    expect(resolved).toEqual({
      name: "Bumpr",
      version: 3,
      nested: { list: ["example.test", true, null] },
    });
  });

  it("does not escape, since the value is re-serialised by JSON.stringify", () => {
    expect(resolveJson({ n: "{{brand.name}}" }, { name: 'quote " and & amp' })).toEqual({
      n: 'quote " and & amp',
    });
  });
});

describe("escapeHtml", () => {
  it("covers the five characters that change meaning in markup", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("readBrand's contract", () => {
  it("refuses a file missing a required key, rather than shipping the string 'undefined'", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mprelist-brand-"));
    const file = join(dir, "brand.json");
    await writeFile(file, JSON.stringify({ name: "X", domain: "x.test", supportEmail: "a@x.test" }));
    try {
      await expect(readBrand(pathToFileURL(file))).rejects.toThrow(/tagline/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses an empty value as firmly as a missing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mprelist-brand-"));
    const file = join(dir, "brand.json");
    await writeFile(
      file,
      JSON.stringify({ name: "", tagline: "t", domain: "x.test", supportEmail: "a@x.test" }),
    );
    try {
      await expect(readBrand(pathToFileURL(file))).rejects.toThrow(/name/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the real brand.json", () => {
  it("drops $-prefixed keys, which are notes to whoever edits it", async () => {
    const brand = await readBrand();
    expect(Object.keys(brand).some((key) => key.startsWith("$"))).toBe(false);
    expect(brand.name).toBeTruthy();
  });

  it("does not lead the product name with Marktplaats", async () => {
    // Chrome Web Store policy: "don't represent that your product is authorized
    // by, endorsed by, or produced by another company". Marktplaats is Adevinta's
    // mark, and it belongs in the tagline — which is why the tagline may say it
    // and the name may not. Asserted rather than remembered, because the cost of
    // getting it wrong is a rejected listing at T58 (#89).
    const { name } = await readBrand();
    expect(name.toLowerCase()).not.toContain("marktplaats");
  });

  it("resolves every token the manifest template asks for", async () => {
    // Catches a typo'd token at `npm test` rather than at `npm run build`, and
    // catches a brand key deleted out from under a template either way.
    const template = await readFile(new URL("../public/manifest.template.json", import.meta.url), "utf8");
    const brand = await readBrand();
    expect(() => resolveJson(JSON.parse(template), brand)).not.toThrow();
  });

  it("resolves every token popup.html asks for", async () => {
    const popup = await readFile(new URL("../src/popup/popup.html", import.meta.url), "utf8");
    const brand = await readBrand();
    expect(() => resolveTokens(popup, brand, escapeHtml)).not.toThrow();
  });

  it("names an icon master that is there, which is the other half of a one-file rebrand", async () => {
    // The artwork is resized at build time from this one file (T48, #78), so a
    // `brand.icon` pointing at nothing is a build that stops — and a test that
    // only read the string would not have noticed.
    const brand = await readBrand();
    expect((await readIconMaster(brand)).length).toBeGreaterThan(0);
  });

  it("says which path it was, when the artwork is not where the brand says", async () => {
    // The likeliest way to meet this is renaming the file and not the field, and
    // an ENOENT on a URL assembled two functions away is a poor way to be told.
    // No fixture on disk: what is passed is the brand, and the second argument is
    // only the directory the path is resolved against.
    await expect(readIconMaster({ icon: "gone.png" }, pathToFileURL(join(tmpdir(), "brand.json"))))
      .rejects.toThrow(/gone\.png/);
  });
});
