import type { ButtonHTMLAttributes, JSX } from "react";

import { classes } from "../classes";

/**
 * A glyph on its own — the popup header's refresh, and nothing heavier.
 *
 * `label` is required rather than optional. An icon button with no text has no
 * accessible name at all unless somebody supplies one, and "unlabelled button"
 * is what a screen reader reads out otherwise.
 */
export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  label: string;
};

export function IconButton({
  label,
  type = "button",
  className,
  children,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button type={type} className={classes("mp-icon-btn", className)} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
