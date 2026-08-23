# `packages/ui` — design tokens and base components

The one design system behind the extension popup and `apps/web`
([ADR-0011](../../docs/adr/0011-repository-layout.md),
[ADR-0017](../../docs/adr/0017-web-surface-and-subscribing.md)), so the two do not drift into two.

It **encodes the design canvas** — [`docs/design/`](../../docs/design/README.md), and specifically the
`Tokens` sheet ADR-0016 has drawn before this package exists. That is not a slogan here: the tests read the
canvas files and hold the palette and every icon to them, so a colour changed on the canvas and not here
fails the suite rather than drifting quietly. Tokens set by whatever the first screen happened to need are
how a design language ends up being nobody's decision.

```ts
import { Badge, Button, Card, Field, Input, Meter, Note, UiStyles } from "@mprelist/ui";

<div className="mp-root">
  <UiStyles />
  <Button tone="locked">Repost</Button>
</div>;
```

## What is in it

| | |
|---|---|
| `tokens.ts` | the palette (light and dark), the type steps, the spacing step, the radii, the elevations and the motion. **The only place a colour is written down.** |
| `theme.ts` | those tokens as CSS custom properties, generated rather than kept beside them |
| `styles.ts` | the component rules, and `uiCss` — the properties and the rules in one string |
| `components/` | `Button`, `IconButton`, `Icon`, `Badge`, `Card`, `Field` (with `Input`, `Select`, `Textarea`, `Checkbox`), `Meter`, `Note`, `Skeleton`, `Spinner`, `UiStyles` |

**Not** in it, deliberately: the popup's header, rows, quota strip and callouts. Those are screens, and they
are T29 (#38), T30a (#39), T30b (#79) and T32 (#41). This package is what they are all built out of.

## What the 2026-08 pass added, and the rule it followed

[ADR-0021](../../docs/adr/0021-design-system-stays-ours.md) is the decision — **not shadcn**, and why. The
rule this package now states for itself is: **a component two screens have spelled twice is a component.**
Every one of these existed already, once in `admin-styles.ts` and once in `popup-styles.ts`:

| | Was |
|---|---|
| `Badge` | the admin corner's `admin-pill` and the plan card's `popup-plan-card-pill` |
| `Card` | the public site's `web-card`, and nothing at all in `/admin` |
| `Field` · `Input` · `Select` · `Textarea` · `Checkbox` | `admin-field` and five bare element selectors |
| `.mp-table` | `admin-table` |
| `Button tone="ghost"` | the popup's `popup-quiet` and the admin's `admin-who` |

`Meter` is the only one that is new rather than moved: the quota was three words of text, and a fraction is
read before it is counted.

Three things changed for the *design* rather than for this package: **focus is visible** on every control
(one rule, and there was none before), **state changes are transitions** — colour and shadow only, at
`--mp-fast`, dropped entirely under `prefers-reduced-motion` — and there are now **two elevations**, so a
card at rest and a card that is lifted are different things.

## Three decisions worth knowing before you use it

**The stylesheet is a string, not a `.css` file.** `uiCss` is text, injected by `<UiStyles />`, a `<style>`
tag, or `adoptedStyleSheets`. `:hover`, `:disabled` and `@keyframes` cannot be inline styles at all, and a
string is the one form that also adopts into the shadow root T41 (#50) injects on marktplaats.nl — where a
stylesheet fetched by URL is another web-accessible resource and a bundler CSS pipeline is a third build to
keep in step. The token block is emitted for `:root`, `:host` **and** `.mp-theme` for that same reason:
inside a shadow root, `:root` matches nothing.

**Names are namespaced, values are not.** Every property is `--mp-…` and every class is `mp-…`, because they
have to survive being injected into a stranger's page. The values are the canvas's, verbatim.

**Light and dark, and an explicit theme wins.** With nothing said, the sheet follows
`prefers-color-scheme` — which is what the POC popup already does. `data-mp-theme="light" | "dark"` on any
ancestor pins a subtree, in both directions; `themeAttribute(theme)` spreads it.

## Consuming it

There is no build step and no `dist/`. Both consumers bundle — esbuild for the extension, Vite for
`apps/web` — so this package's `exports` points at TypeScript source, and a build here would only produce a
second artefact to keep in step. `src/bundles.test.ts` proves the extension's own bundler settings resolve
that entry point, and that the automatic JSX runtime comes from this package's `tsconfig.json` rather than
from the consumer's (esbuild's default is the classic transform, which would leave the components calling a
`React` nobody imported).

React is a **peer** dependency: the consumer owns the copy, and two Reacts in one bundle is a class of bug
worth never having.

```bash
npm run typecheck -w @mprelist/ui
npm test -w @mprelist/ui
```

## The tests

They are about the two things that fail *quietly* in CSS:

- **The canvas is the source.** `tokens.test.ts` compares the whole palette with `Tokens.dc.html`, both
  directions; `icons.test.tsx` matches each icon's geometry **and** stroke width against the SVGs actually
  drawn on the artboards, so an icon this package invented has nowhere to hide.
- **A rule that reaches for a property nobody declared renders transparent.** `styles.test.ts` collects every
  `var(--mp-…)` in the component rules and every declaration in the theme, and holds one to the other. It
  also asserts no rule spells a colour of its own, and that the generated sheet is well-formed — an
  unbalanced brace silently discards everything after it.

Reading `docs/design/` from a test means this workspace has an input outside its own directory. That is the
same arrangement `apps/api` has with `infra/`, and it is why CI carries no path filters (see the root
README): a filter that did not know about it would go green having looked at nothing.
