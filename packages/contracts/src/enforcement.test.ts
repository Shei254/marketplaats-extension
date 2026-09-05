import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CSRF_MODES,
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

/**
 * The constants of a Java enum: everything named before the list's closing `;`.
 *
 * **Two things here are the CSRF modes' fault** (T27, #36), and both were silent
 * rather than red — a reader that finds nothing agrees with every list there is.
 *
 * The declaration is found by *name* rather than by the first `enum ` in the
 * file, because `CsrfMode`'s own docstring says the word before it declares it.
 * And a constant is followed by its constructor arguments **or** by the comma or
 * semicolon that ends it: the modes are the first enum here that takes no
 * arguments, so matching only `(` would have read four of them as none.
 *
 * The emptiness check is the guard for whatever the next such file does.
 *
 * **The slice ends at the first `;`, which includes one written in prose.** A
 * javadoc sentence containing a semicolon truncates the list and the failure
 * arrives as "the API cannot answer with a code it plainly declares" — loud, but a
 * long way from its cause. Keep the constants' own comments free of them.
 */
function javaEnumConstants(path: string): string[] {
  const source = repoFile(`apps/api/src/main/java/com/mprelist/${path}.java`);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const start = source.search(new RegExp(`\\benum\\s+${name}\\b`));
  expect(start, `${path} does not declare an enum called ${name}`).toBeGreaterThan(-1);

  const constants = source.slice(start, source.indexOf(";", start) + 1);
  const named = [...constants.matchAll(/^\s+([A-Z][A-Z_]+)\s*[(,;]/gm)].map(
    ([, constant]) => constant as string,
  );
  expect(named, `${path} was read as an enum with no constants at all`).not.toEqual([]);
  return named;
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

/**
 * The one restatement here where a disagreement is not a rendering bug but a
 * config that silently does nothing (T27, #36).
 *
 * `GET /api/client-config` tells the extension which of four CSRF branches to
 * run. A mode the API can serve and the client cannot name is a document the
 * client drops **whole** — so the endpoint fix an operator deployed during an
 * outage reaches nobody, and the only symptom is that relisting is still broken.
 * That is the failure this file was written for, in its sharpest form.
 *
 * It is also where "strictly data" stops being a promise and becomes a list: the
 * modes are branches that already exist in the client, so holding the three
 * copies to each other is what makes it true that a config cannot ask for a fifth
 * thing.
 */
describe("the CSRF modes", () => {
  it("are the ones the API will serve", () => {
    // Lower case in both places, unlike every other list here: these are the
    // *client's* words for its own branches. The Java enum spells them upper case
    // and puts them on the wire lower, which is what `spelling()` is for.
    expect(javaEnumConstants("clientconfig/internal/CsrfMode").map((mode) => mode.toLowerCase()))
      .toEqual([...CSRF_MODES]);
  });

  it("are the ones the contract document names", () => {
    const named = contract.slice(contract.indexOf("### `GET /api/client-config`"));
    const documented = named.slice(0, named.indexOf("## Anti-stockpiling"));

    for (const mode of CSRF_MODES) {
      expect(documented, `the contract does not name the '${mode}' mode`).toContain(`\`${mode}\``);
    }
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
