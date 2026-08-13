import { SpikePendingError } from "../domain/marktplaats-client";
import type { CsrfConfig } from "../shared/endpoint-config";

/**
 * Reading the CSRF token from the page and turning it into request headers.
 * Kept in the content layer, since it is the only place with DOM
 * access to the page's meta tags / readable cookies.
 */

export async function csrfHeaders(csrf: CsrfConfig): Promise<Record<string, string>> {
  if (csrf.mode === "none") return {};

  const token = await extractCsrfToken(csrf);

  if (!token) {
    throw new SpikePendingError(
        `CSRF token (mode: ${csrf.mode}) not found — check the Options config`,
    );
  }
  return { [csrf.header]: token };
}

/**
 * Extracted into a standalone function so the API Client's Promise lock
 * can fetch the raw token string directly for its cache.
 */
export async function extractCsrfToken(csrf: CsrfConfig): Promise<string | undefined> {
  if (csrf.mode === "none") return undefined;

  const extractor = extractors[csrf.mode];
  return await extractor(csrf as any);
}

// ============================================================================
// Extraction Strategies
// ============================================================================

const extractors = {
  meta: async (config: Extract<CsrfConfig, { mode: "meta" }>) => {
    return document.querySelector(`meta[name="${config.name}"]`)?.getAttribute("content") ?? undefined;
  },

  cookie: async (config: Extract<CsrfConfig, { mode: "cookie" }>) => {
    const prefix = `${config.name}=`;
    const cookie = document.cookie.split("; ").find((c) => c.startsWith(prefix));
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
  },

  fetch: async (config: Extract<CsrfConfig, { mode: "fetch" }>) => {
    try {
      const response = await fetch(config.url, { credentials: "include" });
      const htmlText = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");

      // 1. Search all script tags for React hydration data
      // Frameworks usually inject state into `<script>` tags, e.g.,
      // <script id="__NEXT_DATA__" type="application/json"> or window.__INITIAL_STATE__ = {...}
      const scripts = Array.from(doc.querySelectorAll("script"));

      for (const script of scripts) {
        const content = script.textContent || "";

        // Quick filter to only process scripts that might contain our token
        if (content.toLowerCase().includes('xsrf') || content.toLowerCase().includes('csrf')) {

          // Use Regex to pluck the token out of the stringified JSON/JS object.
          // This matches patterns like: "xsrfToken":"TOKEN_VALUE" or xsrf_token: 'TOKEN_VALUE'
          const match = content.match(/['"]?(?:xsrf|csrf)[_A-Z]*[tT]oken['"]?\s*[:=]\s*['"]([^'"]+)['"]/);

          if (match && match[1]) {
            console.log("[CSRF] Token successfully extracted from React hydration state.");
            return match[1]; // Found it!
          }
        }
      }

      // 2. Global Fallback (Just in case it's in a meta tag or custom attribute instead of JSON)
      const metaMatch = htmlText.match(/['"](?:xsrf|csrf)[_A-Z]*[tT]oken['"]\s*[:=]\s*['"]([^'"]+)['"]/i);
      if (metaMatch && metaMatch[1]) {
        console.log("[CSRF] Token extracted via global Regex fallback.");
        return metaMatch[1];
      }

      // 3. (Optional) If they recently migrated back to SSR forms.
      // Reads config.extractor, not config.selector — the latter does not exist
      // on FetchCsrfConfig, so this branch used to throw on a bad selector.
      if (config.extractor.type === "dom") {
        const legacyElement = doc.querySelector(config.extractor.selector);
        const value = legacyElement?.getAttribute(config.extractor.attribute);
        if (value) return value;
      }

      console.error("[CSRF] Failed to find token in pre-hydrated React HTML payload.");
      return undefined;
    } catch (error) {
      console.error(`Failed to fetch CSRF token from ${config.url}:`, error);
      return undefined;
    }
  }
};