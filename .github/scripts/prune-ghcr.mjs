/**
 * Removes the container versions GHCR is billing for and nothing else.
 *
 * ADR-0023 moved the images off the deployed host and into a registry, and named the bill in its own
 * Negative: "Packages storage and transfer are billed on private repositories past the account's included
 * allowance ... but it wants old tags pruned". Every green `master` adds a `sha-<commit>` to each of the two
 * packages and nothing has ever removed one. This is the thing that removes them.
 *
 * **The asymmetry is the whole design.** Keeping a version too long costs a few cents of storage. Deleting
 * one wrongly is a `docker pull` failing on the host at the moment somebody is deploying a fix — GitHub's
 * restore window exists but does not help the outage that is already happening. So every rule here fails
 * towards keeping, and the two that are easy to get backwards are:
 *
 *   - **Only `sha-<commit>` is a candidate.** Not "everything that is not a release": a tag this file does
 *     not recognise is a human saying *keep this* in the only vocabulary a registry has, and the newest
 *     scheme is always the one written after this file.
 *   - **A version is judged by all of its tags, never by one**, and a release protects whatever it reaches.
 *     ADR-0023 makes a release a second name rather than a second build, and that lands as one of two
 *     shapes depending on what `imagetools create` was given: `--prefer-index` defaults to true, so a lone
 *     source manifest is usually wrapped in a **new** index, leaving `v1.0.0` a version of its own whose
 *     child is the `sha-<commit>` one — and a source that is already an index is copied, leaving a single
 *     version wearing both tags. Both are handled, and neither by knowing which happened: the tag rule
 *     protects a version carrying any release tag, and reachability protects whatever a kept version points
 *     at, however old the retention window thinks it is.
 *
 * The untagged half is the part that is not obvious from the API. A single push shows up as several
 * versions: a manifest index, and the manifests it references, each of which is a version of its own with
 * `tags: []`. Deleting those children breaks the tagged parent, and keeping all of them reclaims nothing,
 * because a layer stays billed until every manifest naming it is gone. So the kept versions' manifests are
 * resolved from the registry, transitively, and what survives that is an orphan — a child of an index some
 * earlier run already took — which is exactly what is safe to delete and what is holding the layers.
 *
 * **Any failure in that walk abandons the whole of it**, rather than the subtree it happened to hit. A
 * resolution that half-succeeded is indistinguishable from one that succeeded — the digests it did not
 * reach look exactly like orphans — so one 429 in the middle would delete the children of a kept index and
 * present as a `docker pull` failing days later. An abandoned walk deletes no untagged version at all: less
 * reclaimed, never a broken pull.
 *
 * **What this does not protect is a `sha-<commit>` somebody is running without a release tag.** `ci.yml`'s
 * dispatch offers exactly that for "something unreleased", and the rule here is age, so ten further pushes
 * to `master` take it. That is bounded rather than silent — the deploy job verifies the digest exists and
 * refuses — but it does mean the unreleased-deploy path reaches back ten commits and no further. Tag a
 * release for anything meant to outlive that, or raise `KEEP` for the run.
 */

/** The tag CI pushes, and the only shape this file will ever delete. `ci.yml` writes the full 40. */
const BUILD_TAG = /^sha-[0-9a-f]{7,40}$/;

/** Manifest types worth asking for: the two index types name children, the two image types do not. */
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/**
 * Whether a tag is one of CI's own build names.
 *
 * Everything else — a release, `latest`, a word somebody typed, a scheme invented next year — answers
 * false and thereby protects the version wearing it. The default has to be this way round: an unrecognised
 * tag is a thing this file does not understand, and the safe response to not understanding a tag is to
 * leave the bytes where they are.
 */
export function isBuildTag(tag) {
  return typeof tag === "string" && BUILD_TAG.test(tag);
}

/** The tags GHCR hangs off a version, from a shape that is three levels deep and may be absent. */
function tagsOf(version) {
  const tags = version?.metadata?.container?.tags;
  return Array.isArray(tags) ? tags : [];
}

/**
 * The versions the tag policy keeps: everything carrying a tag that is not a build, plus the newest `keep`
 * of the ones that only carry builds.
 *
 * Untagged versions are not considered here at all — they are not the tag policy's to judge, and
 * {@link selectVersionsToDelete} decides them by whether anything kept still points at them.
 */
