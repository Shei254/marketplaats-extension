import { inMajorUnits, majorUnitsOf } from "./money";
import type { PendingSwitch, Plan, PlanPrice } from "./enforcement";
import { DUTCH, type Language } from "./language";
import { planWords } from "./words";

/**
 * How a plan reads, in the words both surfaces use for it (T58): the popup's plan
 * cards and the site's landing page show one `GET /api/plans` answer, and a buyer
 * who compared prices on one and subscribes from the other should read the same
 * sentences on both. Moved here from the popup's `plans.ts` when the landing page
 * became the second reader — the same reason `./money` and `./quota` are here.
 *
 * **Every sentence takes the Language it is said in** (ADR-0043) and reads the
 * catalog in `./words`; the argument defaults to Dutch, which is what every build
 * says until T97. Money is the one thing that does not follow it.
 */

/**
 * "€ 9,99" — Dutch formatting, the way the popup's `formatEuro` renders a
 * Marktplaats price: these are amounts on a Dutch marketplace, and no surface should
 * spell money two ways.
 *
 * The currency is Stripe's own lower-case ISO code and `Intl` wants it upper-case.
 * A code `Intl` does not know throws a `RangeError` rather than returning
 * something odd, so the fallback is the amount beside the code — which is a plan
 * card nobody can misread, where a thrown error would be a blank screen over a
 * currency somebody chose in the Stripe dashboard.
 *
 * **The division is the contract's, not this file's** (T66). `amount` is in the
 * currency's smallest unit, and how many of those make one is a fact about the
 * currency rather than about this card — a yen has no minor unit at all, so the
 * `/ 100` that used to be written here rendered ¥1200 as ¥12 on the screen
 * somebody decides to pay from. `/admin` writes the same amounts through the same
 * module, so the plan an operator prices and the card a buyer reads cannot
 * disagree about what the number means.
 */
export function priceOf(price: PlanPrice): string {
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(majorUnitsOf(price.amount, price.currency));
  } catch {
    return `${inMajorUnits(price.amount, price.currency)} ${price.currency.toUpperCase()}`;
  }
}

/**
 * What a tier with no repost cap grants, in the words both surfaces use for it
 * (T73, ADR-0029) — the plan card that sells it, and the strip of somebody already
 * on it.
 *
 * Written once because it is the *same sentence about the same fact*: a buyer
 * comparing cards and then subscribing should read what they were sold, and two
 * spellings a screen apart is how "Onbeperkt herplaatsen" quietly becomes
 * "Onbeperkt opnieuw plaatsen" on one of them.
 *
 * A `used` count beside it — "Onbeperkt · 137 deze periode" — is the better screen
 * and is deliberately not built here: it needs a number `/api/me` does not send,
 * and T73 was already changing that wire shape.
 */
export function unlimitedReposts(language: Language = DUTCH): string {
  return planWords(language)("unlimited");
}

/**
 * "50 herplaatsingen per maand" — what the plan grants, which is always per month.
 *
 * **Whatever rhythm the plan is sold at** (T87, ADR-0037). A rhythm changes the
 * price and never the grant: annual Pro is Pro's monthly grant twelve times at a
 * discount, and the backend counts an annual payer's usage a month at a time. So
 * the line takes no rhythm, and a card that follows a Maandelijks / Jaarlijks
 * switch moves its price and leaves this alone. Before T87 it read the rhythm and
 * said "per jaar" under an annual price — which was then true, and was the bug.
 *
 * **An unlimited tier names no period** (T73, ADR-0029). "Onbeperkt herplaatsen
 * per maand" would be inviting the reader to look for the limit the sentence is there
 * to say does not exist. It is the same string the popup's own strip draws for the
 * plan somebody is already on.
 */
export function grantOf(plan: Plan, language: Language = DUTCH): string {
  if (plan.relistQuotaPerPeriod === null) return unlimitedReposts(language);
  return planWords(language)("grant", { count: plan.relistQuotaPerPeriod });
}

