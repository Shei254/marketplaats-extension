import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DisplayState, Plan } from "@mprelist/contracts";

import { PlanCards } from "./PlanCards";
import { NOT_OPENING, type PlansView } from "./plans";
import { NoTierScreen, OutdatedScreen, SignedInScreen, repostsLeft, resetsOn } from "./screens";

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
    expect(repostsLeft(2, 3)).toBe("2 van 3 herplaatsingen over");
    expect(repostsLeft(0, 3)).toBe("0 van 3 herplaatsingen over");
  });

  it("agrees with the grant rather than the remainder", () => {
    expect(repostsLeft(1, 3)).toBe("1 van 3 herplaatsingen over");
    expect(repostsLeft(1, 1)).toBe("1 van 1 herplaatsing over");
  });
});

describe("when the quota comes back", () => {
  it("reads as a day and a month", () => {
    expect(resetsOn("2026-09-14T08:31:22.101Z")).toBe("Reset op 14 sep");
  });

  it("says nothing at all when the date cannot be read", () => {
    // A strip reading `resets Invalid Date` is worse than one that says only what
    // it knows.
    expect(resetsOn("not-a-date")).toBe("");
    expect(resetsOn("")).toBe("");
  });
});

describe("the plan strip", () => {
  const render = (quotaRemaining: number) => renderPlan({ quotaRemaining });

  const renderPlan = (plan: Partial<DisplayState>) =>
    renderToStaticMarkup(
      <SignedInScreen
        plan={{ ...PLAN, ...plan }}
        onRefresh={() => {}}
        onSignOut={() => {}}
        onSeePlans={() => {}}
        onManageBilling={() => {}}
        handoff={NOT_OPENING}
        busy={false}
      />,
    );

  it("names the tier as the operator spells it, beside what is left", () => {
    const markup = render(2);
    expect(markup).toContain('<span class="popup-plan-name">Free</span>');
    expect(markup).toContain("2 van 3 herplaatsingen over");
    expect(markup).toContain("Reset op 14 sep");
  });

  it("turns when there is nothing left, so the strip itself carries the news", () => {
    expect(render(0)).toContain("popup-plan--spent");
    expect(render(1)).not.toContain("popup-plan--spent");
  });

  it("offers refresh, the plans and sign-out, which is the whole of what this screen does", () => {
    // "Abonnementen" arrived with T52 (#83) and is the second departure from the canvas,
    // for the reason the file's docstring gives: without a way in that does not
    // depend on being out of relists, a paying subscriber could never reach their
    // own billing — and ADR-0017 makes this popup the account surface.
    const markup = render(2);
    expect(markup).toContain('aria-label="Vernieuwen"');
    expect(markup).toContain("Abonnementen");
    expect(markup).toContain("Uitloggen");
  });

  it("puts the way to the plans on the prompt as well, once the quota is spent", () => {
    // Beside the ad list, which ADR-0007 leaves ungated precisely so the
    // conversion click is next to the user's own locked ads.
    expect(render(0)).toContain("Bekijk abonnementen");
    expect(render(2)).not.toContain("Bekijk abonnementen");
  });

  describe("on a tier with no cap (T73, ADR-0029)", () => {
    const unlimited = renderPlan({ quotaRemaining: null, relistQuotaPerPeriod: null });

    it("says so instead of a fraction", () => {
      expect(unlimited).toContain('<span class="popup-plan-name">Free</span>');
      expect(unlimited).toContain("Onbeperkt herplaatsen");
      expect(unlimited).not.toContain("reposts left");
    });

    it("draws no bar, because a proportion needs a ceiling", () => {
      // A permanently full bar is decoration shaped like data: identical after
      // five hundred reposts and after none.
      expect(unlimited).not.toContain("mp-meter");
      expect(render(2)).toContain("mp-meter");
    });

    it("and no reset date, which would invite the reader to believe there is a limit", () => {
      expect(unlimited).not.toContain("Reset op 14 sep");
    });

    it("is never the spent strip, however much has been reposted", () => {
      expect(unlimited).not.toContain("popup-plan--spent");
      expect(unlimited).not.toContain("Bekijk abonnementen");
    });
  });

  describe("on a tier that grants nothing (T73, ADR-0029)", () => {
    const nothing = renderPlan({ quotaRemaining: 0, relistQuotaPerPeriod: 0 });

    it("reads as a plan without reposts rather than as one that has run out", () => {
      expect(nothing).toContain("Geen herplaatsingen in dit abonnement");
      expect(nothing).not.toContain("0 of 0");
    });

    it("promises no date, because nothing comes back on it", () => {
      // The prompt used to tell its holder their reposts "come back on 14 Sep"
      // when they come back as 0. The strip's own "Reset op 14 sep" is the same
      // promise in fewer words, so it goes with it.
      expect(nothing).not.toContain("Reset op 14 sep");
      expect(nothing).not.toContain("They come back");
    });

    it("says the same thing when a card is failing, because the grant is the reason", () => {
      // Reachable the way ADR-0029 says it is: a tier may be zeroed under the
      // people already on it, and one of them may have a failing card. "0 herplaatsingen"
      // beside a dunning prompt blames the card for a nothing the plan chose.
      const failing = renderPlan({
        quotaRemaining: 0,
        relistQuotaPerPeriod: 0,
        subscriptionStatus: "PAST_DUE",
      });

      expect(failing).toContain("Geen herplaatsingen in dit abonnement");
      expect(failing).not.toContain("0 herplaatsingen");
    });

    it("still points at the plans, which is the one thing that changes it", () => {
      expect(nothing).toContain("Bekijk abonnementen");
    });

    it("and still wears the warning strip, because there is still nothing to spend", () => {
      // Not exhausted, and exactly as unusable — a strip drawn as ordinary above a
      // list of locked buttons is a screen that looks fine and is not.
      expect(nothing).toContain("popup-plan--spent");
    });
  });
});

