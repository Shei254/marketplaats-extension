import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { palette } from "./tokens";

/**
 * This package ships TypeScript source rather than a build of it, so the claim
 * that has to hold is that its consumers' bundlers can actually eat it. Nothing
 * imports it yet — T29 (#38) is the first — and a package nobody has bundled is
 * a package whose entry point, JSX setting and workspace link are all untested
 * guesses that fail on somebody else's ticket.
 *
 * The settings below are the extension's own, from apps/extension/scripts/build.mjs.
 */
const resolveDir = fileURLToPath(new URL(".", import.meta.url));

async function bundle(contents: string): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir, loader: "tsx", sourcefile: "consumer.tsx" },
    bundle: true,
    format: "esm",
    target: "chrome110",
    minifySyntax: true,
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles?.[0]?.text ?? "";
}

describe("a consumer bundling this package from source", () => {
  it("resolves the workspace entry point and pulls in what it asked for", async () => {
    const output = await bundle(`
      import { Button, uiCss } from "@mprelist/ui";
      export const app = { Button, uiCss };
    `);

    // The rules travel as text and the palette as the record the sheet is
    // generated from, which is the split `styles.ts` describes. The accent is
    // read from the tokens rather than spelled: this is asserting that the
    // palette reached the bundle, not what colour it is — that is the canvas's,
    // and `tokens.test.ts` is where it is held to it.
    expect(output).toContain("mp-btn--locked");
    expect(output).toContain(palette.light.accent);
  });

  it("gets the automatic JSX runtime from this package's tsconfig, not from its own", async () => {
    // esbuild's default is the classic transform, which would leave our
    // components calling a `React` nobody imported. It reads `jsx: react-jsx`
    // out of the tsconfig nearest each file, so a consumer inherits the right
    // setting without having to know we are React at all.
    const output = await bundle(`
      import { Icon } from "@mprelist/ui";
      export const icon = Icon;
    `);

    expect(output).toContain("react/jsx-runtime");
    expect(output).not.toContain("React.createElement");
  });
});