export function versionsToKeep({ versions, keep }) {
  const tagged = versions.filter((version) => tagsOf(version).length > 0);

  const protectedByTag = tagged.filter((version) => tagsOf(version).some((tag) => !isBuildTag(tag)));
  const buildsOnly = tagged.filter((version) => tagsOf(version).every(isBuildTag));

  // Newest first. `created_at` is what a human would sort by and ties are real — the two packages' pushes
  // land in the same second — so the id breaks them, and ids ascend with time.
  const newestFirst = [...buildsOnly].sort((a, b) => {
    const byDate = Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0);
    return byDate !== 0 ? byDate : b.id - a.id;
  });

  return [...protectedByTag, ...newestFirst.slice(0, Math.max(0, keep))];
}

/**
 * The versions that may be deleted: the builds past the retention window, and the untagged versions that
 * nothing kept refers to.
 *
 * `protectedDigests` is the set the registry walk reached, seeded with the kept versions' own digests, and
 * **`null` means the walk did not happen or did not finish**. That distinction is a `null` rather than an
 * empty set on purpose: the set is seeded, so a failed walk still comes back non-empty, and inferring
 * success from its size would call a walk that read nothing a walk that found nothing — which is the
 * difference between keeping an index's children and deleting them.
 *
 * Protection outranks the retention window, because a digest can be an expired build *and* the image a kept
 * release's index points at, and deleting it by age would break the release the tag policy just kept.
 *
 * `kept` is passed in by the caller that already computed it, so the seeds handed to the walk and the set
 * used here cannot be two different answers to the same question.
 */
export function selectVersionsToDelete({ versions, keep, kept = versionsToKeep({ versions, keep }), protectedDigests = null }) {
  const keptIds = new Set(kept.map((version) => version.id));
  const resolved = protectedDigests instanceof Set;

  return versions.filter((version) => {
    if (keptIds.has(version.id)) return false;
    if (resolved && protectedDigests.has(version.name)) return false;
    // Untagged and unresolved: not knowing what points at it is the reason to leave it.
    return tagsOf(version).length > 0 || resolved;
  });
}

// --- everything below talks to GitHub -----------------------------------------------------------------

const API = "https://api.github.com";
const REGISTRY = "https://ghcr.io";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function github(path, { token, method = "GET" }) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  return response;
}

/**
 * Where a package's versions live, which differs by what kind of account owns it. Asked rather than
 * configured: this repository is under a user today and moving it to an organisation is a thing somebody
 * does in an afternoon, at which point every path below silently becomes a 404.
 */
async function ownerPath(owner, token) {
  const response = await github(`/users/${owner}`, { token });
  if (!response.ok) throw new Error(`Cannot read the owner ${owner}: ${response.status}`);
  const { type } = await response.json();
  return type === "Organization" ? `/orgs/${owner}` : `/users/${owner}`;
}

async function versionsOf(base, encodedPackage, token) {
  const versions = [];
  for (let page = 1; ; page++) {
    const response = await github(
      `${base}/packages/container/${encodedPackage}/versions?per_page=100&page=${page}`,
      { token },
    );
    // A 404 here is not "no images yet". By the time this workflow can run at all it is on `master`, and
    // the push that put it there is a push the `images` job built and pushed both packages on — so the
    // empty window this used to tolerate closes the moment the file exists. What a 404 means afterwards is
    // that something is wrong in a way no other symptom reports: an image renamed on one side only, an
    // owner moved to an organisation, or the delete permission being withdrawn from under the token. Every
    // one of those wants a red run, because the alternative is the failure `ci.yml` calls the one CI cannot
    // have — a green weekly job that looked at nothing while the bill it exists to stop keeps growing.
    if (response.status === 404) {
      throw new Error(
        `No package ${decodeURIComponent(encodedPackage)} under ${base}. Either the image was renamed, the ` +
          `owner moved, or this token cannot see packages — none of which this job should pass through.`,
      );
    }
    if (!response.ok) throw new Error(`Cannot list versions: ${response.status} ${await response.text()}`);

    const batch = await response.json();
    versions.push(...batch);
    if (batch.length < 100) return versions;
  }
}

/** A pull token for one package. GHCR issues these against the workflow token over basic auth. */
async function registryToken(owner, packageName, token) {
  const scope = `repository:${owner}/${packageName}:pull`;
  const response = await fetch(`${REGISTRY}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`, {
    headers: { authorization: `Basic ${Buffer.from(`v:${token}`).toString("base64")}` },
  });
  if (!response.ok) return null;
  return (await response.json()).token ?? null;
}

/**
 * Every digest reachable from the kept versions, the kept versions included.
 *
 * A worklist rather than one pass, because an index may reference an index. Anything that cannot be read —
 * a manifest type nobody expected, a registry that is down, a token that was refused — contributes nothing
 * and leaves its subtree unprotected, which {@link selectVersionsToDelete} answers by not deleting untagged
 * versions at all rather than by deleting the ones it failed to hear about.
 */
