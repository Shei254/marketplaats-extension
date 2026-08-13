import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests run with the dev hooks defined, matching `npm run build:dev`. That the
  // default build drops them is asserted against the emitted bundle instead —
  // scripts/build.test.ts, which is why `scripts` is in `include` below.
  define: { __DEV__: "true" },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
