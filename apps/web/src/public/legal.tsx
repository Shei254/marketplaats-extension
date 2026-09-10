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
 * payment details go to Stripe and we keep the customer reference (#30); and a
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
  updated: "1 september 2026",
  sections: [
    {
      heading: "Wat wij bewaren",
      body:
        "Je e-mailadres en een account-id van onze inlogdienst, het abonnement waar je op zit, en " +
        "een telling van de herplaatsingen die je hebt gedaan. Dat is de hele lijst.",
    },
    {
      heading: "Wat wij nooit zien",
      body:
        "Je Marktplaats-wachtwoord, je Marktplaats-sessie en de inhoud van je advertenties. Het " +
        "herplaatsen gebeurt volledig in je eigen browser onder je eigen Marktplaats-login — de tekst " +
        "en de foto's gaan van Marktplaats naar Marktplaats en bereiken ons nooit. Wij ontvangen " +
        "alleen het id van een advertentie die je hebt herplaatst.",
    },
    {
      heading: "Betalingen",
      body:
        "Je betaalgegevens gaan rechtstreeks naar Stripe, de betaaldienst die wij gebruiken, en naar " +
        `de betaalmethode die je daar kiest. ${BRAND.name} verwerkt ze nooit zelf. Wij bewaren de ` +
        "klantreferentie die Stripe ons geeft, zodat wij weten op welk abonnement je zit.",
    },
    {
      heading: "Wie het verder krijgt",
      body:
        "Niemand. Wij verkopen geen gegevens en er zit geen analyse- of advertentiecode in de extensie.",
    },
    {
      heading: "Je account verwijderen",
      body:
        "Mail ons en alles hierboven wordt verwijderd. Je Marktplaats-advertenties blijven ongemoeid " +
        "— die waren nooit van ons.",
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Voorwaarden",
  updated: "1 september 2026",
  sections: [
    {
      heading: `Wat ${BRAND.name} doet`,
      body:
        `${BRAND.name} verwijdert een van je Marktplaats-advertenties en plaatst deze direct opnieuw, ` +
        "zodat hij weer bovenaan de recente advertenties verschijnt. Dat is het hele product.",
    },
    {
      heading: "Dit verwijdert je advertentie, en dat moet je weten",
      body:
        `Herplaatsen betekent dat de oorspronkelijke advertentie wordt verwijderd. ${BRAND.name} slaat ` +
        "eerst elk veld en elke foto op en zet die terug, maar als Marktplaats de nieuwe advertentie " +
        "weigert, is de oude al weg. Herplaats geen advertentie die je niet kwijt kunt.",
    },
    {
      heading: "Je Marktplaats-account is van jou",
      body:
        "Je bent zelf verantwoordelijk voor hoe je je eigen account gebruikt, inclusief de voorwaarden " +
        `van Marktplaats zelf. ${BRAND.name} spreidt herplaatsingen om het gedrag redelijk te houden, ` +
        "maar kan niet beloven dat Marktplaats er geen bezwaar tegen maakt.",
    },
    {
      heading: "Abonnementen en limieten",
      body:
        "Elk abonnement geeft een aantal herplaatsingen per maand. Ongebruikte herplaatsingen gaan " +
        "niet mee naar de volgende periode. Wij kunnen wijzigen wat een abonnement geeft; verlagen wij " +
        "dat, dan houd je waar je al voor betaald hebt tot je periode afloopt.",
    },
    {
      heading: "Opzeggen",
      body:
        "Je kunt op elk moment opzeggen via Betaling beheren in de extensie, dat de betaalpagina's " +
        "opent die Stripe voor je bijhoudt. Je houdt je betaalde abonnement tot de periode waarvoor je " +
        "betaald hebt afloopt en gaat daarna terug naar het gratis abonnement — je wordt nooit " +
        "buitengesloten van je eigen advertenties.",
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
      <p className="web-doc-updated">Laatst bijgewerkt op {document.updated}</p>
      <div className="web-doc-rule" />
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="web-doc-heading">{section.heading}</h2>
          <p className="web-doc-body">{section.body}</p>
        </section>
      ))}
      <p className="web-placeholder">
        <b>[PLACEHOLDER]</b> — dit is de structuur en een eerlijke beschrijving van wat{" "}
        {BRAND.name} doet. De bindende tekst moet door een jurist voordat de Web Store-vermelding
        online gaat.
      </p>
    </article>
  );
}
