/**
 * `@mprelist/contracts` — the API's wire types, consumed by both clients
 * (ADR-0011), so a contract change lands atomically in one commit.
 *
 * **And the reading of the two wire fields that are not self-explanatory.** Every
 * `amount` here is in the currency's smallest unit, and `./money` is that unit
 * converted, said once rather than in each client (T66). `features` is an open
 * object whose one flag three separate readers had to agree about, and
 * `./features` is that agreement (T69; ADR-0026). A quota is nullable on four wire
 * shapes and had five readers spelling that out four ways, and `./quota` is the one
 * spelling (T73; ADR-0029). And a plan is read aloud on two surfaces since the
 * site's landing page (T58), and `./wording` is how it reads. They are the only
 * runtime code here that is not a list of the enum values the wire uses, and all
 * four are here for the same reason: two copies of a rule about one field is the
 * pair that drifts.
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
  RESERVED_TIER_CODE,
  SUBSCRIPTION_STATUSES,
  type AdminTier,
  type AdminTiers,
  type AuthorizeRequest,
  type CatalogCurrency,
  type CatalogOrder,
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
  type FreeTier,
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
  type SwitchMade,
  type SwitchPreview,
  type SwitchRequest,
  type TierEdit,
  type TierName,
  type TierPriceOnTheWire,
  type UnadoptedPrices,
  type UntaggedPrice,
} from "./enforcement";

export {
  BULK,
  bulkIn,
  isExpressible,
  withBulk,
  type BulkGrant,
} from "./features";

export {
  amountInMinorUnits,
  decimalsIn,
  inMajorUnits,
  majorUnitsOf,
} from "./money";

export { isQuota } from "./quota";

export { cardGrantOf, grantOf, priceAndRhythmOf, priceOf, UNLIMITED_REPOSTS, waysToPay } from "./wording";