/**
 * "€ 9,99 per maand" — one of a plan's rhythms, as its own button says it (T62,
 * #128).
 *
 * A plan may be sold monthly and annually, and what a buyer is choosing between is
 * two amounts against two rhythms — so each price says both, rather than a card
 * saying one amount and a toggle elsewhere deciding which.
 */
export function priceAndRhythmOf(price: PlanPrice, language: Language = DUTCH): string {
  return planWords(language)("priceAndRhythm", { price: priceOf(price), rhythm: every(price.interval, language) });
}

function every(interval: string, language: Language): string {
  const t = planWords(language);
  switch (interval) {
    case "day":
      return t("every.day");
    case "week":
      return t("every.week");
    case "month":
      return t("every.month");
    case "year":
      return t("every.year");
    default:
      // Stripe's own word, untranslated and deliberately: a new interval should
      // read oddly rather than be silently called something it is not.
      return t("every.other", { interval });
  }
}

/**
 * The ways to pay these surfaces can spell, in the order they say them (T65, #137).
 *
 * **Membership and order are both editorial, and between them they are the whole
 * of the editorial decision.** iDEAL leads: this is a Dutch marketplace, iDEAL is
 * how most of the country pays online, and ADR-0006 chose Stripe over a card-only
 * arrangement precisely to keep it. PayPal is next as the name a hesitant buyer
 * recognises fastest, then card. Deciding this here rather than at the API is the
 * same division `priceOf` and `priceAndRhythmOf` already keep: the backend sends Stripe's
 * vocabulary and the client decides how it reads.
 *
 * **A method that does not belong in the sentence is left out of this list**, where
 * the omission is explicit and reviewable — rather than dropped by position, which
 * would edit the sentence by whatever happened to sort last.
 *
 * **Wallets are named too**, after the main methods: Apple Pay, Link and the
 * others Stripe may offer. The sentence only ever names what Stripe says is on,
 * so naming one never makes it false. A method with no entry here (`google_pay`
 * among them) is still left out.
 */
const WAYS_TO_PAY: ReadonlyArray<readonly [token: string, name: string | Ours]> = [
  ["ideal", "iDEAL"],
  ["paypal", "PayPal"],
  ["card", { ours: "methods.card" }],
  ["bancontact", "Bancontact"],
  ["sepa_debit", { ours: "methods.sepa_debit" }],
  ["amazon_pay", "Amazon Pay"],
  ["apple_pay", "Apple Pay"],
  ["blik", "BLIK"],
  ["eps", "eps"],
  ["kakao_pay", "Kakao Pay"],
  ["klarna", "Klarna"],
  ["link", "Link"],
  ["mb_way", "MB WAY"],
  ["naver_pay", "Naver Pay"],
  ["payco", "PAYCO"],
  ["pix", "Pix"],
  ["samsung_pay", "Samsung Pay"],
  ["satispay", "Satispay"],
];

/**
 * A method whose name is a word of ours rather than a brand's, and so is read
 * from the catalog: a card is a "creditcard" in Dutch and something else in English,
 * where iDEAL is iDEAL in both.
 */
interface Ours {
  ours: "methods.card" | "methods.sepa_debit";
}

/**
 * "Je kunt betalen met iDEAL, PayPal, creditcard of SEPA-incasso." — or nothing
 * at all.
 *
 * **`null` is an ordinary answer and renders no sentence**: Stripe could not be
 * asked, or it offers only methods these surfaces have no name for. The plan cards are
 * unaffected either way, which is the whole reason `GET /api/plans` carries this
 * beside them rather than refusing the lot (T65, #137).
 *
 * Every method these surfaces can spell is named, in `WAYS_TO_PAY`'s order, never
 * truncated. A method missing from that list is the only thing left out — a buyer
 * meets the rest at Checkout regardless, and this line is there to get them to it
 * rather than to enumerate it.
 *
 * A token that is not in `WAYS_TO_PAY` is dropped rather than shown raw — a
 * departure from `priceAndRhythmOf` and `priceOf` above, and worth saying why. Those render
 * what Stripe spelled because the alternative was *mistranslation*: an unknown
 * interval called "a month" is a lie about money. Here the alternative is silence,
 * "of sepa_debit" in the one line whose job is to reassure is worse than absent,
 * and the API logs the whole offered set whenever it refreshes — so a method
 * nobody has named is visible where an operator is, not where a buyer is.
 */
