import type { RelistOutcomeCode, RemainingQuota } from "@mprelist/contracts";

import type { GateDecision } from "./authorization-gate";

/**
 * The backend's half of a relist, as the orchestrator needs it (T26, #35).
 *
 * A port, so the delete-first state machine can be tested without a backend and
 * without a fetch — the same arrangement `MarktplaatsClient` and `SnapshotStore`
 * already have. The real one is `src/api/relist-authorizations.ts`.
 *
 * Two calls and they are not symmetric. **`authorize` is a permission**: nothing
 * is deleted without a fresh `proceed` (ADR-0007), and its answer is the gate's
 * decision rather than a response, because reading a response is `decide`'s job
 * and it has already been done by the time this returns. **`report` is
 * bookkeeping**: it settles or refunds the reservation the authorization took, it
 * cannot fail the relist that already happened, and a relist nobody reports on is
 * reconciled by the backend after a grace window (#24).
 */
export interface RelistPermission {
  /**
   * @param batch that this ad is one of several the caller is working through
   * (T68, #147). Optional and false by default, which is what a single repost is
   * — and what an older API ignores. It buys one refusal the client cannot make
   * for itself: `BULK_NOT_ENTITLED` from a plan that does not include bulk, which
   * arrives here as `{ state: "not-in-plan" }`.
   */
  authorize(adId: string, batch?: boolean): Promise<GateDecision>;
  /**
   * Answers with **what the period has left now**, which is the same subtraction
   * `/api/me` renders and the gate refuses on — so a popup that has just relisted
   * can move its own counter without asking again (T32, #41). `null` when the
   * backend could not be told, or told us nothing readable: the caller then knows
   * only that it does not know, which is different from knowing the number is
   * unchanged.
   */
  report(jti: string, outcome: RelistOutcomeCode): Promise<RemainingQuota | null>;
}
