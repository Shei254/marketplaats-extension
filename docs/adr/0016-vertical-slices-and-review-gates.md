# ADR-0016: Iteration 1 is cut into vertical slices, each ending at a manual review

**Status:** Accepted (2026-08-20)
**Scope:** Planning. Restructures `backlog.md`; changes no decision an earlier ADR made.

## Context
The backlog derived from the 2026-08-13 session was cut by **layer**: freeze and restructure, then the local
platform, then entitlements and enforcement, then billing, then extension auth, then the popup. It is a
correct dependency order and it built the right things — issues #9–#26 shipped the schema, the tier catalog,
the resource server, provisioning, both ends of the gate, the reconciliation sweep, the pacing rails and
`/api/me`.

It also spent eighteen tickets before anything a human can see. The first ticket on the critical path that
changes the screen is T29, behind T24, behind T23, behind T06. At the point this ADR was written the popup
was still the POC's: a vanilla-TS list of ads with a Repost button, no sign-in, no gate, no quota. Every
decision in ADR-0007 and ADR-0014 had been implemented and **none of it had ever been looked at**.

That is not a scheduling annoyance. Two of the things this product has to get right — whether the locked
state converts, and whether the popup is pleasant enough to pay for — are only answerable by looking, and
a layered plan defers looking until the layers are done. A third, the enforcement depth itself, was being
judged from the outside as "too deep" precisely because there was no way to sit in front of it and judge it
from the inside.

Options weighed: keep the layered order and add a demo milestone at the end; cut vertically and accept some
rework where a slice needs a thinner version of something a later slice deepens; or interleave, taking one
UI ticket per backend ticket.

## Decision
**Cut the remaining work vertically. A slice is done when a human has clicked through it against a real
build, following a written script.**

Iteration 1 is four slices. Each ends at a state of the product that can be demonstrated, not at a layer
that can be unit-tested:

| Slice | Ends at |
|---|---|
| **A · I can sign in** | Load unpacked, click the icon, sign in through Keycloak, see the plan and quota above the real ad list |
| **B · The gate bites** | Relist and watch the count fall; exhaust it and watch the button lock; trip the pacing rail and watch the cooldown |
| **C · I can pay, and it unlocks** | Locked popup → plan cards → Stripe Checkout → back to a popup that says Pro |
| **D · I can run it** | Sign in to `/admin`, change what a tier grants, watch a fresh user land on it |

Each slice carries a **click-through script** in `docs/`, in the shape of the existing
[`live-testing.md`](../live-testing.md): numbered steps, what to click, and what must be on the screen. The
slice is not done when its tickets are closed. It is done when the script has been walked.

**Go-Live is a separate milestone, not the tail of iteration 1.** Iteration 1 runs on one machine against
Stripe test mode. Deployment, a domain, TLS, a production realm, live keys, Stripe Tax and VAT registration,
the Web Store listing and CI are their own work, and the backlog had no ticket for any of them.

## Consequences
- **Positive:** Every slice is reviewable, so usability is a thing that gets judged four times instead of
  once at the end. The work already shipped in #14–#26 becomes visible in slice A, which is also the first
  honest test of whether it behaves as specified.
- **Positive:** The scripts are the artefact that stops this reverting. A slice with no script is a slice
  nobody agreed how to review.
- **Negative:** Some rework. Slice A renders an ad list that slice B then gives a state machine; slice C
  builds a web app that slice D adds authenticated routes to. A layered plan would have built each once.
  That cost is accepted deliberately — it is the price of being able to look at the thing.
- **Negative:** A vertical slice touches more modules per ticket, so a slice's tickets are harder to
  parallelise across people than a layer's were. Iteration 1 has one developer, so this costs nothing yet.
- The critical path in `backlog.md` is replaced. Ticket ids **stay stable** — a ticket that moves between
  milestones keeps its number, so the GitHub issues and every ADR reference to a `T`-number still resolve.

## Revisit if
More than one person is building at once, and slices start blocking each other rather than each other's
reviews — at which point the layer cut is the better parallelisation and the review gate should move to
the slice boundary rather than sit inside it.
