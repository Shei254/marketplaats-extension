/**
 * Where our own backend is.
 *
 * The **local stack's** address, as `infra/README.md` describes it: the API on
 * 8080, which is Spring Boot's default and the reason Keycloak was moved to 8081.
 * Nothing is deployed yet — T55 (#86) is what deploys it, and #36 is what will
 * serve this as client configuration instead of building it in.
 *
 * Separate from `auth/auth-config.ts` on purpose: one is our API and the other is
 * an identity provider ADR-0009 wants replaceable, and they move at different
 * times for different reasons.
 */
export interface ApiConfig {
  baseUrl: string;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: "http://localhost:8080",
};
