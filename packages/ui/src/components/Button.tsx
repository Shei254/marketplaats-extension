import type { ButtonHTMLAttributes, JSX } from "react";

import { classes } from "../classes";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

/**
 * The one control both apps use.
 *
 * **The tone says what state the action is in, and the component decides from
 * that whether it can be pressed.** That is the whole point of the type: in this
 * product a button that looks locked and still fires is not a cosmetic bug — the
 * relist path deletes an ad before it re-creates it (ADR-0002), so a `locked`
 * Repost that a stray click can still reach is an ad deleted against a quota the
 * gate already refused. A caller cannot pass `disabled={false}` back out of it.
 *
 * The glyph comes with the tone for the same reason: the lock, the tick, the
 * clock and the spinner are how the four inert states tell themselves apart at a
 * glance, and leaving that to each caller is how one of them ends up bare.
 */
export type ButtonTone =
  | "primary"
  | "secondary"
  // The quiet one: a text button that is a button. Both surfaces had written it
  // for themselves — the popup header's `popup-quiet`, the admin corner's
  // `admin-who` — and a control two screens spell twice is a control.
  | "ghost"
  | "retry"
  | "locked"
  | "busy"
  | "done"
  | "cooldown";

/** How big and how round: a row action, a standalone control, a full-width one. */
export type ButtonShape = "pill" | "rect" | "block";

/** Tones that stand for a state in which the action is not available. */
const INERT: readonly ButtonTone[] = ["locked", "busy", "done", "cooldown"];

const GLYPH: Partial<Record<ButtonTone, IconName>> = {
  locked: "lock",
  done: "check",
  cooldown: "clock",
};

export function isInert(tone: ButtonTone): boolean {
  return INERT.includes(tone);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  shape?: ButtonShape;
};

export function Button({
  tone = "primary",
  shape = "pill",
  type = "button",
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const inert = isInert(tone);
  const glyph = GLYPH[tone];
  return (
    <button
      type={type}
      className={classes("mp-btn", `mp-btn--${shape}`, `mp-btn--${tone}`, className)}
      disabled={inert || disabled}
      {...rest}
    >
      {tone === "busy" ? <Spinner /> : null}
      {glyph ? <Icon name={glyph} /> : null}
      {children}
    </button>
  );
}
