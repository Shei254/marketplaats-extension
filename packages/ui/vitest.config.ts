import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The components render to markup through react-dom/server rather than into a
    // document, so nothing here needs a DOM. What is asserted is the emitted HTML
    // and the emitted CSS — see src/styles.test.ts for why that is the interesting
    // pair rather than a jsdom tree.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
