import type { JSX } from "react";

import { BRAND } from "../brand";

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
 * **What is rendered is what the operator wrote, including where it does not match
 * this build.** The terms describe a gratis proefperiode (ADR-0006 ships none —
 * the free tier is permanent), billing per maand (T62, #128 sells a tier monthly
 * *and* annually) and cancelling via accountinstellingen (there are none; it is
 * the Stripe Customer Portal, reached from **Betaling beheren** in the popup).
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

export const PRIVACY: LegalDocument = {
  title: "Privacy",
  // The draft box came off this page on the same day it came off the terms, and
  // that is a change to the words a reader reads.
  updated: "22 september 2026",
  sections: [
    {
      heading: "Wat wij bewaren",
      body: [
        "Je e-mailadres en een account-id van onze inlogdienst, het abonnement waar je op zit, en " +
          "een telling van de herplaatsingen die je hebt gedaan. Dat is de hele lijst.",
      ],
    },
    {
      heading: "Wat wij nooit zien",
      body: [
        "Je Marktplaats-wachtwoord, je Marktplaats-sessie en de inhoud van je advertenties. Het " +
          "herplaatsen gebeurt volledig in je eigen browser onder je eigen Marktplaats-login — de tekst " +
          "en de foto's gaan van Marktplaats naar Marktplaats en bereiken ons nooit. Wij ontvangen " +
          "alleen het id van een advertentie die je hebt herplaatst.",
      ],
    },
    {
      heading: "Betalingen",
      body: [
        "Je betaalgegevens gaan rechtstreeks naar Stripe, de betaaldienst die wij gebruiken, en naar " +
          `de betaalmethode die je daar kiest. ${BRAND.name} verwerkt ze nooit zelf. Wij bewaren de ` +
          "klantreferentie die Stripe ons geeft, zodat wij weten op welk abonnement je zit.",
      ],
    },
    {
      heading: "Wie het verder krijgt",
      body: [
        "Niemand. Wij verkopen geen gegevens en er zit geen analyse- of advertentiecode in de extensie.",
      ],
    },
    {
      heading: "Je account verwijderen",
      body: [
        "Mail ons en alles hierboven wordt verwijderd. Je Marktplaats-advertenties blijven ongemoeid " +
          "— die waren nooit van ons.",
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Gebruiksvoorwaarden",
  updated: "22 september 2026",
  sections: [
    {
      heading: "Inleiding",
      body: [
        `Welkom bij ${BRAND.name}, een browserextensie voor verkopers op Marktplaats. Door onze ` +
          "website te gebruiken, stem je ermee in deze gebruiksvoorwaarden na te leven, die je toegang " +
          "tot en gebruik van het platform regelen.",
      ],
    },
    {
      heading: "Aanvaarding van de voorwaarden",
      body: [
        `Door de ${BRAND.name}-website en de bijbehorende functies te openen, te bekijken of te ` +
          "gebruiken, erken je dat je deze gebruiksvoorwaarden hebt gelezen en begrepen en dat je er " +
          "juridisch aan gebonden bent.",
        "Als je niet akkoord gaat met enig onderdeel van deze gebruiksvoorwaarden, mag je de website " +
          `niet gebruiken of openen. Je voortgezet gebruik van de ${BRAND.name}-website houdt in dat je ` +
          "akkoord gaat met eventuele wijzigingen of updates van deze gebruiksvoorwaarden. Raadpleeg dit " +
          "document regelmatig om op de hoogte te blijven van eventuele wijzigingen.",
      ],
    },
    // The two sections a reader needs before they press the button, kept where they
    // are read rather than at the end with the product detail: what this does, and
    // that doing it deletes the ad first (ADR-0002/0003).
    {
      heading: `Wat ${BRAND.name} doet`,
      body: [
        `${BRAND.name} verwijdert een van je Marktplaats-advertenties en plaatst deze direct opnieuw, ` +
          "zodat hij weer bovenaan de recente advertenties verschijnt. Dat is het hele product.",
      ],
    },
    {
      heading: "Dit verwijdert je advertentie, en dat moet je weten",
      body: [
        `Herplaatsen betekent dat de oorspronkelijke advertentie wordt verwijderd. ${BRAND.name} slaat ` +
          "eerst elk veld en elke foto op en zet die terug, maar als Marktplaats de nieuwe advertentie " +
          "weigert, is de oude al weg. Herplaats geen advertentie die je niet kwijt kunt.",
      ],
    },
    {
      heading: "Registratie en gebruikersaccount",
      body: [
        `Om toegang te krijgen tot bepaalde functies van de ${BRAND.name}-website, kan het nodig zijn ` +
          "een account aan te maken door een geldig e-mailadres te verstrekken. Door je te registreren, " +
          "stem je ermee in om je accountgegevens nauwkeurig, volledig en actueel te houden.",
        "Je bent verantwoordelijk voor het vertrouwelijk houden van je accountgegevens, waaronder je " +
          "e-mailadres en eventueel bijbehorend wachtwoord. Je stemt ermee in je accountgegevens niet met " +
          "anderen te delen en anderen geen toegang tot je account te geven. Elk ongeoorloofd gebruik van " +
          "je account of elke inbreuk op de beveiliging moet onmiddellijk aan ons worden gemeld.",
      ],
    },
    {
      heading: "Intellectuele-eigendomsrechten",
      body: [
        `${BRAND.name} respecteert de intellectuele-eigendomsrechten van anderen en verwacht van ` +
          "gebruikers dat zij hetzelfde doen. Onze website en de content daarop, waaronder maar niet " +
          "beperkt tot tekst, afbeeldingen, grafische elementen en logo's, zijn eigendom van " +
          `${BRAND.name} of zijn licentiegevers en worden beschermd door auteursrecht, merkenrecht en ` +
          "andere wetten inzake intellectuele eigendom.",
        "Door onze website te gebruiken, stem je ermee in onze content of content van derden die op " +
          "onze website beschikbaar is, niet te kopiëren, reproduceren, verspreiden of exploiteren zonder " +
          `uitdrukkelijke schriftelijke toestemming van ${BRAND.name} of de betreffende rechthebbende.`,
      ],
    },
    {
      heading: "Beëindiging en verwijdering van accounts",
      body: [
        `${BRAND.name} behoudt zich het recht voor om naar eigen goeddunken je toegang tot onze website ` +
          "en diensten zonder voorafgaande kennisgeving op te schorten of te beëindigen, om welke reden " +
          "dan ook, waaronder maar niet beperkt tot:",
        [
          "Schending van deze gebruiksvoorwaarden of toepasselijke wet- of regelgeving;",
          "Het verstrekken van valse, misleidende of onjuiste informatie tijdens registratie of het " +
            "aanmaken van een account;",
          "Het uitvoeren van frauduleuze of illegale activiteiten;",
          "Het verstoren van de werking van onze website of diensten.",
        ],
        "Na beëindiging vervalt je recht om onze website en diensten te gebruiken onmiddellijk en kan " +
          `je account, samen met de bijbehorende content, worden verwijderd. ${BRAND.name} is niet ` +
          "aansprakelijk voor schade of verliezen die voortvloeien uit de beëindiging van je account of " +
          "het verwijderen van je content.",
        "Als je je account vrijwillig wilt verwijderen, kun je contact met ons opnemen via " +
          `${BRAND.supportEmail}. Wij helpen je dan met dit proces. Houd er rekening mee dat het ` +
          "verwijderen van je account kan leiden tot verlies van toegang tot bepaalde functies en " +
          "verwijdering van content die aan je account is gekoppeld.",
      ],
    },
    {
      heading: "Geschillen en klachten",
      body: [
        "Als je zorgen of geschillen hebt met betrekking tot onze website, diensten of deze " +
          `gebruiksvoorwaarden, raden wij je aan contact met ons op te nemen via ${BRAND.supportEmail}. ` +
          "Wij zullen ons best doen om je zorgen te behandelen en problemen op een eerlijke en tijdige " +
          "manier op te lossen.",
      ],
    },
    {
      heading: "Uitsluiting van garanties en beperking van aansprakelijkheid",
      body: [
        `${BRAND.name} biedt zijn website en diensten aan op basis van “zoals deze is” en “zoals ` +
          "beschikbaar”, zonder enige uitdrukkelijke of impliciete garantie, waaronder maar niet beperkt " +
          "tot garanties met betrekking tot verkoopbaarheid, geschiktheid voor een bepaald doel of het " +
          "niet maken van inbreuk op rechten van derden.",
        "Wij garanderen niet dat onze website of diensten foutloos, veilig of ononderbroken zullen " +
          "zijn, of dat de content nauwkeurig of volledig zal zijn.",
        `Voor zover maximaal toegestaan door de wet, zijn ${BRAND.name} en zijn gelieerde ondernemingen, ` +
          "functionarissen, bestuurders, werknemers en agenten niet aansprakelijk voor enige directe, " +
          "indirecte, incidentele, bijzondere, gevolg- of punitieve schade, waaronder maar niet beperkt " +
          "tot verlies van winst, gegevens, gebruik of goodwill, die voortvloeit uit je toegang tot of " +
          "gebruik van, of het onvermogen om toegang te krijgen tot of gebruik te maken van, onze website " +
          "of diensten, ongeacht of wij op de hoogte zijn gesteld van de mogelijkheid van dergelijke " +
          "schade.",
      ],
    },
    {
      heading: "Abonnementen en limieten",
      body: [
        "Elk abonnement geeft een aantal herplaatsingen per maand. Ongebruikte herplaatsingen gaan " +
          "niet mee naar de volgende periode.",
        "Loopt een betaald abonnement af, dan ga je terug naar het gratis abonnement — je wordt nooit " +
          "buitengesloten van je eigen advertenties.",
      ],
    },
    {
      heading: "Betaling, terugbetalingen, upgrades en downgrades",
      body: [
        "Voor onze gratis proefperiode vermelden we de duur van de proefperiode wanneer je je aanmeldt. " +
          "We vragen niet om je creditcardgegevens en, net als bij klanten die voor onze diensten betalen, " +
          "verkopen we je gegevens niet.",
        "Als je een chargeback initieert bij je bank of kaartuitgever, wordt je account onmiddellijk " +
          "opgeschort. Toegang tot de dienst wordt pas hersteld nadat het volledige openstaande bedrag is " +
          "terugbetaald, inclusief eventuele kosten die als gevolg van de chargeback zijn ontstaan.",
        "Als je van een gratis proefperiode overstapt naar een betaald abonnement, wordt het bedrag " +
          "onmiddellijk in rekening gebracht en begint je factureringscyclus op de dag van de upgrade.",
        "Betalende klanten worden automatisch per maand gefactureerd. Abonnementen worden aan het einde " +
          "van elke factureringsperiode (maandelijks of jaarlijks) automatisch verlengd totdat ze worden " +
          "geannuleerd. Je kunt je abonnement op elk moment annuleren via je accountinstellingen. De " +
          "annulering wordt van kracht aan het einde van de lopende factureringsperiode.",
        "Je kunt je abonnementniveau op elk moment upgraden of downgraden via je accountinstellingen. " +
          "Een downgrade kan leiden tot verlies van functies of capaciteit binnen je account. " +
          `${BRAND.name} aanvaardt geen verantwoordelijkheid voor een dergelijk verlies.`,
        "Betaalde bedragen worden niet terugbetaald.",
      ],
    },
    {
      heading: "Herroepingsrecht (EU-consumenten)",
      body: [
        "Overeenkomstig Europese Richtlijn 2011/83/EU inzake consumentenrechten heb je vanaf de datum " +
          "van inschrijving een herroepingsrecht van 14 dagen, zonder dat je daarvoor een reden hoeft op " +
          "te geven.",
        "Wanneer je er echter mee instemt dat de toegang tot de dienst onmiddellijk na je abonnement " +
          "begint, erken je uitdrukkelijk afstand te doen van je herroepingsrecht. Deze afstand wordt " +
          "tijdens het betalingsproces en in de orderbevestigingsmail bevestigd.",
        "Als je niet hebt ingestemd met de onmiddellijke start van de dienst, kun je je herroepingsrecht " +
          "uitoefenen door binnen 14 dagen na je inschrijving contact met ons op te nemen via " +
          `${BRAND.supportEmail}.`,
      ],
    },
    {
      heading: "Wijzigingen in de dienst en prijzen",
      body: [
        "Wij behouden ons het recht voor om op elk moment en van tijd tot tijd elk onderdeel van de " +
          "dienst, tijdelijk of permanent, met of zonder voorafgaande kennisgeving te wijzigen of stop te " +
          "zetten.",
        "Soms wijzigen we de prijsstructuur van onze producten. Wanneer we dit doen, stellen we " +
          "bestaande klanten doorgaans vrij van deze wijzigingen. We kunnen er echter voor kiezen om " +
          "prijzen voor bestaande klanten te wijzigen. In dat geval stellen we je ten minste 30 dagen van " +
          "tevoren op de hoogte via het e-mailadres dat bij ons geregistreerd staat.",
        `${BRAND.name} is niet aansprakelijk jegens jou of enige derde partij voor enige wijziging, ` +
          "prijsverandering, opschorting of beëindiging van de dienst.",
      ],
    },
    {
      heading: "Je Marktplaats-account is van jou",
      body: [
        "Je bent zelf verantwoordelijk voor hoe je je eigen account gebruikt, inclusief de voorwaarden " +
          `van Marktplaats zelf. ${BRAND.name} spreidt herplaatsingen om het gedrag redelijk te houden, ` +
          "maar kan niet beloven dat Marktplaats er geen bezwaar tegen maakt.",
      ],
    },
    {
      heading: "Relatie met Marktplaats",
      body: [
        "Wij zijn niet gelieerd aan of gecertificeerd door Marktplaats. Marktplaats is een geregistreerd " +
          "handelsmerk van ©Marktplaats. Wij zijn niet verantwoordelijk voor problemen die kunnen ontstaan " +
          "met Marktplaats of enige andere derde partij.",
      ],
    },
    {
      heading: "Wijzigingen in de gebruiksvoorwaarden",
      body: [
        `${BRAND.name} behoudt zich het recht voor om deze gebruiksvoorwaarden op elk moment en naar ` +
          "eigen goeddunken te wijzigen of aan te passen. Alle wijzigingen worden onmiddellijk van kracht " +
          "zodra de bijgewerkte gebruiksvoorwaarden op onze website zijn gepubliceerd.",
        "Je voortgezet gebruik van onze website en diensten na het publiceren van wijzigingen houdt in " +
          "dat je de bijgewerkte voorwaarden accepteert.",
        "Wij raden je aan deze gebruiksvoorwaarden regelmatig te raadplegen om op de hoogte te blijven " +
          "van eventuele updates. Als je niet akkoord gaat met de bijgewerkte voorwaarden, dien je het " +
          "gebruik van onze website en diensten te staken.",
      ],
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
