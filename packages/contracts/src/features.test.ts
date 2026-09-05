import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BULK, bulkIn, isExpressible, withBulk } from "./features";

/**
 * What `tier.features` means, held to the one implementation of it that cannot
 * import this file (T69, #153; ADR-0026).
 *
 * The cases below are not a survey of a JSON parser: every one of them is a value
 * an operator can type into the catalog's Advanced hatch, and the two that matter
 * most are the ones that look like an off switch and are not. `{"bulk": {"upTo": 0}}`
 * grants bulk capped by the quota alone, and so does `{"bulk": true}` — a number
 * field where empty means none would ship the exact inverse for both.
 */

/** Same arrangement, and same reasons, as `enforcement.test.ts`'s reader. */
const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");

const entitlement = repoFile("apps/api/src/main/java/com/mprelist/catalog/Entitlement.java");

describe("what a features object grants for bulk", () => {
  it("is nothing when the flag is absent, empty, or off", () => {
    // The three spellings of no, and all three reach a real catalog: `free` carries
    // `{}`, an operator can name a flag and say nothing about it, and `false` is
    // what the admin form now writes to turn one off.
    expect(bulkIn({})).toEqual({ granted: false });
    expect(bulkIn({ scheduling: true })).toEqual({ granted: false });
    expect(bulkIn({ bulk: null })).toEqual({ granted: false });
    expect(bulkIn({ bulk: false })).toEqual({ granted: false });
  });

  it("and a cap when the flag carries a whole number above zero", () => {
    expect(bulkIn({ bulk: { upTo: 10 } })).toEqual({ granted: true, upTo: 10 });
    expect(bulkIn({ bulk: { upTo: 25 } })).toEqual({ granted: true, upTo: 25 });
  });

  // The trap this module exists to keep one reading of. The API said yes, which is
  // the half it owns; `{"upTo": N}` is the shape the seed writes rather than one
  // this contract promises, so a value nobody recognises is a grant with nothing
  // said about how many — never a refusal of a permission this side did not issue.
  it("but a grant with no readable number is still a grant", () => {
    expect(bulkIn({ bulk: true })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: 0 })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: "yes" })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: {} })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: { upTo: 0 } })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: { upTo: -1 } })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: { upTo: 2.5 } })).toEqual({ granted: true, upTo: null });
    expect(bulkIn({ bulk: { upTo: "ten" } })).toEqual({ granted: true, upTo: null });
  });
});

describe("writing the flag", () => {
  it("says a cap as the shape the seed and the popup both read", () => {
    expect(withBulk({}, 10)).toEqual({ bulk: { upTo: 10 } });
    expect(bulkIn(withBulk({}, 10))).toEqual({ granted: true, upTo: 10 });
  });

  // Not a deleted key, and the reason is `V8__seed_bulk_entitlement.sql`: it writes
  // only `where features -> 'bulk' is null` and claims of itself that the admin
  // edit is the durable way to take bulk off a tier. A deleted key makes that
  // sentence false on any restored dump, in a file Flyway's checksum forbids
  // correcting.
  it("and says off as `false`, leaving the key where the seed can see it", () => {
    expect(withBulk({ bulk: { upTo: 10 } }, null)).toEqual({ bulk: false });
    expect(Object.keys(withBulk({}, null))).toEqual(["bulk"]);
    expect(bulkIn(withBulk({ bulk: true }, null))).toEqual({ granted: false });
  });

  it("carrying through whatever else the object held", () => {
    expect(withBulk({ scheduling: true }, 3)).toEqual({ scheduling: true, bulk: { upTo: 3 } });
  });
});

describe("what a number field could hold and give back unchanged", () => {
  it("is an empty object, an off switch, and a cap", () => {
    expect(isExpressible({})).toBe(true);
    expect(isExpressible({ bulk: false })).toBe(true);
    expect(isExpressible({ bulk: { upTo: 10 } })).toBe(true);
  });

  // Each of these opens the admin form on its JSON hatch and holds it open. Without
  // that, a tier storing `{"bulk": true}` shows an empty box and the next save
  // revokes bulk for its subscribers with nothing on screen having said so.
  it("and never a grant the field would show as an empty box", () => {
    expect(isExpressible({ bulk: true })).toBe(false);
    expect(isExpressible({ bulk: null })).toBe(false);
    expect(isExpressible({ bulk: 0 })).toBe(false);
    expect(isExpressible({ bulk: { upTo: 0 } })).toBe(false);
    expect(isExpressible({ bulk: { upTo: 2.5 } })).toBe(false);
  });

  it("nor anything the field does not know it is holding", () => {
    // A second flag is the whole truth the number cannot represent, and it is the
    // reason this asks about the object rather than about `bulk`.
    expect(isExpressible({ scheduling: true })).toBe(false);
    expect(isExpressible({ bulk: { upTo: 10 }, scheduling: true })).toBe(false);
    expect(isExpressible({ bulk: { upTo: 10, forever: true } })).toBe(false);
  });

  it("and everything this module writes is expressible, which is what makes the mode switch close", () => {
    expect(isExpressible(withBulk({}, 10))).toBe(true);
    expect(isExpressible(withBulk({}, null))).toBe(true);
  });
});

/**
 * The rule has a third implementation in Java and will keep it: `Entitlement.java`
 * cannot import a TypeScript package, and validating flag names in the API was
 * rejected because it would make adding a flag a deploy (ADR-0026).
 *
 * So it is pinned the way the denial enums already are — by reading the source. A
 * test, not a guarantee: it goes red when somebody rewrites the rule, which is the
 * change that matters, and says nothing about a rename.
 *
 * The failure it is built against is quiet. If Java starts treating `false` as a
 * grant, the popup draws checkboxes the gate then refuses ad by ad; if it stops
 * treating `{"upTo": 10}` as one, a paying tier silently loses a feature. Neither
 * throws anywhere.
 */
describe("the rule the API states in Java", () => {
  it("names the same flag this package does", () => {
    const named = /String\s+BULK\s*=\s*"([^"]*)"/.exec(entitlement);
    expect(named, "Entitlement.java no longer declares a BULK constant").not.toBeNull();
    expect(named?.[1]).toBe(BULK);
  });

  it("and grants on the same three values this package refuses on", () => {
    // Brace-matched rather than sliced to the next `}`, so that an `if` written
    // into this method later is read as part of it rather than as its end — the
    // shape of failure `javaEnumConstants` warns about one file over.
    expect(bodyOf("grants")).toBe(
      "Object value = this.features.get(flag); return value != null && !Boolean.FALSE.equals(value);",
    );
  });
});

/**
 * A method's statements, with its comments gone and its whitespace flattened —
 * which is a string that can be compared to the rule it is supposed to be.
 *
 * Deliberately exact rather than a set of behaviours parsed out of it: this is
 * eight tokens of Java, and anything cleverer would be a second implementation of
 * the thing under test.
 */
function bodyOf(method: string): string {
  const declared = entitlement.search(new RegExp(`\\b${method}\\s*\\(`));
  expect(declared, `Entitlement.java declares no method called ${method}`).toBeGreaterThan(-1);
  const opened = entitlement.indexOf("{", declared);
  let depth = 0;
  let at = opened;
  for (; at < entitlement.length; at += 1) {
    if (entitlement[at] === "{") depth += 1;
    if (entitlement[at] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return entitlement
    .slice(opened + 1, at)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
