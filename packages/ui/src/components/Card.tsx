import type { HTMLAttributes, JSX, ReactNode } from "react";

import { classes } from "../classes";

/**
 * A surface with an edge — what a page of sections is made of.
 *
 * The popup has no use for one: it *is* a card, edge to edge, 360px wide. This is
 * `apps/web`'s shape (T50's public pages already draw it by hand in
 * `site-styles.ts`, and T54's admin corner drew nothing at all), and it is here
 * rather than there because the two surfaces are one design system and a card is
 * the most obvious thing in it.
 *
 * **The head is optional and the body is not.** A card with a title and a lede is
 * a section of a page; a card with neither is a panel around a form. Passing
 * `flush` takes the padding off the body, which is what a table wants — its own
 * cells carry the gutter, and a padded card around it would double it.
 */
export type CardProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  /** The sentence under the title that says what the section is for. */
  lede?: ReactNode;
  /** Controls that belong to the section as a whole, opposite the title. */
  actions?: ReactNode;
  flush?: boolean;
};

export function Card({
  title,
  lede,
  actions,
  flush = false,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  return (
    <section className={classes("mp-card", className)} {...rest}>
      {title || actions ? (
        <div className="mp-card-head">
          <div>
            {title ? <h2 className="mp-card-title">{title}</h2> : null}
            {lede ? <p className="mp-card-lede">{lede}</p> : null}
          </div>
          {actions ? <div className="mp-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={classes("mp-card-body", flush && "mp-card-body--flush")}>{children}</div>
    </section>
  );
}
