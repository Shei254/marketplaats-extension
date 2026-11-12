import { Badge, Button, Icon, Note, Skeleton } from "@mprelist/ui";
import {
  dayOf,
  dueToday,
  freshPeriodLine,
  fromRenewalLine,
  grantOf,
  isInDunning,
  PAY_THE_OPEN_INVOICE_FIRST,
  pendingLine,
  priceAndRhythmOf,
  SWITCH_AT_RENEWAL,
  SWITCHED_TODAY,
  UNDO_FAILED,
  type DisplayState,
  type Plan,
  type PlanPrice,
} from "@mprelist/contracts";
import { useEffect, useRef, useState, type JSX } from "react";

import type { SwitchAnswer } from "../api/subscribing";
import type { Handoff, PlansView } from "./plans";
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
  switching,
}: {
  view: PlansView;
  /**
   * The plan they are on, so the card they already hold can say so — and `null`
   * where they are on none at all (T77, ADR-0032).
   *
   * A tier-less account is not "on the free tier" and must not be drawn as though
   * it were: there is no name to print and no grant to describe, so the whole
   * question of which card is theirs has no answer rather than a default one.
   */
  current: DisplayState | null;
  /** Which card, if any, is busy opening a tab — and what stopped the last one. */
  handoff: Handoff;
  onUpgrade: (tierCode: string, interval: string) => void;
  onRetry: () => void;
  /**
   * A Plan switch, for somebody Stripe is already billing (T90, ADR-0042).
   * Absent where nobody can be paying — on no tier at all — and then every
   * button is Checkout, as it was.
   */
  switching?: Switching;
}): JSX.Element {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
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
  // On no tier there is nothing to hold, so the inert card above the row is
  // skipped for the opposite reason to "they already hold one that is on sale".
  const holdsOneOnSale = current === null || onSale.some((plan) => plan.tier.code === current.tier.code);
  const payer = switching && current?.paying ? { switching, current } : null;
  const inDunning = payer !== null && isInDunning(payer.current.subscriptionStatus);
  return (
    <div className="popup-plans">
      {inDunning ? <Note tone="warn">{PAY_THE_OPEN_INVOICE_FIRST}</Note> : null}
      {holdsOneOnSale ? null : <CurrentPlanCard current={current} switching={payer?.switching} />}
      {onSale.map((plan) => (
        <PlanCard
          key={plan.tier.code}
          plan={plan}
          current={plan.tier.code === current?.tier.code}
          handoff={handoff}
          onUpgrade={onUpgrade}
          payer={payer && !inDunning ? payer : null}
          holder={payer}
          inDunning={inDunning}
          confirming={confirming?.tierCode === plan.tier.code ? confirming : null}
          onConfirming={setConfirming}
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
function CurrentPlanCard({ current, switching }: { current: DisplayState; switching?: Switching }): JSX.Element {
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
      {switching ? <PendingOnHeldCard current={current} switching={switching} /> : null}
    </div>
  );
}

function PlanCard({
  plan,
  current,
  handoff,
  onUpgrade,
  payer,
  holder,
  inDunning,
  confirming,
  onConfirming,
}: {
  plan: Plan;
  current: boolean;
  handoff: Handoff;
  onUpgrade: (tierCode: string, interval: string) => void;
  /** Somebody Stripe bills, and not in Dunning: every button here is a switch. */
  payer: Payer | null;
  /** Somebody Stripe bills, in Dunning or not: whose pending switch may always be undone. */
  holder: Payer | null;
  /** A payer in Dunning, who is offered nothing to press until the invoice is paid. */
  inDunning: boolean;
  /** The inline confirm open on this card, if it is. */
  confirming: Confirming | null;
  onConfirming: (confirming: Confirming | null) => void;
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
      <p className="popup-plan-card-grant">{grantOf(plan)}</p>
      {current ? (
        <Button shape="block" tone="done" aria-label={`${plan.tier.name} is je abonnement`}>
          Je abonnement
        </Button>
      ) : null}
      {current && holder ? <PendingOnHeldCard current={holder.current} switching={holder.switching} /> : null}
      {confirming && payer ? (
        <SwitchConfirm plan={plan} payer={payer} confirming={confirming} onConfirming={onConfirming} />
      ) : payer ? (
        /*
         * Overstappen (T90, ADR-0042): every rhythm of another plan, and on their
         * own card the Rhythm they do not pay — none where theirs is not known,
         * since the one to leave out cannot be told. A pending switch's target
         * says when instead of offering itself again.
         */
        plan.prices
          .filter((price) => !current || (payer.current.rhythm !== null && price.interval !== payer.current.rhythm))
          .map((price) =>
            isPendingTarget(payer.current, plan, price) ? (
              <p key={price.interval} className="popup-plan-card-pending">
                Vanaf {dayOf(payer.current.pendingSwitch?.at ?? "")}
              </p>
            ) : (
              <Button
                key={price.interval}
                shape="block"
                tone="secondary"
                onClick={() => onConfirming({ tierCode: plan.tier.code, price, phase: { kind: "pricing" } })}
              >
                Overstappen · {priceAndRhythmOf(price)}
              </Button>
            ),
          )
      ) : current || inDunning ? null : (
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

/**
 * The inline confirm (T90, ADR-0042): Stripe's price for *Nu*, the card's for
 * *Op {date}*, neither preselected, and Annuleren. Priced as it opens, so the
 * amount shown is the one Stripe will charge.
 */
function SwitchConfirm({
  plan,
  payer,
  confirming,
  onConfirming,
}: {
  plan: Plan;
  payer: Payer;
  confirming: Confirming;
  onConfirming: (confirming: Confirming | null) => void;
}): JSX.Element {
  const { switching, current } = payer;
  const { price, phase } = confirming;
  const to = (next: Phase) => onConfirming({ ...confirming, phase: next });
  const close = () => onConfirming(null);
  const latest = useRef(confirming);
  latest.current = confirming;

  useEffect(() => {
    // Priced once per opening: the confirm is unmounted when it closes.
    let open = true;
    void switching.preview(plan.tier.code, price.interval).then((answer) => {
      if (!open) return;
      const phase: Phase =
        answer.status === "priced" ? { kind: "priced", preview: answer } : { kind: "failed", message: failureOf(answer) };
      onConfirming({ ...latest.current, phase });
    });
    return () => {
      open = false;
    };
  }, []);

  const made = (answer: SwitchAnswer, when: "now" | "renewal") => {
    if (answer.status === "switched" || answer.status === "scheduled") {
      to({ kind: "done", when });
      void switching
        .settle((plan) =>
          when === "now"
            ? plan.tier.code === confirming.tierCode && plan.rhythm === price.interval
            : plan.pendingSwitch?.tier.code === confirming.tierCode && plan.pendingSwitch.rhythm === price.interval,
        )
        .then(close);
      return;
    }
    if (answer.status === "confirm") return to({ kind: "paying" });
    to({ kind: "failed", message: failureOf(answer) });
  };

  return (
    <div className="popup-switch" role="group" aria-label={`Overstappen naar ${plan.tier.name}`}>
      {phase.kind === "pricing" ? <p className="popup-switch-copy">Het bedrag wordt opgehaald…</p> : null}
      {phase.kind === "priced" ? (
        <>
          <p className="popup-switch-copy">
            <b>Nu:</b> {dueToday(phase.preview)}{" "}
            {freshPeriodLine(plan, { name: current.tier.name, relistQuotaPerPeriod: current.relistQuotaPerPeriod })}
          </p>
          <p className="popup-switch-copy">
            <b>Op {dayOf(phase.preview.renewsAt)}:</b> {fromRenewalLine(phase.preview.renewsAt, price, current.tier.name)}
          </p>
          {/* Both the same tone: neither is the default (ADR-0042). */}
          <Button
            shape="block"
            tone="secondary"
            onClick={() => {
              to({ kind: "working" });
              void switching.now(plan.tier.code, price.interval).then((answer) => made(answer, "now"));
            }}
          >
            Nu
          </Button>
          <Button
            shape="block"
            tone="secondary"
            onClick={() => {
              to({ kind: "working" });
              void switching.schedule(plan.tier.code, price.interval).then((answer) => made(answer, "renewal"));
            }}
          >
            Op {dayOf(phase.preview.renewsAt)}
          </Button>
        </>
      ) : null}
      {phase.kind === "working" ? <p className="popup-switch-copy">Een moment…</p> : null}
      {phase.kind === "done" ? (
        <p className="popup-switch-copy" role="status">
          {phase.when === "now" ? SWITCHED_TODAY : SWITCH_AT_RENEWAL}
        </p>
      ) : null}
      {phase.kind === "paying" ? (
        <p className="popup-switch-copy" role="status">
          Rond de betaling af in het tabblad dat is geopend.
        </p>
      ) : null}
      {phase.kind === "failed" ? <Note tone="warn">{phase.message}</Note> : null}
      {phase.kind === "pricing" || phase.kind === "priced" ? (
        <Button shape="block" tone="secondary" onClick={close}>
          Annuleren
        </Button>
      ) : phase.kind === "failed" ? (
        <Button shape="block" tone="secondary" onClick={close}>
          Sluiten
        </Button>
      ) : null}
    </div>
  );
}

/** The held card's half of a pending switch: what it moves to and when, and the way back. */
function PendingOnHeldCard({ current, switching }: { current: DisplayState; switching: Switching }): JSX.Element | null {
  const [undoing, setUndoing] = useState<"idle" | "busy" | "failed">("idle");
  const pending = current.pendingSwitch;
  if (!pending) return null;
  return (
    <>
      <p className="popup-plan-card-pending">{pendingLine(pending)}</p>
      {undoing === "failed" ? <Note tone="warn">{UNDO_FAILED}</Note> : null}
      <Button
        shape="block"
        tone={undoing === "busy" ? "busy" : "secondary"}
        onClick={() => {
          setUndoing("busy");
          void switching.undo().then(async (answer) => {
            if (answer.status !== "undone") return setUndoing("failed");
            await switching.settle((plan) => plan.pendingSwitch === null);
            setUndoing("idle");
          });
        }}
      >
        {undoing === "busy" ? "Een moment…" : "Ongedaan maken"}
      </Button>
    </>
  );
}

function isPendingTarget(current: DisplayState, plan: Plan, price: PlanPrice): boolean {
  return current.pendingSwitch?.tier.code === plan.tier.code && current.pendingSwitch.rhythm === price.interval;
}

/** What to say when a switch call did not do what was asked. */
function failureOf(answer: SwitchAnswer): string {
  switch (answer.status) {
    case "invoice-open":
      return PAY_THE_OPEN_INVOICE_FIRST;
    case "gone":
      return "Dat abonnement wordt niet meer aangeboden.";
    case "not-paying":
      return "Je hebt nog geen betaald abonnement. Vernieuw om de abonnementen opnieuw te laden.";
    default:
      return "Dat lukte nu niet. Er is niets veranderd; probeer het zo nog eens.";
  }
}

/**
 * The Plan switch calls, as the cards need them (T90). `settle` polls `/api/me`
 * until it shows what was asked for — the webhook moves the plan a second or two
 * after Stripe answers — and puts that plan on the screen.
 */
export interface Switching {
  preview(tierCode: string, interval: string): Promise<SwitchAnswer>;
  now(tierCode: string, interval: string): Promise<SwitchAnswer>;
  schedule(tierCode: string, interval: string): Promise<SwitchAnswer>;
  undo(): Promise<SwitchAnswer>;
  settle(until: (plan: DisplayState) => boolean): Promise<void>;
}

interface Payer {
  switching: Switching;
  current: DisplayState;
}

type Phase =
  | { kind: "pricing" }
  | { kind: "priced"; preview: Extract<SwitchAnswer, { status: "priced" }> }
  | { kind: "working" }
  | { kind: "done"; when: "now" | "renewal" }
  /** 3-D Secure: the worker has opened the invoice's page. */
  | { kind: "paying" }
  | { kind: "failed"; message: string };

interface Confirming {
  tierCode: string;
  price: PlanPrice;
  phase: Phase;
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
