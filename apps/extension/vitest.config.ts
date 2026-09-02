import { defineConfig } from "vitest/config";

import { LOCAL_STACK } from "./scripts/deployment.mjs";

export default defineConfig({
  // Tests run with the dev hooks defined, matching `npm run build:dev`. That the
  // default build drops them is asserted against the emitted bundle instead —
  // scripts/build.test.ts, which is why `scripts` is in `include` below.
  // The dev hooks are defined, matching `npm run build:dev`, and the brand name is
  // whatever a test asserting on it says it is — the real one comes from
  // brand.json at build time and `scripts/build.test.ts` asserts *that* against
  // the emitted bundle.
  define: {
    __DEV__: "true",
    __BRAND_NAME__: JSON.stringify("Bumpr"),
    // A version, not *the* version: what the real one is comes from the manifest at
    // build time, and `scripts/build.test.ts` asserts that against the emitted bundle.
    // A test asserting on this one is asserting on a fixture, which is the point.
    __CLIENT_VERSION__: JSON.stringify("9.9.9"),
    // The **local stack's** addresses, which is what `build:dev` compiles in — not a
    // fixture standing in for something else, because the URLs the API tests assert on
    // are these ones and reading them as `http://localhost:8080/api/me` is the point.
    // Imported rather than written again, so `scripts/deployment.mjs` holds the only
    // copy: a third one here would be the one that drifted, silently, in the direction
    // of a suite passing against addresses nothing builds. That the shipped build
    // carries `deployment.json`'s instead is asserted against the emitted bundles in
    // `scripts/build.test.ts`, which is the only place that can.
    __API_BASE_URL__: JSON.stringify(LOCAL_STACK.apiBaseUrl),
    __AUTH_ISSUER__: JSON.stringify(LOCAL_STACK.issuer),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
  },
});
