import {
  UNLIMITED_REPOSTS,
  grantOf,
  priceAndRhythmOf,
  priceOf,
  waysToPay,
  type FreeTier,
  type Plan,
  type PlanPrice,
} from "@mprelist/contracts";
import { Button, Skeleton } from "@mprelist/ui";
import { useEffect, useState, type JSX } from "react";

import type { PlansOnOffer } from "./plans-on-offer";
import type { Account, Choice, SwitchPreviewAnswer, Viewer } from "./viewer";

/**
 * The plans on `/`, with buttons (T85, ADR-0036): prototype A, chosen on
 * 2026-09-25 from three on the branch `prototype/landing-plan-cards`.
 *
 * **Each card leads with how many reposts it grants**, in the mark's gradient,
 * with a meter measured against the largest finite grant on the page; the
 * largest plan is filled with the gradient and lifted. Nothing else is claimed:
 * no list of benefits, since every tier grants the same kind of thing and only
 * the number differs.
 *
 * **The switcher is this page's only.** It shows when some plan is sold yearly,
 * starts on monthly, and never hides a card: a plan sold monthly only stays,
 * with its monthly price and "Alleen maandelijks". Its position is the Rhythm a
 * button buys or switches to. The popup keeps a button per rhythm instead.
 */

/** A card's button, as a function of who is looking — kept pure so it can be read off in a test. */
export type CardAction =
  | { kind: "sign-in"; label: string; choice: Choice }
  | { kind: "buy"; label: string; choice: Choice }
  | { kind: "switch"; label: string; choice: Choice }
  | { kind: "current"; label: string }
  | { kind: "wait"; label: string };

export function actionFor(plan: Plan, interval: string, viewer: Viewer): CardAction {
  const choice = { tierCode: plan.tier.code, interval };
  switch (viewer.kind) {
    case "checking":
      return { kind: "wait", label: `Kies ${plan.tier.name}` };
    case "signed-out":
      return { kind: "sign-in", label: `Kies ${plan.tier.name}`, choice };
    case "signed-in":
      if (!viewer.paying) return { kind: "buy", label: `Kies ${plan.tier.name}`, choice };
      if (viewer.tierCode === plan.tier.code) {
        // A rhythm nobody could read is not a reason to sell them the other
        // one: without it, their own tier is theirs at either.
        if (viewer.rhythm === null || viewer.rhythm === interval) {
          return { kind: "current", label: "Huidig abonnement" };
        }
        return { kind: "switch", label: `Overstappen naar ${rhythmWord(interval)}`, choice };
      }
      return { kind: "switch", label: `Overstappen naar ${plan.tier.name}`, choice };
  }
}

export type FreeAction =
  | { kind: "install"; label: string }
  | { kind: "current"; label: string }
  | { kind: "cancel"; label: string }
  | { kind: "none" };

export function freeActionFor(free: FreeTier, viewer: Viewer): FreeAction {
  switch (viewer.kind) {
    case "checking":
    case "signed-out":
      return { kind: "install", label: "Gratis beginnen" };
    case "signed-in":
      // Moving to the free tier is cancelling, not a switch: there is no Price to
      // switch to, and the Portal cancels at the period's end (ADR-0018).
      if (viewer.paying) return { kind: "cancel", label: "Opzeggen" };
      if (viewer.tierCode === free.tier.code) return { kind: "current", label: "Huidig abonnement" };
      return { kind: "none" };
  }
}

/**
 * The tier that grants the most repostings — unlimited above any number — when
 * there is more than one to be larger than. `undefined` when there is one plan or
 * when two tie for it, since a ring around one of two equals picks at random.
 *
 * It is a fact read off the cards, not an opinion about them: nothing here knows
 * what sells, so nothing is called popular.
 */
export function largestOf(plans: readonly Plan[]): string | undefined {
  if (plans.length < 2) return undefined;
  const grant = (plan: Plan) => plan.relistQuotaPerPeriod ?? Number.POSITIVE_INFINITY;
  const most = Math.max(...plans.map(grant));
  const largest = plans.filter((plan) => grant(plan) === most);
  return largest.length === 1 ? largest[0]?.tier.code : undefined;
}

/**
 * The price a card shows at the switcher's position: that rhythm's, or — for a
 * plan not sold at it — the first, which is the cheapest rhythm `/api/plans`
 * lists.
 */
