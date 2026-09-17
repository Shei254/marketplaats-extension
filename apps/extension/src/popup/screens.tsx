import { Badge, Button, Icon, IconButton, Meter, Note, Skeleton, Spinner } from "@mprelist/ui";
import type { DisplayState } from "@mprelist/contracts";
import type { JSX, ReactNode } from "react";

import { grantsNothing, MANAGING, UNLIMITED_REPOSTS, type Handoff } from "./plans";


/**
 * The screens, as functions of what they show and nothing else — no state,
 * no messaging, no clock beyond the one date they are handed. What decides
 * *which* of them is on the screen is `screen.ts`, and what fetches anything is
 * the worker.
 *
 * The layout is the design canvas's (`docs/design/`), and so are the words. Two
 * deliberate departures, both in the header and both the same shape. The canvas
 * has no sign-out control anywhere and the slice-A click-through ends by signing
 * out; it has no way into the plan cards either except the prompt beside a spent
 * quota, which would leave a paying subscriber with no way to reach their own
 * billing — and ADR-0017 is explicit that this popup *is* the account surface
 * ("the popup's quota display plus a Customer Portal link"). Both are quiet text
 * buttons rather than invented glyphs, since the icon set is the canvas's too.
 */
export function Header({ actions }: { actions?: ReactNode }): JSX.Element {
  return (
    <header className="popup-header">
      <span className="popup-brand">
        <span className="popup-mark">
          <Icon name="logo" />
        </span>
        {__BRAND_NAME__}
      </span>
      {actions ? <span className="popup-actions">{actions}</span> : null}
    </header>
  );
}

/**
 * Signed out: the mark, the promise, and one button. **Nothing else** — no ad
 * list, no quota, no plan (ADR-0007's refinement). The line under the button is
 * the one thing a first-time reader most needs to be told, and it is true: the
 * relist runs in their own session and this extension never sees a Marktplaats
 * password.
 */
export function SignedOutScreen({
  onSignIn,
  busy,
  failure,
}: {
  onSignIn: () => void;
  busy: boolean;
  failure?: string;
}): JSX.Element {
  return (
    <>
      <Header />
      <div className="popup-centred">
        <div className="popup-badge">
          <Icon name="logo" />
        </div>
        <h1 className="popup-title">Zet je advertenties weer bovenaan</h1>
        <p className="popup-copy">
          Log in om je Marktplaats-advertenties met één klik te herplaatsen.
        </p>
        <Button shape="block" tone={busy ? "busy" : "primary"} onClick={onSignIn}>
          {busy ? "Bezig met inloggen…" : "Inloggen"}
        </Button>
        {failure ? <Note tone="error">{failure}</Note> : null}
        <p className="popup-micro">
          {__BRAND_NAME__} ziet je Marktplaats-wachtwoord nooit — het herplaatsen gebeurt in je
          eigen browsersessie.
        </p>
      </div>
    </>
  );
}

/** Waiting on the worker: the shape of the answer rather than a spinner alone. */
export function LoadingScreen(): JSX.Element {
  return (
    <>
      <Header />
      <div className="popup-plan">
        <Skeleton width={120} height={11} />
        <Skeleton width={64} height={11} />
      </div>
      <div className="popup-centred">
        <Spinner size="lg" label="Je abonnement wordt geladen" />
      </div>
    </>
  );
}

/**
 * The backend could not be reached, or answered something unreadable. It says
 * what that means for the user — relisting is paused — and, deliberately, that
 * **nothing has been changed on Marktplaats**, which is the question somebody
 * whose relist just failed actually has.
 */
/**
 * The build is older than the oldest the backend still serves (T43, #52).
 *
 * **No button.** Every other screen here offers the user their next move, and this
 * one has none to offer: the extension cannot update itself, a retry cannot help,
 * and the store's own page is not something a popup can usefully link into. What
 * it can do is say plainly what happened, that it is not their fault, and that
 * their ads are untouched — which is the sentence somebody who has just been
 * locked out of a paid product most needs to read.
 *
 * Chrome updates extensions on its own within a few hours, so "it will fix itself"
 * is true, and saying so is more useful than a button that reloads a refusal.
 */
