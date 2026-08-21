import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The pages render to markup through react-dom/server rather than into a
    // document — there is nothing on them to click — so nothing here needs a DOM.
    // What is asserted is the emitted HTML and the emitted CSS, which is also how
    // `packages/ui` tests the components these are built out of.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
