/**
 * The plan sentences in Dutch — the source catalog, and the one the keys are
 * typed from (ADR-0043). `../wording` reads it; nothing else should.
 *
 * Marktplaats's labels, a tier's name and a payment method's brand name are not
 * **Our words** and are not here.
 */
export const nl = {
  unlimited: "Onbeperkt herplaatsen",
  grant_one: "{{count}} herplaatsing per maand",
  grant_other: "{{count}} herplaatsingen per maand",
  priceAndRhythm: "{{price}} {{rhythm}}",
  every: {
    day: "per dag",
    week: "per week",
    month: "per maand",
    year: "per jaar",
    other: "per {{interval}}",
  },
  methods: {
    card: "creditcard",
    sepa_debit: "SEPA-incasso",
  },
  waysToPay: {
    one: "Je kunt betalen met {{method}}.",
    several: "Je kunt betalen met {{most}} of {{last}}.",
  },
  freshPeriod: {
    sentence: "Je nieuwe maand begint vandaag met {{grant}}; {{lost}}.",
    unlimited: "onbeperkt herplaatsen",
    reposts_one: "{{count}} herplaatsing",
    reposts_other: "{{count}} herplaatsingen",
    restOfPeriod: "de rest van je {{plan}}-periode vervalt",
    leftOver: "wat over is van {{plan}} vervalt",
  },
  dueToday: {
    nothing: "Er wordt vandaag niets afgeschreven.",
    amount: "Je betaalt vandaag {{amount}}.",
  },
  day: "{{day}} {{month}}",
  months: {
    "0": "januari",
    "1": "februari",
    "2": "maart",
    "3": "april",
    "4": "mei",
    "5": "juni",
    "6": "juli",
    "7": "augustus",
    "8": "september",
    "9": "oktober",
    "10": "november",
    "11": "december",
  },
  pending: "Gaat op {{day}} over naar {{plan}}",
  fromRenewal: "Vanaf {{day}} {{price}}; tot dan houd je {{plan}}.",
  switchedToday: "Gelukt. Je nieuwe abonnement gaat vandaag in.",
  switchAtRenewal: "Gelukt. Je stapt over zodra je huidige periode afloopt.",
  undoFailed: "Ongedaan maken lukte nu niet. Probeer het zo nog eens.",
  payTheOpenInvoiceFirst: "Betaal eerst je openstaande factuur via Betaling beheren.",
};
