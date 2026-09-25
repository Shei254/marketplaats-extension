import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The site's one security header (T85, ADR-0036). Since the landing page sells, a
 * signed-in visitor's *Overstappen* charges a saved card — so no page of this site
 * may be framed by another, and no script runs but its own.
 */
const nginx = readFileSync(fileURLToPath(new URL("../nginx.conf.template", import.meta.url)), "utf8");
const POLICY = /add_header Content-Security-Policy "([^"]*)" always;/g;

describe("what the site says about being framed", () => {
  const policies = [...nginx.matchAll(POLICY)].map(([, policy]) => policy ?? "");

  it("forbids every framer, and runs only its own scripts", () => {
    for (const policy of policies) {
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("script-src 'self'");
    }
  });

  it("is said again on index.html, which sets a header of its own and so inherits none", () => {
    // nginx copies `add_header` into a location only when the location sets none,
    // and `index.html` — the document a framer would load — sets Cache-Control.
    const indexHtml = /location = \/index\.html \{([^}]*)\}/.exec(nginx)?.[1] ?? "";
    expect(indexHtml).toContain("Content-Security-Policy");
    expect(policies.length).toBeGreaterThanOrEqual(2);
  });
});
