# ADR-0001: Execution model — client-side browser extension

**Status:** Accepted (2026-07-25)

## Context
The brief called the product "cloud-based," but the reference competitor (dotb.io) is a client-side browser extension. Three execution models were on the table: (1) client-side only, (2) cloud-scheduled with the user's Marktplaats session harvested and replayed server-side, (3) hybrid push-to-extension. The fork determines whether we ever store and replay a user's marketplace session server-side, which drives ToS/ban risk, credential custody, and GDPR exposure.

## Decision
The relist action runs **client-side, in the user's own browser and logged-in Marktplaats session**. There is no server-side execution of marketplace actions. "Cloud" refers only to the app account, subscription/billing, and settings sync — not to performing relists.

## Consequences
- **Positive:** We never hold users' Marktplaats credentials or session server-side → dramatically lower ban-liability, credential-custody, and GDPR risk. Fastest path to a POC (the POC code is identical to the eventual product's execution core). Rides the user's own authenticated session, so no marketplace-auth problem to solve.
- **Negative:** Relists only happen while the user's browser is open → no true unattended/scheduled relisting while the machine is off. Subscription value is closer to dotb's than to a full SaaS.
- **Open tension:** With execution client-side, enforcing paid subscription quotas is inherently spoofable. To be addressed in a later ADR (quota enforcement).
- Supersedes the "cloud-scheduled" and "hybrid" options; revisit only if the subscription proves too weak to sell.
