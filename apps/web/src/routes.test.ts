import { describe, expect, it } from "vitest";

import { isDocument, PATHS, pageFor } from "./routes";

describe("the route table", () => {
  it("answers the two paths Stripe is given", () => {
    // These two strings are also in a Stripe Checkout session (T19, #29). That is
    // why they are exported: the copy in `apps/api` is the one that has to agree,
    // and a rename that only happened here would be found by a customer.
    expect(pageFor(PATHS.success)).toBe("success");
    expect(pageFor(PATHS.cancel)).toBe("cancel");
  });

  it("and the two documents, one of which the Web Store will publish", () => {
    // `/privacy` goes into the Chrome Web Store listing (T58, #89). Once it is
    // there the address is printed somewhere we do not control, so this is a
    // string to choose and then leave alone.
    expect(PATHS).toEqual({
      success: "/success",
      cancel: "/cancel",
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
    expect(isDocument("not-found")).toBe(false);
  });

  it("reads a trailing slash as the same address", () => {
    // Hosts and browsers add one; Stripe redirects to whatever it was given.
    expect(pageFor("/success/")).toBe("success");
    expect(pageFor("/cancel//")).toBe("cancel");
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
    expect(pageFor("/admin")).toBe("not-found");
    expect(pageFor("")).toBe("not-found");
  });

  it("is case-sensitive, like the paths it is handed", () => {
    expect(pageFor("/Success")).toBe("not-found");
  });
});
