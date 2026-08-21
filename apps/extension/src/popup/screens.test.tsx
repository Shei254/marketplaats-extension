import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SignedInScreen, relistsLeft, resetsOn } from "./screens";

const PLAN = {
  subscriptionStatus: "ACTIVE",
  tier: { code: "free", name: "Free" },
  quotaRemaining: 2,
  relistQuotaPerPeriod: 3,
  resetAt: "2026-09-14T08:31:22.101Z",
  features: {},
} as const;

describe("what is left of the plan", () => {
  it("is a fraction, because one number alone says nothing", () => {
    // "2" does not say whether that is nearly all of them or nearly none. The
    // denominator arrived with T32 (#41), which added `relistQuotaPerPeriod` to
    // `/api/me` for exactly this sentence.
    expect(relistsLeft(2, 3)).toBe("2 of 3 relists left");
    expect(relistsLeft(0, 3)).toBe("0 of 3 relists left");
  });

  it("agrees with the grant rather than the remainder", () => {
    expect(relistsLeft(1, 3)).toBe("1 of 3 relists left");
    expect(relistsLeft(1, 1)).toBe("1 of 1 relist left");
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
    expect(markup).toContain("2 of 3 relists left");
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
