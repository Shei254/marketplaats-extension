/**
 * Who is looking at `/`, and what the page may ask on their behalf (T85,
 * ADR-0036). Types only: the session behind them — the token, the storage, the
 * calls — lives in `src/account/`, so nothing in `public/` learns who anybody is
 * by itself and `no-identity.test.ts` still holds of every file here.
 */

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
      /** Whether Stripe is billing them: Checkout if not, a Plan switch if so. */
      paying: boolean;
      /** The Rhythm they pay at, `null` when not paying or not known. */
      rhythm: string | null;
      /**
       * The card they pressed while signed out, carried through sign-in. Only
       * ever set for a payer: anybody else went straight on to Checkout.
       */
      picked: Choice | null;
    };

/** What a Plan switch would invoice now. Negative is a downgrade's credit. */
export type SwitchPreviewAnswer =
  | { status: "ready"; amount: number; currency: string }
  | { status: "not-paying" }
  | { status: "not-for-sale" }
  | { status: "unavailable" };

export type SwitchAnswer =
  | { status: "switched" }
  /** Navigating to the hosted invoice page, where 3-D Secure is finished. */
  | { status: "confirming" }
  | { status: "not-paying" }
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
  switchPlan(choice: Choice): Promise<SwitchAnswer>;
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
};
