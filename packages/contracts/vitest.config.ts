import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Types have nothing to run. What the suite here does is read the two things
    // these types are a restatement of — the contract document and the API's own
    // enums — so it needs a filesystem and nothing else.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
