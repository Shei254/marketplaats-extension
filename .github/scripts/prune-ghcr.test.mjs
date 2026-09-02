import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBuildTag, selectVersionsToDelete, versionsToKeep } from "./prune-ghcr.mjs";

/**
 * What may be deleted from GHCR, and — much more to the point — what may not.
 *
 * ADR-0023 put a registry in the deploy path and named the bill as its cost: every green `master` adds a
 * `sha-<commit>` pair, private-repository storage is billed past the account's allowance, and nothing
 * removed anything. This is that, and the whole of the risk in it is that a prune is a delete against the
 * registry the production host pulls from. There is no undo that matters — GitHub's restore window does not
 * help the deploy that is failing right now — so every rule below is written to fail towards keeping.
 *
 * The fixtures are the shape GHCR actually returns, taken from a real listing on this account rather than
 * from the API reference: `id`, a `name` that is the digest, `created_at`, and the tags buried at
 * `metadata.container.tags`. That listing is also where the hazard the `protectedDigests` tests exist for
 * came from — a single push showed up as **three** versions, one tagged and two untagged, because a
 * manifest index and the manifests it references are each a version. Delete the untagged two and the tagged
 * one is a broken pull; keep every untagged version instead and the prune reclaims nothing at all, since a
 * layer is only unreferenced once every manifest naming it is gone. Both of those are silent from here.
 */

let nextId = 1;

/** A version as the API returns one. `tags: []` is the untagged child case, and it is the common one. */
function version(tags, { createdAt = "2026-01-01T00:00:00Z", digest = `sha256:${nextId}` } = {}) {
  return {
    id: nextId++,
    name: digest,
    created_at: createdAt,
    metadata: { package_type: "container", container: { tags } },
  };
}

const idsOf = (versions) => versions.map((each) => each.id).sort((a, b) => a - b);

describe("which tags make a version a build rather than a release", () => {
  it("recognises the tag CI pushes, at the length CI pushes it", () => {
    assert.equal(isBuildTag(`sha-${"a".repeat(40)}`), true);
    assert.equal(isBuildTag("sha-0123456"), true);
  });

  /**
   * Everything else protects, and that is the direction the ambiguity is resolved in deliberately. A
   * release tag is the obvious case; `latest`, a name somebody typed, and a scheme invented after this file
   * was written are the ones that matter, because each of them is a human saying *keep this* in the only
   * vocabulary the registry has.
   */
  it("and treats every other tag as something to keep, not merely as a release", () => {
    for (const tag of ["v1.0.0", "v1.2.3", "latest", "edge", "rollback-candidate", "sha-nothex", "sha-", ""]) {
      assert.equal(isBuildTag(tag), false, `${tag} must not be prunable`);
    }
  });
});

describe("what survives the tag policy", () => {
  it("keeps nothing out of nothing, rather than failing", () => {
    assert.deepEqual(versionsToKeep({ versions: [], keep: 10 }), []);
  });

  it("keeps every build when there are fewer of them than the retention", () => {
    const versions = [version(["sha-aaaaaaa"]), version(["sha-bbbbbbb"])];

    assert.deepEqual(idsOf(versionsToKeep({ versions, keep: 10 })), idsOf(versions));
  });

  it("keeps the newest builds and no more of them", () => {
    const oldest = version(["sha-1111111"], { createdAt: "2026-01-01T00:00:00Z" });
    const middle = version(["sha-2222222"], { createdAt: "2026-02-01T00:00:00Z" });
    const newest = version(["sha-3333333"], { createdAt: "2026-03-01T00:00:00Z" });

    const kept = versionsToKeep({ versions: [oldest, newest, middle], keep: 2 });

    assert.deepEqual(idsOf(kept), idsOf([middle, newest]));
  });

  /**
   * A release is kept however old it is, and the retention count is not spent on it. Age is the wrong
   * question about a version somebody tagged `v1.0.0`: it is the answer to "what is running", and
   * `infra/deploy/mprelist-deploy` can be handed it by a human at any point in the future.
   */
  it("keeps a release whatever its age, without spending the retention on it", () => {
    const release = version(["v1.0.0"], { createdAt: "2020-01-01T00:00:00Z" });
    const builds = [
      version(["sha-1111111"], { createdAt: "2026-01-01T00:00:00Z" }),
      version(["sha-2222222"], { createdAt: "2026-02-01T00:00:00Z" }),
    ];

    const kept = versionsToKeep({ versions: [release, ...builds], keep: 2 });

    assert.deepEqual(idsOf(kept), idsOf([release, ...builds]));
  });

  /**
   * The one that would be found in production. `docker buildx imagetools create` adds `v1.0.0` to the digest
   * `master` already pushed as `sha-<commit>` — ADR-0023's "a release is a second name on a digest, not a
   * second build" — so the deployed release and an ordinary old build are frequently *the same version*,
   * carrying both tags. A rule that asked "is this a build?" by looking at the first tag, or at any tag,
   * would delete the running release the moment it fell out of the retention window.
   */
  it("keeps a build that a release was later stamped onto the same digest", () => {
    const released = version(["sha-1111111", "v1.0.0"], { createdAt: "2020-01-01T00:00:00Z" });
    const newer = [
      version(["sha-2222222"], { createdAt: "2026-01-01T00:00:00Z" }),
      version(["sha-3333333"], { createdAt: "2026-02-01T00:00:00Z" }),
    ];

    const kept = versionsToKeep({ versions: [released, ...newer], keep: 2 });

    assert.deepEqual(idsOf(kept), idsOf([released, ...newer]));
  });

  it("keeps an untagged version out of the tag policy's hands entirely", () => {
    const untagged = version([]);

    assert.deepEqual(versionsToKeep({ versions: [untagged], keep: 0 }), []);
  });

  it("ignores a version with no metadata rather than throwing on it", () => {
    const malformed = { id: 999, name: "sha256:malformed", created_at: "2026-01-01T00:00:00Z" };

    assert.deepEqual(versionsToKeep({ versions: [malformed], keep: 10 }), []);
  });
});

