import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DENIAL_REASONS,
  RELIST_OUTCOMES,
  SUBSCRIPTION_STATUSES,
} from "./enforcement";

/**
 * These types are a **restatement**, and a restatement that agrees only with
 * itself is the thing this package exists to prevent. So the suite reads both
 * originals out of the working tree: `docs/enforcement-contract.md`, which the
 * README calls the source of truth, and the API's own enums, which are what
 * actually ends up on the wire.
 *
 * The failure it is built against is quiet and asymmetric. A code the backend
 * added and this package has not is a denial the extension renders as "something
 * went wrong, try again" — for a user who could have fixed it in a click. Nothing
 * throws, no test elsewhere goes red, and the first report is a support ticket.
 *
 * Reading files outside this workspace is the same arrangement `apps/api`'s suite
 * has with `infra/`, and one of the reasons CI carries no path filters (see the
 * root README): a filter that did not know about this would go green having looked
 * at nothing.
 */
const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");

const contract = repoFile("docs/enforcement-contract.md");

/** The constants of a Java enum: everything named before the list's closing `;`. */
function javaEnumConstants(path: string): string[] {
  const source = repoFile(`apps/api/src/main/java/com/mprelist/${path}.java`);
  const start = source.indexOf("enum ");
  expect(start, `${path} does not declare an enum`).toBeGreaterThan(-1);

  const constants = source.slice(start, source.indexOf(";", start));
  return [...constants.matchAll(/^\s+([A-Z][A-Z_]+)\s*\(/gm)].map(([, name]) => name as string);
}

describe("the denial reasons", () => {
  it("are the ones the contract document denies with", () => {
    // Every `4xx CODE` the document spells, which is how it names each of them.
    const documented = new Set(
      [...contract.matchAll(/`4\d\d ([A-Z][A-Z_]+)`/g)].map(([, code]) => code as string),
    );

    expect([...documented].sort()).toEqual([...DENIAL_REASONS].sort());
  });

  it("are the ones the API can actually answer with", () => {
    // Three live on the gate's own enum; `UNAUTHENTICATED` is `identity`'s, written
    // by the filter chain before any route is reached, which is what makes it true
    // of routes no ticket has written yet. Asserted where each one lives.
    const gateCodes = javaEnumConstants("enforcement/internal/ReasonCode");
    const filterChain = repoFile(
      "apps/api/src/main/java/com/mprelist/identity/internal/ResourceServerSecurity.java",
    );

    expect(filterChain).toContain('"reason\\":\\"UNAUTHENTICATED');
    expect([...gateCodes, "UNAUTHENTICATED"].sort()).toEqual([...DENIAL_REASONS].sort());
  });
});

describe("the relist outcomes", () => {
  it("are the ones the contract document names in the body of `/complete`", () => {
    const body = contract.split("\n").find((line) => line.includes('"outcome"'));
    const documented = new Set(
      [...(body ?? "").matchAll(/"([A-Z][A-Z_]+)"/g)].map(([, code]) => code as string),
    );

    expect([...documented].sort()).toEqual([...RELIST_OUTCOMES].sort());
  });

  it("are the ones the API accepts", () => {
    expect(javaEnumConstants("enforcement/internal/RelistOutcome").sort()).toEqual(
      [...RELIST_OUTCOMES].sort(),
    );
  });
});

describe("the subscription statuses", () => {
  it("are the seven the API normalizes Stripe's lifecycle into", () => {
    // The contract says "one of the seven normalized statuses" and lists them
    // nowhere; the enum is the list. A status this package has never heard of
    // reaches the popup as a plan it cannot describe.
    expect(javaEnumConstants("subscription/SubscriptionStatus").sort()).toEqual(
      [...SUBSCRIPTION_STATUSES].sort(),
    );
  });
});
