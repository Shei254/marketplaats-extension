import { useState, type JSX } from "react";

import type { Account } from "./viewer";

/**
 * The header's corner on `/` (T85, ADR-0036): *Inloggen* for a visitor, and for
 * somebody signed in a menu with **Betaling beheren** and **Uitloggen**.
 *
 * **"Mijn account" rather than an address**: this application holds no email
 * address (#108), and the realm's tokens for this client carry none, so there is
 * nothing true to put there that the page does not already say — their plan is
 * the card marked "Huidig".
 */
export function AccountControl({ account }: { account: Account }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const { viewer } = account;
  if (viewer.kind === "checking") return null;
  if (viewer.kind === "signed-out") {
    return (
      <button type="button" className="web-account" onClick={() => account.signIn()}>
        Inloggen
      </button>
    );
  }
  return (
    <span className="web-account-menu">
      <button
        type="button"
        className="web-account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Mijn account
      </button>
      {open ? (
        <span className="web-account-items" role="menu">
          {viewer.paying ? (
            <button
              type="button"
              role="menuitem"
              disabled={account.busy === "billing"}
              onClick={account.manageBilling}
            >
              Betaling beheren
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={account.signOut}>
            Uitloggen
          </button>
        </span>
      ) : null}
    </span>
  );
}
