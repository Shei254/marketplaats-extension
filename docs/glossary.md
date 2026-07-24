# Glossary

Domain terms for the Marktplaats relisting extension. Kept current as the design is grilled.

| Term | Definition |
|---|---|
| **Marktplaats** | Large Dutch online classifieds marketplace (owned by Adevinta). Our target platform. Site: marktplaats.nl. |
| **Advertentie (Listing / Ad)** | A single item a seller has posted for sale on Marktplaats. |
| **Relist / "Opnieuw plaatsen"** | Marktplaats action that refreshes a listing's timestamp so it re-appears near the top of recency-sorted results. The core action our product automates. |
| **Bump** | Generic term for any action that pushes a listing back up in ranking (relist is the free form; paid promotion is another). |
| **Verkopen Omhoog / Topper / Dagtopper** | Marktplaats's *paid* promotion products that raise a listing's visibility. Distinct from the free relist. |
| **dotb.io** | Reference competitor: a Chrome browser extension automating Vinted (repost/bump, multi-account, AI). Client-side, subscription-based. Our stated inspiration. |
| **POC (Proof of Concept)** | First deliverable: an icon next to a user's own listing that lets them relist it once. |
| **Execution model** | *Undecided.* Whether relists run client-side (browser extension in the user's session) or server-side (cloud backend acting on the user's behalf). See ADR-0001. |
| **Content script** | Extension code injected into the marktplaats.nl page DOM; how we would render the icon and read listing data client-side. |
| **App account** | A user's identity *in our product* (for auth + subscription). Distinct from their Marktplaats account. |
| **Marketplace session** | The user's authenticated Marktplaats login (cookies/tokens) that any relist action must ride on. |

| **Mijn Advertenties** | The seller's own ad-management view on Marktplaats, where they see and control (edit/delete/post) their own listings. |
| **Internal-API replay** | The extension calling Marktplaats's own private endpoints (list my ads, delete ad, create ad) in the background using the user's logged-in session cookies — the engine behind both relist surfaces (ADR-0004). |
| **Popup panel** | The extension's toolbar-triggered UI listing all of the user's ads with a per-ad relist action; no page navigation. |
| **Durable snapshot** | The full pre-delete capture of an ad (all fields + photo blobs) stored in `chrome.storage.local`, enabling retry/restore in the delete-first flow (ADR-0003). |
| **CSRF/session token** | A token Marktplaats may require on internal write calls; replaying it correctly is an open POC spike. |

| **User (App account)** | An identity in our product, issued by Keycloak. One human = one User. Separate from any Marktplaats account. |
| **MarktplaatsAccount (association)** | A Marktplaats account associated with a User — label + MP id only, **never credentials/session**. Supports multi-account. |
| **Subscription** | The User's plan, mirrored from Stripe via webhooks; carries tier/status/period. |
| **Entitlement** | Limits/features derived from a Subscription tier (relists per period, max MP accounts, feature flags) — what quota checks read. |
| **RelistEvent (UsageRecord)** | A backend-recorded relist attempt; the authoritative usage count for billing/quota. |
| **RelistAuthorization** | A short-lived signed backend OK the extension must obtain before a gated relist (ADR-0007). |
| **SafetyPolicy** | Per-account rate limits, human-like pacing/jitter, and caps — harm-reduction for the user's own account (ADR-0008). |

<!-- Add terms as they are defined during grilling. -->
