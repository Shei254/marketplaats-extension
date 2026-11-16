import { Icon } from "@mprelist/ui";
import type { JSX, ReactNode } from "react";

import { Trans, useTranslation } from "../i18n/react";
import { STORE_URL } from "./store";

/**
 * The public pages, as functions of nothing at all (T50, #81).
 *
 * **They never learn who anybody is**, and that is the decision rather than an
 * omission — ADR-0017. Stripe redirects a browser here the moment a payment
 * lands; the webhook (T20, #30) is what moves the subscription, so there is
 * nothing on this screen worth authenticating for and no question to ask the API.
 * `no-identity.test.ts` holds the whole directory to that: no fetch, no storage,
 * no cookie, in a bundle a stranger reaches without signing in. That stayed true
 * when the landing page began selling (T85, ADR-0036): the session that does it
 * lives in `src/account/`, and none of these pages is handed it.
 *
 * **They no longer assume the extension is installed** (T85): somebody who paid on
 * the site may not have it yet, so the success page says where it is had, and the
 * cancel page points back at the plans as well as at the toolbar.
 *
 * The words and the layout are the canvas's — `docs/design/Success.dc.html` and
 * `Cancel.dc.html` — with the product's name substituted from `brand.json` rather
 * than typed in, because it is provisional until T60 (#91). `NotFoundPage` and
 * `BillingPage` have no artboard: one is what an address nobody claimed gets, and
 * the other is where the Stripe Customer Portal drops a browser on its way out.
 * Both borrow the shape of the two that were drawn.
 */

/**
 * "Klik op het **{brand}**-icoon in je werkbalk" — the line three of these pages
 * end on: the product is in the toolbar, not here.
 */
function ClickTheIcon(): JSX.Element {
  return (
    <Callout>
      <Trans i18nKey="pages.clickTheIcon" components={{ b: <b /> }} />
    </Callout>
  );
}

function Callout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="web-callout">
      <span className="mp-mark web-callout-mark">
        <Icon name="logo" />
      </span>
      <span>{children}</span>
    </p>
  );
}

export function SuccessPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="web-badge web-badge--ok">
        <Icon name="check" size={26} />
      </div>
      <h1 className="web-title">{t("pages.success.title")}</h1>
      <p className="web-copy">{t("pages.success.copy")}</p>
      <ClickTheIcon />
      <p className="web-micro">{t("pages.closeThisTab")}</p>
      <p className="web-micro">
        <Trans i18nKey="pages.success.notInstalled" components={{ a: <a href={STORE_URL} /> }} />
      </p>
    </>
  );
}

export function CancelPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="close" />
      </div>
      <h1 className="web-title">{t("pages.cancel.title")}</h1>
      <p className="web-copy">{t("pages.cancel.copy")}</p>
      <Callout>
        <Trans i18nKey="pages.cancel.tryAgain" components={{ a: <a href="/#abonnementen" /> }} />
      </Callout>
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
  const { t } = useTranslation();
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="card" />
      </div>
      <h1 className="web-title">{t("pages.billing.title")}</h1>
      <p className="web-copy">{t("pages.billing.copy")}</p>
      <ClickTheIcon />
      <p className="web-micro">{t("pages.closeThisTab")}</p>
    </>
  );
}

export function NotFoundPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <>
      <div className="web-badge web-badge--quiet">
        <Icon name="warning" />
      </div>
      <h1 className="web-title">{t("pages.notFound.title")}</h1>
      <p className="web-copy">{t("pages.notFound.copy")}</p>
      <ClickTheIcon />
    </>
  );
}
