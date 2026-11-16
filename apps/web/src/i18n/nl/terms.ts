import type { LegalDocument } from "../../public/legal";

/**
 * The terms in Dutch — the operator's own Gebruiksvoorwaarden, as written
 * (ADR-0043). `../../public/legal.tsx` lays them out and records where they do
 * not match this build, and why that was left; `{{brand}}` is the product's name
 * and `{{supportEmail}}` the address they invite the reader to write to.
 *
 * A block is a paragraph, or the items of a bulleted list.
 */
export const terms = {
  title: "Gebruiksvoorwaarden",
  updated: "22 september 2026",
  sections: [
    {
      heading: "Inleiding",
      body: [
        "Welkom bij {{brand}}, een browserextensie voor verkopers op Marktplaats. Door onze website te gebruiken, stem je ermee in deze gebruiksvoorwaarden na te leven, die je toegang tot en gebruik van het platform regelen.",
      ],
    },
    {
      heading: "Aanvaarding van de voorwaarden",
      body: [
        "Door de {{brand}}-website en de bijbehorende functies te openen, te bekijken of te gebruiken, erken je dat je deze gebruiksvoorwaarden hebt gelezen en begrepen en dat je er juridisch aan gebonden bent.",
        "Als je niet akkoord gaat met enig onderdeel van deze gebruiksvoorwaarden, mag je de website niet gebruiken of openen. Je voortgezet gebruik van de {{brand}}-website houdt in dat je akkoord gaat met eventuele wijzigingen of updates van deze gebruiksvoorwaarden. Raadpleeg dit document regelmatig om op de hoogte te blijven van eventuele wijzigingen.",
      ],
    },
    // The two sections a reader needs before they press the button, kept where they
    // are read rather than at the end with the product detail: what this does, and
    // that doing it deletes the ad first (ADR-0002/0003).
    {
      heading: "Wat {{brand}} doet",
      body: [
        "{{brand}} verwijdert een van je Marktplaats-advertenties en plaatst deze direct opnieuw, zodat hij weer bovenaan de recente advertenties verschijnt. Dat is het hele product.",
      ],
    },
    {
      heading: "Dit verwijdert je advertentie, en dat moet je weten",
      body: [
        "Herplaatsen betekent dat de oorspronkelijke advertentie wordt verwijderd. {{brand}} slaat eerst elk veld en elke foto op en zet die terug, maar als Marktplaats de nieuwe advertentie weigert, is de oude al weg. Herplaats geen advertentie die je niet kwijt kunt.",
      ],
    },
    {
      heading: "Registratie en gebruikersaccount",
      body: [
        "Om toegang te krijgen tot bepaalde functies van de {{brand}}-website, kan het nodig zijn een account aan te maken door een geldig e-mailadres te verstrekken. Door je te registreren, stem je ermee in om je accountgegevens nauwkeurig, volledig en actueel te houden.",
        "Je bent verantwoordelijk voor het vertrouwelijk houden van je accountgegevens, waaronder je e-mailadres en eventueel bijbehorend wachtwoord. Je stemt ermee in je accountgegevens niet met anderen te delen en anderen geen toegang tot je account te geven. Elk ongeoorloofd gebruik van je account of elke inbreuk op de beveiliging moet onmiddellijk aan ons worden gemeld.",
      ],
    },
    {
      heading: "Intellectuele-eigendomsrechten",
      body: [
        "{{brand}} respecteert de intellectuele-eigendomsrechten van anderen en verwacht van gebruikers dat zij hetzelfde doen. Onze website en de content daarop, waaronder maar niet beperkt tot tekst, afbeeldingen, grafische elementen en logo's, zijn eigendom van {{brand}} of zijn licentiegevers en worden beschermd door auteursrecht, merkenrecht en andere wetten inzake intellectuele eigendom.",
        "Door onze website te gebruiken, stem je ermee in onze content of content van derden die op onze website beschikbaar is, niet te kopiëren, reproduceren, verspreiden of exploiteren zonder uitdrukkelijke schriftelijke toestemming van {{brand}} of de betreffende rechthebbende.",
      ],
    },
    {
      heading: "Beëindiging en verwijdering van accounts",
      body: [
        "{{brand}} behoudt zich het recht voor om naar eigen goeddunken je toegang tot onze website en diensten zonder voorafgaande kennisgeving op te schorten of te beëindigen, om welke reden dan ook, waaronder maar niet beperkt tot:",
        [
          "Schending van deze gebruiksvoorwaarden of toepasselijke wet- of regelgeving;",
          "Het verstrekken van valse, misleidende of onjuiste informatie tijdens registratie of het aanmaken van een account;",
          "Het uitvoeren van frauduleuze of illegale activiteiten;",
          "Het verstoren van de werking van onze website of diensten.",
        ],
        "Na beëindiging vervalt je recht om onze website en diensten te gebruiken onmiddellijk en kan je account, samen met de bijbehorende content, worden verwijderd. {{brand}} is niet aansprakelijk voor schade of verliezen die voortvloeien uit de beëindiging van je account of het verwijderen van je content.",
        "Als je je account vrijwillig wilt verwijderen, kun je contact met ons opnemen via {{supportEmail}}. Wij helpen je dan met dit proces. Houd er rekening mee dat het verwijderen van je account kan leiden tot verlies van toegang tot bepaalde functies en verwijdering van content die aan je account is gekoppeld.",
      ],
    },
    {
      heading: "Geschillen en klachten",
      body: [
        "Als je zorgen of geschillen hebt met betrekking tot onze website, diensten of deze gebruiksvoorwaarden, raden wij je aan contact met ons op te nemen via {{supportEmail}}. Wij zullen ons best doen om je zorgen te behandelen en problemen op een eerlijke en tijdige manier op te lossen.",
      ],
    },
    {
      heading: "Uitsluiting van garanties en beperking van aansprakelijkheid",
      body: [
        "{{brand}} biedt zijn website en diensten aan op basis van “zoals deze is” en “zoals beschikbaar”, zonder enige uitdrukkelijke of impliciete garantie, waaronder maar niet beperkt tot garanties met betrekking tot verkoopbaarheid, geschiktheid voor een bepaald doel of het niet maken van inbreuk op rechten van derden.",
        "Wij garanderen niet dat onze website of diensten foutloos, veilig of ononderbroken zullen zijn, of dat de content nauwkeurig of volledig zal zijn.",
        "Voor zover maximaal toegestaan door de wet, zijn {{brand}} en zijn gelieerde ondernemingen, functionarissen, bestuurders, werknemers en agenten niet aansprakelijk voor enige directe, indirecte, incidentele, bijzondere, gevolg- of punitieve schade, waaronder maar niet beperkt tot verlies van winst, gegevens, gebruik of goodwill, die voortvloeit uit je toegang tot of gebruik van, of het onvermogen om toegang te krijgen tot of gebruik te maken van, onze website of diensten, ongeacht of wij op de hoogte zijn gesteld van de mogelijkheid van dergelijke schade.",
      ],
    },
    {
      heading: "Abonnementen en limieten",
      body: [
        "Elk abonnement geeft een aantal herplaatsingen per maand. Ongebruikte herplaatsingen gaan niet mee naar de volgende periode.",
        "Loopt een betaald abonnement af, dan ga je terug naar het gratis abonnement — je wordt nooit buitengesloten van je eigen advertenties.",
      ],
    },
    {
      heading: "Betaling, terugbetalingen, upgrades en downgrades",
      body: [
        "Voor onze gratis proefperiode vermelden we de duur van de proefperiode wanneer je je aanmeldt. We vragen niet om je creditcardgegevens en, net als bij klanten die voor onze diensten betalen, verkopen we je gegevens niet.",
        "Als je een chargeback initieert bij je bank of kaartuitgever, wordt je account onmiddellijk opgeschort. Toegang tot de dienst wordt pas hersteld nadat het volledige openstaande bedrag is terugbetaald, inclusief eventuele kosten die als gevolg van de chargeback zijn ontstaan.",
        "Als je van een gratis proefperiode overstapt naar een betaald abonnement, wordt het bedrag onmiddellijk in rekening gebracht en begint je factureringscyclus op de dag van de upgrade.",
        "Betalende klanten worden automatisch per maand of per jaar gefactureerd, afhankelijk van het gekozen abonnement. Abonnementen worden aan het einde van elke factureringsperiode (maandelijks of jaarlijks) automatisch verlengd totdat ze worden geannuleerd. Je kunt je abonnement op elk moment annuleren via je accountinstellingen. De annulering wordt van kracht aan het einde van de lopende factureringsperiode.",
        "Je kunt je abonnementniveau op elk moment upgraden of downgraden via je accountinstellingen. Een downgrade kan leiden tot verlies van functies of capaciteit binnen je account. {{brand}} aanvaardt geen verantwoordelijkheid voor een dergelijk verlies.",
        "Betaalde bedragen worden niet terugbetaald.",
      ],
    },
    {
      heading: "Herroepingsrecht (EU-consumenten)",
      body: [
        "Overeenkomstig Europese Richtlijn 2011/83/EU inzake consumentenrechten heb je vanaf de datum van inschrijving een herroepingsrecht van 14 dagen, zonder dat je daarvoor een reden hoeft op te geven.",
        "Wanneer je er echter mee instemt dat de toegang tot de dienst onmiddellijk na je abonnement begint, erken je uitdrukkelijk afstand te doen van je herroepingsrecht. Deze afstand wordt tijdens het betalingsproces en in de orderbevestigingsmail bevestigd.",
        "Als je niet hebt ingestemd met de onmiddellijke start van de dienst, kun je je herroepingsrecht uitoefenen door binnen 14 dagen na je inschrijving contact met ons op te nemen via {{supportEmail}}.",
      ],
    },
    {
      heading: "Wijzigingen in de dienst en prijzen",
      body: [
        "Wij behouden ons het recht voor om op elk moment en van tijd tot tijd elk onderdeel van de dienst, tijdelijk of permanent, met of zonder voorafgaande kennisgeving te wijzigen of stop te zetten.",
        "Soms wijzigen we de prijsstructuur van onze producten. Wanneer we dit doen, stellen we bestaande klanten doorgaans vrij van deze wijzigingen. We kunnen er echter voor kiezen om prijzen voor bestaande klanten te wijzigen. In dat geval stellen we je ten minste 30 dagen van tevoren op de hoogte via het e-mailadres dat bij ons geregistreerd staat.",
        "{{brand}} is niet aansprakelijk jegens jou of enige derde partij voor enige wijziging, prijsverandering, opschorting of beëindiging van de dienst.",
      ],
    },
    {
      heading: "Je Marktplaats-account is van jou",
      body: [
        "Je bent zelf verantwoordelijk voor hoe je je eigen account gebruikt, inclusief de voorwaarden van Marktplaats zelf. {{brand}} spreidt herplaatsingen om het gedrag redelijk te houden, maar kan niet beloven dat Marktplaats er geen bezwaar tegen maakt.",
      ],
    },
    {
      heading: "Relatie met Marktplaats",
      body: [
        "Wij zijn niet gelieerd aan of gecertificeerd door Marktplaats. Marktplaats is een geregistreerd handelsmerk van ©Marktplaats. Wij zijn niet verantwoordelijk voor problemen die kunnen ontstaan met Marktplaats of enige andere derde partij.",
      ],
    },
    {
      heading: "Wijzigingen in de gebruiksvoorwaarden",
      body: [
        "{{brand}} behoudt zich het recht voor om deze gebruiksvoorwaarden op elk moment en naar eigen goeddunken te wijzigen of aan te passen. Alle wijzigingen worden onmiddellijk van kracht zodra de bijgewerkte gebruiksvoorwaarden op onze website zijn gepubliceerd.",
        "Je voortgezet gebruik van onze website en diensten na het publiceren van wijzigingen houdt in dat je de bijgewerkte voorwaarden accepteert.",
        "Wij raden je aan deze gebruiksvoorwaarden regelmatig te raadplegen om op de hoogte te blijven van eventuele updates. Als je niet akkoord gaat met de bijgewerkte voorwaarden, dien je het gebruik van onze website en diensten te staken.",
      ],
    },
  ],
} satisfies LegalDocument;
