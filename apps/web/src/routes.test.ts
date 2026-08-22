import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isAdminPath, isDocument, PATHS, pageFor } from "./routes";

/**
 * The other copy of the three paths Stripe is given, read out of the working tree
 * — the same arrangement `packages/contracts` has with the API's own enums, and
 * for the same reason: a restatement that agrees only with itself proves nothing.
 *
 * Java holds `/success`, `/cancel` and `/billing` because it is what builds a
 * Checkout session's URLs and the Customer Portal's `return_url`; nothing is
 * shared between the two languages, and nothing fetches these paths, so a rename
 * on one side is silent until somebody who has just paid lands on a blank page.
 */
const WEB_PAGES_JAVA = "../../api/src/main/java/com/mprelist/billing/internal/WebPages.java";

const webPagesJava = readFileSync(fileURLToPath(new URL(WEB_PAGES_JAVA, import.meta.url)), "utf8");

describe("the route table", () => {
  it("answers the three paths Stripe is given", () => {
    // These three strings are also in a Stripe API call — two in a Checkout
    // session (T19, #29) and one as the Customer Portal's `return_url` (T21, #31).
    // That is why they are exported: the copy in `apps/api` is the one that has to
    // agree, and a rename that only happened here would be found by a customer.
    expect(pageFor(PATHS.success)).toBe("success");
    expect(pageFor(PATHS.cancel)).toBe("cancel");
    expect(pageFor(PATHS.billing)).toBe("billing");
  });

  it("answers every path `apps/api` sends a browser back to", () => {
    // Both directions in one assertion: a path renamed here is no longer answered,
    // and a fourth added there without a page here is answered by nothing either.
    const sent = [...webPagesJava.matchAll(/baseUrl \+ "([^"]+)"/g)].map(([, p]) => p as string);

    expect(sent.length, "no paths found in WebPages.java — the guard stopped looking").toBe(3);
    for (const path of sent) {
      expect(pageFor(path), path).not.toBe("not-found");
    }
  });

  it("and the two documents, one of which the Web Store will publish", () => {
    // `/privacy` goes into the Chrome Web Store listing (T58, #89). Once it is
    // there the address is printed somewhere we do not control, so this is a
    // string to choose and then leave alone.
    expect(PATHS).toEqual({
      success: "/success",
      cancel: "/cancel",
      billing: "/billing",
      privacy: "/privacy",
      terms: "/terms",
    });
    expect(pageFor(PATHS.privacy)).toBe("privacy");
    expect(pageFor(PATHS.terms)).toBe("terms");
  });

  it("knows which pages are documents and which are one sentence", () => {
    expect(isDocument("privacy")).toBe(true);
    expect(isDocument("terms")).toBe(true);
    expect(isDocument("success")).toBe(false);
    expect(isDocument("billing")).toBe(false);
    expect(isDocument("not-found")).toBe(false);
  });

  it("reads a trailing slash as the same address", () => {
    // Hosts and browsers add one; Stripe redirects to whatever it was given.
    expect(pageFor("/success/")).toBe("success");
    expect(pageFor("/cancel//")).toBe("cancel");
    expect(pageFor("/billing/")).toBe("billing");
  });

  it("has nothing at the root, deliberately", () => {
    // There is no landing page on the canvas, and inventing one is a decision for
    // the ticket that also writes the Web Store listing (T58, #89).
    expect(pageFor("/")).toBe("not-found");
  });

  it("gives an address nobody claimed a page rather than a blank screen", () => {
    // The visitor most likely to arrive at a mistyped URL here is somebody who
    // just paid, which is the whole reason this is a page and not an empty root.
    expect(pageFor("/succes")).toBe("not-found");
    expect(pageFor("")).toBe("not-found");
  });

  it("and still answers `not-found` for `/admin`, which is a surface and not a page", () => {
    // T54 (#85) made the admin corner its own surface — its own frame, its own
    // stylesheet, and the only authentication in this bundle (ADR-0017) — chosen
    // by the entry point *before* this table is consulted. Keeping it out of the
    // table is what lets a reader trust the sentence `Page` is named for: every
    // page in it is public.
    expect(pageFor("/admin")).toBe("not-found");
    expect(isAdminPath("/admin")).toBe(true);
  });

  it("reads the admin corner at its own address, trailing slash and all", () => {
    expect(isAdminPath("/admin/")).toBe(true);
    expect(isAdminPath("/admin/tiers")).toBe(false);
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/administrators")).toBe(false);
  });

  it("is case-sensitive, like the paths it is handed", () => {
    expect(pageFor("/Success")).toBe("not-found");
  });
});
