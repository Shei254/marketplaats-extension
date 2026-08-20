import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedInScreen, relistsLeft, resetsOn } from "./screens";

const PLAN = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 2,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
} as const;

describe("what is left of the plan", () => {
  it("counts down in the plural the number needs", () => {
    expect(relistsLeft(2)).toBe("2 relists left");
    expect(relistsLeft(1)).toBe("1 relist left");
  });

  it("says none rather than zero", () => {
    expect(relistsLeft(0)).toBe("no relists left");
  });

  it("is what is left and not a fraction, because the total is not in the answer", () => {
    // The canvas draws "3 of 3". `GET /api/me` carries `quotaRemaining` and never
    // what the tier grants, so the denominator is a number this popup does not
    // have — closing that gap is a contract change (noted on T32, #41), not
    // something to guess at here.
    expect(relistsLeft(3)).not.toContain(" of ");
  });
});

describe("when the quota comes back", () => {
  it("reads as a day and a month", () => {
    expect(resetsOn("2026-09-14T08:31:22.101Z")).toBe("resets 14 Sep");
  });

  it("says nothing at all when the date cannot be read", () => {
    // A strip reading `resets Invalid Date` is worse than one that says only what
    // it knows.
    expect(resetsOn("not-a-date")).toBe("");
    expect(resetsOn("")).toBe("");
  });
});

describe("the plan strip", () => {
  const render = (quotaRemaining: number) =>
    renderToStaticMarkup(
      <SignedInScreen
        plan={{ ...PLAN, quotaRemaining }}
        onRefresh={() => {}}
        onSignOut={() => {}}
        busy={false}
      />,
    );

  it("names the tier as the operator spells it, beside what is left", () => {
    const markup = render(2);
    expect(markup).toContain("<b>Free</b>");
    expect(markup).toContain("2 relists left");
    expect(markup).toContain("resets 14 Sep");
  });

  it("turns when there is nothing left, so the strip itself carries the news", () => {
    expect(render(0)).toContain("popup-plan--spent");
    expect(render(1)).not.toContain("popup-plan--spent");
  });

  it("offers refresh and sign-out, which is the whole of what this screen does", () => {
    const markup = render(2);
    expect(markup).toContain('aria-label="Refresh"');
    expect(markup).toContain("Sign out");
  });
});
