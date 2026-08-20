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
| `Tokens.dc.html` | the token sheet **T28 encodes** |
| `canvas.json` | artboard layout, the three pages, and the sticky notes |

Every artboard carries a **Dark** toggle. All colour values are lifted verbatim from
`apps/extension/src/popup/popup.html`, so the design is continuous with what already ships. Two are
new and called out on the token sheet: `--err-bg` (the POC renders error notes on the *warning*
background) and `--shadow`.

The legal copy in `Privacy` and `Terms` is structure plus an honest description of what the product
does. It is marked `[PLACEHOLDER]` and **needs a lawyer before the Web Store listing** (T58).

## What reads these files

[`packages/ui`](../../packages/ui/README.md) (T28) **encodes the token sheet**, and its tests read the
artboards directly: the palette is compared with the `.t` / `.t.dark` blocks in `Tokens.dc.html`, and every
icon it ships is matched — geometry and stroke width — against an `<svg>` actually drawn on some artboard.

So a re-seed that changes a colour or redraws an icon **fails `npm test`** until the package is updated to
match. That is the intended direction: the canvas decides, the code follows.

## Re-seeding

Edit the `.dc.html` files, then re-seed and republish to the same artifact URL. The seeding helper
ships with the `design` skill; ask Claude Code to "update the design canvas" rather than running it
by hand.

**Edits made in the published canvas do not flow back here.** If the canvas has been edited and
saved in the browser, extract it back into these files before editing them, or the next re-seed
overwrites that work.