describe("the update screen", () => {
  const markup = renderToStaticMarkup(<OutdatedScreen />);

  it("says the build is the problem, and names the product doing the saying", () => {
    expect(markup).toContain("moet worden bijgewerkt");
    expect(markup).toContain("AdBump");
  });

  it("offers no button, because there is nothing a button could do", () => {
    // Every other screen here hands the user their next move. This one has none:
    // the extension cannot update itself and a retry cannot help, so it says what
    // will fix it — Chrome, within a few hours — instead of miming a control.
    expect(markup).not.toContain("<button");
  });

  it("says the ads are untouched, which is what somebody locked out most needs to read", () => {
    expect(markup).toContain("Er is niets gewijzigd op Marktplaats");
  });
});

describe("the no-plan screen", () => {
  const PRO: Plan = {
    tier: { code: "pro", name: "Pro" },
    relistQuotaPerPeriod: 50,
    features: {},
    prices: [{ amount: 999, currency: "eur", interval: "month" }],
  };
  const noTier = (view: PlansView): string =>
    renderToStaticMarkup(
      <NoTierScreen view={view}>
        <PlanCards view={view} current={null} handoff={NOT_OPENING} onUpgrade={() => {}} onRetry={() => {}} />
      </NoTierScreen>,
    );
  const markup = noTier({ status: "ready", plans: [PRO], paymentMethods: [] });

  it("says the plan is gone rather than that something went wrong", () => {
    // T77 (ADR-0032). The backend answered promptly and truthfully, so the one
    // thing this must not do is describe an outage — which is what every build
    // shipped before this one renders for the same denial.
    expect(markup).toContain("geen abonnement");
    expect(markup).not.toContain("Probeer het zo opnieuw");
  });

  it("offers the catalog, because subscribing is the one thing that does help", () => {
    // This reverses T77's original reading of the screen, and the reason it can is
    // that T77's own argument against it was conditional: pointing somebody at the
    // cards "would be offering a catalog that may be empty". Where it is not
    // empty, buying a plan is precisely the user's way out — and it is *their* way
    // out rather than a wait on an operator, which is what the old screen said.
    expect(markup).toContain("Pro");
    expect(markup).toContain("popup-plan-card");
    expect(markup).toContain("<button");
  });

  it("and marks no card as the one they are on, because they are on none", () => {
    // The whole state is "this account has no tier", so a Huidig badge would be a
    // claim the screen exists to deny — and `CurrentPlanCard` would have nothing
    // to draw a grant line from.
    expect(markup).not.toContain("Huidig");
    expect(markup).not.toContain("Je abonnement");
  });

  it("but says to wait when the catalog really is empty, offering no button", () => {
    // The state T77 was right about, and the reason the cards are conditional
    // rather than unconditional: deleting the last tier is a supported act, and
    // then there is genuinely nothing for either of them to do. This is the only
    // branch where "opnieuw proberen helpt niet" is still true.
    const empty = noTier({ status: "ready", plans: [], paymentMethods: [] });

    expect(empty).toContain("opnieuw proberen helpt niet");
    expect(empty).not.toContain("<button");
    expect(empty).not.toContain("popup-plan-card");
  });

  it("and says nothing about waiting while there is something to buy", () => {
    // The two halves are exclusive. Telling somebody to sit tight directly above a
    // row of buy buttons is the screen contradicting itself.
    expect(markup).not.toContain("opnieuw proberen helpt niet");
  });

  it("says the ads are untouched, like every other screen somebody is locked out of", () => {
    expect(markup).toContain("Er is niets gewijzigd op Marktplaats");
  });

  it("sells nothing, because the catalog it would point at may be empty", () => {
    expect(markup).not.toContain("Bekijk abonnementen");
  });
});
