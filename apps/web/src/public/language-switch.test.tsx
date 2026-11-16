// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LANGUAGE_KEY } from "../i18n/choice";
import { words } from "../i18n/words";
import { Site } from "../Site";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NEVER = (): Promise<never> => new Promise(() => {});

let host: HTMLElement;
let root: Root;
let kept: Record<string, string>;

function draw(pathname: string): void {
  act(() =>
    root.render(
      <Site
        pathname={pathname}
        year={2026}
        loadPlans={NEVER}
        languageStore={{ getItem: (key) => kept[key] ?? null, setItem: (key, value) => void (kept[key] = value) }}
      />,
    ),
  );
}

beforeEach(async () => {
  kept = {};
  await words.changeLanguage("nl");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  await words.changeLanguage("nl");
});

const languageSwitch = () => host.querySelector<HTMLButtonElement>(".web-nav button[lang]");
const nav = () => host.querySelector(".web-nav")?.textContent ?? "";

describe("the site's Language switch (T97)", () => {
  it("is in the navigation bar on every page, offering the other Language by its own name", () => {
    for (const page of ["/", "/privacy", "/terms", "/success", "/nowhere"]) {
      draw(page);
      expect(languageSwitch()?.textContent).toBe("EN");
      expect(languageSwitch()?.getAttribute("aria-label")).toBe("English");
      expect(languageSwitch()?.getAttribute("lang")).toBe("en");
    }
  });

  it("turns the page English when pressed, and keeps the choice", () => {
    draw("/terms");
    expect(nav()).toContain("Voorwaarden");

    act(() => languageSwitch()?.click());

    expect(nav()).toContain("Terms");
    expect(host.querySelector(".web-page")?.textContent).not.toContain("de oorspronkelijke advertentie wordt verwijderd");
    expect(kept[LANGUAGE_KEY]).toBe("en");
    expect(languageSwitch()?.textContent).toBe("NL");
    expect(languageSwitch()?.getAttribute("aria-label")).toBe("Nederlands");
  });

  it("turns it back", () => {
    draw("/");
    act(() => languageSwitch()?.click());
    act(() => languageSwitch()?.click());
    expect(kept[LANGUAGE_KEY]).toBe("nl");
    expect(host.textContent).toContain("Zet je advertentie weer bovenaan");
  });
});
