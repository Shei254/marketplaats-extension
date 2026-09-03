/**
 * `@mprelist/contracts` — the API's wire types, consumed by both clients
 * (ADR-0011), so a contract change lands atomically in one commit.
 *
 * **And the reading of the one wire field that is not self-explanatory**: every
 * `amount` here is in the currency's smallest unit, and `./money` is that unit
 * converted, said once rather than in each client (T66). It is the only runtime
 * code here that is not a list of the enum values the wire uses.
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
  CSRF_MODES,
  DENIAL_REASONS,
  RELIST_OUTCOMES,
  SUBSCRIPTION_STATUSES,
  type AdminTier,
  type AdminTiers,
  type AuthorizeRequest,
  type CatalogCurrency,
  type CheckoutRequest,
  type ClientConfig,
  type ClientConfigCsrf,
  type ClientConfigExtractor,
  type ClientConfigPacing,
  type CheckoutSession,
  type CompleteRequest,
  type CsrfMode,
  type Denial,
  type DenialReason,
  type DisplayState,
  type NewPlan,
  type NewPrice,
  type Plan,
  type PlanPrice,
  type Plans,
  type PortalSession,
  type RelistAuthorization,
  type RelistOutcomeCode,
  type RemainingQuota,
  type SubscriptionStatus,
  type TierEdit,
  type TierName,
  type TierPriceOnTheWire,
  type UnadoptedPrices,
  type UntaggedPrice,
} from "./enforcement";

export {
  amountInMinorUnits,
  decimalsIn,
  inMajorUnits,
  majorUnitsOf,
} from "./money";
