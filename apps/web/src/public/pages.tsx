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
      <h1 className="web-title">Alles is geregeld</h1>
      <p className="web-copy">
        Je betaling is gelukt. Open het {BRAND.name}-icoon in de werkbalk van je browser — je
        nieuwe herplaatsingen staan er al klaar.
      </p>
      <Callout>
        Klik op het <b>{BRAND.name}</b>-icoon in je werkbalk
      </Callout>
      <p className="web-micro">Hier hoef je niets te doen — je kunt dit tabblad sluiten.</p>
    </>
  );
}

export function CancelPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="close" />
      </div>
      <h1 className="web-title">Er is niets afgeschreven</h1>
      <p className="web-copy">
        Je hebt het afrekenen afgebroken, dus er is niets betaald en er is niets veranderd. Je
        gratis herplaatsingen staan er nog gewoon.
      </p>
      <Callout>Open {BRAND.name} opnieuw wanneer je het nog eens wilt proberen</Callout>
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
      <h1 className="web-title">Dat is opgeslagen</h1>
      <p className="web-copy">
        Wat je ook hebt gewijzigd — hoe je betaalt, je abonnement, of opzeggen — het is opgeslagen
        bij Stripe, de betaaldienst die wij gebruiken. Open het {BRAND.name}-icoon in de werkbalk van
        je browser om te zien wat dat betekent; het kan even duren voordat een wijziging daar is.
      </p>
      <Callout>
        Klik op het <b>{BRAND.name}</b>-icoon in je werkbalk
      </Callout>
      <p className="web-micro">Hier hoef je niets te doen — je kunt dit tabblad sluiten.</p>
    </>
  );
}

export function NotFoundPage(): JSX.Element {
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="warning" />
      </div>
      <h1 className="web-title">Op dit adres staat niets</h1>
      <p className="web-copy">
        {BRAND.name} zit in de werkbalk van je browser en niet op deze site. Heb je zojuist
        betaald, dan is die betaling gelukt — deze pagina hoort daar niet bij.
      </p>
      <Callout>
        Klik op het <b>{BRAND.name}</b>-icoon in je werkbalk
      </Callout>
    </>
  );
}
