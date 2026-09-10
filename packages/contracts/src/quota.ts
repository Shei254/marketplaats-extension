/**
 * What a repost quota may say on the wire (T73, ADR-0029), for every reader of one.
 *
 * **One rule about one field, in the package that already carries two of those.**
 * `quotaRemaining` and `relistQuotaPerPeriod` are nullable on four wire shapes —
 * `DisplayState`, `RemainingQuota`, `Plan` and `AdminTier` — and by the end of T73
 * five parsers across two clients had each written the rule out for themselves, in
 * four different spellings. `./features` is here for exactly that reason and says
 * so: two copies of a rule about one field is the pair that drifts. Five was not a
 * warning about the future; one of them had already dropped a check.
 *
 * **A type guard rather than a boolean**, which is the half that cannot be
 * hand-rolled. `Number.isInteger` narrows nothing in TypeScript, so every reader
 * that checked by hand still needed `as number | null` to build its result — a cast
 * asserting exactly what the check above it had just proven, and asserting it in
 * three files where nobody would notice if the check changed.
 *
 * It lives beside `./money` and `./features` on their argument: this package
 * carries behaviour about wire fields as well as their shapes, and this is
 * behaviour about one field rather than a general number library.
 */

/**
 * Whether this is a quota: a whole number that is not negative, or `null`.
 *
 * **The three states are the point** (ADR-0029). `null` is a tier with no cap, `0`
 * is a tier that grants nothing, and they are not the same tier — one may repost
 * forever and the other never. A reader that collapsed them would either promise a
 * free tier unlimited reposts or refuse them to the most generous plan in the
 * catalog, depending on which way it fell.
 *
 * **`-1` is not a quota**, which is this function's one opinion. It is the sentinel
 * ADR-0029 turned down, on the grounds that `Math.max(0, -1 - held)` is `0` and so
 * the most generous tier would refuse every repost while reading as a working gate.
 * A parser that accepted it would let it back in a layer below where that was
 * decided — and the arithmetic downstream is written for `null`, not for it.
 *
 * `undefined` is refused too, and deliberately not folded in with `null`: absent is
 * a body missing a field it promised, where an explicit `null` is the API saying
 * there is no ceiling. That is the same distinction `AdministerTiers.quotaSent` spends
 * a `JsonNode` on for the write side, kept here for the read.
 */
export function isQuota(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
