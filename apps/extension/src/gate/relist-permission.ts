import type { RelistOutcomeCode } from "@mprelist/contracts";

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
  authorize(adId: string): Promise<GateDecision>;
  report(jti: string, outcome: RelistOutcomeCode): Promise<void>;
}
