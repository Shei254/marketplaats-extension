import { describe, expect, it } from "vitest";

import { applyStoredTheme, chooseTheme, effectiveTheme, otherTheme, storedTheme, THEME_KEY, type ThemeStore } from "./theme";

function store(initial: Record<string, string> = {}): ThemeStore & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

const refusing: ThemeStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

function root(): HTMLElement & { attributes_: Record<string, string> } {
  const attributes_: Record<string, string> = {};
  return {
    attributes_,
    setAttribute: (name: string, value: string) => {
      attributes_[name] = value;
    },
  } as unknown as HTMLElement & { attributes_: Record<string, string> };
}

describe("what was chosen", () => {
  it("is nothing until the switch is used", () => {
    expect(storedTheme(store())).toBeNull();
  });

  it("is nothing when the stored value is not a theme", () => {
    expect(storedTheme(store({ [THEME_KEY]: "sepia" }))).toBeNull();
  });

  it("is nothing when the store cannot be read, or is not there", () => {
    expect(storedTheme(refusing)).toBeNull();
    expect(storedTheme(undefined)).toBeNull();
  });

  it("is what the switch last set", () => {
    const kept = store();
    chooseTheme("dark", root(), kept);

    expect(storedTheme(kept)).toBe("dark");
  });
});

describe("the theme on screen", () => {
  it("follows the system while nothing is chosen", () => {
    expect(effectiveTheme(null, true)).toBe("dark");
    expect(effectiveTheme(null, false)).toBe("light");
  });

  it("is the choice, whichever way the system points", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });

  it("switches to the other one", () => {
    expect(otherTheme("dark")).toBe("light");
    expect(otherTheme("light")).toBe("dark");
  });
});

describe("the document", () => {
  it("is pinned by a choice, even when the choice cannot be kept", () => {
    const element = root();
    chooseTheme("light", element, refusing);

    expect(element.attributes_).toEqual({ "data-mp-theme": "light" });
  });

  it("opens pinned to a remembered choice", () => {
    const element = root();
    applyStoredTheme(element, store({ [THEME_KEY]: "dark" }));

    expect(element.attributes_).toEqual({ "data-mp-theme": "dark" });
  });

  it("is left to the system when nothing is remembered", () => {
    const element = root();
    applyStoredTheme(element, store());

    expect(element.attributes_).toEqual({});
  });
});