export function OutdatedScreen(): JSX.Element {
  return (
    <>
      <Header />
      <div className="popup-centred">
        <div className="popup-warning">
          <Icon name="warning" />
        </div>
        <h1 className="popup-title">{__BRAND_NAME__} moet worden bijgewerkt</h1>
        <p className="popup-copy">
          Deze versie is te oud om veilig te blijven herplaatsen, dus dat is gestopt. Chrome werkt
          extensies meestal binnen een paar uur bij — open dit dan opnieuw.
        </p>
        <p className="popup-micro">
          Er is niets gewijzigd op Marktplaats en je advertenties staan precies waar je ze
          hebt achtergelaten.
        </p>
      </div>
    </>
  );
}

/**
 * On no plan at all (T77, ADR-0032): the tier this account was on was deleted and
 * the catalog had no default to move it to.
 *
 * **No retry button, and for a sharper version of `OutdatedScreen`'s reason.**
 * There the user can do something and it simply is not "try again"; here there is
 * nothing for *either* of them to do — an operator makes a tier the default and
 * everybody naming none is adopted onto it at once. So the copy says who is doing
 * it and that nothing was lost, and offers no control that would only ever be
 * pressed in vain.
 *
 * **It says nothing about paying**, deliberately. A subscriber whose plan was
 * deleted has had their Stripe subscription cancelled, and pointing them at the
 * plan cards at this moment would be offering a catalog that may be empty — see
 * the same choice `BatchBar`'s locked line makes while bulk is withdrawn.
 */
export function NoTierScreen(): JSX.Element {
  return (
    <>
      <Header />
      <div className="popup-centred">
        <div className="popup-warning">
          <Icon name="warning" />
        </div>
        <h1 className="popup-title">Er staat nu geen abonnement op dit account</h1>
        <p className="popup-copy">
          Het abonnement waar je op zat bestaat niet meer, en er is nog geen ander ingesteld.
          Herplaatsen is daarom gepauzeerd tot dat gebeurd is.
        </p>
        <p className="popup-micro">
          Er is niets gewijzigd op Marktplaats en je advertenties staan precies waar je ze hebt
          achtergelaten. Dit lost zich vanzelf op — opnieuw proberen helpt niet.
        </p>
      </div>
    </>
  );
}

export function UnavailableScreen({
  onRetry,
  busy,
}: {
  onRetry: () => void;
  busy: boolean;
}): JSX.Element {
  return (
    <>
      <Header />
      <div className="popup-centred">
        <div className="popup-warning">
          <Icon name="warning" />
        </div>
        <h1 className="popup-title">{__BRAND_NAME__} is nu niet bereikbaar</h1>
        <p className="popup-copy">
          Je abonnement en limiet kunnen niet worden gecontroleerd, dus herplaatsen is gepauzeerd.
          Er is niets gewijzigd op Marktplaats.
        </p>
        <Button shape="rect" tone={busy ? "busy" : "secondary"} onClick={onRetry}>
          {busy ? "Bezig…" : "Opnieuw proberen"}
        </Button>
      </div>
    </>
  );
}

/**
 * Signed in: the plan, what is left of it, and when it comes back.
 *
 * The ad list belongs under this strip and is T30a (#39). What is here is the
 * shell it hangs from, which is what this ticket is.
 */
