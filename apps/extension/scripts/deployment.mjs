import { readFile } from "node:fs/promises";

/**
 * Where a published extension talks (T56, #87, and ADR-0024).
 *
 * Two addresses decide it — our own API, and the Keycloak realm — and **neither
 * can be served to the extension**, which is the whole reason they are compiled
 * in and this file exists. `client-config.ts` fetches the served document from
 * `${baseUrl}/api/client-config`, so an extension that does not already know
 * where the API is cannot ask the API where it is; and signing in is what
 * produces the token every call carries, so the realm has to be known before the
 * first fetch of that document, not after it. Neither is a limitation of how #36
 * was built. Both are properties of the order things happen in.
 *
 * So the addresses are resolved at build time from the committed
 * `deployment.json`, the way `brand.json` is resolved by `brand.mjs` beside this
 * — same shape, same `$`-prefixed notes, and the same insistence that a build
 * **stops** rather than shipping something wrong. What makes stopping the right
 * answer here is that the mistake is otherwise silent and then permanent: a
 * build carrying `localhost` looks fine on the machine that made it, works in
 * the click-through, and is inert on every machine that installs it from the Web
 * Store. Correcting it is a review of days to weeks, and T43's `426 Upgrade
 * Required` cannot even announce the problem — saying so requires reaching the
 * API the stranded build can no longer find.
 *
 * Committed rather than environment, because these are public URLs and not
 * secrets. The consequence is the reason rather than a side effect: moving a
 * deployment's hostnames becomes one reviewable commit, in the one part of this
 * product where the change cannot be undone without somebody else's review.
 */

const DEPLOYMENT = new URL("../../../deployment.json", import.meta.url);

/** Keys that are documentation for whoever edits the file, not values to render. */
const NOT_A_VALUE = /^\$/;

/**
 * The local stack's addresses (`infra/README.md`) — the API on 8080, which is
 * Spring Boot's default and the reason Keycloak was moved to 8081.
 *
 * `npm run build:dev` compiles these in and `npm run build` compiles
 * `deployment.json` in, which is the same split `__DEV__` already draws between
 * the two builds. They live here rather than in `deployment.json` because that
 * file describes *the deployment*, and a second profile in it would be the named
 * set ADR-0024 defers until there is a staging stack to name.
 */
export const LOCAL_STACK = Object.freeze({
  apiBaseUrl: "http://localhost:8080",
  issuer: "http://localhost:8081/realms/mprelist",
});

/**
 * Reads and checks the committed deployment.
 *
 * Every rule below is one way to ship an extension that cannot talk to anything,
 * and each of them fails at a distance — in somebody else's browser, after a
 * review — which is why they are checked here rather than trusted.
 *
 * @param {URL} [url]
 * @returns {Promise<{ apiBaseUrl: string, issuer: string }>}
 */
export async function readDeployment(url = DEPLOYMENT) {
  const parsed = JSON.parse(await readFile(url, "utf8"));
  const deployment = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !NOT_A_VALUE.test(key)),
  );

  const apiBaseUrl = addressOf(deployment, "apiBaseUrl");
  const issuer = addressOf(deployment, "issuer");

  if (!/\/realms\/[^/]+$/.test(new URL(issuer).pathname)) {
    throw new Error(
      `deployment.json's issuer is \`${issuer}\`, which names no realm. Keycloak serves its discovery `
        + "document under `/realms/<name>`, and an issuer without one is a 404 that reads as an outage.",
    );
  }

  return { ...deployment, apiBaseUrl, issuer };
}

/**
 * One address, checked. Returns it so a caller reads the checked value rather
 * than the one it passed in.
 *
 * @param {Record<string, unknown>} deployment
 * @param {string} key
 * @returns {string}
 */
function addressOf(deployment, key) {
  const value = deployment[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`deployment.json is missing or empty: ${key}`);
  }

  let address;
  try {
    address = new URL(value);
  }
  catch {
    throw new Error(`deployment.json's ${key} is \`${value}\`, which is not an absolute URL`);
  }

  if (address.protocol !== "https:") {
    // The realm is `sslRequired: external`, so Keycloak answers `403 HTTPS required` to
    // any non-local plain-HTTP caller — which is the setting working. An `http://`
    // address here ships a build that cannot sign anybody in and says so obscurely.
    throw new Error(`deployment.json's ${key} is \`${value}\`, and a deployed address is https`);
  }

  if (LOCAL_ADDRESSES.has(address.hostname) || address.hostname.endsWith(".local")) {
    throw new Error(
      `deployment.json's ${key} is \`${value}\`, which is the machine the build ran on. `
        + "A published extension would reach whatever is on the *user's* own port.",
    );
  }

  if (value.endsWith("/")) {
    // Checked against the text rather than the parsed pathname, which is `/` for a
    // bare origin and would fail every correct value here.
    // Every call is `${baseUrl}/api/…` and the issuer is compared to the `iss` claim
    // as text, so a trailing slash is a double slash in one and a mismatch in the other.
    throw new Error(`deployment.json's ${key} is \`${value}\`, which has a trailing slash`);
  }

  return value;
}

const LOCAL_ADDRESSES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
