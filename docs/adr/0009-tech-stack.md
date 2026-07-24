# ADR-0009: Technology stack

**Status:** Accepted (2026-07-25)

## Context
With execution client-side (ADR-0001), auth on Keycloak (ADR-0005), and billing on Stripe (ADR-0006), the remaining stack pieces are the extension platform, backend language, database, web dashboard, and hosting. The team writes the extension in TypeScript and leans Java/Spring for the backend.

## Decision
| Layer | Choice |
|---|---|
| Browser extension | **Chrome, Manifest V3**, TypeScript (Firefox port later) |
| Relist engine | Internal-API replay in the extension background/service worker (ADR-0004) |
| Client snapshot store | `chrome.storage.local` + `unlimitedStorage` (ADR-0003) |
| Backend API | **Spring Boot** (Java), OAuth2/OIDC resource server |
| Identity provider | **Keycloak** (self-hosted OIDC) (ADR-0005) |
| Billing | **Stripe Billing** + webhooks (ADR-0006) |
| Database | **PostgreSQL** |
| Web dashboard | **React + TypeScript SPA** against the Spring Boot API |
| Hosting | **Containerized (Docker), EU region** (GDPR posture for Dutch/EU users) |

## Consequences
- **Positive:** TypeScript shared between extension and dashboard (shared types/components → less drift); Postgres pairs cleanly with Keycloak, Spring, and subscription/usage data; EU-region hosting gives a clean GDPR posture; all components self-hostable (no vendor lock-in beyond Stripe).
- **Negative:** Multiple deployables to operate (extension, SPA, Spring API, Keycloak, Postgres) — real ops surface for a small team; a Firefox port is deferred work.

## Scope note
The POC needs **none** of the server-side stack — it is a standalone Chrome MV3 extension (ADR-0001..0004). The backend/auth/billing/dashboard stack is full-app only.
