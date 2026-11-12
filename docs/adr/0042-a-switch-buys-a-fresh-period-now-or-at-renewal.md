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
  it will not, **Betaling beheren** releases the schedule first.
