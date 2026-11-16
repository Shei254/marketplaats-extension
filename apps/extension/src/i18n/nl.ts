/**
 * **Our words** in Dutch, for the popup, the **Page button** and the worker — the
 * source catalog, and the one the keys are typed from (ADR-0043).
 *
 * Marktplaats's own labels (*Gereserveerd*, *Bieden*, *Gratis*, *Zie beschrijving*)
 * are here because this is where the extension writes them, and they are written
 * as Marktplaats writes them in every Language. `{{brand}}` is the build's brand
 * name, which `./words` supplies to every sentence.
 */
export const nl = {
  common: {
    busy: "Bezig…",
    tryAgain: "Opnieuw proberen",
    again: "Opnieuw",
    cancel: "Annuleren",
    close: "Sluiten",
    refresh: "Vernieuwen",
    seePlans: "Bekijk abonnementen",
    opening: "Bezig met openen…",
    oneMoment: "Een moment…",
    nothingChangedOnMarktplaats:
      "Er is niets gewijzigd op Marktplaats en je advertenties staan precies waar je ze hebt achtergelaten.",
  },
  header: {
    // Not "Abonnementen": with the Language switch beside the theme switch (T97)
    // that word left no room for either in a 360px header. The plan screens and
    // the site still say Abonnementen.
    plans: "Plannen",
    signOut: "Uitloggen",
    back: "Terug",
    darkMode: "Donkere modus",
    lightMode: "Lichte modus",
  },
  signedOut: {
    title: "Zet je advertenties weer bovenaan",
    copy: "Log in om je Marktplaats-advertenties met één klik te herplaatsen.",
    signIn: "Inloggen",
    signingIn: "Bezig met inloggen…",
    micro: "{{brand}} ziet je Marktplaats-wachtwoord nooit — het herplaatsen gebeurt in je eigen browsersessie.",
    failed: "Inloggen is niet gelukt. Probeer het opnieuw.",
  },
  loading: "Je abonnement wordt geladen",
  outdated: {
    title: "{{brand}} moet worden bijgewerkt",
    copy: "Deze versie is te oud om veilig te blijven herplaatsen, dus dat is gestopt. Chrome werkt extensies meestal binnen een paar uur bij — open dit dan opnieuw.",
  },
  noTier: {
    title: "Er staat nu geen abonnement op dit account",
    nothingToBuy:
      "Het abonnement waar je op zat bestaat niet meer, en er is nog geen ander ingesteld. Herplaatsen is daarom gepauzeerd tot dat gebeurd is.",
    chooseOne:
      "Het abonnement waar je op zat bestaat niet meer. Kies hieronder een abonnement om weer te kunnen herplaatsen.",
    resolvesItself: " Dit lost zich vanzelf op — opnieuw proberen helpt niet.",
  },
  unavailable: {
    title: "{{brand}} is nu niet bereikbaar",
    copy: "Je abonnement en limiet kunnen niet worden gecontroleerd, dus herplaatsen is gepauzeerd. Er is niets gewijzigd op Marktplaats.",
  },
  plan: {
    paymentFailed: "betaling mislukt",
    grantsNothing: "Geen herplaatsingen in dit abonnement",
    grant_one: "{{count}} herplaatsing",
    grant_other: "{{count}} herplaatsingen",
    left_one: "{{remaining}} van {{count}} herplaatsing over",
    left_other: "{{remaining}} van {{count}} herplaatsingen over",
    resetsOn: "Reset op {{day}} {{month}}",
    monthsShort: {
      "0": "jan",
      "1": "feb",
      "2": "mrt",
      "3": "apr",
      "4": "mei",
      "5": "jun",
      "6": "jul",
      "7": "aug",
      "8": "sep",
      "9": "okt",
      "10": "nov",
      "11": "dec",
    },
  },
  exhausted: {
    title: "Je hebt je limiet voor herplaatsingen in deze periode bereikt",
    comeBackOn: "Ze resetten op {{day}} {{month}}.",
    comeBack: "Ze resetten wanneer de periode wordt vernieuwd.",
  },
  noReposts: {
    title: "Dit abonnement bevat geen herplaatsingen",
    copy: "Met een betaald abonnement krijg je ze wel.",
  },
  dunning: {
    title: "Je betaling is niet gelukt",
    copy: "We blijven het proberen. Werk je betaalgegevens bij om weer te kunnen herplaatsen — je abonnement is nog steeds {{tier}}.",
    updateCard: "Betaalgegevens bijwerken",
  },
  plans: {
    title: "Kies een abonnement",
    lede: "Het afrekenen wordt geopend in een nieuw tabblad. Kom daarna hier terug.",
    payWith: "Je kunt betalen met iDEAL | Wero, PayPal, creditcard en debitcard",
    fine: "Je kunt op elk moment opzeggen — je gaat dan terug naar Gratis en behoudt altijd toegang.",
    manage: "Betaling beheren",
    notLoaded: "De prijzen konden nu niet worden geladen.",
    noneOnSale: "Er zijn op dit moment geen betaalde abonnementen beschikbaar.",
    current: "Huidig",
    yours: "Je abonnement",
    isYours: "{{plan}} is je abonnement",
    from: "Vanaf {{day}}",
    switchFor: "Overstappen · {{price}}",
    switchTo: "Overstappen naar {{plan}}",
    pricing: "Het bedrag wordt opgehaald…",
    now: "Nu",
    nowLabel: "Nu:",
    on: "Op {{day}}",
    onLabel: "Op {{day}}:",
    finishPaying: "Rond de betaling af in het tabblad dat is geopend.",
    undo: "Ongedaan maken",
    gone: "Dat abonnement wordt niet meer aangeboden.",
    notPaying: "Je hebt nog geen betaald abonnement. Vernieuw om de abonnementen opnieuw te laden.",
    switchFailed: "Dat lukte nu niet. Er is niets veranderd; probeer het zo nog eens.",
    nothingToManage: "Je hebt nog niets betaald, dus er is niets te beheren.",
    alreadyPaying: "Je hebt al een betaald abonnement. Stap over met Overstappen bij het abonnement dat je wilt.",
    checkoutNotOpened: "Het afrekenen kon niet worden geopend. Probeer het zo opnieuw.",
    portalNotOpened: "Je betaalpagina kon niet worden geopend. Probeer het zo opnieuw.",
  },
  search: {
    box: "Zie jouw advertenties",
    clear: "Zoekopdracht wissen",
    noMatches: "Geen advertenties gevonden voor “{{query}}”.",
  },
  ads: {
    none: "Je hebt geen actieve advertenties.",
    allOnPageReposted: "Alle advertenties op deze pagina zijn herplaatst.",
    allFoundReposted: "Alle gevonden advertenties zijn herplaatst.",
    pageNotLoaded: "Deze pagina kon niet worden geladen. {{why}}",
    notLoaded: "Je advertenties konden niet worden geladen. {{why}}",
    toTop: "Naar boven",
    running: "Bezig: {{title}}",
    runningIn: "Bezig: {{title}} · {{seconds}} s",
    reposted: "{{count}} herplaatst · ze staan bovenaan",
    repostedOnFirstPage: "{{count}} herplaatst · ze staan bovenaan pagina 1",
    pages: "Pagina's",
    toStart: "Naar begin",
    previous: "‹ Vorige",
    next: "Volgende ›",
    loading: "Laden…",
    pageOf: "Pagina {{number}} van {{last}}",
    reloadPage: "Pagina vernieuwen",
    staleTab: "Nog één stap: vernieuw je Marktplaats-pagina, dan kan {{brand}} aan de slag.",
    reserved: "Gereserveerd",
    // The second sentence is the half that matters (T71): a reposted ad stays promised.
    reservedTooltip: "Gereserveerd voor een koper. Bij herplaatsen blijft de advertentie gereserveerd.",
    bidding: "· bieden",
    bid: "Bieden",
    free: "Gratis",
    seeDescription: "Zie beschrijving",
    countdown: "{{seconds}}s",
    // English as it stood before the catalogs: no screen changes in T95.
    workerSilent: "Nothing was reposted. {{why}}",
  },
  failure: {
    noTab: "Open marktplaats.nl in een tabblad en probeer het opnieuw.",
    signedOutOfMarktplaats: "Log eerst in op Marktplaats en probeer het opnieuw.",
    paymentRequired:
      "Marktplaats vraagt geld om deze advertentie opnieuw te plaatsen, en de extensie betaalt nooit voor je.",
    createNotConfirmed: "Marktplaats bevestigde niet dat de nieuwe advertentie geplaatst is.",
    adGone: "Marktplaats heeft deze advertentie niet meer.",
    refused: "Marktplaats heeft het verzoek geweigerd (HTTP {{status}}).",
  },
  pendingRow: {
    puttingBack: "Wordt teruggezet…",
    needsYou: "Terugzetten lukt niet vanzelf — klik op Opnieuw.",
    noTab: "Onderbroken: open Marktplaats om af te ronden",
    ask: "Deze advertentie staat niet meer op Marktplaats. Weet je zeker dat je hem niet wilt terugzetten?",
    letGoYes: "Ja, niet terugzetten",
    letGo: "Niet terugzetten",
  },
  notice: {
    replaced:
      "“{{title}}” is herplaatst, maar de oude advertentie staat er ook nog. De extensie verwijdert hem zodra dat lukt.",
    deleted: "“{{title}}” is verwijderd en nog niet teruggeplaatst. Je gegevens zijn bewaard.",
    needsYou:
      "Niet zeker of “{{title}}” al opnieuw geplaatst is. Controleer je advertenties; je advertentie zelf staat nog online.",
    notYet:
      "Het herplaatsen van “{{title}}” is nog niet gelukt. Je advertentie staat gewoon online; de extensie probeert het opnieuw.",
    why: {
      offline: "Er was geen internetverbinding.",
      timeout: "Marktplaats reageerde niet op tijd.",
      "tab-closed": "Het Marktplaats-tabblad werd gesloten tijdens het herplaatsen.",
      "logged-out": "Je bent uitgelogd bij Marktplaats.",
      server: "Marktplaats had een storing.",
    },
    placeAgain: "Opnieuw plaatsen",
  },
  repost: {
    adUnchanged: "Er is niets herplaatst — je advertentie is ongewijzigd.",
    unconfirmed:
      "Nog niet zeker of dit gelukt is. De extensie controleert het op de achtergrond en probeert het opnieuw.",
    busy: "Er loopt al een herplaatsing. Wacht tot die klaar is.",
    adIsDown:
      "Je advertentie is verwijderd, maar herplaatsen is mislukt. De advertentie is opgeslagen in de extensie — klik op Opnieuw.",
    pacing: "Even wachten voor deze, zodat je herplaatsingen op klikken lijken en niet op een script.",
    cancelled: "De herplaatsing werd onderbroken voordat er iets verwijderd was.",
    label: {
      idle: "Herplaats",
      busy: "Herplaatsen…",
      done: "Herplaatst",
      parked: "Wordt gecontroleerd…",
    },
    tooltip: {
      idle: "Verwijder “{{title}}” en plaats de advertentie opnieuw, zodat deze weer bovenaan staat.",
      busy: "Bezig met herplaatsen…",
    },
  },
  refusal: {
    grantsNothing: "Dit abonnement bevat geen herplaatsingen.",
    spent: "Je hebt je limiet voor herplaatsingen in deze periode bereikt.",
    cooldown: "Geef Marktplaats even de tijd voordat je opnieuw herplaatst.",
    cooldownFor: "Geef Marktplaats even de tijd — opnieuw herplaatsen over {{seconds}}s.",
    notInPlan: "Meerdere tegelijk herplaatsen hoort niet bij je abonnement.",
    updateCard: "Je betaling is niet gelukt, dus herplaatsen is gepauzeerd.",
    noTier: "Er staat nu geen abonnement op dit account, dus herplaatsen is gepauzeerd.",
    retry: "Je abonnement kon niet worden gecontroleerd, dus er is niets herplaatst. Probeer het opnieuw.",
  },
  page: {
    puttingBack:
      "Er ging iets mis tijdens het herplaatsen. Je advertentie staat nog online; we proberen het automatisch opnieuw. Je kunt het hier opnieuw proberen; laten gaan kan in de extensie.",
    needsYou: "Dit lukt niet vanzelf. Probeer het opnieuw; laten gaan kan in de extensie.",
    settledUnseen: "De extensie heeft deze herplaatsing afgerond. Vernieuw de pagina om te zien hoe het ging.",
    puttingBackLabel: "Wordt teruggezet",
    toast: "Advertentie staat weer bovenaan",
    in: "Over {{seconds}}s",
    updatePayment: "Betaling bijwerken",
    thisAd: "deze advertentie",
    nothingReposted: "Er is niets herplaatst. {{why}}",
  },
};
