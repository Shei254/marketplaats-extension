# ADR-0021: The design system stays ours, and stays a CSS string

**Status:** Accepted (2026-08-23)
**Scope:** Both surfaces. Refines [ADR-0016](0016-vertical-slices-and-review-gates.md)'s canvas-first rule
and settles what `packages/ui` is when somebody asks for a component it does not have.

## Context
The popup and `/admin` were built screen by screen against the design canvas, and by the time both existed
the seams showed: the admin corner was a white page with a bare table on it, three form controls were spelled
in `admin-styles.ts` and nowhere else, the plan card's pill and the admin's state pills were two spellings of
one thing, and **nothing on either surface showed keyboard focus** — the search box's outline was the whole of
it.

The obvious move was to adopt **shadcn/ui**: it is the current default answer, it is well designed, and it
would arrive with a form vocabulary we do not have.

Three things make it the wrong tool *here*:

1. **It is Tailwind, and this design ships as a string.** `uiCss` is text — injected by `<UiStyles/>` in
   React, and adopted into the shadow root T41 ([#50](https://github.com/Shei254/marketplaats-extension/issues/50))
   will open on marktplaats.nl. Tailwind emits a stylesheet from a build; the extension's esbuild pipeline has
   no CSS step, and putting one in means a web-accessible stylesheet in a stranger's page and a third build to
   keep in step. The string is not a preference, it is the delivery mechanism.
2. **It brings a second token vocabulary.** `--primary`, `--ring`, HSL triples. Ours are the canvas's, held to
   `docs/design/Tokens.dc.html` by a test that reads that file. Two systems means the conformance test is
   theatre — it would still pass while the screens were painted from somebody else's palette.
3. **Radix is behaviour we are not using.** The value in shadcn is largely its primitives' keyboard and focus
   management for menus, dialogs and comboboxes. Neither surface has one. What we have is buttons, inputs, a
   table and badges — the parts where a library buys the least and costs a runtime in a popup that has to
   paint instantly.

## Decision
**Deepen `packages/ui` instead, and take shadcn's *look* rather than its code.**

Concretely, in the 2026-08 pass:

- **The palette was re-cut on the canvas and then here** — a cooler neutral ramp, a stronger accent, and a
  dark theme designed as itself rather than as the light one inverted. Three tokens were missing rather than
  wrong: `subtle` (the fill under a table head or an input), `ring` (a focus ring — there was none) and
  `shadow-sm` (a card at rest, beside the lifted one).
- **A component two screens have spelled twice is a component.** `Badge`, `Card`, `Field`/`Input`/`Select`/
  `Textarea`/`Checkbox`, `.mp-table` and a `ghost` Button tone all existed already, once in `admin-styles.ts`
  and once in `popup-styles.ts`. `Meter` is the only genuinely new one, and it exists because the quota — the
  number this product is about — was three words of text.
- **What stays in a surface's own sheet is layout**, and nothing else.

## Consequences
- **Positive:** One place to change a colour, and it is still the canvas. The conformance test still means
  what it says.
- **Positive:** No new build step, no runtime dependency, and the shadow-root story T41 depends on is intact.
- **Positive:** Focus is visible on every control, in one rule rather than a decision per component.
- **Negative:** We own the components. A date picker, a combobox or a modal is ours to write, and each is a
  keyboard implementation to get right — the point at which this decision should be revisited rather than
  worked around.
- **Negative:** The artboards' *layout* is now behind the code on the two things this pass added (the quota
  meter, and sections as cards). The token sheet is still authoritative for colour and is where a re-seed
  starts; `docs/design/README.md` records exactly what differs so the next re-seed draws it.

## Revisit if
A surface needs a control whose value is its keyboard behaviour — a modal, a menu, a combobox, a date picker.
Writing the third one of those by hand is worse than taking a headless library (Radix, Ark, React Aria) for
behaviour alone and keeping these tokens and this stylesheet for the look.
