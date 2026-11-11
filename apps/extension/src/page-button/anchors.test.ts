// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { findSlots } from "./anchors";
import { rowHtml } from "./testing/row";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("finding where the Page buttons go", () => {
  it("finds each ad once, with both of its Sneller verkopen controls and its row", () => {
    document.body.innerHTML = rowHtml("m2462954041") + rowHtml("m100");

    const slots = findSlots(document);

    expect(slots.map((slot) => slot.listingId)).toEqual(["m2462954041", "m100"]);
    const [first] = slots;
    expect(first?.desktop?.classList.contains("hz-Button")).toBe(true);
    expect(first?.mobile?.classList.contains("hz-Link")).toBe(true);
    expect(first?.row?.classList.contains("cells")).toBe(true);
  });

  it("falls back to the class when Marktplaats drops its test id", () => {
    document.body.innerHTML = rowHtml("m7").replaceAll('data-testid="buy-feature-button"', "");

    expect(findSlots(document).map((slot) => slot.listingId)).toEqual(["m7"]);
  });

  it("ignores an id that is not an item id, and finds nothing on a page it cannot read", () => {
    document.body.innerHTML = rowHtml("not-an-ad");
    expect(findSlots(document)).toEqual([]);

    document.body.innerHTML = "<main><p>Iets anders</p></main>";
    expect(findSlots(document)).toEqual([]);
  });
});