export function SignedInScreen({
  plan,
  children,
  onRefresh,
  onSignOut,
  onSeePlans,
  onManageBilling,
  handoff,
  busy,
}: {
  plan: DisplayState;
  /** The ad list (`AdList`), which owns state this frame has no business holding. */
  children?: ReactNode;
  onRefresh: () => void;
  onSignOut: () => void;
  onSeePlans: () => void;
  /** Opens the Customer Portal (T21, #31) — the dunning prompt's own button. */
  onManageBilling: () => void;
  handoff: Handoff;
  busy: boolean;
}): JSX.Element {
  // The three states a quota can be in, named rather than re-derived at each of
  // the four places below that branch on them (ADR-0029). `unlimited` reads the
  // grant and not the remainder: the two are null together, and the ceiling is the
  // fact the screen is actually about.
  //
  // The middle one is `plans.ts`'s function since T32 (#41) and is called rather
  // than copied into a local, so that this strip and the ad list beneath it have
  // one spelling between them: a screen of dead buttons and the prompt explaining
  // them must never disagree about whether the plan grants anything.
  const unlimited = plan.relistQuotaPerPeriod === null;
  const spent = plan.quotaRemaining === 0 && !grantsNothing(plan);
  const paymentFailing = !ALLOWED_STATUSES.includes(plan.subscriptionStatus);
  return (
    <>
      <Header
        actions={
          <>
            <IconButton label="Vernieuwen" onClick={onRefresh} disabled={busy}>
              <Icon name="refresh" />
            </IconButton>
            <Button tone="ghost" onClick={onSeePlans} disabled={busy}>
              Abonnementen
            </Button>
            <Button tone="ghost" onClick={onSignOut} disabled={busy}>
              Uitloggen
            </Button>
          </>
        }
      />
      <div className={stripClass(spent || grantsNothing(plan), paymentFailing)}>
        <div className="popup-plan-top">
          <span className="popup-plan-name">
            {plan.tier.name}
            {paymentFailing ? <Badge tone="err">betaling mislukt</Badge> : null}
          </span>
          <span className="popup-plan-left">{grantLine(plan, paymentFailing)}</span>
        </div>
        {/* No bar while a card is failing, and no date either. A meter says how much
            is available and none of it is: the tier is still theirs (ADR-0018) but
            nothing can be spent until Stripe is paid, and the prompt below is what
            says so. Drawing 41 of 50 there would be an invitation.

            And none of either on an unlimited tier, for the opposite reason and
            deliberately in the same shape (ADR-0029): a meter draws a proportion
            and there is no ceiling to draw one against, so a permanently full bar
            would be decoration shaped like data — identical after five hundred
            reposts and after none. */}
        {paymentFailing || unlimited ? null : (
          <Meter
            value={plan.quotaRemaining ?? 0}
            max={plan.relistQuotaPerPeriod ?? 0}
            valueText={grantLine(plan)}
          />
        )}
        {/* A date is what makes "you have none left" actionable, and it is only
            true where something actually comes back. It says nothing on an
            unlimited tier — it would invite the reader to believe there is a limit
            — and it is a promise on a tier granting 0, where what comes back is 0
            (ADR-0029). */}
        {paymentFailing || unlimited || grantsNothing(plan) || !resetsOn(plan.resetAt) ? null : (
          <p className="popup-plan-foot">{resetsOn(plan.resetAt)}</p>
        )}
      </div>
      {paymentFailing ? (
        <DunningPrompt tier={plan.tier.name} onManageBilling={onManageBilling} handoff={handoff} />
      ) : null}
      {spent && !paymentFailing ? (
        <ExhaustedPrompt resetAt={plan.resetAt} onSeePlans={onSeePlans} />
      ) : null}
      {grantsNothing(plan) && !paymentFailing ? <NoRepostsPrompt onSeePlans={onSeePlans} /> : null}
      {children}
    </>
  );
}

/**
 * The statuses that entitle their holder to relist (`docs/enforcement-contract.md`).
 * Everything else is a card that is currently failing: since ADR-0018 a terminal
 * end falls back to the free tier and is `ACTIVE`, so nobody who cancelled ever
 * lands here — which is why the copy below says "update your card" and never
 * "resubscribe".
 */
const ALLOWED_STATUSES: readonly DisplayState["subscriptionStatus"][] = ["ACTIVE", "TRIALING"];

