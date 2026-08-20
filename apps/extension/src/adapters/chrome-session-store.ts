import type { AuthSession, SessionStore } from "../auth/session";

/**
 * The real `SessionStore`: one key in `chrome.storage.local`, beside the relist
 * snapshots (ADR-0003's area, which the manifest already asks for).
 *
 * Keeping tokens where the user can read them is ADR-0010's explicit trade: they
 * own the credentials that minted them, so a refresh token read out of extension
 * storage grants its owner nothing they did not already have.
 *
 * What is read back is **checked**, not trusted. Storage outlives the code that
 * wrote it — an interrupted write, a value from an older build, a tester's
 * `chrome.storage.local.set` — and a malformed session is answered as no session
 * at all, so the failure is "you are signed out" rather than a bearer header
 * reading `undefined`.
 */
const STORAGE_KEY = "authSession";

export class ChromeSessionStore implements SessionStore {
  async read(): Promise<AuthSession | null> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return asSession(stored[STORAGE_KEY]);
  }

  async write(session: AuthSession): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: session });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}

export function asSession(value: unknown): AuthSession | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;

  const accessToken = stored["accessToken"];
  const expiresAt = stored["expiresAt"];
  const obtainedAt = stored["obtainedAt"];
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  if (typeof expiresAt !== "number" || typeof obtainedAt !== "number") return null;

  return {
    accessToken,
    refreshToken: nullableString(stored["refreshToken"]),
    idToken: nullableString(stored["idToken"]),
    expiresAt,
    obtainedAt,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
