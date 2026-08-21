import { Button, Icon, Note, Skeleton } from "@mprelist/ui";
import type { DisplayState, Plan } from "@mprelist/contracts";
import type { JSX } from "react";

import { grantOf, priceOf, type Handoff, type PlansView } from "./plans";
import { relistsLeft } from "./screens";

/**
 * What can be bought, and the plan they are on (T52, #83).
 *
 * **The conversion click, one step from the locked button.** ADR-0007 keeps the ad
 * list ungated precisely so a locked Repost sits beside the user's own ads, and
 * ADR-0017 puts the plan choice in the popup rather than on a website so that this
 * is one click away rather than a second sign-in on another origin. This is the
 * screen both of those decisions were making room for.
 *
 * The layout and the words are the canvas's (`docs/design/PlanCards.dc.html`),
 * with two departures, both because a card is drawn from what the API says rather
 * than from what the artboard shows:
 *
 * - **No tagline.** "About a dozen ads, bumped weekly" is not something
 *   `GET /api/plans` carries, and a line per tier code hardcoded here would be
 *   wrong for the tier an admin adds (T53, #84) and stale for one they rename.
 * - **The current plan's card carries no amount** unless it is also on sale. A
 *   tier missing from `/api/plans` is either free — no Stripe Price, so nothing to
 *   show — or one that has been withdrawn while its subscribers keep renewing
 *   (ADR-0019), and nothing here can tell those apart. €0 would be right for one
 *   of them and a lie about the other, so it says what it does know instead: what
 *   is left of the plan they are on.
 */
export function PlanCards({
  view,
  current,
  handoff,
  onUpgrade,
  onRetry,
}: {
  view: PlansView;
  /** The plan they are on, so the card they already hold can say so. */
  current: DisplayState;
  /** Which card, if any, is busy opening a tab — and what stopped the last one. */
  handoff: Handoff;
  onUpgrade: (tierCode: string) => void;
  onRetry: () => void;
}): JSX.Element {
  if (view.status === "loading") return <LoadingCards />;
  if (view.status === "failed") {
    return (
      <div className="popup-plans-failed">
        {/* The contract's own words for a `503` here: never a guessed amount, and
            never a card whose button would open a Checkout for one. */}
        <Note tone="warn">Prices couldn’t be loaded just now.</Note>
        <Button shape="rect" tone="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const onSale = view.plans;
  const holdsOneOnSale = onSale.some((plan) => plan.tier.code === current.tier.code);
  return (
    <div className="popup-plans">
      {holdsOneOnSale ? null : <CurrentPlanCard current={current} />}
      {onSale.map((plan) => (
        <PlanCard
          key={plan.tier.code}
          plan={plan}
          current={plan.tier.code === current.tier.code}
          handoff={handoff}
          onUpgrade={onUpgrade}
        />
      ))}
      {onSale.length === 0 ? (
        // Not a failure: nothing is on sale, which is every stack whose Stripe
        // Prices have not been created yet (T22, #28).
        <p className="popup-plans-empty">There are no paid plans on offer right now.</p>
      ) : null}
    </div>
  );
}

/**
 * The plan they are on when nobody can buy it — the free tier, and any tier taken
 * off sale under the people already on it.
 *
 * It is first, as the canvas draws it, and it is inert: there is nothing to buy
 * here and the button says so rather than being absent, so the cards below it read
 * as a row of comparable things.
 */
function CurrentPlanCard({ current }: { current: DisplayState }): JSX.Element {
  return (
    <div className="popup-plan-card popup-plan-card--current">
      <div className="popup-plan-card-head">
        <span className="popup-plan-card-name">{current.tier.name}</span>
        <span className="popup-plan-card-pill">Current</span>
      </div>
      <p className="popup-plan-card-grant">
        {relistsLeft(current.quotaRemaining, current.relistQuotaPerPeriod)}
      </p>
      <Button shape="block" tone="done" aria-label={`${current.tier.name} is your plan`}>
        Your plan
      </Button>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  handoff,
  onUpgrade,
}: {
  plan: Plan;
  current: boolean;
  handoff: Handoff;
  onUpgrade: (tierCode: string) => void;
}): JSX.Element {
  const opening = handoff.kind === "opening";
  const openingThis = opening && handoff.what === plan.tier.code;
  return (
    <div className={current ? "popup-plan-card popup-plan-card--current" : "popup-plan-card"}>
      <div className="popup-plan-card-head">
        <span className="popup-plan-card-name">{plan.tier.name}</span>
        {current ? <span className="popup-plan-card-pill">Current</span> : null}
        <span className="popup-plan-card-price">{priceOf(plan.price)}</span>
      </div>
      <p className="popup-plan-card-grant">{grantOf(plan)}</p>
      {current ? (
        <Button shape="block" tone="done" aria-label={`${plan.tier.name} is your plan`}>
          Your plan
        </Button>
      ) : (
        <Button
          shape="block"
          // Every other card locks while one is opening: two Checkout tabs from
          // two clicks is two sessions and one confused buyer, and the popup is
          // about to be destroyed by the first anyway.
          tone={openingThis ? "busy" : opening ? "locked" : "primary"}
          onClick={() => onUpgrade(plan.tier.code)}
        >
          {openingThis ? "Opening…" : "Upgrade"}
          {openingThis || opening ? null : <Icon name="external" size={13} />}
        </Button>
      )}
    </div>
  );
}

/** The shape of the answer rather than a spinner, like the loading screen above it. */
function LoadingCards(): JSX.Element {
  return (
    <div className="popup-plans">
      {[0, 1].map((card) => (
        <div className="popup-plan-card" key={card}>
          <div className="popup-plan-card-head">
            <Skeleton width={54} height={13} />
            <Skeleton width={44} height={13} />
          </div>
          <Skeleton width={110} height={11} />
          <Skeleton width="100%" height={30} shape="pill" />
        </div>
      ))}
    </div>
  );
}
