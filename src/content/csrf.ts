import { SpikePendingError } from "../domain/marktplaats-client";
import type { CsrfConfig } from "../shared/endpoint-config";

/**
 * Reading the CSRF token from the page and turning it into request headers —
 * grouped here beside CsrfConfig (rather than as free functions envying its
 * fields) and kept in the content layer, since it is the only place with DOM
 * access to the page's meta tags / readable cookies.
 */
export function csrfHeaders(csrf: CsrfConfig): Record<string, string> {
  if (csrf.mode === "none") return {};
  const token = readCsrfToken(csrf);
  if (!token) {
    throw new SpikePendingError(
      `CSRF token (${csrf.mode} '${csrf.name}') not found — check the Options config`,
    );
  }
  return { [csrf.header]: token };
}

function readCsrfToken(csrf: CsrfConfig): string | undefined {
  if (csrf.mode === "meta") {
    return (
      document.querySelector(`meta[name="${csrf.name}"]`)?.getAttribute("content") ?? undefined
    );
  }
  // cookie (must be non-HttpOnly to be readable here).
  const prefix = `${csrf.name}=`;
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}
