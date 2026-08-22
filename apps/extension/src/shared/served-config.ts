import { CSRF_MODES, type CsrfMode } from "@mprelist/contracts";

import type { CsrfConfig } from "./endpoint-config";

/**
 * The document `GET /api/client-config` serves, as this build is willing to read
 * it (T27, #36; ADR-0013).
 *
 * **The whole module is a checker.** Nothing here fetches, stores or applies
 * anything — it decides what a value from outside is allowed to become. That is
 * the shape the ADR's hard constraint takes in code: a served document is data,
 * so the only thing it can do is pass or fail a check written here, and there is
 * no path from a byte on the wire to a behaviour this build was not shipped with.
 *
 * **Read twice, checked twice.** The worker checks what the API answered before
 * storing it, and every reader checks again what came back out of
 * `chrome.storage.local` — because storage is the user's, outlives the build that
 * wrote it, and is exactly where `ChromePaceStore` already assumes junk.
 */

/**
 * The shape this build understands. A document announcing anything else is
 * ignored **whole** rather than read for the parts that look familiar: a version
 * exists to say the shape moved, and half a document is the failure it is there
 * to prevent.
 *
 * The API stamps this rather than taking it from an operator
 * (`ClientConfig.CURRENT`), so the two move together with a deploy.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * The longest gap a served pacing window may ask for, and the number is not
 * taste: an MV3 service worker is killed a few minutes after it goes idle, and
 * the wait happens *in the worker*. A window beyond that is a relist that never
 * starts, and the user is looking at a countdown while it does not.
 */
const LONGEST_SENSIBLE_GAP_MS = 5 * 60_000;

/** The served document, once it has been checked. Everything is optional but the version. */
export interface ServedConfig {
  schemaVersion: number;
  /**
   * Marktplaats paths by the extension's own name for each. **Not checked
   * against the names this build knows** — that is the merge's job, where the
   * names live; a name from a newer build is dropped there rather than making
   * the whole document unreadable here.
   */
  endpoints: Record<string, string>;
  /** Replaced whole or not at all, for the reason `loadEndpointConfig` gives. */
  csrf: CsrfConfig | null;
  /** The client-side gap between two relists (T46, #54) — the seam that ticket left. */
  pacing: { minMs: number; maxMs: number } | null;
}

/**
 * What a document is worth reading as, or `null` for one that is not.
 *
 * Total and unforgiving: one bad field discards the document rather than being
 * skipped, because a config that is *partly* applied is the state nobody can
 * reason about — an operator would be looking at a deploy that worked and a
 * client doing half of it.
 */
export function asServedConfig(body: unknown): ServedConfig | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;

  if (fields["schemaVersion"] !== SUPPORTED_SCHEMA_VERSION) return null;

  const endpoints = asPaths(fields["endpoints"]);
  if (endpoints === null) return null;

  const csrf = "csrf" in fields && fields["csrf"] != null ? asCsrf(fields["csrf"]) : null;
  if (csrf === null && fields["csrf"] != null) return null;

  const pacing = "pacing" in fields && fields["pacing"] != null ? asPacing(fields["pacing"]) : null;
  if (pacing === null && fields["pacing"] != null) return null;

  return { schemaVersion: SUPPORTED_SCHEMA_VERSION, endpoints, csrf, pacing };
}

/**
 * Paths, and only paths. Every value is a string that goes into a URL, which is
 * the one thing this document does that reaches the network — so an empty one is
 * refused here rather than becoming a request to the site's root.
 */
function asPaths(value: unknown): Record<string, string> | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const paths: Record<string, string> = {};
  for (const [name, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path !== "string" || path.length === 0) return null;
    paths[name] = path;
  }
  return paths;
}

