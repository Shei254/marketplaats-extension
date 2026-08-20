import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests run with the dev hooks defined, matching `npm run build:dev`. That the
  // default build drops them is asserted against the emitted bundle instead —
  // scripts/build.test.ts, which is why `scripts` is in `include` below.
  // The dev hooks are defined, matching `npm run build:dev`, and the brand name is
  // whatever a test asserting on it says it is — the real one comes from
  // brand.json at build time and `scripts/build.test.ts` asserts *that* against
  // the emitted bundle.
  define: { __DEV__: "true", __BRAND_NAME__: JSON.stringify("Bumpr") },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
  },
});
