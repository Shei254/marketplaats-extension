/**
 * Runtime configuration of Marktplaats's internal endpoints + CSRF source, so a
 * tester can paste discovered values (via the Options page or the __setEndpoints
 * console hook) and live-test WITHOUT editing source or rebuilding. Persisted in
 * chrome.storage.local; read by the content script at call time.
 *
 * This is what the spikes (#2/#3/#4) fill in. An unset endpoint surfaces as a
 * SpikePendingError telling the tester to configure it.
 */
export type CsrfMode = "meta" | "cookie" | "none";

export interface CsrfConfig {
  /** where the token lives: a <meta> tag, a readable cookie, or not needed. */
  mode: CsrfMode;
  /** meta-tag name or cookie name (ignored when mode is "none"). */
  name: string;
  /** request header the token is sent in. */
  header: string;
}

export interface EndpointConfig {
  /** GET → the user's ads. */
  listMyAds: string;
  /** GET → one ad's full detail. May contain ":id". */
  captureAd: string;
  /** DELETE → remove an ad. May contain ":id". */
  deleteAd: string;
  /** POST → create a new ad. */
  createAd: string;
  /** POST (multipart) → upload one photo, returns a media id. */
  uploadPhoto: string;
  csrf: CsrfConfig;
}

export const EMPTY_ENDPOINT_CONFIG: EndpointConfig = {
  listMyAds: "",
  captureAd: "",
  deleteAd: "",
  createAd: "",
  uploadPhoto: "",
  csrf: { mode: "meta", name: "csrf-token", header: "x-csrf-token" },
};

const STORAGE_KEY = "endpointConfig";

export async function loadEndpointConfig(): Promise<EndpointConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const partial = stored[STORAGE_KEY] as Partial<EndpointConfig> | undefined;
  return {
    ...EMPTY_ENDPOINT_CONFIG,
    ...partial,
    csrf: { ...EMPTY_ENDPOINT_CONFIG.csrf, ...partial?.csrf },
  };
}

export async function saveEndpointConfig(config: EndpointConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/** True when chrome.storage.onChanged reports the endpoint config changed. */
export function isEndpointConfigChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string,
): boolean {
  return areaName === "local" && STORAGE_KEY in changes;
}
