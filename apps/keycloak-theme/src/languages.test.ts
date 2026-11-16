import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loginCss } from "./login/css";
import { themeTypes } from "./theme";

/**
 * Two locales, and the sign-in page offers no choice between them (T96,
 * ADR-0043): it shows the Language it was handed in `ui_locales`, and the
 * dropdown Keycloak's template would draw for a second locale is gone.
 */
const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").replace(/<#--[\s\S]*?-->/g, "");

const SHELLS = {
  login: source("./login/template.ftl"),
  email: source("./email/html/template.ftl"),
};

describe("the theme in two languages", () => {
  it("draws no language dropdown on the sign-in page", () => {
    expect(SHELLS.login).not.toContain("kc-locale");
    expect(SHELLS.login).not.toContain("locale.supported");
    expect(SHELLS.login).not.toContain("language-switch");
  });

  it("and keeps no rules for one", () => {
    expect(loginCss).not.toContain("login-locale");
  });

  it("writes no word of ours into either shell, which would be Dutch on the English page", () => {
    // The footer's link text is a message: the shell is the same file in both.
    for (const [type, shell] of Object.entries(SHELLS)) {
      expect(shell, type).not.toMatch(/>\s*(Voorwaarden|Terms)\s*</);
      expect(shell, type).toContain('msg("mprelistTerms")');
    }
  });

  it.each(themeTypes())("gives $type a bundle per locale, with the same keys in each", ({ messages }) => {
    const keys = (file: string | undefined) => [...(file ?? "").matchAll(/^(\w+)=/gm)].map(([, key]) => key);
    expect(Object.keys(messages).sort()).toEqual(["messages_en.properties", "messages_nl.properties"]);
    expect(keys(messages["messages_en.properties"])).toEqual(keys(messages["messages_nl.properties"]));
  });
});
