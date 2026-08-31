import { Icon } from "@mprelist/ui";
import type { JSX, ReactNode } from "react";

import { BRAND } from "../brand";

/**
 * The public pages, as functions of nothing at all (T50, #81).
 *
 * **They never learn who anybody is**, and that is the decision rather than an
 * omission — ADR-0017. Stripe redirects a browser here the moment a payment
 * lands; the webhook (T20, #30) is what moves the subscription, so there is
 * nothing on this screen worth authenticating for and no question to ask the API.
 * `no-identity.test.ts` holds the whole directory to that: no fetch, no storage,
 * no cookie, in a bundle a stranger reaches without signing in.
 *
 * The words and the layout are the canvas's — `docs/design/Success.dc.html` and
 * `Cancel.dc.html` — with the product's name substituted from `brand.json` rather
 * than typed in, because it is provisional until T60 (#91). `NotFoundPage` and
 * `BillingPage` have no artboard: one is what an address nobody claimed gets, and
 * the other is where the Stripe Customer Portal drops a browser on its way out.
 * Both borrow the shape of the two that were drawn.
 */

/** The line every one of these pages ends on: the product is in the toolbar, not here. */
function Callout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="web-callout">
      <span className="web-callout-mark">
        <Icon name="logo" />
      </span>
      <span>{children}</span>
    </p>
  );
}

export function SuccessPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--ok">
        <Icon name="check" size={26} />
      </div>
      <h1 className="web-title">You’re all set</h1>
      <p className="web-copy">
        Your payment went through. Open the {BRAND.name} icon in your browser toolbar — your new
        relist allowance is already there.
      </p>
      <Callout>
        Click the <b>{BRAND.name}</b> icon in your toolbar
      </Callout>
      <p className="web-micro">Nothing to do here — you can close this tab.</p>
    </>
  );
}

export function CancelPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="close" />
      </div>
      <h1 className="web-title">No payment was taken</h1>
      <p className="web-copy">
        You closed checkout before finishing, so nothing was charged and nothing changed. Your free
        relists are still there.
      </p>
      <Callout>Reopen {BRAND.name} whenever you want to try again</Callout>
    </>
  );
}

/**
 * Where the Customer Portal's own "return" link lands (T21, #31).
 *
 * **It says nothing about what they did**, because it does not know and must not
 * guess: the same link is clicked by somebody who cancelled, somebody who changed
 * a card and somebody who only read an invoice. What moves the plan is the webhook
 * (T20, #30), so the page's whole job is to say the change is with Stripe and to
 * point back at the toolbar — including the delay, which is the one thing a
 * returning user is about to notice for themselves.
 *
 * **Stripe is named and then glossed** (T64). Dropping the name would be worse
 * than keeping it — it is what appears on the buyer’s bank statement — but it is
 * not a name this product’s users are assumed to know. And since PayPal joined
 * iDEAL, SEPA and card it is no longer "your card" they may have changed, so the
 * copy asks about *how they pay* instead.
 */
export function BillingPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="card" />
      </div>
      <h1 className="web-title">That’s saved</h1>
      <p className="web-copy">
        Whatever you changed — how you pay, your plan, or cancelling — is saved with Stripe, the
        payment provider we use. Open the {BRAND.name} icon in your browser toolbar to see where
        that leaves you; a change can take a moment to reach it.
      </p>
      <Callout>
        Click the <b>{BRAND.name}</b> icon in your toolbar
      </Callout>
      <p className="web-micro">Nothing to do here — you can close this tab.</p>
    </>
  );
}

export function NotFoundPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="warning" />
      </div>
      <h1 className="web-title">There’s nothing at this address</h1>
      <p className="web-copy">
        {BRAND.name} lives in your browser toolbar rather than on this site. If you have just paid,
        the payment landed — nothing here is part of it.
      </p>
      <Callout>
        Click the <b>{BRAND.name}</b> icon in your toolbar
      </Callout>
    </>
  );
}
