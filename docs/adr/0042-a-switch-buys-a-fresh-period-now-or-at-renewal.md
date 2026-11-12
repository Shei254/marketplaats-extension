# ADR-0042: A switch buys a fresh period, now or at renewal, and both doors are ours

**Status:** Accepted (2026-11-12)
**Scope:** `SwitchPlans` and the `/api/plan-switch` routes, the subscription mirror, `GET /api/me`, the
popup's plan cards and the site's, and the Stripe Customer Portal's configuration.
**Supersedes part of [ADR-0036](0036-the-site-sells-and-a-subscriber-switches-in-place.md)**: "immediate and
prorated both ways", "scheduling [downgrades] for period end was deferred", and "the popup keeps T83's answer
to a paying subscriber, the Customer Portal". Its 2026-11-12 amendment still holds: a switch waits for the
money only where Stripe's pending-updates list lets it. **Refines
[ADR-0037](0037-an-annual-price-buys-a-monthly-grant.md)**. Its "a Rhythm switch starts a fresh window" now
covers every switch.

## Context

A subscriber on `pro_sepa` pressed Power's **€15,00 per maand** in the popup and got T83's refusal: *"Je hebt
al een betaald abonnement. Wissel of zeg op via Betaling beheren."* The refusal was correct. The fault was the
button: `GET /api/me` had been sending `paying` since T85, and the popup never read it. The obvious fix
(an **Overstappen** button calling the site's existing `/api/plan-switch`) raised the question this ADR is
mostly about. The usual reason to switch is "my reposts are used up", and ADR-0036's switch answered that
badly in one direction or the other:

- **Prorated, same window** (what shipped). Pro → Power on the 12th with 50 used leaves 60 − 50 = 10
  reposts. That is fair to the money, but not what the switcher came for.
- **Prorated, fresh window.** Gives 60 at once, and can be gamed: up on day 12 for ≈ €3, use all 60, down on
  day 13 for ≈ €2.83 back, with a fresh 50 on top. Stripe prorates money **by days**, and a grant is spent
  **by count**, in an afternoon if the subscriber likes.

## Decision

- **An immediate switch restarts the billing period at the new plan's full price, and credits nothing.**
  `billing_cycle_anchor=now`, `proration_behavior=none`. The new period, a fresh **Quota period** and its
  full grant all start that day, for a switch up or down and for a switch of tier or of **Rhythm**. Each
  grant is paid for in full exactly once, so switching back and forth buys nothing. The remainder of the old
  plan is lost. The confirm step says so in those words.
- **Every switch can instead be a Scheduled switch**, taking effect when the paid period ends, through a
  Stripe Subscription Schedule (current Price until `current_period_end`, then the new one). Every switch is
  offered both ways, so nothing needs to define "downgrade". The date is never chosen. **At most one is
  pending.** It shows on both cards, **Ongedaan maken** releases it, and any later switch replaces it (an
  immediate one releases it first).
- **The schedule is mirrored, never asked for.** `subscription_schedule.*` webhooks set and clear the pending
  switch on the one subscription row. `GET /api/me` reads it from there and never calls Stripe, so it stays
  Stripe-first as ADR-0019 requires, and a schedule ended in the dashboard is reflected too.
- **A cancellation always wins** over a pending switch, which is dropped.
- **No switch during Dunning**, immediate or scheduled. `past_due`, `unpaid` and `incomplete` are refused
  by the API with a new `409`, and the cards say to pay the open invoice first. A bank debit still on its
  way is `active` at Stripe, so it is not Dunning and the subscriber can switch.
- **The popup switches itself**, with the site's routes, an inline confirm (Stripe's preview of today's
  charge for *Nu*, the card's price for *Op {date}*, nothing preselected), the subscriber's own card
  offering its other Rhythm, and the site's settle-and-poll afterwards.
- **The Customer Portal stops switching plans.** *Customers can switch plans* is turned off in every
  account's Portal configuration. The Portal keeps payment details, invoices and cancelling.

## Considered options

- **Prorated, keep the window** (ADR-0036 as shipped): fair, and no help to a subscriber who is out of
  reposts.
- **Prorated, fresh window**: gameable, as above.
- **Credit the unused days and restart the period**: €15 − ≈€6 on day 12. Gameable for the same reason
  (credits are by day). **Credit only if nothing was used this period** was fairest, but it was declined:
  it would make billing read our usage table.
- **The Portal as the popup's switch** (T83, ADR-0036): no code of ours, but a third door with Stripe's
  proration rules instead of these.
- **Ask Stripe for the schedule on every `/api/me`**: always exact, but every popup open becomes a Stripe
  call that can fail.

## Consequences

- **Switching early in a period costs money.** The day-2 switcher loses about a month of the old plan. This
  is deliberate, and the confirm step says so before anybody pays.
- **The site changes too.** It shares `SwitchPlans`, so its proration ends with this ADR.
- **A pending switch is new state** on the subscription row and in `DisplayState`, and both clients
  render it.
- **The Portal setting is an operator step in each Stripe account**, not a deploy. `docs/click-through.md`
  6a is rewritten to match.
- **To verify against Stripe before building:** that `billing_cycle_anchor=now` is accepted with
  `pending_if_incomplete`, and whether the Portal will cancel a subscription that a schedule controls. If
  it will not, **Betaling beheren** releases the schedule first. What was found is below.

## Checked in test mode (2026-11-12)

Scripted against the sandbox account with the API version `stripe-java` 29.2.0 pins, on throwaway objects
deleted afterwards.

- **`billing_cycle_anchor=now` with `proration_behavior=none` and `pending_if_incomplete` is accepted.**
  For a card that pays, the subscription moves at once to a new period starting that second, and the invoice
  is the new Price's full amount with no proration lines. For a card that needs 3-D Secure
  (`pm_card_authenticationRequired`), it comes back `active` and unchanged, with a `pending_update` carrying
  the new anchor and items, and an open invoice with a hosted page, which is the flow the site already had.
  The preview (`invoices/create_preview` with the same `subscription_details`) totals the same full amount.
  PayPal was not checked: a test PayPal method cannot be attached without a redirect.
- **An update made directly on a subscription that a schedule controls is not refused.** Stripe rewrites
  the schedule's current phase instead and keeps its old end date, which leaves a schedule nobody asked for.
  So the decision's "an immediate switch releases it before updating" is required, not tidiness.
- **Stripe's API refuses `cancel_at_period_end` on a subscription a schedule controls:** *"The subscription
  is managed by the subscription schedule …, and updating any cancelation behavior directly is not allowed.
  Please update the schedule instead."* An immediate cancel succeeds and cancels the schedule with it, so the
  mirror clears the pending switch on `customer.subscription.deleted` and `subscription_schedule.canceled`.
- **Not checked: what the Customer Portal does** for a subscriber with a pending switch, whose cancel is at
  period end (ADR-0018). If it applies the API's rule, *Opzeggen* is hidden or fails there, and no webhook
  arrives. **Decided for now (2026-11-12): nothing releases the schedule before the Portal opens.** A cancel
  the Portal does accept still drops the pending switch through the webhook; one it refuses means pressing
  **Ongedaan maken** first. The Portal check is an open item in `docs/click-through.md` 6a, to be decided on
  in a later session: if the Portal refuses, *Betaling beheren* releasing a pending switch first is the
  fallback this ADR named.

## Settled in review (2026-11-12)

- **A schedule lets go once its switch has taken over.** Its second phase runs a full period with
  `end_behavior=release`, so left alone Stripe would hold the subscription for that whole period, refusing a
  cancel at period end, with nothing pending on the cards to explain it. The webhook releases a schedule
  named by a subscription event when it is in its last phase and would release anyway
  (`ReleaseFinishedSchedules`). One that ends by cancelling is never touched.
- **Ongedaan maken is allowed during Dunning.** It charges nothing, and it is the way out of a cancel the
  Portal refuses while a schedule holds the subscription. `OPEN_INVOICE` refuses the preview, the switch and
  the schedule, not the undo, and both clients show the button.
- **A switch now that is left at 3-D Secure loses a pending Scheduled switch.** The schedule is released
  before the update, because an update under a schedule rewrites its phases (above). If the payer never
  confirms, the subscription is unchanged and nothing is pending. Accepted rather than re-made: re-making it
  would mean a schedule created on the strength of a payment that never happened.
- **The mirror names the schedule that set a pending switch**, so a replaced schedule's late `released`, or
  a schedule's `created` arriving after its `updated`, leaves the new switch in place.
