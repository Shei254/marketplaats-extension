# ADR-0037: An annual price buys a monthly grant

**Status:** Accepted (2026-09-25)
**Scope:** `Subscriptions.currentFor` — the **Quota period** the gate counts in and `/api/me` answers
`resetAt` from — and the grant line every plan card draws (`grantOf`, `packages/contracts`). T87 is the work.
**Refines [ADR-0014](0014-tier-catalog-and-entitlements.md)**, whose "a payer's window is Stripe's" read as
"a payer's quota period *is* Stripe's billing period", and **[ADR-0019](0019-plans-are-stripe-first-and-webhook-synced.md)**
as T62 extended it to more than one **Rhythm** per Plan.

**The decision is that a Rhythm changes what is paid and never what is granted.** Annual Pro is Pro's monthly
grant twelve times, at a discount — not Pro's grant once a year. The Quota period is one month for everybody.

## Context

The landing page's Maandelijks / Jaarlijks switcher changed the grant line with the price: *"50 herplaatsingen
per jaar"* under an annual price. That read as a wording bug and was not one. A payer's window was copied from
Stripe's `current_period_*` and never rolled, and an annual Stripe subscription's period is the whole year —
so annual Pro really did grant 50 a year, and the page was the one surface telling the truth. The Terms said
the opposite (*"Elk abonnement geeft een aantal herplaatsingen per maand"*), and so did what the product meant
to sell. Changing the words alone would have promised annual buyers twelve times what the gate let them do.

## Decision

- **An annual payer's window is the month of Stripe's year that contains now**, counted from Stripe's period
  start — the day they bought — with `plusMonths` from that anchor rather than from the previous month, for
  #20's reason (31 January → 28 February → 31 March, never walking). The last month ends at Stripe's end, so
  the twelfth window closes when Stripe renews, and a remainder shorter than a month is folded into it rather
  than becoming a sliver with a fresh grant — which a monthly Stripe period anchored on the 31st produces
  (28 February → 31 March).
- **Derived when the row is read, never stored.** The row keeps Stripe's period exactly as the webhook wrote
  it, so the webhook stays the only writer of a Stripe-owned window, no column is added, and nobody already on
  an annual plan needs a migration. `resetAt` becomes the end of the current month; the renewal date is
  Stripe's and the Customer Portal's to show.
- **A Rhythm switch is a fresh grant.** Changing interval restarts Stripe's period, which starts a new first
  month with nothing spent in it. Somebody who spent 45 of 50 and switches to annual on the 20th gets 50 more
  that day. Accepted: the switch is itself a new payment, the most it gives away is one month's grant, and it
  happens only on a Rhythm change.
- **Every grant line says per month, on every surface.** `grantOf` no longer takes a Rhythm; only the price
  block answers the switcher.

## Considered options

- **Carry usage across a Rhythm switch** — count the first window after one from the old window's start.
  Rejected: a special case in the gate and a previous-window column the webhook has to keep, to prevent a
  give-away the customer has just paid for.
- **Keep the old monthly anchor after a switch.** Rejected: the twelfth window would then no longer end at
  Stripe's renewal.
- **Roll annual windows in place, like free ones.** Rejected: rolling overwrites Stripe's start, which is the
  anchor, so it needs a `period_anchor` column and a backfill for what reading does with neither.
- **A separate yearly quota on the tier.** Rejected: a Tier has one quota shared by its Rhythms by design
  (ADR-0019, T62), and a yearly pool would read as carry-over, which the Terms rule out.
