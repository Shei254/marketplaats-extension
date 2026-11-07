// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ListingSummary, PendingRepost } from "../domain/types";
import { AdList } from "./AdList";
import type { WorkerPort } from "./screen";
import { Thumbnail } from "./Thumbnail";

const AD: ListingSummary = {
  id: "m1",
  title: "Vintage Eames lounge chair",
  priceCents: 125_000,
  priceType: "FIXED",
  biddingEnabled: false,
  reserved: false,
};
const PENDING: PendingRepost = {
  listingId: "m9",
  title: "Gazelle damesfiets",
  needsUser: false,
  running: false,
  deleted: true,
};
const PHOTO = "https://images.marktplaats.com/one.jpg";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const picture = () => container.querySelector<HTMLImageElement>(".popup-ad-thumbnail img");
const noPhotoIcon = () => container.querySelector(".popup-ad-thumbnail svg");

async function draw(url?: string) {
  await act(async () => root.render(<Thumbnail url={url} />));
}

describe("a thumbnail", () => {
  it("draws the photo inside the box", async () => {
    await draw(PHOTO);

    expect(picture()?.getAttribute("src")).toBe(PHOTO);
  });

  it("shows no icon while the photo may still be loading", async () => {
    await draw(PHOTO);

    expect(noPhotoIcon()).toBeNull();
  });

  it("draws the no-photo icon for an ad with no photo", async () => {
    await draw(undefined);

    expect(noPhotoIcon()).not.toBeNull();
    expect(picture()).toBeNull();
  });

  it("falls back to the no-photo icon when the photo will not load", async () => {
    await draw(PHOTO);

    await act(async () => {
      picture()?.dispatchEvent(new Event("error"));
    });

    expect(noPhotoIcon()).not.toBeNull();
    expect(picture()).toBeNull();
  });

  it("tries again when it is handed another URL", async () => {
    await draw(PHOTO);
    await act(async () => {
      picture()?.dispatchEvent(new Event("error"));
    });

    await draw("https://images.marktplaats.com/two.jpg");

    expect(picture()?.getAttribute("src")).toBe("https://images.marktplaats.com/two.jpg");
  });

  it("reads a scheme-relative URL as https, not as the extension's own scheme", async () => {
    await draw("//images.marktplaats.com/one.jpg");

    expect(picture()?.getAttribute("src")).toBe(PHOTO);
  });

  it("leaves naming the ad to the title beside it", async () => {
    await draw(PHOTO);

    expect(picture()?.getAttribute("alt")).toBe("");
  });
});

describe("the rows of the list", () => {
  const worker = {
    relist: vi.fn(),
    retry: vi.fn(),
    msBeforeNextRelist: vi.fn(async () => 0),
    relistStatus: vi.fn(async () => null),
  } as unknown as WorkerPort;

  async function list(ads: ListingSummary[], pending: PendingRepost[]) {
    await act(async () =>
      root.render(
        <AdList
          view={{ status: "ready", ads, total: ads.length }}
          worker={worker}
          onOutcome={() => {}}
          grantsNothing={false}
          pending={pending}
        />,
      ),
    );
  }

  it("carry one on an ad's row and on a pending repost's", async () => {
    await list(
      [{ ...AD, thumbnailUrl: PHOTO }],
      [{ ...PENDING, thumbnailUrl: "https://images.marktplaats.com/gone.jpg" }],
    );

    const sources = [...container.querySelectorAll(".popup-ad-thumbnail img")].map((img) => img.getAttribute("src"));
    expect(sources).toEqual(["https://images.marktplaats.com/gone.jpg", PHOTO]);
  });

  it("hold their shape when neither has a photo", async () => {
    await list([AD], [PENDING]);

    expect(container.querySelectorAll(".popup-ad-thumbnail")).toHaveLength(2);
    expect(picture()).toBeNull();
  });
});
