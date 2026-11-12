/**
 * Who is looking at `/`, and what the page may ask on their behalf (T85,
 * ADR-0036). Types only: the session behind them — the token, the storage, the
 * calls — lives in `src/account/`, so nothing in `public/` learns who anybody is
 * by itself and `no-identity.test.ts` still holds of every file here.
 */

import type { PendingSwitch } from "@mprelist/contracts";

/** A plan at a Rhythm: what a card's button buys or switches to. */
export interface Choice {
  tierCode: string;
  interval: string;
}

export type Viewer =
  /** Not known yet: a silent sign-in is on its way, or `/api/me` is. */
  | { kind: "checking" }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      /** `null` on no tier at all (ADR-0032). */
      tierCode: string | null;
      /** What their plan is called, for the confirm's "wat over is van X vervalt" (T90). */
      tierName: string | null;
      /** What it grants a month, `null` unlimited or unknown. */
      grant: number | null;
      /** Whether Stripe is billing them: Checkout if not, a Plan switch if so. */
      paying: boolean;
      /** The Rhythm they pay at, `null` when not paying or not known. */
      rhythm: string | null;
      /** Stripe is collecting an open invoice: no switch until it is paid (T90). */
      inDunning: boolean;
      /** The Scheduled switch waiting for the period's end, if any (T90). */
      pendingSwitch: PendingSwitch | null;
      /**
       * The card they pressed while signed out, carried through sign-in. Only
       * ever set for a payer: anybody else went straight on to Checkout.
       */
      picked: Choice | null;
    };

/** What a switch made now would invoice today, and when the period renews (T90). */
export type SwitchPreviewAnswer =
  | { status: "ready"; amount: number; currency: string; renewsAt: string }
  | { status: "not-paying" }
  | { status: "invoice-open" }
  | { status: "not-for-sale" }
  | { status: "unavailable" };

export type SwitchAnswer =
  | { status: "switched" }
  /** A Scheduled switch, made: the chosen plan from the renewal (T90). */
  | { status: "scheduled" }
  /** Ongedaan maken, done. */
  | { status: "undone" }
  /** Navigating to the hosted invoice page, where 3-D Secure is finished. */
  | { status: "confirming" }
  | { status: "not-paying" }
  /** `409 OPEN_INVOICE`: Dunning. */
  | { status: "invoice-open" }
  | { status: "not-for-sale" }
  | { status: "unavailable" };

/** Everything the landing page may do for its visitor. */
export interface Account {
  viewer: Viewer;
  /** A sentence about the last thing that went wrong, or `null`. */
  notice: string | null;
  /** Which card is on its way somewhere — Checkout, sign-in — so it can say so. */
  busy: Choice | "billing" | null;
  signIn(choice?: Choice): void;
  signOut(): void;
  /** The Customer Portal: invoices, the way they pay, cancelling. */
  manageBilling(): void;
  /** Checkout, for somebody Stripe is billing for nothing. */
  buy(choice: Choice): void;
  previewSwitch(choice: Choice): Promise<SwitchPreviewAnswer>;
  /** Now: a fresh period at the new plan's full price, nothing credited (ADR-0042). */
  switchPlan(choice: Choice): Promise<SwitchAnswer>;
  /** At renewal: a Scheduled switch. */
  scheduleSwitch(choice: Choice): Promise<SwitchAnswer>;
  /** Ongedaan maken. */
  undoSwitch(): Promise<SwitchAnswer>;
}

/** A page with no session at all: every button signs in, or links out. */
export const NOBODY: Account = {
  viewer: { kind: "signed-out" },
  notice: null,
  busy: null,
  signIn: () => {},
  signOut: () => {},
  manageBilling: () => {},
  buy: () => {},
  previewSwitch: async () => ({ status: "unavailable" }),
  switchPlan: async () => ({ status: "unavailable" }),
  scheduleSwitch: async () => ({ status: "unavailable" }),
  undoSwitch: async () => ({ status: "unavailable" }),
};