export function waysToPay(methods: readonly string[], language: Language = DUTCH): string | null {
  const t = planWords(language);
  const named = WAYS_TO_PAY.filter(([token]) => methods.includes(token)).map(([, name]) =>
    typeof name === "string" ? name : t(name.ours),
  );
  const last = named.pop();
  if (last === undefined) return null;
  if (named.length === 0) return t("waysToPay.one", { method: last });
  return t("waysToPay.several", { most: named.join(", "), last });
}

/**
 * What a switch made now does to the reposts (T90, ADR-0042), in the confirm
 * step both surfaces show before anybody pays: the new month starts today with
 * its full grant, and the rest of the old plan is gone. Said in those words
 * because the loss is deliberate and nobody should find it out afterwards.
 *
 * A target with no cap grants "onbeperkt herplaatsen" rather than a number, and
 * a plan left with no cap had nothing "left over" to count, so its period is
 * what is lost.
 */
export function freshPeriodLine(
  to: { relistQuotaPerPeriod: number | null },
  from: { name: string; relistQuotaPerPeriod: number | null },
  language: Language = DUTCH,
): string {
  const t = planWords(language);
  const grant =
    to.relistQuotaPerPeriod === null
      ? t("freshPeriod.unlimited")
      : t("freshPeriod.reposts", { count: to.relistQuotaPerPeriod });
  const lost =
    from.relistQuotaPerPeriod === null
      ? t("freshPeriod.restOfPeriod", { plan: from.name })
      : t("freshPeriod.leftOver", { plan: from.name });
  return t("freshPeriod.sentence", { grant, lost });
}

/**
 * Stripe's preview of a switch made now, in a sentence. The new plan's full
 * price, or less where the Stripe customer holds a credit, and never negative
 * since nothing is credited (ADR-0042) — so zero is the only other case.
 */
export function dueToday(preview: { amount: number; currency: string }, language: Language = DUTCH): string {
  const t = planWords(language);
  if (preview.amount <= 0) return t("dueToday.nothing");
  return t("dueToday.amount", {
    amount: priceOf({ amount: preview.amount, currency: preview.currency, interval: "month" }),
  });
}

/** "12 december", in the reader's own zone: the day on their calendar. Empty for no date. */
export function dayOf(iso: string, language: Language = DUTCH): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const t = planWords(language);
  return t("day", { day: date.getDate(), month: t(`months.${date.getMonth() as Month}`) });
}

/** `Date#getMonth`'s answer, which is the catalog's key for that month's name. */
type Month = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** The held card's line while a Scheduled switch waits (T90). */
export function pendingLine(pending: PendingSwitch, language: Language = DUTCH): string {
  return planWords(language)("pending", { day: dayOf(pending.at, language), plan: pending.tier.name });
}

/** *Op {datum}*'s line in the confirm: the card's price from the renewal, and the plan kept until then (T90). */
export function fromRenewalLine(
  renewsAt: string,
  price: PlanPrice,
  keeping: string,
  language: Language = DUTCH,
): string {
  return planWords(language)("fromRenewal", {
    day: dayOf(renewsAt, language),
    price: priceAndRhythmOf(price, language),
    plan: keeping,
  });
}

/** What both confirms say once Stripe has taken the switch (T90). */
export function switchedToday(language: Language = DUTCH): string {
  return planWords(language)("switchedToday");
}

export function switchAtRenewal(language: Language = DUTCH): string {
  return planWords(language)("switchAtRenewal");
}

export function undoFailed(language: Language = DUTCH): string {
  return planWords(language)("undoFailed");
}

/** What both surfaces' cards say during Dunning instead of offering a switch (T90, `OPEN_INVOICE`). */
export function payTheOpenInvoiceFirst(language: Language = DUTCH): string {
  return planWords(language)("payTheOpenInvoiceFirst");
}
