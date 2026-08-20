import { Button, Icon, IconButton, Note, Skeleton, Spinner } from "@mprelist/ui";
import type { DisplayState } from "@mprelist/contracts";
import type { JSX, ReactNode } from "react";

/**
 * The four screens, as functions of what they show and nothing else — no state,
 * no messaging, no clock beyond the one date they are handed. What decides
 * *which* of them is on the screen is `screen.ts`, and what fetches anything is
 * the worker.
 *
 * The layout is the design canvas's (`docs/design/`), and so are the words. One
 * deliberate departure, and it is in the header: the canvas has no sign-out
 * control anywhere, and the slice-A click-through ends by signing out. It is a
 * quiet text button rather than an invented glyph, since the icon set is the
 * canvas's too.
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
        <h1 className="popup-title">Put your ads back on top</h1>
        <p className="popup-copy">
          Sign in to relist your Marktplaats ads in one click. Three a month are free.
        </p>
        <Button shape="block" tone={busy ? "busy" : "primary"} onClick={onSignIn}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {failure ? <Note tone="error">{failure}</Note> : null}
        <p className="popup-micro">
          {__BRAND_NAME__} never sees your Marktplaats password — relisting runs in your own browser
          session.
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
        <Spinner size="lg" label="Loading your plan" />
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
        <h1 className="popup-title">Can’t reach {__BRAND_NAME__} right now</h1>
        <p className="popup-copy">
          Your plan and quota can’t be checked, so relisting is paused. Nothing has been changed on
          Marktplaats.
        </p>
        <Button shape="rect" tone={busy ? "busy" : "secondary"} onClick={onRetry}>
          {busy ? "Trying…" : "Try again"}
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
  onRefresh,
  onSignOut,
  busy,
}: {
  plan: DisplayState;
  onRefresh: () => void;
  onSignOut: () => void;
  busy: boolean;
}): JSX.Element {
  const spent = plan.quotaRemaining === 0;
  return (
    <>
      <Header
        actions={
          <>
            <IconButton label="Refresh" onClick={onRefresh} disabled={busy}>
              <Icon name="refresh" />
            </IconButton>
            <button type="button" className="popup-quiet" onClick={onSignOut} disabled={busy}>
              Sign out
            </button>
          </>
        }
      />
      <div className={spent ? "popup-plan popup-plan--spent" : "popup-plan"}>
        <span>
          <b>{plan.tier.name}</b> · {relistsLeft(plan.quotaRemaining)}
        </span>
        <span>{resetsOn(plan.resetAt)}</span>
      </div>
    </>
  );
}

/**
 * "2 relists left".
 *
 * **Not "2 of 3"**, which is what the canvas draws — `GET /api/me` carries what is
 * left and never what the tier grants, so the denominator is a number this popup
 * does not have. Rendering the half it has is the honest reading; closing the gap
 * is a contract change, and it is written down on T32 (#41) rather than guessed
 * at here.
 */
export function relistsLeft(remaining: number): string {
  if (remaining === 0) return "no relists left";
  return `${remaining} relist${remaining === 1 ? "" : "s"} left`;
}

/**
 * "resets 14 Sep", or nothing at all if the date cannot be read — a strip reading
 * `resets Invalid Date` is worse than one that says only what it knows.
 *
 * Spelled from a table rather than by `Intl`, which is the unusual choice and so
 * the one to write down. `Intl` with `en-GB` renders September as **"Sept"** on
 * current ICU and "Sep" on older ones, so one build would read differently on two
 * Chromes and neither would match the design canvas. The copy on this surface is
 * English and there is no localisation ticket; when there is one, this is the
 * function it replaces.
 *
 * The date is read in the user's own zone, because the day their quota comes back
 * is the day on their own calendar.
 */
export function resetsOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `resets ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
