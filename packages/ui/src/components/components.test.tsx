import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "./Badge";
import { Button, isInert, type ButtonTone } from "./Button";
import { Card } from "./Card";
import { Checkbox, Field, Input, Select, Textarea } from "./Field";
import { IconButton } from "./IconButton";
import { Meter } from "./Meter";
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

  for (const tone of ["primary", "secondary", "ghost", "retry"] satisfies ButtonTone[]) {
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

describe("Badge", () => {
  it("says nothing about itself when it is only a fact", () => {
    // `neutral` is the absence of a tone rather than a fourth colour, so it takes
    // no modifier at all and the base class is the whole of it.
    expect(markup(<Badge>month</Badge>)).toBe('<span class="mp-badge">month</span>');
  });

  it("carries the tone as a class, for the four that mean something", () => {
    for (const tone of ["accent", "ok", "warn", "err"] as const) {
      expect(markup(<Badge tone={tone}>on sale</Badge>)).toContain(`mp-badge--${tone}`);
    }
  });
});

describe("Card", () => {
  it("is a section with a body, and nothing else unless it is given one", () => {
    expect(markup(<Card>rows</Card>)).toBe(
      '<section class="mp-card"><div class="mp-card-body">rows</div></section>',
    );
  });

  it("draws the head when there is a title, a lede or an action for it", () => {
    const card = markup(
      <Card title="Tiers" lede="Every tier there is" actions={<Button>New plan</Button>}>
        rows
      </Card>,
    );

    expect(card).toContain('<h2 class="mp-card-title">Tiers</h2>');
    expect(card).toContain('<p class="mp-card-lede">Every tier there is</p>');
    expect(card).toContain('<div class="mp-card-actions">');
  });

  it("takes the padding off for a table, whose own cells carry the gutter", () => {
    expect(markup(<Card flush>table</Card>)).toContain("mp-card-body mp-card-body--flush");
  });
});

describe("Field", () => {
  it("is the label, so clicking the words focuses the control", () => {
    const field = markup(
      <Field label="Reposts per period" hint="Lowering it clamps at zero.">
        <Input value="50" readOnly />
      </Field>,
    );

    expect(field).toMatch(/^<label class="mp-field">/);
    expect(field).toContain('<span class="mp-label">Reposts per period</span>');
    // A span rather than a paragraph: a <p> is not phrasing content, and the
    // browser would close the label around it — taking the control out of it.
    expect(field).toContain('<span class="mp-hint">Lowering it clamps at zero.</span>');
  });

  it("gives every control the class its rules are written against", () => {
    expect(markup(<Input />)).toContain('class="mp-input"');
    expect(markup(<Select />)).toContain('class="mp-select"');
    expect(markup(<Textarea />)).toContain('class="mp-textarea"');
    expect(markup(<Checkbox label="Published" />)).toContain('class="mp-check"');
  });

  it("defaults an input to text, since every one of ours is", () => {
    expect(markup(<Input />)).toContain('type="text"');
    expect(markup(<Input type="number" />)).toContain('type="number"');
  });

  it("puts the checkbox before its words, which is the one field that reads that way", () => {
    expect(markup(<Checkbox label="Published" />)).toMatch(/<input[^>]*>\s*<span>Published<\/span>/);
  });
});

describe("Meter", () => {
  it("is the fraction that is left, as a width and as a number a reader can hear", () => {
    const meter = markup(<Meter value={2} max={3} valueText="2 of 3 reposts left" />);

    expect(meter).toContain('role="progressbar"');
    expect(meter).toContain('aria-valuenow="2"');
    expect(meter).toContain('aria-valuetext="2 of 3 reposts left"');
    expect(meter).toContain("width:66.66666666666666%");
  });

  it("turns colour on the fraction rather than on being told", () => {
    // A caller deciding this is a caller that gets it right on one screen and
    // wrong on the next.
    expect(markup(<Meter value={2} max={3} />)).not.toContain("mp-meter--");
    expect(markup(<Meter value={1} max={8} />)).toContain("mp-meter--warn");
    expect(markup(<Meter value={0} max={3} />)).toContain("mp-meter--err");
  });

  it("is empty rather than full when there is no quota at all", () => {
    // A tier with a quota of zero is how "no free tier" is expressed (T53, #84),
    // and 0/0 must not read as a full bar.
    expect(markup(<Meter value={0} max={0} />)).toContain("width:0%");
  });

  it("cannot overflow its own bar", () => {
    expect(markup(<Meter value={9} max={3} />)).toContain("width:100%");
  });
});
