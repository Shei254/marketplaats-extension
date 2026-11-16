import type { JSX } from "react";

import { useTranslation } from "../i18n/react";
import { t } from "../i18n/words";

/**
 * Privacy and terms (T36, #45) — the two documents the Chrome Web Store listing
 * cannot go up without ([#89](https://github.com/Shei254/marketplaats-extension/issues/89)),
 * since it requires a hosted privacy policy URL.
 *
 * **The terms are the operator's own Gebruiksvoorwaarden**, handed over as finished
 * copy and rendered as written. The structure of the privacy page is still the
 * design canvas's — `docs/design/Privacy.dc.html` — and the product's name comes
 * from `brand.json` on both rather than being typed in, as does the address the
 * terms invite the reader to write to.
 *
 * **The words themselves are in the catalog** (`../i18n/nl/privacy.ts` and
 * `terms.ts`, ADR-0043), one document per file; this file is their layout and
 * the record of what was decided about them.
 *
 * **What is rendered is what the operator wrote, including where it does not match
 * this build.** The terms describe a gratis proefperiode (ADR-0006 ships none —
 * the free tier is permanent) and cancelling via accountinstellingen (there are
 * none; it is the Stripe Customer Portal, reached from **Betaling beheren** in the
 * popup). They also said billing was per maand, which T62 (#128) made untrue by
 * selling a tier annually too; that one sentence was corrected on 2026-09-25 at
 * the operator's request (T87), and the rest stand as written.
 * That was asked for and decided on 2026-09-22; it is recorded here rather than
 * silently corrected, because the herroepingsrecht clause leans on the trial and
 * whoever reconciles the two will want to know it was a choice and not an
 * oversight.
 *
 * **One section went: *Opzeggen*.** The operator's copy describes cancelling
 * differently, and a terms page that named two routes would be one contradicting
 * itself. *Abonnementen en limieten* stayed, cut down to the facts that copy does
 * not touch — what a plan grants, that it does not carry over, and that a plan
 * running out returns somebody to the free tier rather than locking them out of
 * their own ads (ADR-0018). **It names no way to cancel**, which is what keeps it
 * and the operator's own payment section from disagreeing. The promise it used to
 * make about a lowered grant went with the route: *Wijzigingen in de dienst en
 * prijzen* now reserves that right in the operator's own words.
 *
 * **The privacy page still invents nothing.** Every claim on it is one the code
 * makes true and can be checked against it: what the API stores is
 * `app_user.idp_subject`, a tier and a count of reservations; the ad's text and
 * photos are copied Marktplaats to Marktplaats by the extension and only the ad's
 * id ever reaches our API (#22); payment details go to Stripe and we keep the
 * customer reference (#30). A privacy page that promised more than the schema can
 * keep would be worse than none.
 *
 * The most important sentence in the product is on the terms page: **relisting
 * deletes the original ad first** (ADR-0002/0003). It is the thing a user most
 * needs to know before they press the button, it survived the rewrite, and both
 * `legal.test.tsx` and `Site.test.tsx` hold the page to it.
 */

/**
 * One block of a section: a paragraph, or the items of a bulleted list.
 *
 * A section was one sentence while the copy was a description of the product.
 * A document that enumerates the grounds it can close an account on needs both,
 * and needs them *in order* — the grounds sit between two paragraphs. An array
 * of strings is the list rather than a tagged shape, so that the twenty-odd
 * paragraphs below stay readable as bare strings and only the one list is
 * punctuated.
 */
export type LegalBlock = string | readonly string[];

export interface LegalSection {
  readonly heading: string;
  readonly body: readonly LegalBlock[];
}

export interface LegalDocument {
  readonly title: string;
  /** When the words last changed. */
  readonly updated: string;
  readonly sections: readonly LegalSection[];
}

/** The two documents in Dutch, as the catalog holds them — what the tests read. */
export const PRIVACY: LegalDocument = t("privacy", { returnObjects: true });

export const TERMS: LegalDocument = t("terms", { returnObjects: true });

export function PrivacyPage(): JSX.Element {
  const { t } = useTranslation();
  return <Document document={t("privacy", { returnObjects: true })} />;
}

export function TermsPage(): JSX.Element {
  const { t } = useTranslation();
  return <Document document={t("terms", { returnObjects: true })} />;
}

/**
 * One document, laid out the way the canvas lays both of them out: a title, when
 * it last changed, a rule, and then headed sections.
 *
 * The two pages share this rather than each drawing their own, so that adding a
 * third — a cookie notice, an imprint — is a constant and not a fourth layout.
 */
function Document({ document }: { document: LegalDocument }): JSX.Element {
  const { t } = useTranslation();
  return (
    <article className="web-doc">
      <h1 className="web-doc-title">{document.title}</h1>
      <p className="web-doc-updated">{t("legal.updated", { date: document.updated })}</p>
      <div className="web-doc-rule" />
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="web-doc-heading">{section.heading}</h2>
          {section.body.map((block, at) =>
            Array.isArray(block) ? (
              // The index is the key because the only ordering here is the one
              // written above: these blocks are static copy, never reordered and
              // never filtered, so there is nothing an identity would survive.
              <ul className="web-doc-list" key={at}>
                {block.map((item, item_at) => (
                  <li key={item_at}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="web-doc-body" key={at}>
                {block}
              </p>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
