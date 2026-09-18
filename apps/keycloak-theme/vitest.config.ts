import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Nothing here renders into a document: what this workspace produces is a
    // directory of text files and a few PNGs, and what the suite asserts is
    // their contents. The pages they become are Keycloak's to render, and
    // `docs/click-through.md` is where a human looks at one.
    environment: "node",
    // `scripts` too, because what this workspace produces is a directory of
    // files and the only honest assertion about their layout and their pixel
    // sizes is one made against the emitted bytes — scripts/build.test.ts.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
