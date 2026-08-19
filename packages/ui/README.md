# `packages/ui` — design tokens and components

Empty on purpose. This directory is the home ADR-0011 reserves for the one design system serving both the
extension popup and `apps/web` ([ADR-0017](../../docs/adr/0017-web-surface-and-subscribing.md));
the code arrives with
[#37 (T28 · `packages/ui` foundation)](https://github.com/Shei254/marketplaats-extension/issues/37).

Tokens (colour, spacing, type scale, motion) plus base components, light and dark — today's popup already
supports both.

It encodes **the agreed design canvas**, not guesses. That is why the canvas is drawn before this ticket
starts ([ADR-0016](../../docs/adr/0016-vertical-slices-and-review-gates.md)) — tokens set by whatever the
first screen happened to need are how a design language ends up being nobody's decision.
