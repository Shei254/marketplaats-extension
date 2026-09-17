import type { IconName } from "@mprelist/ui";

/**
 * The pages the admin corner has, as a table rather than as a switch buried in a
 * component.
 *
 * **This is the file a second page is added in.** A row here is a word in the
 * sidebar, a heading, and the sentence that says what the page is for — so the
 * shell around a page is written once and a page spells none of its own chrome.
 *
 * **There is one row today.** The Stripe prices carrying no tier were briefly a
 * page of their own; they are a warning on the catalog now, because a whole page
 * for a list that is empty on a well-kept account is a door most operators open
 * once. The table stays a table: it is what the second real page costs nothing to
 * add through.
 *
 * **It is not a route table.** There is still no router in this build (see
 * `routes.ts`, and `main.tsx` for why `/admin` is chosen before the public table is
 * consulted); the realm registers the origin root as this client's one redirect
 * URI, so a path under `/admin` is a URL a sign-in cannot come back to. Which page
 * is showing is state in the surface rather than an address, and `ADMIN_PATH`
 * stays the whole of what this corner claims.
 */
export type AdminPageId = "tiers";

export interface AdminPage {
  id: AdminPageId;
  /** The word in the sidebar, which is as short as it can be said. */
  label: string;
  /** The heading the page opens with. */
  title: string;
  /** The sentence under the heading, in the terms of somebody who does not read Java. */
  lede: string;
  /**
   * The sidebar heading this sits under. Two pages share one today; the field is
   * here because the moment there is a page about *people* rather than about the
   * catalog, a flat list of five words stops saying which is which.
   */
  group: string;
  /** From the design canvas's own set — this surface invents no glyphs. */
  icon: IconName;
}

export const ADMIN_PAGES: readonly AdminPage[] = [
  {
    id: "tiers",
    label: "Tiers",
    title: "Tiers",
    lede:
      "Every plan there is — what it costs, how many reposts it buys, and whether people can buy it. " +
      "Amounts are set in Stripe and shown here.",
    group: "Catalog",
    icon: "bolt",
  },
];

/** Where an operator lands, which is the list they came to work in. */
export const DEFAULT_PAGE: AdminPageId = "tiers";

/**
 * One id, one page. Total over the union, so a page added above without a row is a
 * compile error rather than a blank screen.
 */
export function adminPage(id: AdminPageId): AdminPage {
  const found = ADMIN_PAGES.find((page) => page.id === id);
  if (!found) throw new Error(`no admin page called ${id}`);
  return found;
}

/**
 * The sidebar's shape: the pages in the order they are written above, gathered
 * under their group and with the groups in the order they first appear.
 *
 * Order comes from the table rather than from a sort, because the order of a
 * navigation is a decision — the page an operator wants most is first — and not
 * something the alphabet should be making.
 */
export function navGroups(): { group: string; pages: AdminPage[] }[] {
  const groups: { group: string; pages: AdminPage[] }[] = [];
  for (const page of ADMIN_PAGES) {
    const existing = groups.find((candidate) => candidate.group === page.group);
    if (existing) existing.pages.push(page);
    else groups.push({ group: page.group, pages: [page] });
  }
  return groups;
}
