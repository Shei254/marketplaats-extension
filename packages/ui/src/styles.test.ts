import { describe, expect, it } from "vitest";

import { componentCss, uiCss } from "./styles";
import { themeCss } from "./theme";

const declared = new Set([...themeCss.matchAll(/(--mp-[\w-]+)\s*:/g)].map(([, name]) => name));
const referenced = [...componentCss.matchAll(/var\((--mp-[\w-]+)\)/g)].map(([, name]) => name);

describe("the component rules", () => {
  it("reference no custom property the theme does not declare", () => {
    // This is the failure worth a test: a rule reaching for `--mp-acccent` does
    // not throw and does not warn. It renders transparent, and the button that
    // was meant to be the only blue thing on the screen simply is not there.
    for (const name of new Set(referenced)) {
      expect(declared, name).toContain(name);
    }
  });

  it("spell no colour of their own", () => {
    expect(componentCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("cover every tone and shape the components can ask for", () => {
    for (const tone of ["primary", "secondary", "retry", "locked", "busy", "done", "cooldown"]) {
      expect(componentCss, tone).toContain(`.mp-btn--${tone}`);
    }
    for (const shape of ["pill", "rect", "block"]) {
      expect(componentCss, shape).toContain(`.mp-btn--${shape}`);
    }
    for (const tone of ["ok", "warn", "error"]) {
      expect(componentCss, tone).toContain(`.mp-note--${tone}`);
    }
  });

  it("give the error note a background of its own", () => {
    // The one place the canvas corrects the POC rather than copying it:
    // popup.html renders error notes on the *warning* background.
    expect(componentCss).toContain(".mp-note--error { color: var(--mp-err); background: var(--mp-err-bg); }");
  });

  it("slow the spinner down under reduced motion rather than stopping it", () => {
    expect(componentCss).toContain("@keyframes mp-spin");
    expect(componentCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-duration: var\(--mp-spin-reduced\);/s,
    );
  });

  it("namespace every class, because they have to survive a stranger's page", () => {
    // T41 (#50) injects this into marktplaats.nl. A bare `.note` there is not our
    // note for long.
    for (const [, selector] of componentCss.matchAll(/^\.([\w-]+)/gm)) {
      expect(selector, selector).toMatch(/^mp-/);
    }
  });
});

describe("uiCss", () => {
  it("is the properties and the rules that read them, in that order", () => {
    expect(uiCss.indexOf(themeCss)).toBe(0);
    expect(uiCss).toContain(componentCss);
  });

  it("is well-formed, since half of it is generated and CSS fails quietly", () => {
    // A stylesheet with an unbalanced brace loses everything after it, and a
    // token that resolved to nothing emits `--mp-x: undefined;`. Neither throws,
    // neither warns, and both are invisible until somebody looks at the screen.
    expect(countOf(uiCss, "{")).toBe(countOf(uiCss, "}"));
    expect(uiCss).not.toMatch(/\b(undefined|null|NaN|\[object Object\])\b/);
  });
});

const countOf = (text: string, character: string): number =>
  text.split(character).length - 1;
