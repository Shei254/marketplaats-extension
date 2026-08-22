import type { HTMLAttributes, JSX } from "react";

import { classes } from "../classes";

/**
 * How much of something is left, in the width of a bar.
 *
 * Built for the popup's quota, which was three words of text — "2 of 3 relists
 * left" — and is the number this product is *about*. A bar is read before it is
 * counted, and the words stay beside it because a bar alone cannot say when it
 * comes back.
 *
 * **It turns colour on its own**, at a quarter left and at empty, because those
 * are properties of the fraction rather than decisions a caller should be able to
 * get wrong on one screen and right on another.
 *
 * `role="progressbar"` with the real numbers: a screen reader reads the quota
 * rather than a decorative div, and `aria-valuetext` is what the sighted reader's
 * sentence says, since "2" alone is not the fact.
 */
export type MeterProps = HTMLAttributes<HTMLSpanElement> & {
  /** What is left, not what is spent. */
  value: number;
  max: number;
  /** The sentence a screen reader should hear instead of a bare number. */
  valueText?: string;
};

export function Meter({ value, max, valueText, className, ...rest }: MeterProps): JSX.Element {
  const left = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const tone = left === 0 ? "err" : left <= 0.25 ? "warn" : null;
  return (
    <span
      className={classes("mp-meter", tone && `mp-meter--${tone}`, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      {...rest}
    >
      <span className="mp-meter-fill" style={{ width: `${left * 100}%` }} />
    </span>
  );
}
