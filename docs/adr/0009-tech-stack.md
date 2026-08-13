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

## Amended (2026-08-13)
The POC is complete and the full app is being built. Refinements to the table above:

| Layer | Refinement |
|---|---|
| Repository | **Monorepo** — `apps/{extension,api,dashboard}`, `packages/{contracts,ui}`, `infra/` ([ADR-0011](0011-repository-layout.md)) |
| Backend API | **Modular monolith** with Spring Modulith; Gradle, Java 21, Flyway ([ADR-0012](0012-backend-modular-monolith.md)) |
| Extension auth | `chrome.identity.launchWebAuthFlow` + PKCE, extension as Keycloak public client ([ADR-0010](0010-extension-authentication.md)) |
| Extension UI | **React**, consuming `packages/ui` shared with the dashboard. The POC **Options page is deleted** ([ADR-0013](0013-remote-client-configuration.md)) |
| Endpoint config | **Backend-served**, hardcoded defaults as fallback, data-only ([ADR-0013](0013-remote-client-configuration.md)) |
| Web dashboard | First cut is a **thin shell**: sign-in, plan picker → Stripe Checkout, account page → Stripe Customer Portal, privacy/terms. Payment methods, invoices, cancellation, dunning and proration stay Stripe-hosted. |
| Internal-API layer | Frozen by **golden-payload characterization tests** ([ADR-0015](0015-frozen-internal-api-golden-tests.md)) |

**Release-cadence constraint:** extension releases take days (Chrome Web Store review), API deploys take
minutes. The API must stay backward-compatible with older installed extension versions.
