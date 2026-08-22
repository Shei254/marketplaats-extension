import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0017's boundary, asserted over the source rather than over one screen.
 *
 * "The public routes never learn who anybody is" is a claim about a bundle a
 * stranger loads without signing in — so what has to be true is that nothing in
 * it asks the API a question, keeps a session, or reads a cookie. A test that
 * rendered a page and found no login form would prove none of that; a page can
 * call `fetch` on mount and look identical.
 *
 * `/admin` (T54, #85) is the exception the ADR names and it lives in `src/admin/`,
 * which is why this walks by directory rather than by file.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const AUTHENTICATED = "admin";

/** What learning who somebody is looks like, spelled as the APIs that do it. */
const IDENTITY = [
  "fetch(",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document.cookie",
  "navigator.sendBeacon",
  "EventSource",
  "WebSocket",
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === AUTHENTICATED ? [] : sources(path);
    // The test files themselves name every one of these, which is the point of them.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the public bundle", () => {
  const files = sources(SRC);

  it("is the whole of what is not `src/admin/` today", () => {
    // A guard that silently stopped finding files would pass for ever.
    expect(files.length).toBeGreaterThan(4);
  });

  it("and the exception it makes is load-bearing rather than vacuous", () => {
    // Since T54 (#85) there is real identity code to exclude — a session, a token
    // exchange, `sessionStorage`. If this ever stopped being true, every assertion
    // below would be passing over a directory that no longer needed excluding, and
    // the day something identity-shaped moved *out* of it nothing would notice.
    const admin = readFileSync(join(SRC, "admin", "admin-session.ts"), "utf8");
    const browser = readFileSync(join(SRC, "admin", "BrowserAdminApp.tsx"), "utf8");

    expect(browser).toContain("sessionStorage");
    expect(admin).toContain("access_token");
    expect(files.some((path) => path.includes(`${AUTHENTICATED}/`))).toBe(false);
  });

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    it(`asks nobody who they are — ${path.slice(SRC.length)}`, () => {
      for (const api of IDENTITY) {
        expect(source, api).not.toContain(api);
      }
    });
  }
});
