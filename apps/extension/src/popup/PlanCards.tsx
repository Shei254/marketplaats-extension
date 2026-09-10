import { Badge, Button, Icon, Note, Skeleton } from "@mprelist/ui";
import type { DisplayState, Plan, PlanPrice } from "@mprelist/contracts";
import type { JSX } from "react";

import { grantOf, priceAndRhythmOf, type Handoff, type PlansView } from "./plans";
import { grantLine } from "./screens";

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
  onUpgrade: (tierCode: string, interval: string) => void;
  onRetry: () => void;
}): JSX.Element {
  if (view.status === "loading") return <LoadingCards />;
  if (view.status === "failed") {
    return (
      <div className="popup-plans-failed">
        {/* The contract's own words for a `503` here: never a guessed amount, and
            never a card whose button would open a Checkout for one. */}
        <Note tone="warn">De prijzen konden nu niet worden geladen.</Note>
        <Button shape="rect" tone="secondary" onClick={onRetry}>
          Opnieuw proberen
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
        <p className="popup-plans-empty">Er zijn op dit moment geen betaalde abonnementen beschikbaar.</p>
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
        <Badge tone="accent">Huidig</Badge>
      </div>
      <p className="popup-plan-card-grant">{grantLine(current)}</p>
      <Button shape="block" tone="done" aria-label={`${current.tier.name} is je abonnement`}>
        Je abonnement
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
  onUpgrade: (tierCode: string, interval: string) => void;
}): JSX.Element {
  const opening = handoff.kind === "opening";
  return (
    <div className={current ? "popup-plan-card popup-plan-card--current" : "popup-plan-card"}>
      <div className="popup-plan-card-head">
        <span className="popup-plan-card-name">{plan.tier.name}</span>
        {current ? <Badge tone="accent">Huidig</Badge> : null}
      </div>
      {/* The quota, described in the rhythm of the first price — which is the
          cheapest, and the one somebody reads the card by. */}
      <p className="popup-plan-card-grant">{grantOf(plan, plan.prices[0]?.interval ?? "month")}</p>
      {current ? (
        <Button shape="block" tone="done" aria-label={`${plan.tier.name} is je abonnement`}>
          Je abonnement
        </Button>
      ) : (
        /*
         * One button per rhythm (T62, #128), each saying its own amount.
         *
         * A toggle above the cards was the other shape and is worse here: plans
         * need not offer the same rhythms — one may be monthly-only — and a global
         * switch would hide those rather than showing what each is actually sold
         * at. Two buttons also put the two amounts side by side, which is the
         * comparison somebody is making.
         */
        plan.prices.map((price, index) => (
          <RhythmButton
            key={price.interval}
            plan={plan}
            price={price}
            handoff={handoff}
            opening={opening}
            // The first rhythm is the card's own decision and the rest are its
            // alternative. Two full-width slabs of accent read as one control cut
            // in half; a primary and a secondary read as a choice with a default.
            // Which is first is `/api/plans`'s order, and that is the cheapest.
            alternative={index > 0}
            onUpgrade={onUpgrade}
          />
        ))
      )}
    </div>
  );
}

/** One rhythm's button: what it costs, how often, and what happens when it is pressed. */
function RhythmButton({
  plan,
  price,
  handoff,
  opening,
  alternative = false,
  onUpgrade,
}: {
  plan: Plan;
  price: PlanPrice;
  handoff: Handoff;
  opening: boolean;
  /** Not the first rhythm this plan is sold at, so it is offered rather than urged. */
  alternative?: boolean;
  onUpgrade: (tierCode: string, interval: string) => void;
}): JSX.Element {
  // Keyed by tier *and* rhythm, so the button that was clicked is the one that
  // says "Opening…" — a plan with two of them would otherwise light both.
  const openingThis = opening && handoff.kind === "opening" && handoff.what === buying(plan, price);
  return (
    <Button
      shape="block"
      // Every other button locks while one is opening: two Checkout tabs from two
      // clicks is two sessions and one confused buyer, and the popup is about to be
      // destroyed by the first anyway.
      tone={openingThis ? "busy" : opening ? "locked" : alternative ? "secondary" : "primary"}
      onClick={() => onUpgrade(plan.tier.code, price.interval)}
    >
      {openingThis ? "Bezig met openen…" : priceAndRhythmOf(price)}
      {openingThis || opening ? null : <Icon name="external" size={13} />}
    </Button>
  );
}

/** What `Handoff.what` holds while one rhythm of one plan is opening. */
export function buying(plan: Plan, price: PlanPrice): string {
  return `${plan.tier.code}:${price.interval}`;
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
