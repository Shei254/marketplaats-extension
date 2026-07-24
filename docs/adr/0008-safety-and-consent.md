# ADR-0008: Safety & consent posture

**Status:** Accepted (2026-07-25)
**Scope:** POC (warning copy) and full app (rails + acknowledgment).

## Context
The relist mechanic is delete+recreate (ADR-0002), which contravenes Marktplaats's terms and can get a user's account flagged or banned; internal-API calls are more detectable than human clicks (ADR-0004). The harm lands on paying customers' accounts, and mass detection would get the extension itself blocked.

## Decision
**Informed consent + conservative safety rails.**
- **Consent:** On first use, present a clear, honest warning that the action contravenes Marktplaats's terms and carries account-ban risk, requiring explicit acknowledgment.
- **Safety rails (defaults):** Per-account relist **rate limits**, **human-like pacing/jitter** between actions, and sensible **caps**. Defaults favour account safety over maximum bump frequency.

## Consequences
- **Positive:** Minimizes the bans that would destroy trust and retention; reduces legal exposure; keeps the extension below mass-detection thresholds, protecting product longevity; strongest ethical/liability position.
- **Negative:** Caps the short-term "bump" aggressiveness a power user might want (accepted trade-off).
- Explicitly rejects the aggressive-frequency posture.

## Note
Pacing/rate-limiting here is harm-reduction for the *user's own* account and good-citizen behaviour toward the platform — not tooling for malicious evasion.

## Amendment (2026-07-25): POC drops the first-use consent warning
Per product decision, the **POC does not show the first-use consent/ban-risk warning**. The POC keeps only the basic pacing rail. Consequences accepted for the POC: users are not informed in-product that delete+recreate can get their Marktplaats account banned, and the associated liability-reduction benefit is forgone for the POC.

Scope: this amendment applies to the **POC only**. The informed-consent + safety-rails posture above **remains the decision for the full app** unless a later amendment changes it.