async function reachableDigests(owner, packageName, seeds, token) {
  // Nothing kept means nothing to walk from, and a walk with no seeds learns nothing about the registry —
  // which is not the same as learning that everything is an orphan. Without this, a package whose tags had
  // all been removed would resolve to "protected: none" and be deleted in its entirety.
  if (seeds.length === 0) return null;

  const pullToken = await registryToken(owner, packageName, token);
  if (!pullToken) {
    console.log("::warning::Could not obtain a pull token; leaving every untagged version alone.");
    return null;
  }

  const reached = new Set(seeds);
  const worklist = [...seeds];
  while (worklist.length > 0) {
    const digest = worklist.pop();
    const response = await fetch(`${REGISTRY}/v2/${owner}/${packageName}/manifests/${digest}`, {
      headers: { accept: MANIFEST_TYPES, authorization: `Bearer ${pullToken}` },
    });
    // Abandoning the whole walk rather than skipping this digest. Carrying on would leave everything below
    // it looking like an orphan, which is the one wrong answer available here: the digests this run failed
    // to read are exactly the ones something kept is pointing at.
    if (!response.ok) {
      console.log(
        `::warning::Could not read the manifest for ${digest} (${response.status}); ` +
          "leaving every untagged version alone this run.",
      );
      return null;
    }

    const manifest = await response.json().catch(() => null);
    if (manifest === null) {
      console.log(`::warning::Unreadable manifest for ${digest}; leaving every untagged version alone this run.`);
      return null;
    }
    // A plain image manifest has no `manifests` and is not a failure — it is a leaf.
    for (const child of manifest.manifests ?? []) {
      if (child?.digest && !reached.has(child.digest)) {
        reached.add(child.digest);
        worklist.push(child.digest);
      }
    }
  }
  return reached;
}

async function prunePackage({ owner, base, packageName, keep, dryRun, token }) {
  const encoded = encodeURIComponent(packageName);
  const versions = await versionsOf(base, encoded, token);

  const kept = versionsToKeep({ versions, keep });
  const protectedDigests = await reachableDigests(owner, packageName, kept.map((each) => each.name), token);
  const doomed = selectVersionsToDelete({ versions, keep, kept, protectedDigests });

  console.log(
    `${packageName}: ${versions.length} versions, keeping ${versions.length - doomed.length}, ` +
      `deleting ${doomed.length}${dryRun ? " (dry run)" : ""}`,
  );

  let deleted = 0;
  let failed = 0;
  for (const version of doomed) {
    const tags = tagsOf(version);
    const label = `${version.name} [${tags.length > 0 ? tags.join(", ") : "untagged"}]`;
    if (dryRun) {
      console.log(`  would delete ${label}`);
      continue;
    }

    const response = await github(`${base}/packages/container/${encoded}/versions/${version.id}`, {
      token,
      method: "DELETE",
    });
    if (response.ok || response.status === 404) {
      console.log(`  deleted ${label}`);
      deleted++;
    } else {
      // One failure does not stop the rest: a version that will not delete is a thing to look at on Monday,
      // not a reason to leave the other package untouched for another week.
      console.log(`::warning::Could not delete ${label}: ${response.status} ${await response.text()}`);
      failed++;
    }
  }
  return { deleted, failed };
}

async function main() {
  const token = required("GITHUB_TOKEN");
  const owner = required("OWNER");
  const packages = required("PACKAGES").split(",").map((each) => each.trim()).filter(Boolean);
  const keep = Number.parseInt(process.env.KEEP ?? "10", 10);
  const dryRun = process.env.DRY_RUN === "true";

  if (!Number.isInteger(keep) || keep < 1) throw new Error(`KEEP must be a positive integer, not ${process.env.KEEP}`);

  const base = await ownerPath(owner, token);
  let failed = 0;
  for (const packageName of packages) {
    // Each package is taken on its own so that one that cannot be read or written does not quietly cost the
    // other one its weekly run. The failure is still a failure — it is counted and raised at the end.
    try {
      failed += (await prunePackage({ owner, base, packageName, keep, dryRun, token })).failed;
    }
    catch (failure) {
      console.log(`::error::${packageName}: ${failure.message}`);
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} package(s) or version(s) could not be pruned`);
}

// Only when run, so the tests can import the rules without any of the above happening.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((failure) => {
    console.log(`::error::${failure.message}`);
    process.exit(1);
  });
}