/**
 * Which of the three treatments the strip wears.
 *
 * `nothingToSpend` is wider than *spent* on purpose (ADR-0029): a tier granting 0
 * is not an exhausted one and the words say so, but the user can do exactly as
 * much on it — nothing — and a strip drawn as ordinary above a list of locked
 * buttons is a screen that looks fine and is not.
 */
function stripClass(nothingToSpend: boolean, paymentFailing: boolean): string {
  if (paymentFailing) return "popup-plan popup-plan--failing";
  return nothingToSpend ? "popup-plan popup-plan--spent" : "popup-plan";
}

/**
 * The right-hand half of the strip's top line: what this plan has left, in the
 * one sentence its three-and-a-bit states each need (ADR-0029).
 *
 * Written once and read three times — the line itself, the meter's
 * `aria-valuetext`, and the current-plan card on the plans screen — because a bar
 * and its own screen-reader sentence saying different things is the bug the
 * `valueText` prop exists to prevent, and because the plans screen describing the
 * plan somebody is on differently from the screen they came from is the same bug
 * one click further along.
 *
 * @param paymentFailing whether a card is currently failing, which is a fact about
 * the strip rather than about the plan — the plans screen has its own dunning
 * treatment and passes nothing
 */
export function grantLine(plan: DisplayState, paymentFailing = false): string {
  // Unlimited first, and before the failing card: "Onbeperkt herplaatsen" is what the
  // tier grants, which is exactly what that branch says for a capped one.
  if (plan.relistQuotaPerPeriod === null) return UNLIMITED_REPOSTS;
  // **A tier granting 0 is not an exhausted one**, and "0 of 0 reposts left" reads
  // as somebody who spent them. Nobody on this plan ever had any.
  //
  // Ahead of the failing card for the same reason unlimited is: both branches say
  // what the tier grants, and this is the grant in words. A tier may be zeroed
  // under the people already on it (ADR-0029), one of whom may have a card
  // failing — and "0 relists" over a dunning prompt blames Stripe for a nothing
  // the operator chose.
  if (plan.relistQuotaPerPeriod === 0) return "Geen herplaatsingen in dit abonnement";
  // A card that is failing shows the grant rather than the remainder: the tier is
  // still theirs (ADR-0018) and nothing of it can be spent, so a number that moved
  // would be describing spending that cannot happen.
  if (paymentFailing) {
    return `${plan.relistQuotaPerPeriod} herplaatsing${plan.relistQuotaPerPeriod === 1 ? "" : "en"}`;
  }
  return repostsLeft(plan.quotaRemaining ?? 0, plan.relistQuotaPerPeriod);
}

/**
 * Shown when the period is spent: when they come back, and the way out of waiting.
 *
 * **The button arrived with the cards it opens** (T52, #83) — #79 shipped this
 * prompt without one rather than draw a button with nowhere to go, and this is the
 * ticket that gave it somewhere. It sits beside the ad list on purpose: ADR-0007
 * leaves that list ungated precisely so the conversion click is next to the user's
 * own locked ads rather than three steps away on a website.
 *
 * The canvas's copy here is "You've used your 3 for this month / Pro gives you 50
 * relists a month", and the second sentence is not kept: it names a tier and a
 * quota that are an operator's to change (ADR-0014), so saying it would mean
 * fetching `/api/plans` on every popup open for one line — and would be wrong the
 * day somebody renames Pro. What is kept is the date, which is the thing that
 * makes "you have none left" actionable for a user who does not want to pay.
 */
