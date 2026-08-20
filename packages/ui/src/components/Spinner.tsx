import type { HTMLAttributes, JSX } from "react";

import { classes } from "../classes";

export type SpinnerProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** `lg` is the standalone one; the default rides inside a button. */
  size?: "sm" | "lg";
  /**
   * What a screen reader should say while it turns. Left off, the spinner is
   * hidden: inside a button the label already says "Reposting…", and announcing
   * "loading" twice is worse than not at all.
   */
  label?: string;
};

export function Spinner({ size = "sm", label, className, ...rest }: SpinnerProps): JSX.Element {
  return (
    <span
      className={classes("mp-spinner", size === "lg" && "mp-spinner--lg", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}
