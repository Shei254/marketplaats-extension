# Design canvas — sources

The artboards behind the popup and `apps/web` designs, as Design Component files. **These are the
source; the published canvas is generated from them** and is git-ignored (it is ~2.3 MB of editor
code, regenerated on every seed).

| | |
|---|---|
| `Main.dc.html` | signed in, quota remaining — the canonical popup |
| `SignedOut.dc.html` · `Loading.dc.html` · `Unavailable.dc.html` | the states with no ad list |
| `RowStates.dc.html` | the per-row idle / busy / done / failed machine (T30b) |
| `QuotaExhausted.dc.html` · `Cooldown.dc.html` · `Dunning.dc.html` | the gated states — ads stay visible, buttons lock |
| `PlanCards.dc.html` | the plan picker (T52) |
| `Success.dc.html` · `Cancel.dc.html` · `Privacy.dc.html` · `Terms.dc.html` | `apps/web`'s public pages (T50, T36) |
| `Landing.dc.html` | `/`, the Web Store listing's homepage (T58) — drawn, not yet built |
| `Tokens.dc.html` | the token sheet **T28 encodes** |
| `canvas.json` | artboard layout, the three pages, and the sticky notes |

Every artboard carries a **Dark** toggle and the same `.t` / `.t.dark` token block, so a palette change
is one edit applied to all of them.

**The palette was re-cut in 2026-08** ([ADR-0021](../adr/0021-design-system-stays-ours.md)) and no longer
comes from `apps/extension/src/popup/popup.html`: a cooler neutral ramp, a stronger accent, and a dark theme
designed as itself rather than as the light one inverted. Three tokens are new — `--subtle` (the fill under a
table head or an input), `--ring` (a focus ring, which nothing had) and `--shadow-sm` (a card at rest, beside
the lifted `--shadow`) — alongside the two the canvas already added, `--err-bg` and `--shadow`.

**`Privacy` and `Terms` are the two artboards drawn *from* the code**, and they are the exception to
everything above. `Privacy` is still structure plus an honest description of what the product does, but
`Terms` is the operator's own Gebruiksvoorwaarden (T36, 2026-09-22): sixteen sections of binding text that
arrived as finished copy, not as a drawing. Neither carries the dashed `[PLACEHOLDER]` box any more.

Both were redrawn out of `apps/web/src/public/legal.tsx` on 2026-09-22 — its `PRIVACY` and `TERMS`, in the
page's own order, at the type sizes these artboards already used — so the *words* on them are the code's and
the *frame* around those words is still the canvas's. **Redraw them the same way rather than editing the
copy here**, which would be editing a legal document in a design file. `Terms` is ~3880px tall as a result,
which is what sixteen sections of it come to; `canvas.json` carries the frame.

## What reads these files

[`packages/ui`](../../packages/ui/README.md) (T28) **encodes the token sheet**, and its tests read the
artboards directly: the palette is compared with the `.t` / `.t.dark` blocks in `Tokens.dc.html`, and every
icon it ships is matched — geometry and stroke width — against an `<svg>` actually drawn on some artboard.

So a re-seed that changes a colour or redraws an icon **fails `npm test`** until the package is updated to
match. That is the intended direction: the canvas decides, the code follows.

### Where the code is ahead of these artboards

The 2026-08 UI pass went the other way for **layout**, and this is the honest record of it. Colour is still
the canvas's — the token sheet was edited first and `tokens.test.ts` holds the code to it — but four things
are drawn in the product and on no artboard:

| | Where | What to draw at the next re-seed |
|---|---|---|
| The quota **meter** | popup, under the plan name | a 4px `--mp-line` track with an `--mp-accent` fill; amber under a quarter left, red at empty |
| Sections as **cards** | `/admin`, and the popup's plan cards | `--mp-bg` on `--mp-stage`, 1px `--mp-line`, `--mp-radius-card`, `--mp-shadow-sm` |
| A **focus ring** | every control on both surfaces | `0 0 0 3px var(--mp-ring)`, with a transparent 2px outline under it |
| The **logo tile** | all three headers | the mark on `--mp-accent`, 24px, `--mp-radius-block` |

`/admin` still has no artboard at all and is drawn out of the tokens, which is what
[T54 (#85)](https://github.com/Shei254/marketplaats-extension/issues/85) decided and remains true.

**And the popup copy here is in English, while both surfaces ship `lang="nl"`.** `Main.dc.html` says
*"Repost"* and *"relists left"* where the popup renders Dutch — these artboards are the source for the
*structure* of that copy, and the Dutch is the code's. Draw them in Dutch at the next re-seed. The two legal
artboards are no longer part of this: they were redrawn from `legal.tsx` and are in Dutch already. The
product's **name** was substituted through every file here on 2026-09-19, when `brand.json` stopped saying
Bumpr (T60), so it is the one thing in this copy that is current.

## Re-seeding

Edit the `.dc.html` files, then re-seed and republish to the same artifact URL. The seeding helper
ships with the `design` skill; ask Claude Code to "update the design canvas" rather than running it
by hand.

**Edits made in the published canvas do not flow back here.** If the canvas has been edited and
saved in the browser, extract it back into these files before editing them, or the next re-seed
overwrites that work.
