import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extensionIdFromKey } from "./extension-key.mjs";

/**
 * The extension id is the Keycloak redirect URI, and the realm imports on first
 * start only — so an id that silently changes is not a bug you fix, it is a
 * `down -v`. That is what makes the derivation worth pinning rather than trusting.
 *
 * The first suite pins it against a **stated digest**, not against a second copy
 * of the implementation. A test that recomputes `sha256 → first 16 bytes → map
 * the nibbles` agrees with any mistake the script makes in the same direction;
 * one that starts from a hex constant does not. The authoritative check is still
 * Chrome itself — step 1 of docs/click-through.md is where a human reads the id
 * off `chrome://extensions` and finds out whether we and Chrome agree.
 *
 * The CLI suite works on a copy in a temp directory, so it never rewrites the
 * manifest of an extension somebody has loaded unpacked.
 */

/** Arbitrary fixed bytes. The derivation hashes the key; it does not parse it. */
const KEY = Buffer.from("mprelist-extension-key-test-vector").toString("base64");

/**
 * `sha256(<the bytes KEY decodes to>)`, first 16 bytes:
 *   e6 70 09 30 1e 07 21 2d ce 08 07 bc cb a4 92 a0
 * Rendered as Chrome renders it — each nibble `0`–`f` as a letter `a`–`p`.
 */
const KEY_DIGEST_PREFIX = "e67009301e07212dce0807bccba492a0";
const KEY_ID = "oghaajdaboahcbcnmoaiahlmmlkejcka";

const SCRIPT = fileURLToPath(new URL("./extension-key.mjs", import.meta.url));

function run(args: string[]): string {
  return execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
}

describe("extensionIdFromKey", () => {
  it("renders the first 16 digest bytes as the letters a-p", () => {
    const fromStatedDigest = [...KEY_DIGEST_PREFIX]
      .map((hex) => String.fromCharCode(0x61 + Number.parseInt(hex, 16)))
      .join("");
    expect(fromStatedDigest).toBe(KEY_ID);
    expect(extensionIdFromKey(KEY)).toBe(KEY_ID);
  });

  it("is 32 characters of a-p, which is what lets it be a hostname label", () => {
    // `<id>.chromiumapp.org` is the redirect URI, so a digit or a `+` here would
    // not merely look wrong — it would not be a legal label.
    expect(extensionIdFromKey(KEY)).toMatch(/^[a-p]{32}$/);
  });

  it("is stable across calls, since the redirect URI depends on it", () => {
    expect(extensionIdFromKey(KEY)).toBe(extensionIdFromKey(KEY));
  });

  it("distinguishes keys that differ by one byte", () => {
    const other = Buffer.from("mprelist-extension-key-test-vectos").toString("base64");
    expect(extensionIdFromKey(other)).not.toBe(KEY_ID);
  });
});

describe("the CLI, against a copy of the manifest", () => {
  let dir: string;
  let manifest: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mprelist-key-"));
    manifest = join(dir, "manifest.json");
    await writeFile(manifest, '{\n  "manifest_version": 3,\n  "name": "Test",\n  "version": "0.0.1"\n}\n');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("`set` writes the key and reports the id that key derives to", async () => {
    expect(run(["set", KEY, "--manifest", manifest])).toContain(KEY_ID);
    expect(JSON.parse(await readFile(manifest, "utf8")).key).toBe(KEY);
  });

  it("`id` agrees with `set`, so nothing has to be copied by hand", () => {
    run(["set", KEY, "--manifest", manifest]);
    // Bare on stdout: this is what MPRELIST_EXTENSION_ID=$(…) captures.
    expect(run(["id", "--manifest", manifest]).trim()).toBe(KEY_ID);
  });

  it("changes only the `key` line, so switching keys is a one-line diff", async () => {
    const before = await readFile(manifest, "utf8");
    run(["set", KEY, "--manifest", manifest]);
    const after = await readFile(manifest, "utf8");
    const added = after.split("\n").filter((line) => !before.split("\n").includes(line));
    expect(added).toEqual([`  "key": "${KEY}",`]);
  });

  it("replaces an existing key rather than adding a second one", async () => {
    run(["set", KEY, "--manifest", manifest]);
    const replacement = Buffer.from("a-web-store-public-key").toString("base64");
    run(["set", replacement, "--manifest", manifest]);
    const raw = await readFile(manifest, "utf8");
    expect(raw.match(/"key":/g)).toHaveLength(1);
    expect(JSON.parse(raw).key).toBe(replacement);
  });

  it("`generate` produces a manifest whose id `id` then confirms", () => {
    const generated = run(["generate", "--manifest", manifest]);
    const reported = generated.match(/Extension id: ([a-p]{32})/)?.[1];
    expect(reported).toMatch(/^[a-p]{32}$/);
    expect(run(["id", "--manifest", manifest]).trim()).toBe(reported);
  });

  it("refuses an id when there is no key, rather than inventing one", () => {
    expect(() => run(["id", "--manifest", manifest])).toThrow(/generate/);
  });

  it("refuses a key that is not base64", () => {
    expect(() => run(["set", "not a key!", "--manifest", manifest])).toThrow(/base64/);
  });
});
