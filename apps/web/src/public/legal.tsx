import type { JSX } from "react";

import { BRAND } from "../brand";

/**
 * Privacy and terms (T36, #45) — the two documents the Chrome Web Store listing
 * cannot go up without ([#89](https://github.com/Shei254/marketplaats-extension/issues/89)),
 * since it requires a hosted privacy policy URL.
 *
 * **The words are the design canvas's** — `docs/design/Privacy.dc.html` and
 * `Terms.dc.html` — with the product's name substituted from `brand.json` rather
 * than typed in, because it is provisional until T60 (#91). They are structure and
 * an honest description of what this product does, and both pages say so on their
 * face: **the binding text needs a lawyer before the listing goes up**, and that
 * sentence is rendered rather than left in a comment so that nobody reads the page
 * as legal advice it is not.
 *
 * **Nothing here is invented.** Every claim is one the code makes true and can be
 * checked against it: what the API stores is `app_user.idp_subject`, a tier and a
 * count of reservations; the ad's text and photos are copied Marktplaats to
 * Marktplaats by the extension and only the ad's id ever reaches our API (#22);
 * card details go to Stripe and we keep the customer reference (#30); and a
 * lapsed subscription falls back to the free tier rather than locking anybody out
 * (ADR-0018). A privacy page that promised more than the schema can keep would be
 * worse than none.
 *
 * The most important sentence in the product is on the terms page: **relisting
 * deletes the original ad first** (ADR-0002/0003). It is the thing a user most
 * needs to know before they press the button, and `legal.test.tsx` holds the page
 * to it.
 */
export interface LegalSection {
  readonly heading: string;
  readonly body: string;
}

export interface LegalDocument {
  readonly title: string;
  /** When the words last changed, which is when the canvas wrote them. */
  readonly updated: string;
  readonly sections: readonly LegalSection[];
}

export const PRIVACY: LegalDocument = {
  title: "Privacy",
  updated: "20 August 2026",
  sections: [
    {
      heading: "What we store",
      body:
        "Your email address and an account id from our sign-in provider, the plan you are on, and a " +
        "count of relists you have made. That is the whole list.",
    },
    {
      heading: "What we never see",
      body:
        "Your Marktplaats password, your Marktplaats session, and the contents of your ads. Relisting " +
        "runs entirely in your own browser under your own Marktplaats login — the ad text and photos " +
        "are copied from Marktplaats to Marktplaats and never reach us. We only ever receive the id of " +
        "an ad you relisted.",
    },
    {
      heading: "Payments",
      body:
        `Card details go straight to Stripe and are never handled by ${BRAND.name}. We store the ` +
        "customer reference Stripe gives us so we know which plan you are on.",
    },
    {
      heading: "Who else gets it",
      body:
        "Nobody. We do not sell data, and there is no analytics or advertising code in the extension.",
    },
    {
      heading: "Deleting your account",
      body:
        "Email us and everything above is removed. Your Marktplaats ads are unaffected — they were " +
        "never ours.",
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Terms",
  updated: "20 August 2026",
  sections: [
    {
      heading: `What ${BRAND.name} does`,
      body:
        `${BRAND.name} deletes one of your Marktplaats ads and immediately posts it again, so it ` +
        "reappears at the top of recent listings. That is the whole product.",
    },
    {
      heading: "This is destructive, and you should know it",
      body:
        `Relisting means the original ad is deleted. ${BRAND.name} saves every field and photo first ` +
        "and restores them, but if Marktplaats rejects the new ad the old one is already gone. Do not " +
        "relist an ad you cannot afford to lose.",
    },
    {
      heading: "Your Marktplaats account is yours",
      body:
        "You are responsible for how you use your own account, including Marktplaats’ own terms. " +
        `${BRAND.name} paces relists to keep behaviour reasonable, but it cannot promise Marktplaats ` +
        "will not object.",
    },
    {
      heading: "Plans and quotas",
      body:
        "Each plan grants a number of relists per month. Unused relists do not carry over. We may " +
        "change what a plan grants; if we lower it, you keep what you already paid for until your " +
        "period ends.",
    },
    {
      heading: "Cancelling",
      body:
        "Cancel any time from the Stripe portal. You keep your paid plan until the period you paid " +
        "for runs out, then drop back to the free plan — you are never locked out of your own ads.",
    },
  ],
};

export function PrivacyPage(): JSX.Element {
  return <Document document={PRIVACY} />;
}

export function TermsPage(): JSX.Element {
  return <Document document={TERMS} />;
}

/**
 * One document, laid out the way the canvas lays both of them out: a title, when
 * it last changed, a rule, and then headed sections.
 *
 * The two pages share this rather than each drawing their own, so that adding a
 * third — a cookie notice, an imprint — is a constant and not a fourth layout.
 */
function Document({ document }: { document: LegalDocument }): JSX.Element {
  return (
    <article className="web-doc">
      <h1 className="web-doc-title">{document.title}</h1>
      <p className="web-doc-updated">Last updated {document.updated}</p>
      <div className="web-doc-rule" />
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="web-doc-heading">{section.heading}</h2>
          <p className="web-doc-body">{section.body}</p>
        </section>
      ))}
      <p className="web-placeholder">
        <b>[PLACEHOLDER]</b> — this is the structure and the honest description of what {BRAND.name}{" "}
        does. The binding text needs a lawyer before the Web Store listing goes up.
      </p>
    </article>
  );
}
