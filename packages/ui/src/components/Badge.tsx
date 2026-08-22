import type { HTMLAttributes, JSX } from "react";

import { classes } from "../classes";

/**
 * A word about a thing, in the colour of what it means.
 *
 * Both surfaces had written this for themselves before it existed here — the
 * admin corner's `admin-pill` for *on sale* / *draft* / *default*, and the plan
 * card's `popup-plan-card-pill` for *Current*. Two spellings of one component is
 * how two screens end up disagreeing about what a state looks like.
 *
 * **The tone is what the word means, not how it looks.** `neutral` is a fact
 * about a thing (`month`, `year`), `accent` is a fact about *your* thing (the
 * plan you are on, the tier new accounts get), and the other three are the same
 * three `Note` has: something is right, something wants attention, something is
 * wrong.
 */
export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "err";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps): JSX.Element {
  return (
    <span
      className={classes("mp-badge", tone !== "neutral" && `mp-badge--${tone}`, className)}
      {...rest}
    />
  );
}
