import type { HTMLAttributes, JSX } from "react";

import { classes } from "../classes";

/**
 * The line under a row that says what just happened.
 *
 * `error` is the one place this package does not copy the POC: popup.html renders
 * error notes on the *warning* background, and the canvas gives them `--err-bg`
 * of their own. See `docs/design/README.md`.
 */
export type NoteTone = "ok" | "warn" | "error";

export type NoteProps = HTMLAttributes<HTMLParagraphElement> & {
  tone: NoteTone;
};

export function Note({ tone, className, ...rest }: NoteProps): JSX.Element {
  return (
    <p
      className={classes("mp-note", `mp-note--${tone}`, className)}
      // Assertive would talk over a user mid-sentence; a relist result can wait
      // for a gap. Errors are still notes here — the row's button carries the
      // retry, and this says why.
      role="status"
      {...rest}
    />
  );
}
