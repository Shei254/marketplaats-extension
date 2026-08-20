import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { argv, cwd, exit } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * The extension's identity, and the one thing that must not move.
 *
 * An unpacked extension with no `key` in its manifest derives its id from the
 * **absolute directory path** it was loaded from. That is stable for one checkout
 * on one machine and different everywhere else — and the id is baked into the
 * Keycloak redirect URI `https://<id>.chromiumapp.org/`, which the realm imports
 * on **first start only**. So an id that moves is not a rebuild, it is a
 * `down -v` (infra/README.md).
 *
 * A `key` — the base64 of an RSA public key in DER SubjectPublicKeyInfo form —
 * pins it. Chrome derives the id from that key rather than from the path, so the
 * same id follows the extension across machines, checkouts and reloads.
 *
 * It lives in `public/manifest.template.json`, the source the build resolves brand
 * tokens into (T48, #78) — not in the emitted `dist/manifest.json`, which is a
 * build artefact. The build passes `key` through untouched.
 *
 * **We generate our own key (ADR-0010's second row), not a Web Store one.** The
 * cost is stated there and is real: the Web Store signs uploads with *its* key,
 * so publishing assigns a different id, and the redirect URI has to change once.
 * `set` below is that change, and it is one command rather than a hunt — which is
 * the whole reason the id is *derived* here and never written down twice.
 *
 * The id is never stored. It is computed from the manifest's `key` on demand, so
 * there is no second copy to fall out of step with the first:
 *
 *     MPRELIST_EXTENSION_ID=$(npm run -s extension-id -w @mprelist/extension)
 *
 * Commands:
 *   generate   a fresh keypair → manifest `key`, private half to keys/
 *   set <b64>  replace the key with one Chrome gave you (the publish-time switch)
 *   id         print the id the current manifest key derives to
 *
 * `--manifest` exists for the test, so it can exercise the round-trip without
 * rewriting the manifest a developer has loaded unpacked — the same reason, and
 * the same precedent, as `--outdir` in scripts/build.mjs.
 */

const DEFAULT_MANIFEST = new URL("../public/manifest.template.json", import.meta.url);
const PRIVATE_KEY = new URL("../keys/extension.pem", import.meta.url);

/**
 * Chrome's own derivation, from `crx_file::id_util::GenerateId`: SHA-256 the
 * decoded public key, take the **first 16 bytes**, and render each of the 32
 * nibbles as a letter — `0`→`a` through `f`→`p`. Hex would have been the obvious
 * encoding; Chrome uses `a`–`p` so an id is always letters, which is what lets it
 * be a hostname label in `<id>.chromiumapp.org`.
 *
 * @param {string} base64Spki the manifest's `key`
 * @returns {string} the 32-character extension id
 */
export function extensionIdFromKey(base64Spki) {
  const digest = createHash("sha256").update(Buffer.from(base64Spki, "base64")).digest();
  return [...digest.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0xf])
    .map((nibble) => String.fromCharCode(0x61 + nibble))
    .join("");
}

/** @returns {Promise<{raw: string, manifest: Record<string, unknown>}>} */
async function readManifest(path) {
  const raw = await readFile(path, "utf8");
  return { raw, manifest: JSON.parse(raw) };
}

/**
 * Rewrites only the `key` member, preserving the file's own formatting and key
 * order. A `JSON.stringify` round-trip would reformat a hand-maintained manifest
 * on every call, so the diff of switching keys would be the whole file rather
 * than the one line that changed.
 */
async function writeKey(path, base64Spki) {
  const { raw, manifest } = await readManifest(path);
  const line = `  "key": ${JSON.stringify(base64Spki)},`;
  const next =
    "key" in manifest
      ? raw.replace(/^ {2}"key": ".*",$/m, line)
      : // Directly after the opening brace: `key` is identity, so it reads first.
        raw.replace(/^\{$/m, `{\n${line}`);
  if (next === raw) throw new Error("could not place `key` in the manifest template — has its shape changed?");
  await writeFile(path, next);
  return extensionIdFromKey(base64Spki);
}

async function generate(path) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  await mkdir(new URL("../keys/", import.meta.url), { recursive: true });
  await writeFile(PRIVATE_KEY, privateKey);
  const base64 = publicKey.toString("base64");
  const id = await writeKey(path, base64);
  console.log(`Wrote the public key to public/manifest.template.json and the private half to keys/extension.pem.`);
  console.log(`Extension id: ${id}`);
  console.log(
    `\nThe private key is git-ignored, and nothing in this project's path to production needs it:\n` +
      `the Web Store re-signs on upload, so it is only of use if you ever pack a .crx yourself.\n` +
      `Losing it does not cost you the id — that comes from the public key in the manifest.`,
  );
}

async function set(path, base64Spki) {
  if (!base64Spki) throw new Error("usage: extension-key.mjs set <base64-public-key>");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Spki)) throw new Error("that does not look like base64");
  const id = await writeKey(path, base64Spki);
  console.log(`Extension id is now: ${id}`);
  console.log(
    `\nThis id is in the Keycloak redirect URI, and the realm imports on first start only.\n` +
      `A running local stack must be recreated: docker compose -f infra/docker-compose.yml down -v`,
  );
}

async function id(path) {
  const { manifest } = await readManifest(path);
  if (typeof manifest.key !== "string") {
    throw new Error("the manifest template has no `key` — run `extension-key.mjs generate` first");
  }
  // Bare, so it can be captured: MPRELIST_EXTENSION_ID=$(npm run -s extension-id …)
  console.log(extensionIdFromKey(manifest.key));
}

// Only when run as a script. The test imports `extensionIdFromKey` from here, and
// a module that parses argv on import would take the test's own argv as its own.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) await main();

async function main() {
const { values, positionals } = parseArgs({
  options: { manifest: { type: "string" } },
  allowPositionals: true,
});
const [command, argument] = positionals;
const manifest = values.manifest ? new URL(values.manifest, pathToFileURL(`${cwd()}/`)) : DEFAULT_MANIFEST;

const commands = { generate, set, id };
if (!Object.hasOwn(commands, command ?? "")) {
  console.error("usage: extension-key.mjs <generate | set <base64-public-key> | id> [--manifest <path>]");
  exit(2);
}
try {
  await commands[command](manifest, argument);
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  exit(1);
}
}
