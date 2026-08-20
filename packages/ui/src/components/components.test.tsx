import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, isInert, type ButtonTone } from "./Button";
import { IconButton } from "./IconButton";
import { Note } from "./Note";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

const markup = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element);

describe("Button", () => {
  it("carries its shape and tone as classes, and defaults to the row action", () => {
    expect(markup(<Button>Repost</Button>)).toBe(
      '<button type="button" class="mp-btn mp-btn--pill mp-btn--primary">Repost</button>',
    );
  });

  it("is not a submit button unless somebody says so", () => {
    // Both consumers put these inside forms eventually. A pill labelled "Repost"
    // that submits the page around it is a surprise nobody asked for.
    expect(markup(<Button>Repost</Button>)).toContain('type="button"');
    expect(markup(<Button type="submit">Pay</Button>)).toContain('type="submit"');
  });

  for (const tone of ["locked", "busy", "done", "cooldown"] satisfies ButtonTone[]) {
    it(`refuses to be pressed while ${tone}`, () => {
      expect(isInert(tone)).toBe(true);
      expect(markup(<Button tone={tone}>Repost</Button>)).toContain("disabled");
    });

    it(`stays refused while ${tone} even when the caller says otherwise`, () => {
      // The tone is the state, and the state decides. A locked Repost that a
      // stray click can still reach deletes an ad the gate already refused —
      // relisting is delete-first (ADR-0002), so there is no harmless version.
      expect(markup(<Button tone={tone} disabled={false}>Repost</Button>)).toContain("disabled");
    });
  }

  for (const tone of ["primary", "secondary", "retry"] satisfies ButtonTone[]) {
    it(`can be pressed while ${tone}`, () => {
      expect(isInert(tone)).toBe(false);
      expect(markup(<Button tone={tone}>Repost</Button>)).not.toContain("disabled");
    });
  }

  it("still honours a caller that disables an otherwise live tone", () => {
    expect(markup(<Button disabled>Repost</Button>)).toContain("disabled");
  });

  it("brings the glyph that tells one inert state from another", () => {
    // Lock, tick and clock are how locked, done and cooldown read at a glance on
    // a row of otherwise identical grey pills.
    expect(markup(<Button tone="locked">Repost</Button>)).toContain("M7.2 8.8V6.6");
    expect(markup(<Button tone="done">Reposted</Button>)).toContain("M4.6 10.4 8.2 14l7.2-8");
    expect(markup(<Button tone="cooldown">24s</Button>)).toContain("<circle");
    expect(markup(<Button tone="busy">Reposting…</Button>)).toContain('class="mp-spinner"');
  });

  it("leaves the live tones bare", () => {
    expect(markup(<Button tone="primary">Repost</Button>)).not.toContain("<svg");
    expect(markup(<Button tone="retry">Retry</Button>)).not.toContain("<svg");
  });

  it("keeps a caller's own class beside its own", () => {
    expect(markup(<Button className="popup-row-action">Repost</Button>)).toContain(
      'class="mp-btn mp-btn--pill mp-btn--primary popup-row-action"',
    );
  });
});

describe("IconButton", () => {
  it("has an accessible name, because there is no text to read", () => {
    expect(markup(<IconButton label="Refresh" />)).toBe(
      '<button type="button" class="mp-icon-btn" aria-label="Refresh"></button>',
    );
  });
});

describe("Note", () => {
  it("is announced when it appears, without talking over anybody", () => {
    expect(markup(<Note tone="ok">Reposted.</Note>)).toBe(
      '<p class="mp-note mp-note--ok" role="status">Reposted.</p>',
    );
  });

  it("carries its tone", () => {
    expect(markup(<Note tone="error">Could not re-create it.</Note>)).toContain("mp-note--error");
  });
});

describe("Skeleton", () => {
  it("takes a number as pixels and a string as written", () => {
    expect(markup(<Skeleton width={64} height="11px" />)).toBe(
      '<span class="mp-skeleton" style="width:64px;height:11px" aria-hidden="true"></span>',
    );
    expect(markup(<Skeleton width="78%" />)).toContain("width:78%");
  });

  it("is hidden from a screen reader, being a shape rather than content", () => {
    expect(markup(<Skeleton />)).toContain('aria-hidden="true"');
  });

  it("can stand in for a pill", () => {
    expect(markup(<Skeleton shape="pill" />)).toContain("mp-skeleton--pill");
  });
});

describe("Spinner", () => {
  it("is decoration inside a button whose label already says what is happening", () => {
    expect(markup(<Spinner />)).toBe('<span class="mp-spinner" aria-hidden="true"></span>');
  });

  it("announces itself when it is the only thing on the screen", () => {
    expect(markup(<Spinner size="lg" label="Loading your ads" />)).toBe(
      '<span class="mp-spinner mp-spinner--lg" role="status" aria-label="Loading your ads"></span>',
    );
  });
});
