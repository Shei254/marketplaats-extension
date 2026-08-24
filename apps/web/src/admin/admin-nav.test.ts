import { iconNames } from "@mprelist/ui";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, adminPage, DEFAULT_PAGE, navGroups } from "./admin-nav";

/**
 * The page table, held to the things a sidebar breaks quietly on: a duplicate id,
 * a glyph this design system does not draw, a group order the alphabet decided.
 */
describe("the admin pages", () => {
  it("are addressed by an id nothing else claims", () => {
    const ids = ADMIN_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("and every one of them is reachable from its id", () => {
    for (const page of ADMIN_PAGES) {
      expect(adminPage(page.id)).toBe(page);
    }
  });

  it("open on the catalog, which is what an operator came here to work in", () => {
    expect(DEFAULT_PAGE).toBe("tiers");
    expect(ADMIN_PAGES[0]?.id).toBe(DEFAULT_PAGE);
  });

  it("draw themselves out of the canvas's own icon set", () => {
    // A name this package does not draw renders nothing at all — an entry with a
    // hole where its glyph goes, on a sidebar that otherwise looks fine.
    for (const page of ADMIN_PAGES) {
      expect(iconNames, page.id).toContain(page.icon);
    }
  });

  it("say what they are for in a sentence, since the shell prints one for every page", () => {
    for (const page of ADMIN_PAGES) {
      expect(page.title.length, page.id).toBeGreaterThan(0);
      expect(page.lede.length, page.id).toBeGreaterThan(0);
    }
  });
});

describe("the sidebar's groups", () => {
  it("come in the order the table writes them, not the order the alphabet would", () => {
    // The order of a navigation is a decision — the page an operator wants most is
    // first — and not something a sort should be making.
    expect(navGroups().flatMap(({ pages }) => pages.map((page) => page.id))).toEqual(
      ADMIN_PAGES.map((page) => page.id),
    );
  });

  it("and every page appears under exactly one of them", () => {
    const groups = navGroups();
    expect(groups.flatMap(({ pages }) => pages)).toHaveLength(ADMIN_PAGES.length);
    expect(new Set(groups.map(({ group }) => group)).size).toBe(groups.length);
  });
});