/**
 * The CSRF block, checked per mode, because the modes carry different fields and
 * a `fetch` with no page to fetch is a config that cannot run.
 *
 * **There is no pattern here and there will not be one.** The local type has a
 * regex variant that nothing has ever constructed and no branch has ever read;
 * this checker cannot produce one, so nothing served is compiled — only compared.
 * That is the line between data and code, drawn where it can be seen.
 */
function asCsrf(value: unknown): CsrfConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;

  const mode = fields["mode"];
  const header = fields["header"];
  if (!isCsrfMode(mode)) return null;
  if (typeof header !== "string" || header.length === 0) return null;

  if (mode === "none") return { mode, header };
  if (mode === "meta" || mode === "cookie") {
    const name = fields["name"];
    return typeof name === "string" && name.length > 0 ? { mode, header, name } : null;
  }

  const url = fields["url"];
  const extractor = fields["extractor"];
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof extractor !== "object" || extractor === null) return null;
  const { selector, attribute } = extractor as Record<string, unknown>;
  if (typeof selector !== "string" || selector.length === 0) return null;
  if (typeof attribute !== "string" || attribute.length === 0) return null;
  return { mode, header, url, extractor: { type: "dom", selector, attribute } };
}

/**
 * The window, in whole milliseconds, running forwards and finishing inside the
 * life of the worker that has to wait it out.
 *
 * Nothing here checks it against the backend's own rail: a floor below it costs
 * the user a cooldown they would have been refused anyway, and coupling this
 * client to a number that lives in the API's configuration would be two settings
 * that have to be deployed in step.
 */
function asPacing(value: unknown): { minMs: number; maxMs: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { minMs, maxMs } = value as Record<string, unknown>;
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null;
  const min = minMs as number;
  const max = maxMs as number;
  if (min < 0 || max < min || max > LONGEST_SENSIBLE_GAP_MS) return null;
  return { minMs: min, maxMs: max };
}

function isCsrfMode(value: unknown): value is CsrfMode {
  return typeof value === "string" && (CSRF_MODES as readonly string[]).includes(value);
}

/**
 * Where the served document is kept, and why it is `chrome.storage.local` rather
 * than a variable in the worker.
 *
 * **The reader is the content script**, which is a different context on somebody
 * else's page and shares nothing with the worker but storage. The worker is also
 * torn down about thirty seconds after it goes idle, so a document held in memory
 * would be re-fetched on every relist — which would make a `GET` to our API part
 * of the relist path, and ADR-0013 is explicit that this adds no new failure mode
 * to it.
 */
const STORAGE_KEY = "clientConfig";

/** The document, and when it was fetched — the second is what makes it refreshable. */
export interface StoredConfig {
  fetchedAt: number;
  config: ServedConfig;
}

/**
 * What is stored, checked on the way out. `null` when nothing has been fetched
 * yet, when the shape is not one this build reads, or when somebody has written
 * their own — all three of which mean the same thing to every caller: use what
 * you were built with.
 */
export async function readServedConfig(): Promise<StoredConfig | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const held = stored[STORAGE_KEY] as Record<string, unknown> | undefined;
  if (typeof held !== "object" || held === null) return null;
  const config = asServedConfig(held["config"]);
  const fetchedAt = held["fetchedAt"];
  if (config === null || typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return null;
  return { fetchedAt, config };
}

export async function writeServedConfig(stored: StoredConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}

/**
 * Forget what was stored, which is how this build falls back to what it shipped
 * with.
 *
 * **It is the answer to a document this build cannot read**, and that is a
 * `200` — an operator has deployed something, and it is not something this
 * release understands. Keeping the last one it *did* understand would apply
 * yesterday's hotfix to today's breakage, which is the one failure a served
 * config can cause that a client with no config at all cannot.
 *
 * Not the answer to a fetch that failed: see `ClientConfigFetcher`.
 */
export async function forgetServedConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** True when a storage change touched the served document — see `isEndpointConfigChange`. */
export function isServedConfigChange(changes: Record<string, unknown>): boolean {
  return STORAGE_KEY in changes;
}
