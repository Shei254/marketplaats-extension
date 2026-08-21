import { afterEach, describe, expect, it } from "vitest";

import { installChromeStub, type ChromeStub } from "../testing/chrome-stub";
import { ChromePaceStore } from "./chrome-pace-store";

/**
 * The relist pace's deadline, in `chrome.storage.local` (T46, #54).
 *
 * It is stored at all because an MV3 worker does not live long enough to remember
 * it: about thirty seconds after it goes idle it is gone, which is well inside the
 * gap this deadline exists to hold — so a value in a variable would be forgotten
 * between exactly the two relists it is meant to space out.
 */
let stub: ChromeStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("the pace deadline", () => {
  it("round-trips", async () => {
    stub = installChromeStub();
    const store = new ChromePaceStore();

    await store.write(1_755_000_300_000);

    await expect(store.read()).resolves.toBe(1_755_000_300_000);
  });

  it("is nothing at all before the first relist", async () => {
    stub = installChromeStub();

    await expect(new ChromePaceStore().read()).resolves.toBeNull();
  });

  it("is nothing rather than nonsense when the stored value is junk", async () => {
    // Storage outlives the build that wrote it, and under ADR-0007 the user can
    // write it themselves. `NaN` milliseconds of waiting is the failure this
    // avoids: it compares false against everything, so a wait computed from it
    // would neither happen nor end.
    for (const junk of ["soon", null, {}, [], Number.NaN, undefined]) {
      stub?.restore();
      stub = installChromeStub({ relistPace: junk });

      await expect(new ChromePaceStore().read(), JSON.stringify(junk) ?? "undefined").resolves.toBeNull();
    }
  });
});
