# ADR-0005: Identity & authentication (full app) — Keycloak + Spring Boot

**Status:** Accepted (2026-07-25)
**Scope:** Full app only. The POC has no auth (rides the user's Marktplaats session, per ADR-0001).

## Context
The full app needs user identity for subscriptions and a managed user list, with stated goals of scalability and extensibility (social logins, multi-account support) without re-platforming auth later. The backend leans Spring Boot (Java; consistent with the repo's IntelliJ project files). Options: self-hosted OIDC (Keycloak), Spring-native OAuth2 + own user store, or a managed SaaS provider.

## Decision
- **Identity provider: Keycloak** (self-hosted OIDC), with **Spring Boot as an OAuth2/OIDC resource server** validating Keycloak-issued tokens.
- **Backend: Spring Boot** (provisional overall-stack lean; full stack decided in a later ADR).

## Consequences
- **Positive:** Social login, MFA, account linking, roles, and an admin UI available out of the box and switched on when needed; no painful auth migration later; scales; avoids vendor lock-in / per-MAU fees.
- **Negative:** Keycloak is a real service to run, secure, upgrade, and eventually make HA — meaningful ops weight for a small team.

## Modeling rule (important, preserves ADR-0001)
"A user with multiple Marktplaats accounts" is a **domain-model** concern, not an auth concern:
- The app-user authenticates **once** into our service via Keycloak.
- Multiple Marktplaats accounts are represented as **associated MP-account identities** (labels/ids for entitlement, quota, and the managed user list) — **never** stored MP credentials or sessions server-side.
- MP *sessions* remain client-side in the browser. Storing them server-side to act on multiple accounts centrally would silently reintroduce the rejected cloud-execution model (ADR-0001).

## Revisit if
Ops burden of self-hosted Keycloak proves too high pre-launch → consider Spring-native auth as an interim, accepting later migration cost.