export function priceShown(plan: Plan, interval: string): PlanPrice | undefined {
  return plan.prices.find((price) => price.interval === interval) ?? plan.prices[0];
}

/**
 * What a year saves over twelve months of the same plan, in whole percent —
 * computed from the plan's own two Stripe prices, and `undefined` unless both
 * exist, share a currency and the year really is cheaper.
 */
export function yearlySaving(plan: Plan): number | undefined {
  const month = plan.prices.find((price) => price.interval === "month");
  const year = plan.prices.find((price) => price.interval === "year");
  if (!month || !year || month.currency !== year.currency) return undefined;
  const twelve = month.amount * 12;
  if (year.amount >= twelve) return undefined;
  const saved = Math.round((1 - year.amount / twelve) * 100);
  return saved > 0 ? saved : undefined;
}

export function PlanSection({
  plans,
  onRetry,
  account,
  installUrl,
}: {
  plans: PlansOnOffer | "loading";
  onRetry: () => void;
  account: Account;
  installUrl: string;
}): JSX.Element {
  const [interval, setRhythm] = useState("month");
  const [switching, setSwitching] = useState<{ plan: Plan; choice: Choice } | null>(null);

  if (plans === "loading") {
    return (
      <div className="web-plans" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="web-plan">
            <Skeleton width="45%" height={14} />
            <Skeleton width="60%" height={48} />
            <Skeleton width="80%" height={12} />
          </div>
        ))}
      </div>
    );
  }
  if (plans.status === "unavailable") {
    return (
      <div className="web-plans-unavailable">
        <p>
          De prijzen kunnen nu niet worden geladen. Je vindt ze ook in de extensie, onder{" "}
          <b>Kies een abonnement</b>.
        </p>
        <Button tone="retry" shape="rect" onClick={onRetry}>
          Opnieuw proberen
        </Button>
      </div>
    );
  }

  const { plans: onSale, freeTier } = plans;
  if (onSale.length === 0 && !freeTier) return <></>;
  const featured = largestOf(onSale);
  const ceiling = Math.max(
    1,
    ...[freeTier?.relistQuotaPerPeriod, ...onSale.map((plan) => plan.relistQuotaPerPeriod)].filter(
      (grant): grant is number => typeof grant === "number",
    ),
  );
  const soldYearly = onSale.some((plan) => plan.prices.some((price) => price.interval === "year"));
  const shownInterval = soldYearly ? interval : "month";
  const payWith = waysToPay(plans.paymentMethods);
  const picked = account.viewer.kind === "signed-in" ? account.viewer.picked : null;

  return (
    <>
      {soldYearly ? (
        <RhythmSwitch interval={shownInterval} onChange={setRhythm} saving={bestSaving(onSale)} />
      ) : null}
      {account.notice ? (
        <p className="web-plans-notice" role="status">
          {account.notice}
        </p>
      ) : null}
      <div className="web-plans">
        {freeTier ? (
          <FreeCard free={freeTier} ceiling={ceiling} account={account} installUrl={installUrl} />
        ) : null}
        {onSale.map((plan) => (
          <PlanCard
            key={plan.tier.code}
            plan={plan}
            interval={shownInterval}
            ceiling={ceiling}
            featured={plan.tier.code === featured}
            picked={picked?.tierCode === plan.tier.code}
            account={account}
            onSwitch={(choice) => setSwitching({ plan, choice })}
          />
        ))}
      </div>
      {payWith ? <p className="web-pay-with">{payWith}</p> : null}
      {switching ? (
        <SwitchDialog
          plan={switching.plan}
          choice={switching.choice}
          account={account}
          onClose={() => setSwitching(null)}
        />
      ) : null}
    </>
  );
}

function RhythmSwitch({
  interval,
  onChange,
  saving,
}: {
  interval: string;
  onChange: (interval: string) => void;
  saving: number | undefined;
}): JSX.Element {
  return (
    <div className="web-rhythm" role="radiogroup" aria-label="Betaalritme">
      {(["month", "year"] as const).map((rhythm) => (
        <button
          key={rhythm}
          type="button"
          role="radio"
          aria-checked={interval === rhythm}
          className={interval === rhythm ? "is-on" : undefined}
          onClick={() => onChange(rhythm)}
        >
          {rhythm === "month" ? "Maandelijks" : "Jaarlijks"}
          {rhythm === "year" && saving ? <span className="web-rhythm-save">tot −{saving}%</span> : null}
        </button>
      ))}
    </div>
  );
}