function ExhaustedPrompt({
  resetAt,
  onSeePlans,
}: {
  resetAt: string;
  onSeePlans: () => void;
}): JSX.Element {
  return (
    <div className="popup-prompt">
      <span className="popup-prompt-mark">
        <Icon name="bolt" />
      </span>
      <div>
        <p className="popup-prompt-title">Je hebt je limiet voor herplaatsingen in deze periode bereikt</p>
        <p className="popup-prompt-copy">
          Ze resetten{" "}
          {resetsOn(resetAt).replace("Reset op ", "op ") || "wanneer de periode wordt vernieuwd"}.
        </p>
        <Button shape="rect" tone="primary" onClick={onSeePlans}>
          Bekijk abonnementen
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown on a tier that grants no reposts at all — which is not the same screen as
 * one that has run out, and is the distinction ADR-0029 exists to make sayable.
 *
 * **No date, because nothing comes back.** {@link ExhaustedPrompt} above promises
 * "they come back on 14 Sep", and on a tier granting 0 what comes back is 0 —
 * which is a plan somebody has to change rather than a wait somebody has to sit
 * out. So this one offers only the thing that would change it.
 *
 * The state is reachable two ways and neither is exotic: an operator withdrawing
 * the free tier is a quota of 0 on the default one (ADR-0019), and every
 * subscription that ends falls back there (ADR-0018).
 */
function NoRepostsPrompt({ onSeePlans }: { onSeePlans: () => void }): JSX.Element {
  return (
    <div className="popup-prompt">
      <span className="popup-prompt-mark">
        <Icon name="bolt" />
      </span>
      <div>
        <p className="popup-prompt-title">Dit abonnement bevat geen herplaatsingen</p>
        <p className="popup-prompt-copy">Met een betaald abonnement krijg je ze wel.</p>
        <Button shape="rect" tone="primary" onClick={onSeePlans}>
          Bekijk abonnementen
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown while a card is failing. **"je abonnement is nog steeds Pro" is the load-bearing
 * half**: Stripe is still retrying, the tier has not been taken away, and a
 * successful retry gives it straight back (ADR-0018).
 *
 * "Betaalgegevens bijwerken" opens the Customer Portal (T21, #31), which is where the card
 * actually lives — none of it is built here, and ADR-0018 asks for this copy
 * rather than "resubscribe" precisely because nothing has been cancelled.
 */
function DunningPrompt({
  tier,
  onManageBilling,
  handoff,
}: {
  tier: string;
  onManageBilling: () => void;
  handoff: Handoff;
}): JSX.Element {
  const opening = handoff.kind === "opening" && handoff.what === MANAGING;
  return (
    <div className="popup-prompt popup-prompt--failing">
      <span className="popup-prompt-mark popup-prompt-mark--failing">
        <Icon name="card" />
      </span>
      <div>
        <p className="popup-prompt-title">Je betaling is niet gelukt</p>
        <p className="popup-prompt-copy">
          We blijven het proberen. Werk je betaalgegevens bij om weer te kunnen herplaatsen — je
          abonnement is nog steeds {tier}.
        </p>
        <Button shape="rect" tone={opening ? "busy" : "secondary"} onClick={onManageBilling}>
          {opening ? "Bezig met openen…" : "Betaalgegevens bijwerken"}
        </Button>
        {handoff.kind === "failed" ? <Note tone="error">{handoff.message}</Note> : null}
      </div>
    </div>
  );
}

/**
 * The plan cards, and the frame around them (T52, #83).
 *
 * The cards themselves are `PlanCards`, handed in — this is the title, the two
 * sentences the canvas puts around them, and the way back. **"Het afrekenen wordt
 * geopend in een nieuw tabblad" is a warning, not decoration**: the popup is
 * destroyed the moment that
 * tab takes focus (ADR-0017), so a user who is not told will read the popup
 * vanishing as the click having failed.
 *
 * **The ways to pay are named here, under the lede** (T65, #137). A Dutch buyer's
 * commonest question at this exact moment is whether iDEAL is on the other side of
 * that tab, and ADR-0006 chose Stripe over a card-only arrangement to make sure it
 * is. The sentence is read from the Stripe dashboard rather than written here —
 * `OpenCheckout` keeps the methods in one place and this reports it, so there is
 * no second answer to drift (ADR-0022). When there is nothing to say it says
 * nothing: no placeholder, no "loading", and the lede above stands on its own.
 *
 * **"Betaling beheren" is here rather than on a card**, because it belongs to
 * whoever has billing at all rather than to any one plan — and it is shown to
 * everybody, including somebody who has never paid, because nothing on this screen
 * can tell: the free tier is absent from `/api/plans` by construction, and a
 * subscriber who cancelled is back on it with their invoices still at Stripe
 * (ADR-0018). So the API answers that question and the note says the answer.
 */
export function PlansScreen({
  onBack,
  onManageBilling,
  handoff,
  payWith,
  children,
}: {
  onBack: () => void;
  onManageBilling: () => void;
  handoff: Handoff;
  /**
   * The finished sentence — "Je kunt betalen met iDEAL, PayPal of creditcard." — or
   * `null`, which renders
   * nothing at all. Built by `waysToPay` in `plans.ts`; this end only places it.
   */
  payWith: string | null;
  /** `PlanCards` — the cards own the loading and failed states of the list itself. */
  children?: ReactNode;
}): JSX.Element {
  const managing = handoff.kind === "opening" && handoff.what === MANAGING;
  return (
    <>
      <Header
        actions={
          <Button tone="ghost" onClick={onBack}>
            Terug
          </Button>
        }
      />
      <div className="popup-plans-body">
        <h1 className="popup-plans-title">Kies een abonnement</h1>
        <p className="popup-plans-lede">
          Het afrekenen wordt geopend in een nieuw tabblad. Kom daarna hier terug.
          {payWith ? <span className="popup-plans-ways"> {payWith}</span> : null}
        </p>
        {children}
        {handoff.kind === "failed" ? <Note tone="error">{handoff.message}</Note> : null}
        <p className="popup-plans-fine">
          Je kunt op elk moment opzeggen — je gaat dan terug naar Gratis en behoudt altijd toegang.
        </p>
        <Button
          tone="ghost"
          className="popup-plans-manage"
          onClick={onManageBilling}
          disabled={handoff.kind === "opening"}
        >
          {managing ? "Bezig met openen…" : "Betaling beheren"}
        </Button>
      </div>
    </>
  );
}

/**
 * "2 van 3 herplaatsingen over" — the sentence the canvas draws, and the reason
 * `/api/me` grew a `relistQuotaPerPeriod` in T32 (#41).
 *
 * The pair is what makes it legible: the first number alone says nothing about
 * whether two is nearly all of them or nearly none. The plural agrees with the
 * grant rather than the remainder, so "1 van 3 herplaatsingen over" reads
 * correctly and a one-repost tier still says "1 van 1 herplaatsing over".
 *
 * **Users read "herplaatsing" and the code keeps "relist"** (ADR-0029). The wire
 * field it reads is still `relistQuotaPerPeriod`, and deliberately so — the split
 * is the same one the glossary draws between the brand name and `mprelist`, and it
 * is what let the copy become Dutch without touching a contract.
 */
export function repostsLeft(remaining: number, granted: number): string {
  return `${remaining} van ${granted} herplaatsing${granted === 1 ? "" : "en"} over`;
}

/**
 * "Reset op 14 sep", or nothing at all if the date cannot be read — a strip
 * reading `Reset op Invalid Date` is worse than one that says only what it knows.
 *
 * **Still spelled from a table rather than by `Intl`, and the reason survived the
 * translation intact.** `Intl` with `nl-NL` renders March as **"mrt."** on current
 * ICU and September as "sep." — with the trailing stop, and inconsistently across
 * ICU versions, exactly as `en-GB` disagreed with itself over "Sept" and "Sep". One
 * build would read differently on two Chromes and neither would match the design
 * canvas, which is the whole argument for the table and is not an argument about
 * which language it holds.
 *
 * The abbreviations are lower-case because that is how Dutch writes them; the line
 * begins with a capital because it begins a sentence, which is why the "Reset op"
 * carries it rather than the month.
 *
 * The date is read in the user's own zone, because the day their quota comes back
 * is the day on their own calendar.
 */
export function resetsOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `Reset op ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
