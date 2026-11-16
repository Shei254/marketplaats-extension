import type { CatalogOf } from "./catalog";
import type { nl } from "./nl";

/**
 * The plan sentences in English, held to the Dutch catalog's keys (ADR-0043).
 *
 * *Repost* for *herplaatsen*. A tier's name and a payment method's brand are not
 * **Our words** and are not here; money is written the Dutch way by `../wording`
 * whichever Language the sentence is in.
 */
export const en = {
  unlimited: "Unlimited reposts",
  grant_one: "{{count}} repost a month",
  grant_other: "{{count}} reposts a month",
  priceAndRhythm: "{{price}} {{rhythm}}",
  every: {
    day: "a day",
    week: "a week",
    month: "a month",
    year: "a year",
    other: "per {{interval}}",
  },
  methods: {
    card: "credit card",
    sepa_debit: "SEPA Direct Debit",
  },
  waysToPay: {
    one: "You can pay with {{method}}.",
    several: "You can pay with {{most}} or {{last}}.",
  },
  freshPeriod: {
    sentence: "Your new month starts today with {{grant}}; {{lost}}.",
    unlimited: "unlimited reposts",
    reposts_one: "{{count}} repost",
    reposts_other: "{{count}} reposts",
    restOfPeriod: "the rest of your {{plan}} period expires",
    leftOver: "what is left of {{plan}} expires",
  },
  dueToday: {
    nothing: "Nothing is charged today.",
    amount: "You pay {{amount}} today.",
  },
  day: "{{day}} {{month}}",
  months: {
    "0": "January",
    "1": "February",
    "2": "March",
    "3": "April",
    "4": "May",
    "5": "June",
    "6": "July",
    "7": "August",
    "8": "September",
    "9": "October",
    "10": "November",
    "11": "December",
  },
  pending: "Moves to {{plan}} on {{day}}",
  fromRenewal: "From {{day}} {{price}}; until then you keep {{plan}}.",
  switchedToday: "Done. Your new plan starts today.",
  switchAtRenewal: "Done. You switch as soon as your current period ends.",
  undoFailed: "Undoing that did not work just now. Try again in a moment.",
  payTheOpenInvoiceFirst: "Pay your open invoice first, under Manage billing.",
} satisfies CatalogOf<typeof nl>;
