/**
 * `@mprelist/contracts` — the API's wire types, consumed by both clients
 * (ADR-0011), so a contract change lands atomically in one commit.
 *
 * Consumed as TypeScript source: both consumers bundle, so a build step here
 * would only produce a second artefact to keep in step.
 *
 * **Shared source is not lockstep releases.** Extension releases take days and API
 * deploys take minutes (ADR-0011), so the API stays backward-compatible with
 * installed builds: removing or renaming a field here is a versioning decision
 * (T43, #52), not a refactor.
 */
export {
  DENIAL_REASONS,
  RELIST_OUTCOMES,
  SUBSCRIPTION_STATUSES,
  type AuthorizeRequest,
  type CompleteRequest,
  type Denial,
  type DenialReason,
  type DisplayState,
  type Plan,
  type PlanPrice,
  type Plans,
  type RelistAuthorization,
  type RelistOutcomeCode,
  type RemainingQuota,
  type SubscriptionStatus,
  type TierName,
} from "./enforcement";
