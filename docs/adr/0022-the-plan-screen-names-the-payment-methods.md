# ADR-0022: The plan screen names the payment methods, read from Stripe

**Status:** Accepted (2026-09-01)
**Scope:** Full app. Refines ADR-0006 and the rule `OpenCheckout` states about where payment methods live.

## Context
ADR-0006 chose Stripe over a card-only arrangement **because the users are Dutch and iDEAL is how most of the
country pays online**. That decision then became invisible. The plans screen said only:

> Checkout opens in a new tab. Come back here when you're done.

A buyer deciding whether to pay had no way of knowing iDEAL was on the other side of that tab, and the
conversion ADR-0006 was protecting was being spent on a page nobody could see in advance. T64 added PayPal to
the same Checkout, which made the gap wider rather than narrower: three good reasons to buy, none of them
mentioned where the buyer is.

**And there was a real tension in the obvious fix.** `OpenCheckout` says, and has said since T22:

> Which payment methods are offered … is a setting on the Stripe account rather than a parameter here.
> Naming them in code would mean a deploy to add one, and would put a second answer beside the dashboard's.

A hardcoded sentence in the popup is exactly that second answer. It is right the day it is written and wrong
the day somebody ticks a box, and nothing fails — the copy simply starts lying, in the one place whose job is
to be believed.

Three options were weighed.

1. **A hardcoded, deliberately non-exhaustive line** — "Pay with iDEAL, PayPal or card." Only *removing* one
   of those three makes it false, so adding Bancontact tomorrow leaves it true and merely incomplete. One
   string, no code, and the drift is at least a drift somebody owns.
2. **Read the list from Stripe when the cards are drawn.** No second answer, ever. Costs a contract field, a
   Stripe call on a display path, and a cache.
3. **Name no methods** — "You'll choose how to pay on the next page." Zero drift, forever true, and it gives
   the Dutch iDEAL buyer nothing, which was the whole point.

## Decision
**The list is read from Stripe.** `GET /api/plans` carries `paymentMethods`, and the popup renders a sentence
from it.

This does not reopen what `OpenCheckout` closed. That rule is about **choosing** methods; this only
**reports** the choice. There is still exactly one place the answer lives — the dashboard — and the popup is
reading it rather than holding a copy.

**The default configuration, because it is the one Checkout applies.** The session sets no
`payment_method_configuration`, so Stripe uses the account default; reading the object flagged `is_default` is
therefore reading the very thing the buyer will meet, not a proxy for it. Stripe supports a second
configuration with a different set for subscriptions, and an account that *passed* one would make this answer
wrong — so `OpenCheckout` must go on naming none, and `CachedPaymentMethods` says so where somebody would
change it.

**It degrades independently of the prices, and that is a deliberate exception to this route's own rule.**
Everything else about `GET /api/plans` is all-or-nothing, argued from the screen being a **comparison**: a
buyer cannot tell a plan that is missing from a plan that does not exist, so a partial list is a wrong
picture at the moment somebody is deciding what to pay. Take the methods away and the comparison is
untouched — every plan, rhythm and amount still says exactly what it said. Blanking a working plan screen
because a reassurance failed would lose a sale to protect a nicety. So an empty list arrives beside a
perfectly good `200`.

**Empty means "say nothing", and it deliberately conflates two causes** — Stripe could not be asked, and
nothing is turned on. A client would do the same thing for either, so there is no second state to carry; the
difference is in the log, where the operator is.

**Stripe's vocabulary crosses the boundary unedited** — `ideal`, `paypal`, `sepa_debit` — and the popup owns
the display names and the order. That is the division `currency` and `interval` already keep, and it puts the
editorial decision (iDEAL leads, because this is a Dutch marketplace) in the surface that is making it.

**A method the popup cannot name is omitted, not shown raw.** This departs from `plans.ts`, which renders an
unknown interval as Stripe spelled it so it "reads oddly rather than being silently called a month". That
rule guards against **mistranslation**, and the alternative here is **silence**: the sentence is
non-exhaustive by construction, so dropping a name never makes it false, while `or sepa_debit` in the one
line meant to reassure is worse than absent. Wallets — `link`, `apple_pay`, `google_pay` — are unnamed for
the same reason and are not an oversight.

**The API logs the whole offered set on refresh rather than the unmapped tokens.** The backend cannot know
what the popup can spell without holding a second copy of the map, which is the thing this ADR exists to
avoid. So it logs what Stripe offers, and a method that appears there and never on a plan card is a line
missing from `waysToPay`.

**Read with Jackson from a raw request, not through the SDK's model.** `PaymentMethodConfiguration` is
generated as a nested class per method with no way to iterate them, so a typed reading is sixty hardcoded
calls that silently omit the sixty-first. It is also the choice `StripeEvent` already makes, for the reason
`build.gradle.kts` gives: the shape of Stripe's answer decides what we can read, rather than the version of a
jar. It keeps Gson — Stripe's serialiser, nothing of ours — off the compile classpath.

## Consequences
- **Positive:** The copy cannot drift from the dashboard, because there is no copy.
- **Positive:** ADR-0006's reason for choosing Stripe is finally visible to the person it was chosen for.
- **Positive:** Enabling a method stays a checkbox. It now also changes what the popup says, with no deploy.
- **Negative:** A second Stripe call on a route a user waits on. Cached, and it can fail without costing the
  cards — but it is one more thing between a click and a plan screen.
- **Negative, and the sharp one:** **this cache is a freshness setting and the price cache is not.** A Stripe
  Price is immutable, so `price-cache` only bounds how long a mistake is shown. A payment method
  configuration is mutable in place, so a method enabled in the dashboard is absent from the popup for up to
  `payment-method-cache`. Anybody tuning the two is making different trades under similar names.
- **Negative:** the popup's display-name map is a small vocabulary that can go stale. It fails quietly and in
  the safe direction — an unnamed method is omitted from a sentence that never claimed to be complete — and
  the log is the only thing that will say so.

## Revisit if
Stripe stops applying the default configuration to sessions that name none, or this product starts passing
one (offering a different set to subscriptions than to one-offs) — `CachedPaymentMethods` reads the default
and would then be reading the wrong object. Or if the sentence proves to be worth an A/B test, at which point
what it says stops being a copy decision and becomes a measured one.
