import type { AdminSession } from "./admin-session";

/**
 * What the admin corner is showing, and the whole of it (T54, #85).
 *
 * Five screens, one at a time, and the split that matters is between the two ways
 * of not being let in. **`not-an-operator` is not a failure and not a retry**: the
 * person is signed in, Keycloak is working, and they are simply somebody without
 * the `ADMIN` role — sending them round the sign-in loop would return them as the
 * same person, which is the loop ADR-0010's own notes warn about. `failed` is the
 * other one: the realm could not be reached, or refused, and trying again is
 * exactly the right thing to offer.
 *
 * `signing-in` is a screen rather than a spinner over nothing because the page is
 * about to be navigated away from — it exists so that the half-second before
 * Keycloak takes over says what is happening rather than looking hung.
 */
export type AdminScreen =
  | { screen: "loading" }
  | { screen: "signing-in" }
  | { screen: "failed"; message: string }
  | { screen: "not-an-operator" }
  | { screen: "catalog"; session: AdminSession };

export const LOADING: AdminScreen = { screen: "loading" };
