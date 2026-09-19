import { describe, expect, it } from "vitest";

import { propertiesFile } from "./properties";

describe("a theme.properties file", () => {
  it("writes one key per line", () => {
    expect(propertiesFile({ parent: "base", styles: "css/login.css" })).toBe(
      "parent=base\nstyles=css/login.css\n",
    );
  });

  it("escapes every character outside ASCII, whatever charset Java reads the file as", () => {
    // `brand.tagline` carries "één". `java.util.Properties.load(InputStream)` is
    // ISO-8859-1 and the same file read through a UTF-8 Reader is not, so a raw
    // `é` is one of two different strings depending on which Keycloak uses. A
    // `\uXXXX` escape is the one spelling both readings agree on.
    expect(propertiesFile({ brandTagline: "met één klik" })).toBe(
      "brandTagline=met \\u00e9\\u00e9n klik\n",
    );
  });

  it("escapes the characters that would otherwise end the value or start a comment", () => {
    expect(propertiesFile({ a: "x=y", b: "x:y", c: "x#y", d: "x!y", e: "c:\\tmp" })).toBe(
      "a=x\\=y\nb=x\\:y\nc=x\\#y\nd=x\\!y\ne=c\\:\\\\tmp\n",
    );
  });

  it("escapes a newline rather than writing a second line nothing reads as one", () => {
    expect(propertiesFile({ a: "one\ntwo" })).toBe("a=one\\ntwo\n");
  });
});
