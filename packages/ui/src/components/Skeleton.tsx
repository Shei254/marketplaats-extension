import type { HTMLAttributes, JSX } from "react";

import { classes } from "../classes";

export type SkeletonProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** A number is pixels; a string is whatever CSS length or percentage you wrote. */
  width?: number | string;
  height?: number | string;
  /** A skeleton standing in for a pill-shaped control rather than for text. */
  shape?: "bar" | "pill";
};

const length = (value: number | string | undefined): string | undefined =>
  typeof value === "number" ? `${value}px` : value;

export function Skeleton({
  width,
  height,
  shape = "bar",
  className,
  style,
  ...rest
}: SkeletonProps): JSX.Element {
  return (
    <span
      className={classes("mp-skeleton", shape === "pill" && "mp-skeleton--pill", className)}
      style={{ width: length(width), height: length(height), ...style }}
      // A loading placeholder is not content. The screen it sits on says it is
      // loading; a row of unnamed boxes announced one by one says nothing.
      aria-hidden={true}
      {...rest}
    />
  );
}
