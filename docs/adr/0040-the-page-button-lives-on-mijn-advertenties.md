# ADR-0040: The second surface is a Page button on Mijn Advertenties, in its own React content script

**Status:** Accepted (2026-11-10)
**Scope:** `apps/extension` — a new content script and the injected UI. **Narrows
[ADR-0004](0004-surfaces-and-internal-api.md)**, which named both the dashboard and public listing pages, and
answers T40 ([#49](https://github.com/Shei254/marketplaats-extension/issues/49)). T41
([#50](https://github.com/Shei254/marketplaats-extension/issues/50)) and T42
([#51](https://github.com/Shei254/marketplaats-extension/issues/51)) are the work. No API, worker-protocol or
catalog change: the button sends the `relist` the popup already sends.

## Decision

**The only page the extension draws into is Mijn Advertenties** (`/my-account/sell/*`), and it draws one
**Page button** per row, above Marktplaats's *Sneller verkopen* in `.AdFeatures-module-cta`. That page lists
only the seller's own ads, so the row's `data-ad-id` *is* the ownership; **Ownership detection** stays an
open spike for any other page rather than being solved here. Public ad pages get nothing, which also keeps us
out of pages strangers see.

**It runs in a second content script, matched on `/my-account/sell/*` only, built with React and
`packages/ui`.** The relay `content.js` on every marktplaats.nl page is untouched. The button renders the
popup's own `Button` tones inside a Shadow DOM, so the two surfaces cannot drift apart visually, and React's
weight is paid on the one page that uses it.

**It behaves like the popup's row, word for word**: *Herplaats* and the popup's tooltip; one repost at a time
across both surfaces (it reads the worker's `activeRepost()`); a cooldown counts down on the button; every
other refusal opens an anchored card with `refusalNote`'s sentence and at most one action (plans page,
Portal, or *Opnieuw proberen*); success fades the row and offers a *Vernieuwen* toast rather than reloading;
a **Pending repost** shows on its button, and *Niet terugzetten* stays in the popup alone. Geometry is
Marktplaats's `hz-Button`, colour and mark (`logo`) are ours.

## Considered options

- **Both pages ADR-0004 named.** Needs Ownership detection on public pages, which nobody has pinned, for a
  surface the seller visits less often than their own list.
- **Plain DOM, no React.** Smallest bundle, but every button state and the card re-implemented by hand — a
  second design system.
- **React inside the existing `content.js`.** One script, but React on every marktplaats.nl page for a feature
  that lives on one.
- **Auto-reload after success.** Simpler, but sends a seller working down their list back to the top each time.
- **A pending-repost strip on the page.** A second place that can let an ad go, which destroys its snapshot.

## Consequences

- **The URL match assumes Mijn Advertenties is a full page load**, not a client-side route from elsewhere on
  the site. The click-through has to confirm it; if it is wrong, the match widens and the script decides
  for itself whether it is on the page.
- **Two content scripts on the same page**: the relay and the Page button. The button never calls
  Marktplaats itself; it asks the worker, which asks the relay, as the popup does.
