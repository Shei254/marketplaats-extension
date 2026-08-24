import type { UntaggedPrice } from "@mprelist/contracts";
import { Card, Note } from "@mprelist/ui";
import type { JSX } from "react";

import type { PricesAnswer } from "./admin-api";

/**
 * The Stripe Prices carrying no `tier_code` — the list that makes a forgotten tag
 * visible rather than silent (ADR-0019).
 *
 * **A page of its own since the 2026-08 pass, and that is the point of it.** It
 * used to sit directly under the tier catalog, which put a list nobody can act on
 * underneath the list an operator works in — every scroll past the forms ended in
 * a table that answers a question almost nobody is asking. It is still one click
 * away, and the sidebar carries a count when there is something in it, which is
 * the only moment it is worth anybody's attention.
 *
 * **It lists and does nothing.** There is no adopt button, because Stripe accounts
 * hold Prices for one-offs, coupons and experiments, and only the operator can
 * tell an experiment from a mistake. Adopting is done in Stripe, by adding the
 * tag, which fires `price.updated` and goes through the sync that already exists.
 */
export function AdminPrices({ answer }: { answer: PricesAnswer | null }): JSX.Element {
  if (!answer) return <p className="admin-empty">Asking Stripe…</p>;
  if (answer.status === "forbidden") {
    return <Note tone="error">This account no longer has the ADMIN role.</Note>;
  }
  if (answer.status !== "ready") {
    return (
      <Note tone="warn">
        Stripe could not be asked, so this list is unknown rather than empty.
      </Note>
    );
  }
  if (answer.prices.length === 0) {
    return (
      <Card>
        {/* Empty is the *good* state here, and a blank card would read as a
            failure. Said in a sentence instead. */}
        <p className="admin-empty">
          Every price in Stripe belongs to a tier. Nothing to sort out.
        </p>
      </Card>
    );
  }
  return (
    <div className="admin-sections">
      <Note tone="warn">
        Add <code>metadata.tier_code</code> to a price in Stripe and it becomes a tier here on its
        own — nothing needs doing on this screen.
      </Note>
      <Card flush>
        <div className="admin-table-scroll">
          <table className="mp-table admin-table">
            <thead>
              <tr>
                <th>Price</th>
                <th>Nickname</th>
                <th>Amount</th>
                <th>Recurs</th>
              </tr>
            </thead>
            <tbody>
              {answer.prices.map((price) => (
                <PriceRow key={price.id} price={price} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PriceRow({ price }: { price: UntaggedPrice }): JSX.Element {
  return (
    <tr>
      <td>
        <code className="mp-code">{price.id}</code>
      </td>
      <td>{price.nickname ?? "—"}</td>
      <td className="admin-numeric">
        {(price.amount / 100).toFixed(2)} {price.currency.toUpperCase()}
      </td>
      {/* A one-off is the commonest thing in this list that is not a mistake. */}
      <td>{price.interval ?? "one-off"}</td>
    </tr>
  );
}
