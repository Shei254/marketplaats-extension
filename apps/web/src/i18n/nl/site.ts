/**
 * **Our words** on the public site in Dutch — everything but the two legal
 * documents, which are beside this file (ADR-0043). `/admin` has no Language and
 * is not here.
 *
 * `{{brand}}` is the product's name, which `../words` supplies to every sentence.
 * A tag in a sentence (`<b>`, `<a>`) is drawn by the component that says it.
 */
export const site = {
  common: {
    tryAgain: "Opnieuw proberen",
    oneMoment: "Een moment…",
    close: "Sluiten",
    cancel: "Annuleren",
    addToChrome: "Toevoegen aan Chrome",
  },
  nav: {
    privacy: "Privacy",
    terms: "Voorwaarden",
    signIn: "Inloggen",
    account: "Mijn account",
    manageBilling: "Betaling beheren",
    signOut: "Uitloggen",
  },
  footer: {
    disclaimer: "{{brand}} is een onafhankelijk product en is niet gelieerd aan Marktplaats.",
  },
  pages: {
    clickTheIcon: "Klik op het <b>{{brand}}</b>-icoon in je werkbalk",
    closeThisTab: "Hier hoef je niets te doen — je kunt dit tabblad sluiten.",
    success: {
      title: "Alles is geregeld",
      copy: "Je betaling is gelukt. Open het {{brand}}-icoon in de werkbalk van je browser — je nieuwe herplaatsingen staan er al klaar.",
      notInstalled: "Nog niet geïnstalleerd? <a>Toevoegen aan Chrome</a> — je abonnement staat klaar zodra je inlogt.",
    },
    cancel: {
      title: "Er is niets afgeschreven",
      copy: "Je hebt het afrekenen afgebroken, dus er is niets betaald en er is niets veranderd. Je gratis herplaatsingen staan er nog gewoon.",
      tryAgain: "Probeer het opnieuw vanuit {{brand}} of via <a>de abonnementen</a>",
    },
    billing: {
      title: "Dat is opgeslagen",
      copy: "Wat je ook hebt gewijzigd — hoe je betaalt, je abonnement, of opzeggen — het is opgeslagen bij Stripe, de betaaldienst die wij gebruiken. Open het {{brand}}-icoon in de werkbalk van je browser om te zien wat dat betekent; het kan even duren voordat een wijziging daar is.",
    },
    notFound: {
      title: "Op dit adres staat niets",
      copy: "{{brand}} zit in de werkbalk van je browser en niet op deze site. Heb je zojuist betaald, dan is die betaling gelukt — deze pagina hoort daar niet bij.",
    },
  },
  landing: {
    title: "Zet je advertentie weer bovenaan",
    copy: "Herplaats hem vanuit je browser, met behoud van alle tekst en foto’s.",
    micro: "Gratis te installeren · werkt in Chrome",
    onToHowItWorks: "Verder naar Zo werkt het",
    howItWorks: "Zo werkt het",
    steps: {
      open: { title: "Open Marktplaats", copy: "Ga in de website naar je advertenties." },
      signIn: { title: "Log in bij {{brand}}", copy: "Via het icoon in je werkbalk." },
      repost: { title: "Klik op <b>Herplaats</b>", copy: "Je advertentie staat weer bovenaan." },
    },
    plans: "Abonnementen",
    plansCopy: "Begin gratis, of kies een abonnement als je vaker wilt herplaatsen.",
    startFree: "Begin gratis",
    worksInChrome: "Werkt in Chrome",
    demo: {
      before: "Na een paar dagen",
      after: "Na herplaatsen",
      yours: "Jouw fiets",
      fiveDays: "5 dagen",
      justNow: "zojuist",
      onTop: "Bovenaan",
      newlyPlaced: "Nieuw geplaatst · {{when}}",
      today: "vandaag",
      yesterday: "gisteren",
      twoDays: "2 dagen",
    },
  },
  plans: {
    /**
     * How a buyer pays, under the cards — the operator's own copy, as written
     * (2026-09-25), and three deliberate departures worth knowing before "fixing":
     *
     * - **It says *u*.** The rest of this page, the popup and the mail say *je*
     *   (ADR-0035); this one sentence is formal because the operator asked for it.
     * - **It is fixed, not built from what Stripe offers.** The popup still names
     *   only the methods Stripe's Checkout offers (`waysToPay`, T65); this names
     *   iDEAL | Wero whether or not the Stripe account has it switched on.
     * - **The landing page's only.** The popup keeps `waysToPay`'s sentence.
     *
     * `PlanSection` shows it only beside something to buy: a free card alone has
     * nothing to pay for.
     */
    payWith:
      "Uw betaling wordt veilig verwerkt via Stripe. U kunt eenvoudig kiezen uit verschillende betaalmethoden, waaronder iDEAL | Wero, PayPal, creditcard en debitcard.",
    choose: "Kies {{plan}}",
    from: "Vanaf {{day}}",
    switchTo: "Overstappen naar {{to}}",
    current: "Huidig abonnement",
    startFree: "Gratis beginnen",
    cancelPlan: "Opzeggen",
    unavailable:
      "De prijzen kunnen nu niet worden geladen. Je vindt ze ook in de extensie, onder <b>Kies een abonnement</b>.",
    rhythm: "Betaalritme",
    monthly: "Maandelijks",
    yearly: "Jaarlijks",
    rhythmWord: { month: "maandelijks", year: "jaarlijks" },
    upTo: "tot −{{saving}}%",
    free: "Gratis",
    mostReposts: "Meeste herplaatsingen",
    perYear: "per jaar",
    perMonth: "per maand",
    monthlyOnly: "Alleen maandelijks",
    aMonth: "{{price}} per maand",
    aMonthSaving: "{{price}} per maand · bespaar {{saving}}%",
    undo: "Ongedaan maken",
    pricing: "Het bedrag wordt opgehaald…",
    nowLabel: "Nu:",
    now: "Nu",
    onLabel: "Op {{day}}:",
    on: "Op {{day}}",
    atRenewal: "Bij verlenging",
    yourCurrentPlan: "je huidige abonnement",
    switching: "Je abonnement wordt aangepast…",
    notForSale: "Dit abonnement wordt niet meer aangeboden. Vernieuw de pagina voor wat er nu te koop is.",
    switchFailed: "Dat lukte nu niet. Er is niets veranderd; probeer het zo nog eens.",
  },
  account: {
    signInFailed: "Inloggen is niet gelukt. Probeer het nog eens.",
    notLoaded: "Je abonnement kon niet worden geladen. Vernieuw de pagina om het nog eens te proberen.",
    checkoutNotOpened: "Afrekenen kon niet worden geopend. Probeer het zo nog eens.",
    portalNotOpened: "Het betaaloverzicht kon niet worden geopend. Probeer het zo nog eens.",
    settling: "Gelukt. Het kan even duren voordat je abonnement hier zo staat.",
  },
  legal: {
    updated: "Laatst bijgewerkt op {{date}}",
  },
};