function FreeCard({
  free,
  ceiling,
  account,
  installUrl,
}: {
  free: FreeTier;
  ceiling: number;
  account: Account;
  installUrl: string;
}): JSX.Element {
  const action = freeActionFor(free, account.viewer);
  return (
    <div className="web-plan">
      <p className="web-plan-name">{free.tier.name}</p>
      <Grant grant={free.relistQuotaPerPeriod} words={freeWords(free)} ceiling={ceiling} />
      <p className="web-plan-price">
        <b>Gratis</b>
      </p>
      <p className="web-plan-note">&nbsp;</p>
      {action.kind === "install" ? (
        <a className="web-plan-btn web-plan-btn--secondary" href={installUrl}>
          {action.label}
        </a>
      ) : action.kind === "current" ? (
        <span className="web-plan-btn web-plan-btn--current">{action.label}</span>
      ) : action.kind === "cancel" ? (
        <button
          type="button"
          className="web-plan-btn web-plan-btn--quiet"
          disabled={account.busy === "billing"}
          onClick={account.manageBilling}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  ceiling,
  featured,
  picked,
  account,
  onSwitch,
}: {
  plan: Plan;
  interval: string;
  ceiling: number;
  featured: boolean;
  picked: boolean;
  account: Account;
  onSwitch: (choice: Choice) => void;
}): JSX.Element {
  const price = priceShown(plan, interval);
  const at = price?.interval ?? interval;
  const action = actionFor(plan, at, account.viewer);
  const saving = at === "year" ? yearlySaving(plan) : undefined;
  const busy =
    typeof account.busy === "object" && account.busy?.tierCode === plan.tier.code && account.busy.interval === at;
  const classes = ["web-plan", featured ? "web-plan--featured" : "", picked ? "web-plan--picked" : ""];
  return (
    <div className={classes.filter(Boolean).join(" ")}>
      {featured ? <span className="web-plan-flag">Meeste herplaatsingen</span> : null}
      <p className="web-plan-name">{plan.tier.name}</p>
      <Grant grant={plan.relistQuotaPerPeriod} words={grantWords(plan, at)} ceiling={ceiling} />
      {price ? (
        <p className="web-plan-price">
          <b>{priceOf(price)}</b> {at === "year" ? "per jaar" : at === "month" ? "per maand" : ""}
        </p>
      ) : null}
      <p className="web-plan-note">
        {interval === "year" && at !== "year"
          ? "Alleen maandelijks"
          : price && at === "year"
            ? `${priceOf({ ...price, amount: Math.round(price.amount / 12) })} per maand${
                saving ? ` · bespaar ${saving}%` : ""
              }`
            : " "}
      </p>
      {action.kind === "current" ? (
        <span className="web-plan-btn web-plan-btn--current">{action.label}</span>
      ) : (
        <button
          type="button"
          className={
            action.kind === "switch" ? "web-plan-btn web-plan-btn--secondary" : "web-plan-btn web-plan-btn--primary"
          }
          disabled={action.kind === "wait" || busy}
          aria-busy={busy || undefined}
          onClick={() => {
            if (action.kind === "sign-in") account.signIn(action.choice);
            if (action.kind === "buy") account.buy(action.choice);
            if (action.kind === "switch") onSwitch(action.choice);
          }}
        >
          {busy ? "Een moment…" : action.label}
        </button>
      )}
    </div>
  );
}

/** The number, the words under it, and the meter — the card's centrepiece. */
function Grant({ grant, words, ceiling }: { grant: number | null; words: string; ceiling: number }): JSX.Element {
  const width = grant === null ? 100 : Math.max(4, Math.round((grant / ceiling) * 88));
  return (
    <>
      <p className="web-plan-number">{grant === null ? "∞" : grant}</p>
      <p className="web-plan-grant">{words}</p>
      <div className="web-plan-meter" aria-hidden="true">
        <span className={grant === null ? "is-open" : undefined} style={{ width: `${width}%` }} />
      </div>
    </>
  );
}

/** "herplaatsingen per maand", under the number — `grantOf` without the number it already shows. */
function grantWords(plan: Plan, interval: string): string {
  if (plan.relistQuotaPerPeriod === null) return UNLIMITED_REPOSTS.toLowerCase();
  return grantOf(plan, interval).replace(/^\d+\s+/, "");
}

/** The free tier rolls monthly on our own clock (ADR-0018), whatever the switcher says. */
function freeWords(free: FreeTier): string {
  return grantWords({ ...free, prices: [] }, "month");
}

function rhythmWord(interval: string): string {
  return interval === "year" ? "jaarlijks" : interval === "month" ? "maandelijks" : interval;
}

function bestSaving(plans: readonly Plan[]): number | undefined {
  const savings = plans.map(yearlySaving).filter((saving): saving is number => saving !== undefined);
  return savings.length > 0 ? Math.max(...savings) : undefined;
}

/**
 * Overstappen, confirmed: what Stripe says the switch invoices now, and what the
 * plan costs after. Nothing is charged until **Overstappen** in here is pressed,
 * which is also what makes a stray click — framed or not — harmless.
 */
export function SwitchDialog({
  plan,
  choice,
  account,
  onClose,
}: {
  plan: Plan;
  choice: Choice;
  account: Account;
  onClose: () => void;
}): JSX.Element {
  type Phase =
    | { kind: "pricing" }
    | { kind: "priced"; preview: Extract<SwitchPreviewAnswer, { status: "ready" }> }
    | { kind: "switching" }
    | { kind: "done" }
    | { kind: "failed"; message: string };
  const [phase, setPhase] = useState<Phase>({ kind: "pricing" });
  const after = plan.prices.find((price) => price.interval === choice.interval);

  useEffect(() => {
    let current = true;
    void account.previewSwitch(choice).then((answer) => {
      if (!current) return;
      if (answer.status === "ready") return setPhase({ kind: "priced", preview: answer });
      if (answer.status === "not-paying") return onClose();
      setPhase({ kind: "failed", message: failureOf(answer.status) });
    });
    return () => {
      current = false;
    };
    // Priced once per opening: the dialog is remounted for another plan.
  }, []);

  const confirm = () => {
    setPhase({ kind: "switching" });
    void account.switchPlan(choice).then((answer) => {
      if (answer.status === "switched") return setPhase({ kind: "done" });
      if (answer.status === "confirming") return;
      if (answer.status === "not-paying") return onClose();
      setPhase({ kind: "failed", message: failureOf(answer.status) });
    });
  };

  return (
    <div className="web-dialog-backdrop" onClick={onClose}>
      <div
        className="web-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="web-dialog-title" className="web-dialog-title">
          Overstappen naar {plan.tier.name}
          {after ? ` · ${rhythmWord(after.interval)}` : ""}
        </h3>
        <p className="web-dialog-copy" aria-live="polite">
          {phase.kind === "pricing"
            ? "Het bedrag wordt opgehaald…"
            : phase.kind === "priced"
              ? dueNow(phase.preview) + (after ? ` Daarna ${priceAndRhythmOf(after)}.` : "")
              : phase.kind === "switching"
                ? "Je abonnement wordt aangepast…"
                : phase.kind === "done"
                  ? "Gelukt. Je nieuwe abonnement gaat meteen in."
                  : phase.message}
        </p>
        <div className="web-dialog-actions">
          {phase.kind === "done" || phase.kind === "failed" ? (
            <button type="button" className="web-plan-btn web-plan-btn--secondary" onClick={onClose}>
              Sluiten
            </button>
          ) : (
            <>
              <button
                type="button"
                className="web-plan-btn web-plan-btn--secondary"
                onClick={onClose}
                disabled={phase.kind === "switching"}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="web-plan-btn web-plan-btn--primary"
                onClick={confirm}
                disabled={phase.kind !== "priced"}
              >
                Overstappen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The preview in a sentence. Negative is a credit, and is said as one rather than as a minus. */
export function dueNow(preview: { amount: number; currency: string }): string {
  const amount = priceOf({ amount: Math.abs(preview.amount), currency: preview.currency, interval: "month" });
  if (preview.amount > 0) return `Je betaalt nu ${amount} voor de rest van deze periode.`;
  if (preview.amount < 0) return `Je krijgt ${amount} tegoed, dat met je volgende betalingen wordt verrekend.`;
  return "Er wordt nu niets afgeschreven.";
}

function failureOf(status: "not-for-sale" | "unavailable"): string {
  return status === "not-for-sale"
    ? "Dit abonnement wordt niet meer aangeboden. Vernieuw de pagina voor wat er nu te koop is."
    : "Dat lukte nu niet. Er is niets veranderd; probeer het zo nog eens.";
}
