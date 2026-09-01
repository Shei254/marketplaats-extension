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
- **Negative, and the one this decision owes #137.** Reading the default configuration settles *which object*
  Checkout consults; it does not check that a method supports **recurring** payments. So the sentence can
  still name a method a `subscription` Checkout will not render — which is the exact failure #137 gave as its
  reason for asking for the subscription configuration instead, and choosing the default does not answer it.
  PayPal is the live case: one-off and recurring are two different account settings, only the first is
  visible on the configuration read here, and **nothing in this API can report the second** (T64, #136).
  Until then a method ticked in the dashboard but not approved for recurring is advertised on the plan screen
  and unusable at Checkout — a worse state than not naming it — and `backlog.md` T57 is where that is
  tracked. What this ADR does buy is that the gap is now one setting wide rather than two.
- **Negative, and the sharp one:** **this cache is a freshness setting and the price cache is not.** A Stripe
  Price is immutable, so `price-cache` only bounds how long a mistake is shown. A payment method
  configuration is mutable in place, so a method enabled in the dashboard is absent from the popup for up to
  `payment-method-cache`. Anybody tuning the two is making different trades under similar names.
- **Negative:** the popup's display-name map is a small vocabulary that can go stale. It fails quietly and in
  the safe direction — an unnamed method is omitted from a sentence that never claimed to be complete — and
  the log is the only thing that will say so.

## Revisit if
Stripe exposes whether a method is approved for recurring payments, at which point the residual above stops
being a documented gap and becomes a filter this class should apply. Or if Stripe stops applying the default
configuration to sessions that name none, or this product starts passing one (offering a different set to
subscriptions than to one-offs) — `CachedPaymentMethods` reads the default
and would then be reading the wrong object. Or if the sentence proves to be worth an A/B test, at which point
what it says stops being a copy decision and becomes a measured one.

## Amended 2026-09-01 — two readings this got wrong, found by a buyer who saw neither PayPal nor a bank

The report was "PayPal and the bank option still don't appear in the checkout". Neither was this ADR's fault
— the account is US-established, so PayPal is not offered to it at all and SEPA Direct Debit is
unavailable ([ADR-0006](0006-billing.md), corrected the same day). But looking for it turned up two things
this decision had actually got wrong.

**`is_default` does not identify the configuration on its own.** The list also returns the configurations a
Connect platform holds for its connected accounts, each carrying a default of its own and told apart by
`parent`. Taking the first flagged object in list order picked a **child** configuration on the very account
this was written against — `apple_pay, card, google_pay, link`, where the account's own default says
`bancontact, blik, card, cashapp, eps, giropay, ideal, link`. Both objects are valid, neither read fails, and
the plan screen was describing a set Checkout does not apply: the "second answer beside the dashboard's" this
ADR was written to prevent, reached from the other side. **The reading is now this account's own default —
`is_default` **and** no `parent`** — and two of ours claiming it is logged rather than resolved, because a
guess dressed as an answer is the thing to avoid on a screen somebody is buying from. No own default at all
answers nothing, rather than borrowing a connected account's.

**And the recurring gap above is now partly closed, which the "revisit if" below anticipated.** That clause
waits on Stripe exposing whether a method is approved for recurring payments. For three of them it already
does, one field over on the object being read: **iDEAL, Bancontact and Sofort have no recurrence of their
own** — each takes a single payment and leaves a SEPA Direct Debit mandate, which is what the subscription is
then charged against. With `sepa_debit` off, a `subscription` Checkout renders none of them however firmly
the configuration says `on`. So `offered()` now means *what a subscription Checkout will offer*, and drops
those three when there is no mandate for them to leave.

This is deliberately **a filter and not the table this ADR refused**: the condition is read from the same
configuration rather than written down, so a method Stripe teaches to bill recurring tomorrow needs no edit
unless it is one of these three. And the drift is in the safe direction the decision already relies on — it
can only *omit* a method, and a sentence that never claimed to be exhaustive is not made false by an
omission, only by a name that is not there at Checkout.

**PayPal's own recurring approval is still not readable anywhere in Stripe's API**, so the Negative above
stands, narrowed to it alone. What is new is that it is now visible after the fact: **every opened session
logs the methods Stripe actually resolved for it** (`OpenCheckout`). The plan screen's sentence is a
prediction from the account's configuration; the session is the ground truth, and it is the only place the
session's currency and a method's recurring approval are both accounted for. A name in the sentence that is
missing from that log line is exactly the residual, in the log where the operator is — which is what this
investigation had to reconstruct by hand from a Stripe console.

## Amended 2026-09-02 — the session log is not the ground truth this claimed

The amendment above ends: *"every opened session logs the methods Stripe actually resolved for it … the
sentence is a prediction; the session is the ground truth."* The first half is right and the second is too
strong, and the gap is where the next day went.

`payment_method_types` is resolved when the session is **created**. Stripe's Adaptive Pricing converts the
presentment currency when the page is **opened**, and a converted cross-border subscription is offered card,
Link, Apple Pay and Google Pay only. So the log names `paypal` on a session whose buyer is shown a card form,
and two sessions created a minute apart — Adaptive Pricing on and off, same Kenyan buyer — log identical
lists. The session accounts for the currency it was *created* in, not the one it is *presented* in.

[ADR-0006](0006-billing.md), amended the same day, closes this by pinning the session to the Price's own
currency, which makes created and presented the same thing again and restores the log line's claim. The
narrower reading stands on its own though: **this log is evidence about the configuration, not about the
page.** Anything that changes the offer between creation and render — Adaptive Pricing was one, and it was
on by default — is invisible to it, and the only instrument for those is opening the URL.

What is unchanged is the residual this ADR owes #137: PayPal's recurring approval is still unreadable in the
API, and is still T57's.
