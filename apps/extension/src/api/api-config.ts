/**
 * Where our own backend is.
 *
 * **Compiled in, and it could not be anything else** (T56, #87, ADR-0024). The
 * served client-configuration document (#36) is fetched from
 * `${baseUrl}/api/client-config`, so an extension that does not already know
 * where the API is cannot ask the API where it is. That is a property of the
 * order things happen in rather than of how #36 was built, and it is why the two
 * comments that used to stand here — promising this would become served config —
 * are gone rather than still waiting.
 *
 * The value is `deployment.json`'s in `npm run build` and the local stack's in
 * `npm run build:dev`; `scripts/deployment.mjs` is what refuses to ship anything
 * unreachable, and `scripts/build.test.ts` asserts the split against the emitted
 * bundles.
 *
 * Separate from `auth/auth-config.ts` on purpose: one is our API and the other is
 * an identity provider ADR-0009 wants replaceable, and they move at different
 * times for different reasons.
 */
export interface ApiConfig {
  baseUrl: string;
}

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: __API_BASE_URL__,
};
