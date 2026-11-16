// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LANGUAGE_KEY } from "../i18n/choice";
import { words } from "../i18n/words";
import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import { Header } from "./screens";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let chrome: ChromeStub;
let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  chrome = installChromeStub();
  await words.changeLanguage("nl");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Header />));
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  chrome.restore();
  await words.changeLanguage("nl");
});

const languageSwitch = () => host.querySelector<HTMLButtonElement>("button[lang]");
const themeSwitch = () => host.querySelector<HTMLButtonElement>("button:not([lang])");

describe("the popup's Language switch (T97)", () => {
  it("sits in the header beside the theme switch, offering the other Language by its own name", () => {
    expect(languageSwitch()?.textContent).toBe("EN");
    expect(languageSwitch()?.getAttribute("aria-label")).toBe("English");
    expect(languageSwitch()?.getAttribute("lang")).toBe("en");
    expect(languageSwitch()?.nextElementSibling).toBe(themeSwitch());
  });

  it("changes the popup's words when pressed, and keeps the choice where every context reads it", async () => {
    expect(themeSwitch()?.getAttribute("aria-label")).toBe("Donkere modus");

    await act(async () => languageSwitch()?.click());

    expect(themeSwitch()?.getAttribute("aria-label")).toBe("Dark mode");
    expect(chrome.area[LANGUAGE_KEY]).toBe("en");
    expect(languageSwitch()?.textContent).toBe("NL");
    expect(languageSwitch()?.getAttribute("aria-label")).toBe("Nederlands");
  });

  it("follows a change of Language made anywhere else", async () => {
    await act(async () => void words.changeLanguage("en"));
    expect(languageSwitch()?.textContent).toBe("NL");
  });
});