describe("what is actually deleted", () => {
  it("deletes the builds past the retention window", () => {
    const doomed = version(["sha-1111111"], { createdAt: "2026-01-01T00:00:00Z" });
    const kept = version(["sha-2222222"], { createdAt: "2026-02-01T00:00:00Z" });

    const deleted = selectVersionsToDelete({ versions: [doomed, kept], keep: 1 });

    assert.deepEqual(idsOf(deleted), [doomed.id]);
  });

  it("deletes nothing when everything is within the window", () => {
    const versions = [version(["sha-1111111"]), version(["v2.0.0"])];

    assert.deepEqual(selectVersionsToDelete({ versions, keep: 10 }), []);
  });

  /**
   * An untagged version that nothing kept refers to is an orphan — the child of an index that was pruned in
   * an earlier run, or of one that never got a tag — and it is exactly the thing that keeps a layer alive
   * and billed. Deleting it is most of the point of the whole file.
   */
  it("deletes an untagged version that no kept version refers to", () => {
    const orphan = version([], { digest: "sha256:orphan" });
    const kept = version(["sha-1111111"], { digest: "sha256:kept" });

    const deleted = selectVersionsToDelete({
      versions: [orphan, kept],
      keep: 10,
      protectedDigests: new Set(["sha256:kept"]),
    });

    assert.deepEqual(idsOf(deleted), [orphan.id]);
  });

  /** And the mirror of it: the child of something kept is not an orphan, and deleting it breaks the parent. */
  it("keeps an untagged child of a kept index", () => {
    const child = version([], { digest: "sha256:child" });
    const index = version(["v1.0.0"], { digest: "sha256:index" });

    const deleted = selectVersionsToDelete({
      versions: [child, index],
      keep: 10,
      protectedDigests: new Set(["sha256:index", "sha256:child"]),
    });

    assert.deepEqual(deleted, []);
  });

  /**
   * Protection beats the retention window, and it has to: a digest can be both an expired build *and* the
   * platform manifest a kept release's index points at, in which case deleting it by age breaks a release
   * that the tag policy correctly decided to keep.
   */
  it("keeps an expired build that a kept release still refers to", () => {
    const expired = version(["sha-1111111"], { createdAt: "2020-01-01T00:00:00Z", digest: "sha256:expired" });
    const newer = version(["sha-2222222"], { createdAt: "2026-01-01T00:00:00Z", digest: "sha256:newer" });

    const deleted = selectVersionsToDelete({
      versions: [expired, newer],
      keep: 1,
      protectedDigests: new Set(["sha256:newer", "sha256:expired"]),
    });

    assert.deepEqual(deleted, []);
  });

  /**
   * With no protected set resolved at all, nothing untagged is touched. This is the failure mode of the
   * registry being unreachable or answering something unexpected, and it must degrade to a prune that
   * removes less than it could rather than to one that removes a manifest something needs.
   */
  it("leaves every untagged version alone when nothing was resolved", () => {
    const untagged = [version([]), version([])];
    const build = version(["sha-1111111"]);

    assert.deepEqual(selectVersionsToDelete({ versions: [...untagged, build], keep: 10 }), []);
  });

  /**
   * The distinction the whole untagged half turns on, and the reason it is a `null` rather than an empty
   * set. The walk is seeded with the kept versions' own digests, so a walk that read nothing still comes
   * back non-empty — inferring "resolved" from the size of it would call a walk that failed a walk that
   * found nothing, and delete the children of every kept index on the strength of it.
   */
  it("treats an explicit null as a walk that did not happen, and keeps the untagged", () => {
    const child = version([], { digest: "sha256:child" });
    const index = version(["v1.0.0"], { digest: "sha256:index" });

    assert.deepEqual(selectVersionsToDelete({ versions: [child, index], keep: 10, protectedDigests: null }), []);
  });

  /**
   * The caller has already computed the kept set to seed the walk with, and hands it back rather than
   * letting this recompute one. Two answers to "what is kept" is the way the seeds and the survivors come
   * to disagree — the walk protecting one set while the filter keeps another.
   */
  it("uses the kept set it is given rather than working one out again", () => {
    const spared = version(["sha-1111111"], { createdAt: "2020-01-01T00:00:00Z" });
    const other = version(["sha-2222222"], { createdAt: "2026-01-01T00:00:00Z" });

    const deleted = selectVersionsToDelete({ versions: [spared, other], keep: 0, kept: [spared] });

    assert.deepEqual(idsOf(deleted), [other.id]);
  });

  it("never deletes a release, whatever the retention is set to", () => {
    const versions = [version(["v1.0.0"]), version(["v1.1.0"]), version(["latest"])];

    assert.deepEqual(selectVersionsToDelete({ versions, keep: 0 }), []);
  });
});
