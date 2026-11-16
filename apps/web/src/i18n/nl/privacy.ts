import type { LegalDocument } from "../../public/legal";

/**
 * The privacy page in Dutch (ADR-0043). `../../public/legal.tsx` lays it out and
 * says what every claim here is held to; `{{brand}}` is the product's name.
 *
 * A block is a paragraph, or the items of a bulleted list.
 */
export const privacy = {
  title: "Privacy",
  // The draft box came off this page on the same day it came off the terms, and
  // that is a change to the words a reader reads.
  updated: "22 september 2026",
  sections: [
    {
      heading: "Wat wij bewaren",
      body: [
        "Je e-mailadres en een account-id van onze inlogdienst, het abonnement waar je op zit, en een telling van de herplaatsingen die je hebt gedaan. Dat is de hele lijst.",
      ],
    },
    {
      heading: "Wat wij nooit zien",
      body: [
        "Je Marktplaats-wachtwoord, je Marktplaats-sessie en de inhoud van je advertenties. Het herplaatsen gebeurt volledig in je eigen browser onder je eigen Marktplaats-login — de tekst en de foto's gaan van Marktplaats naar Marktplaats en bereiken ons nooit. Wij ontvangen alleen het id van een advertentie die je hebt herplaatst.",
      ],
    },
    {
      heading: "Betalingen",
      body: [
        "Je betaalgegevens gaan rechtstreeks naar Stripe, de betaaldienst die wij gebruiken, en naar de betaalmethode die je daar kiest. {{brand}} verwerkt ze nooit zelf. Wij bewaren de klantreferentie die Stripe ons geeft, zodat wij weten op welk abonnement je zit.",
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
        "Mail ons en alles hierboven wordt verwijderd. Je Marktplaats-advertenties blijven ongemoeid — die waren nooit van ons.",
      ],
    },
  ],
} satisfies LegalDocument;
