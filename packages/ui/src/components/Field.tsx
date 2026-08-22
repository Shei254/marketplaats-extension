import type { InputHTMLAttributes, JSX, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

import { classes } from "../classes";

/**
 * A label, a control, and the sentence under it that explains the rule.
 *
 * **The whole thing is the `<label>`**, so the label text and the hint both focus
 * the control when they are clicked — which is free here and is the kind of thing
 * nobody adds later. That is also why the hint is a `<span>`: a `<p>` inside a
 * `<label>` is not phrasing content, and the browser closes the label around it.
 *
 * The admin corner had all of this as `admin-field`, and it is the reason this
 * component exists: a form is the one screen where a design system either has
 * opinions or is decoration.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className={classes("mp-field", className)}>
      <span className="mp-label">{label}</span>
      {children}
      {hint ? <span className="mp-hint">{hint}</span> : null}
    </label>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...rest }: InputProps): JSX.Element {
  return <input type={type} className={classes("mp-input", className)} {...rest} />;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...rest }: SelectProps): JSX.Element {
  return <select className={classes("mp-select", className)} {...rest} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps): JSX.Element {
  return <textarea className={classes("mp-textarea", className)} {...rest} />;
}

/**
 * A checkbox and the words beside it, which is the one field where the label goes
 * after the control rather than above it.
 *
 * The input is the browser's own, coloured with `accent-color`. A drawn one would
 * be a second keyboard and screen-reader implementation to get right, for a
 * control the platform already ships.
 */
export function Checkbox({
  label,
  className,
  ...rest
}: InputProps & { label: ReactNode }): JSX.Element {
  return (
    <label className={classes("mp-check-row", className)}>
      <input type="checkbox" className="mp-check" {...rest} />
      <span>{label}</span>
    </label>
  );
}
