import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `@mprelist/contracts` ships TypeScript source rather than a build of it, and
 * this workspace is its first consumer. Vitest resolving it proves Vite can; what
 * ships is esbuild's answer, and the two are different resolvers reading the same
 * `exports` field.
 *
 * Today the gate imports only *types*, which are erased — so nothing from the
 * package reaches a bundle yet and a broken link would stay invisible until T26
 * (#35) imports a value and `npm run build` stops working, on somebody else's
 * ticket. The settings below are the extension's own, from `scripts/build.mjs`.
 */
describe("the shared contracts package, through the bundler that ships", () => {
  it("resolves from this workspace and carries its values into the bundle", async () => {
    const result = await build({
      stdin: {
        contents: `
          import { DENIAL_REASONS } from "@mprelist/contracts";
          export const codes = DENIAL_REASONS;
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)),
        loader: "ts",
        sourcefile: "consumer.ts",
      },
      bundle: true,
      format: "esm",
      target: "chrome110",
      minifySyntax: true,
      write: false,
      logLevel: "silent",
    });

    expect(result.outputFiles?.[0]?.text).toContain("QUOTA_EXCEEDED");
  });
});
