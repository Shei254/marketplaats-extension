// @vitest-environment happy-dom
import type { AdminTier } from "@mprelist/contracts";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminApp } from "./AdminApp";
import { DEFAULT_ADMIN_CONFIG } from "./admin-config";
import type { Http } from "./discovery";
import { discoveryDocument, inMemoryStorage, json, tokenFor } from "./testing";

/**
 * The admin corner, driven the way an operator drives it: rendered into a real
 * document, clicked, and read back.
 *
 * Every browser thing this component touches arrives as a prop — the query, the
 * storage, `fetch`, and the two kinds of navigation — so what is asserted below
 * includes the two routes that end in the page being navigated away from, which
 * nothing could test if it called `location.assign` itself.
 *
 * No testing library: React's own `act` and `createRoot` over happy-dom, the same
 * arrangement the popup's suite has.
 */
const PRO: AdminTier = {
  tier: { code: "pro", name: "Pro" },
  relistQuotaPerPeriod: 50,
  features: {},
  published: true,
  isDefault: false,
  prices: [{ stripePriceId: "price_pro", interval: "month" }],
  subscribers: 0,
  payingSubscribers: 0,
};

const FREE: AdminTier = {
  tier: { code: "free", name: "Free" },
  relistQuotaPerPeriod: 3,
  features: {},
  published: false,
  isDefault: true,
  prices: [],
  // The default tier, with people on it and nobody paying — every free tier (T77).
  subscribers: 12,
  payingSubscribers: 0,
};

const DRAFT: AdminTier = {
  tier: { code: "starter", name: "starter" },
  relistQuotaPerPeriod: 0,
  features: {},
  published: false,
  isDefault: false,
  prices: [{ stripePriceId: "price_starter", interval: "month" }],
  subscribers: 0,
  payingSubscribers: 0,
};

/** A tier with no repost cap (T73, ADR-0029) — the third thing a quota can say. */
const UNLIMITED: AdminTier = {
  tier: { code: "power", name: "Power" },
  relistQuotaPerPeriod: null,
  features: {},
  published: true,
  isDefault: false,
  prices: [{ stripePriceId: "price_power", interval: "month" }],
  subscribers: 0,
  payingSubscribers: 0,
};

/** A Price in Stripe carrying no `tier_code`, which is what the second page lists. */
const UNTAGGED = {
  id: "price_loose",
  nickname: null,
  amount: 1200,
  currency: "eur",
  interval: null,
};

interface Backend {
  /** Roles the exchanged token carries; `null` means the code exchange fails. */
  roles?: string[] | null;
  tiers?: () => Response;
  prices?: () => Response;
  write?: () => Response;
  order?: () => Response;
  remove?: () => Response;
  currency?: () => Response;
  create?: () => Response;
  addPrice?: () => Response;
}

function stack(backend: Backend = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (url.includes("/.well-known/")) return json(discoveryDocument(DEFAULT_ADMIN_CONFIG.issuer));
    if (url.includes("/protocol/openid-connect/token")) {
      return backend.roles === null
        ? json({ error_description: "Code not valid" }, 400)
        : json({ access_token: tokenFor(backend.roles ?? ["ADMIN"]) });
    }
    if (url.endsWith("/api/admin/tiers")) return (backend.tiers ?? (() => json({ tiers: [FREE, PRO] })))();
    if ((init?.method ?? "GET") === "DELETE") {
      return (backend.remove ?? (() => json({ tiers: [FREE] })))();
    }
    if (url.endsWith("/api/admin/tiers/order")) {
      return (backend.order ?? (() => json({ tiers: [PRO, FREE] })))();
    }
    if (url.endsWith("/api/admin/prices")) return (backend.prices ?? (() => json({ prices: [] })))();
    if (url.endsWith("/api/admin/currency")) {
      return (backend.currency ?? (() => json({ currency: "eur" })))();
    }
    if (url.endsWith("/api/admin/plans")) return (backend.create ?? (() => json(PRO, 201)))();
    if (url.endsWith("/prices") && (init?.method ?? "GET") === "POST") {
      return (backend.addPrice ?? (() => json(PRO)))();
    }
    return (backend.write ?? (() => json(PRO)))();
  };
  const navigated: string[] = [];
  const replaced: string[] = [];
  return { http, calls, navigated, replaced, storage: inMemoryStorage() };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const text = (): string => container.querySelector(".admin-page")?.textContent ?? "";

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label} — screen reads: ${text()}`);
  return found;
}

const click = (label: string): Promise<void> => act(async () => button(label).click());

/**
 * The same click, but in the row for one tier.
 *
 * Every row carries the same buttons, so `click("Prices")` reaches whichever row is
 * first — which is a test that passes while pointing at something else. This says
 * which plan it means.
 */
function clickInRowFor(code: string, label: string): Promise<void> {
  const row = [...container.querySelectorAll("tbody tr")].find(
    (candidate) => candidate.querySelector(".admin-code")?.textContent?.trim() === code,
  );
  if (!row) throw new Error(`no row for ${code} — screen reads: ${text()}`);
  const found = [...row.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no ${label} button in the ${code} row`);
  return act(async () => found.click());
}

/**
 * Wait for something to have happened, rather than for a number of ticks.
 *
 * The handlers behind these buttons await a discovery fetch and a crypto digest
 * before they navigate, so "flush one microtask" is a guess — and a guess that
 * passed on its own and failed in a full run, which is the flake this replaces.
 * Polling a condition is the same wait expressed as what it is actually waiting
 * for, and it fails with a sentence rather than with `undefined`.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resume) => setTimeout(resume, 0));
    });
  }
  throw new Error(`timed out waiting for ${what} — screen reads: ${text()}`);
}


/**
 * Type into a controlled input the way a person does.
 *
 * React tracks the last value it wrote on the node itself, so assigning `.value`
 * and firing `input` is a change React decides has not happened. Going through the
 * prototype's own setter is what clears that tracker — the standard workaround,
 * and the reason this is a helper rather than three copies.
 */
async function type(selector: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`no field at ${selector}`);
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set?.call(field, value);
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })));
}

/** Tick or untick a checkbox the way a person does — by clicking the box itself. */
async function check(selector: string): Promise<void> {
  const box = container.querySelector<HTMLInputElement>(selector);
  if (!box) throw new Error(`no checkbox at ${selector} — screen reads: ${text()}`);
  await act(async () => box.click());
}

/** The codes down the table, top to bottom — the Catalog order as the screen has it. */
function codesOnScreen(): string[] {
  return [...container.querySelectorAll("tbody .admin-code")].map(
    (cell) => cell.textContent?.trim() ?? "",
  );
}

/**
 * Step a row with the keyboard-reachable half of the ordering control (T75, #164).
 *
 * The drag half cannot be driven from here at all: `happy-dom` ships no
 * `DragEvent` and `getBoundingClientRect` answers zeros, which is why ADR-0030
 * makes `docs/click-through.md` the only cover the drop has. These buttons are the
 * same act through the same function, so what they prove about the arithmetic
 * holds for both.
 */
function move(name: string, direction: "up" | "down"): Promise<void> {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Move ${name} ${direction}"]`,
  );
  if (!found) throw new Error(`no ${direction} button for ${name} — screen reads: ${text()}`);
  return act(async () => found.click());
}

/** The sequence the screen sent to `PUT /api/admin/tiers/order`. */
function sentOrder(s: ReturnType<typeof stack>): string[] {
  const sent = s.calls.find((call) => call.url.endsWith("/api/admin/tiers/order"));
  return (JSON.parse(sent?.body ?? "{}") as { codes?: string[] }).codes ?? [];
}

/** The body of the one `PUT /api/admin/tiers/...` this screen sent. */
function sentEdit(s: ReturnType<typeof stack>): Record<string, unknown> {
  return JSON.parse(s.calls.find((call) => call.method === "PUT")?.body ?? "{}") as Record<
    string,
    unknown
  >;
}

/** The body of the one `POST /api/admin/plans` this screen sent. */
function sentPlan(s: ReturnType<typeof stack>): Record<string, unknown> {
  return JSON.parse(
    s.calls.find((call) => call.url.endsWith("/api/admin/plans"))?.body ?? "{}",
  ) as Record<string, unknown>;
}

/** Arrive as if Keycloak had just redirected back, which is where a sign-in lands. */
async function arrive(
  s: ReturnType<typeof stack>,
  options: { search?: string; path?: string } = {},
): Promise<string> {
  // The state has to be one this tab sent, so the flow is started for real first.
  let sentTo = "";
  const { beginSignIn } = await import("./admin-session");
  await beginSignIn(DEFAULT_ADMIN_CONFIG, s.http, s.storage, (url) => void (sentTo = url), "/admin");
  const state = new URL(sentTo).searchParams.get("state") ?? "";
  const search = options.search ?? `?code=a-code&state=${state}`;
  await act(async () => {
    root.render(
      <AdminApp
        http={s.http}
        storage={s.storage}
        search={search}
        path={options.path ?? "/admin"}
        navigate={(url) => void s.navigated.push(url)}
        replaceUrl={(url) => void s.replaced.push(url)}
      />,
    );
  });
  return search;
}

describe("arriving at /admin signed out", () => {
  it("takes the operator to Keycloak without asking them to click anything", async () => {
    // There is no sign-in button: arriving here *is* the request to sign in.
    const s = stack();

    await act(async () => {
      root.render(
        <AdminApp
          http={s.http}
          storage={s.storage}
          search=""
          path="/admin"
          navigate={(url) => void s.navigated.push(url)}
          replaceUrl={(url) => void s.replaced.push(url)}
        />,
      );
    });
    await until(() => s.navigated.length > 0, "the sign-in to reach the realm");

    expect(s.navigated[0]).toContain("/protocol/openid-connect/auth");
    expect(text()).toContain("Taking you to sign in");
  });
});

describe("coming back as an operator", () => {
  it("shows the catalog", async () => {
    const s = stack();

    await arrive(s);

    expect(text()).toContain("Tiers");
    expect(text()).toContain("pro");
    expect(text()).toContain("free");
  });

  it("and rewrites the address bar, which still says the redirect URI", async () => {
    // Rewritten rather than navigated: a navigation reloads the page and throws
    // away the token this tab is now holding.
    const s = stack();

    await arrive(s);

    expect(s.replaced).toEqual(["/admin"]);
  });

  it("and lists every tier, including the drafts and the free one", async () => {
    // The two `GET /api/plans` hides. An operator who could not see a draft could
    // not act on the one thing this screen exists for.
    const s = stack({ tiers: () => json({ tiers: [FREE, DRAFT, PRO] }) });

    await arrive(s);

    expect(text()).toContain("starter");
    expect(container.querySelector('tr[data-draft="true"]')).not.toBeNull();
  });

  it("and says which one new accounts start on, and which are on sale", async () => {
    const s = stack();

    await arrive(s);

    expect(text()).toContain("default");
    expect(text()).toContain("on sale");
  });

  it("and shows the Stripe price id as a fact rather than a field", async () => {
    const s = stack();

    await arrive(s);

    expect(text()).toContain("price_pro");
    expect(container.querySelector('input[value="price_pro"]')).toBeNull();
  });

  it("but never an amount, so the catalog stays editable while Stripe is down", async () => {
    const s = stack({ prices: () => new Response(null, { status: 503 }) });

    await arrive(s);

    expect(text()).toContain("Tiers");
    expect(text()).toContain("price_pro");
    // And the one list that *is* Stripe's says so rather than showing nothing,
    // which would read as "every Price is tagged" at the moment nobody can check.
    expect(text()).toContain("Stripe could not be asked");
  });
});

describe("under StrictMode, which runs every effect twice", () => {
  it("exchanges the one-time code exactly once", async () => {
    // React double-invokes effects in development, which this environment does too
    // — so without a guard the arrival runs twice and the second run exchanges a
    // code Keycloak has already spent. **Asserted as the count rather than as the
    // screen**, because the screen cannot see it: the second run fails fast (no
    // network) and resolves *first*, so the good result overwrites it and a test
    // that only read the screen would pass with the bug in place. `main.tsx` does
    // not use StrictMode today; this is what makes adding it safe.
    const s = stack();
    let sentTo = "";
    const { beginSignIn } = await import("./admin-session");
    await beginSignIn(DEFAULT_ADMIN_CONFIG, s.http, s.storage, (url) => void (sentTo = url), "/admin");
    const state = new URL(sentTo).searchParams.get("state") ?? "";

    await act(async () => {
      root.render(
        <StrictMode>
          <AdminApp
            http={s.http}
            storage={s.storage}
            search={`?code=a-code&state=${state}`}
            path="/admin"
            navigate={(url) => void s.navigated.push(url)}
            replaceUrl={(url) => void s.replaced.push(url)}
          />
        </StrictMode>,
      );
    });

    const exchanges = s.calls.filter(
      (call) => call.url.includes("/protocol/openid-connect/token") && call.method === "POST",
    );
    expect(exchanges).toHaveLength(1);
    expect(text()).toContain("Tiers");
  });

  it("and starts exactly one sign-in on a fresh visit", async () => {
    // The sharper half. Two runs would mint two verifiers into one storage key, so
    // the second overwrites the first — and whichever navigation the browser
    // actually follows carries a challenge for a verifier that is no longer there.
    // The sign-in then fails at the token endpoint, minutes later, with a message
    // about neither.
    const s = stack();

    await act(async () => {
      root.render(
        <StrictMode>
          <AdminApp
            http={s.http}
            storage={s.storage}
            search=""
            path="/admin"
            navigate={(url) => void s.navigated.push(url)}
            replaceUrl={(url) => void s.replaced.push(url)}
          />
        </StrictMode>,
      );
    });
    await until(() => s.navigated.length > 0, "the sign-in to reach the realm");

    expect(s.navigated).toHaveLength(1);
    // And the challenge it carries is for the verifier that is actually stored.
    const stored = JSON.parse(s.storage.getItem("mprelist.admin.sign-in") ?? "{}") as { state: string };
    expect(new URL(s.navigated[0] ?? "").searchParams.get("state")).toBe(stored.state);
  });
});

describe("re-rendering the shell", () => {
  it("does not re-ask the API for anything", async () => {
    // The catalog is loaded in an effect keyed on the API client, so a client
    // rebuilt on every render is a fetch on every render — a bug that shows up as a
    // backend log full of identical requests rather than as anything on screen.
    // Today `AdminApp` happens to hold no state that changes while somebody is
    // browsing; the day it does, this is what says so.
    const s = stack();
    const search = await arrive(s);
    const asked = s.calls.filter((call) => call.url.endsWith("/api/admin/tiers")).length;

    // The same props, through fresh inline callbacks — which is what every real
    // caller passes, and what used to make the arrival effect run a second time.
    await act(async () => {
      root.render(
        <AdminApp
          http={s.http}
          storage={s.storage}
          search={search}
          path="/admin"
          navigate={(url) => void s.navigated.push(url)}
          replaceUrl={(url) => void s.replaced.push(url)}
        />,
      );
    });

    expect(s.calls.filter((call) => call.url.endsWith("/api/admin/tiers"))).toHaveLength(asked);
  });
});

describe("coming back as somebody else", () => {
  it("says so rather than showing an empty catalog", async () => {
    // The API would refuse every call with a `403`; a screen that did not check
    // would be a table of nothing and a console full of them.
    const s = stack({ roles: [] });

    await arrive(s);

    expect(text()).toContain("Not your corner");
    expect(text()).toContain("ADMIN");
  });

  it("and offers the only thing that helps, which is being somebody else", async () => {
    // Not a retry: signing in again returns the same person. Without this the
    // click-through's step 2 is a trap with no way out.
    const s = stack({ roles: ["SUPPORT"] });

    await arrive(s);
    await click("Sign in as somebody else");
    await until(() => s.navigated.length > 0, "the sign-out to reach the realm");

    expect(s.navigated.at(-1)).toContain("/protocol/openid-connect/logout");
  });

  it("and asks nothing of the admin API on the way", async () => {
    const s = stack({ roles: [] });

    await arrive(s);

    expect(s.calls.some((call) => call.url.includes("/api/admin/"))).toBe(false);
  });
});

describe("when the sign-in itself fails", () => {
  it("says what the realm said, and offers to try again", async () => {
    const s = stack({ roles: null });

    await arrive(s);

    expect(text()).toContain("Sign-in didn’t work");
    expect(text()).toContain("Code not valid");
    await click("Try again");
    await until(() => s.navigated.length > 0, "the retry to reach the realm");
    expect(s.navigated.at(-1)).toContain("/protocol/openid-connect/auth");
  });

  it("and passes on Keycloak's own refusal, which names what is misconfigured", async () => {
    const s = stack();

    await arrive(s, {
      search: "?error=invalid_redirect_uri&error_description=Invalid+parameter%3A+redirect_uri",
    });

    expect(text()).toContain("Invalid parameter: redirect_uri");
  });
});

describe("editing a tier", () => {
  it("opens a form holding what the row says", async () => {
    const s = stack();

    await arrive(s);
    await click("Edit");

    expect(container.querySelector<HTMLInputElement>("#tier-name")?.value).toBe("Free");
    expect(container.querySelector<HTMLInputElement>("#tier-quota")?.value).toBe("3");
  });

  it("and sends every editable field, because the API's PUT is total", async () => {
    const s = stack();

    await arrive(s);
    await click("Edit");
    await type("#tier-quota", "0");
    await click("Save");
    await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

    const put = s.calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("http://localhost:8080/api/admin/tiers/free");
    const sent = JSON.parse(put?.body ?? "{}") as Record<string, unknown>;
    // Quota 0 on the default tier is how ADR-0019 says "there is no free tier".
    expect(sent["relistQuotaPerPeriod"]).toBe(0);
    // `code` among them since T76 (ADR-0031): a whole `PUT` says "not moving it" by
    // sending back the code it was given, which is what this row does.
    expect(Object.keys(sent).sort()).toEqual([
      "code",
      "features",
      "name",
      "published",
      "relistQuotaPerPeriod",
    ]);
    expect(sent["code"]).toBe("free");
  });

  it("refuses a blank quota rather than reading it as zero", async () => {
    // `Number("") === 0`, so a cleared field used to submit a tier granting
    // nothing, silently — and on the default tier that is "there is no free tier"
    // (ADR-0019) applied by accident.
    const s = stack();

    await arrive(s);
    await click("Edit");
    await type("#tier-quota", "");
    await click("Save");

    // The whole sentence, not just the field name: this is the one string on the
    // screen only ever read by somebody who has already got something wrong, and
    // the worst moment to meet a second word for the field they are looking at
    // (T74, #161).
    expect(text()).toContain("Reposts per period has to be");
    expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  describe("and giving it no cap at all (T73, ADR-0029)", () => {
    it("shows the row as unlimited rather than as a blank or a zero", async () => {
      const s = stack({ tiers: () => json({ tiers: [FREE, UNLIMITED] }) });

      await arrive(s);

      expect(text()).toContain("Unlimited");
    });

    it("sends an explicit null, which is the only thing that means unlimited", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-unlimited");
      await click("Save");
      await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

      // Present and null — absent is a `400`, which is the distinction the whole
      // write side of ADR-0029 rests on.
      const sent = sentEdit(s);
      expect(sent["relistQuotaPerPeriod"]).toBeNull();
      expect(Object.keys(sent).sort()).toEqual([
        "code",
        "features",
        "name",
        "published",
        "relistQuotaPerPeriod",
      ]);
    });

    it("and greys the number, because there is no longer a number to type", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-unlimited");

      expect(container.querySelector<HTMLInputElement>("#tier-quota")?.disabled).toBe(true);
    });

    it("warns about the reach when it is the tier every new account lands on", async () => {
      // Every new account and every subscription that ends (ADR-0018). It warns
      // rather than refuses: a self-hosted single-user deployment *is* this.
      const s = stack();

      await arrive(s);
      await click("Edit");
      await check("#tier-unlimited");

      expect(text()).toContain("every new account");
    });

    it("and says nothing of the sort on a tier nobody is provisioned onto", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-unlimited");

      expect(text()).not.toContain("every new account");
    });
  });

  describe("and zeroing one that is on sale (T73, ADR-0029)", () => {
    it("says the plan will be withdrawn rather than letting the API refuse it", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await type("#tier-quota", "0");

      expect(text()).toContain("take Pro off sale");
    });

    it("and withdraws it in the same submit, because a PUT is whole", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await type("#tier-quota", "0");
      await click("Save");
      await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

      // Said here rather than sent to an API that would refuse it, which is
      // `NewPlanForm`'s existing habit: a round trip to be told what is already
      // visible on this form.
      expect(sentEdit(s)["relistQuotaPerPeriod"]).toBe(0);
      expect(sentEdit(s)["published"]).toBe(false);
    });
  });

  describe("and putting one that grants nothing on sale (T73, ADR-0029)", () => {
    // The same rule met from the other side, and the commoner route: a draft is
    // quota 0 by definition (ADR-0019), so ticking On sale on one is how an
    // operator most often asks for a thing the API refuses.
    it("warns before the save, rather than unticking the box behind them", async () => {
      const s = stack({ tiers: () => json({ tiers: [DRAFT] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-published");

      expect(text()).toContain("not put starter on sale");
    });

    it("and says it in the tense of what has not happened yet", async () => {
      // The withdrawal sentence would be a lie here: nothing is being taken off
      // sale, because it was never on it.
      const s = stack({ tiers: () => json({ tiers: [DRAFT] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-published");

      expect(text()).not.toContain("off sale");
    });

    it("and the save still leaves it off sale, which is what the warning said", async () => {
      const s = stack({ tiers: () => json({ tiers: [DRAFT] }) });

      await arrive(s);
      await click("Edit");
      await check("#tier-published");
      await click("Save");
      await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

      expect(sentEdit(s)["published"]).toBe(false);
    });
  });

  it("says why a tier with no Price cannot go on sale, before the save rather than after", async () => {
    // The way out is Stripe's, so a form that only reported the `409` would send
    // an operator to look in the wrong place.
    const s = stack();

    await arrive(s);
    await click("Edit");

    expect(text()).toContain("metadata.tier_code = free");
  });

  it("and reports the API's refusal when it comes anyway", async () => {
    const s = stack({ write: () => new Response(null, { status: 409 }) });

    await arrive(s);
    await click("Edit");
    await click("Save");
    await until(() => text().includes("cannot hold that tier"), "the API's refusal to be reported");

    // One status for four facts since ADR-0031, and the form names all four: the
    // API sends no `reason`, and the recovery is the same for every one of them.
    expect(text()).toContain("no Stripe Price");
    expect(text()).toContain("a Price has frozen");
  });

  /**
   * The free tier is the one with no Stripe Price (T76, ADR-0031), and the code is
   * the field an operator could not set until now. `FREE` is priceless here, which
   * is what makes it the row these are about — nothing is flagged.
   */
  describe("and renaming the one tier no Price has frozen (T76, ADR-0031)", () => {
    it("files it under the new name, because nothing holds a second copy of the code", async () => {
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Gratis");
      await click("Save");
      await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

      // Addressed by where it is, and filed under where it is going.
      expect(sentEdit(s)["code"]).toBe("gratis");
      expect(s.calls.find((call) => call.method === "PUT")?.url).toContain("/tiers/free");
    });

    it("prints the code while it is being typed, because the rename is not cosmetic here", async () => {
      // Derived is not the same as secret, and it is least secret in the moment it
      // changes: this is the one row where a label edit moves `/api/me`'s payload.
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Zakelijk Groeiën");

      expect(text()).toContain("zakelijk-groeien");
    });

    it("and says what moving it does, rather than letting it happen quietly", async () => {
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Gratis");

      expect(text()).toContain("Nobody moves");
    });

    it("refuses a name another tier is already filed under, without a round trip", async () => {
      // "Pro" derives `pro`, which the catalog holds. Said here because the screen
      // is holding every tier and the API's `409` carries no `reason` to tell the
      // four things it means apart.
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Pro");
      await click("Save");

      expect(text()).toContain("Pro already uses");
      expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
    });

    it("refuses the one name whose code this screen could never open again", async () => {
      // `PUT /api/admin/tiers/order` is the Catalog order's route and Spring prefers
      // the literal, so a tier filed under `order` is uneditable — including to undo
      // it. Unreachable until a *name* could derive a code.
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Order");
      await click("Save");

      expect(text()).toContain("could never open again");
      expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
    });

    it("refuses a name with nothing in it to make a code from", async () => {
      const s = stack();

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "!!!");
      await click("Save");

      expect(text()).toContain("a letter or a digit");
      expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
    });

    it("but leaves the code alone on a tier a Price has frozen, and sends it back unchanged", async () => {
      // Stripe holds the code as `metadata.tier_code` and the sync finds the tier by
      // it, so renaming underneath would split one tier in two on the next
      // `price.updated`. `PRO` has a price; the field is display text again.
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");
      await type("#tier-name", "Pro Plus");
      await click("Save");
      await until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

      expect(sentEdit(s)["code"]).toBe("pro");
      expect(sentEdit(s)["name"]).toBe("Pro Plus");
    });

    it("and says so on the row, rather than leaving the operator to find out", async () => {
      const s = stack({ tiers: () => json({ tiers: [PRO] }) });

      await arrive(s);
      await click("Edit");

      expect(text()).toContain("it stays there");
    });
  });

  it("refuses flags that are not a JSON object, rather than sending them", async () => {
    const s = stack();

    await arrive(s);
    await click("Edit");
    await click(OPEN_HATCH);
    await type("#tier-features", "not json");
    await click("Save");

    expect(text()).toContain("JSON object");
    expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
  });
});

/**
 * The cap an operator types (T69, #153; ADR-0026).
 *
 * **One invariant under all of it: the number field owns the value only when it can
 * represent the whole truth.** The auto-expand, the disabled box and the refused
 * collapse are three readings of that rather than three behaviours — which is why
 * they are asserted together, and why the case that matters most is a tier storing
 * something the number cannot say. Without the invariant, `{"bulk": true}` opens
 * showing an empty box and the next save revokes bulk for that tier's subscribers
 * with nothing on screen having said so.
 */
const OPEN_HATCH = "▾ Advanced · edit as JSON";
const CLOSE_HATCH = "▴ Advanced · done editing as JSON";

/** A tier selling a cap, which is the shape `V8__seed_bulk_entitlement.sql` writes. */
const CAPPED: AdminTier = { ...PRO, features: { bulk: { upTo: 10 } } };

/** A grant the popup and the API both honour and the number field cannot say. */
const UNSAYABLE: AdminTier = { ...FREE, features: { bulk: true } };

const bulkField = (): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>("#tier-bulk");

/** The `features` of the one `PUT` this screen sent. */
const sentFlags = (s: ReturnType<typeof stack>): unknown =>
  (JSON.parse(s.calls.find((call) => call.method === "PUT")?.body ?? "{}") as Record<string, unknown>)[
    "features"
  ];

const saved = (s: ReturnType<typeof stack>): Promise<void> =>
  until(() => s.calls.some((call) => call.method === "PUT"), "the save to reach the API");

describe("the bulk cap", () => {
  it("is a number the form holds, not JSON an operator writes", async () => {
    const s = stack({ tiers: () => json({ tiers: [FREE, CAPPED] }) });

    await arrive(s);
    await clickInRowFor("pro", "Edit");

    expect(bulkField()?.value).toBe("10");
    // The hatch is shut on a tier the field can say, which is the ordinary case.
    expect(container.querySelector("#tier-features")).toBeNull();
  });

  it("and goes out in the shape both readers read", async () => {
    const s = stack({ tiers: () => json({ tiers: [FREE, CAPPED] }) });

    await arrive(s);
    await clickInRowFor("pro", "Edit");
    await type("#tier-bulk", "4");
    await click("Save");
    await saved(s);

    expect(sentFlags(s)).toEqual({ bulk: { upTo: 4 } });
  });

  // Not a deleted key: `V8__seed_bulk_entitlement.sql` writes only where the key is
  // absent and claims of itself that the admin edit is the durable way to take bulk
  // off a tier. A delete falsifies that on any restored dump, in a file Flyway's
  // checksum forbids correcting.
  it("emptied, it writes `false` and leaves the key where the seed can see it", async () => {
    const s = stack({ tiers: () => json({ tiers: [FREE, CAPPED] }) });

    await arrive(s);
    await clickInRowFor("pro", "Edit");
    await type("#tier-bulk", "");
    await click("Save");
    await saved(s);

    expect(sentFlags(s)).toEqual({ bulk: false });
  });

  // The one value that looks like the off switch and is its inverse: `bulkIn` reads
  // a cap only from a whole number above zero, so `{"upTo": 0}` is *granted, capped
  // by the quota alone*.
  it("refuses 0, and says which way round it would have been read", async () => {
    const s = stack({ tiers: () => json({ tiers: [FREE, CAPPED] }) });

    await arrive(s);
    await clickInRowFor("pro", "Edit");
    await type("#tier-bulk", "0");
    await click("Save");

    expect(text()).toContain("0 is not");
    expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("hands the value to the hatch when it opens, and takes the number out of play", async () => {
    // A mode, not a mirror: exactly one control owns the value at a time, so the
    // box is disabled rather than left showing a number nothing would save.
    const s = stack();

    await arrive(s);
    await click("Edit");
    await click(OPEN_HATCH);

    expect(bulkField()?.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>("#tier-features")?.value).toBe(
      JSON.stringify({ bulk: false }, null, 2),
    );
  });

  it("opens on the hatch for flags the number cannot say", async () => {
    const s = stack({ tiers: () => json({ tiers: [UNSAYABLE, PRO] }) });

    await arrive(s);
    await click("Edit");

    expect(container.querySelector<HTMLTextAreaElement>("#tier-features")?.value).toContain("true");
    expect(bulkField()?.disabled).toBe(true);
  });

  it("and will not close while they still say more than a cap", async () => {
    const s = stack({ tiers: () => json({ tiers: [UNSAYABLE, PRO] }) });

    await arrive(s);
    await click("Edit");
    await click(CLOSE_HATCH);

    // A disclosure that declines to close has to read as an explanation rather than
    // as a broken control, so the refusal names what the field can hold.
    expect(text()).toContain("stays open");
    expect(container.querySelector("#tier-features")).not.toBeNull();

    await type("#tier-features", '{"bulk": {"upTo": 5}}');
    await click(CLOSE_HATCH);

    expect(container.querySelector("#tier-features")).toBeNull();
    expect(bulkField()?.value).toBe("5");
  });

  it("is set where a plan is created, so a cap is not a second act", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await type("#plan-quota", "10");
    await type("#plan-bulk", "3");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["features"]).toEqual({ bulk: { upTo: 3 } });
  });
});

describe("moving the default", () => {
  it("is offered on every tier that is not already it", async () => {
    // A move, never a toggle: there is no control that could leave the catalog
    // without a default, because the API offers no request that would.
    const s = stack();

    await arrive(s);

    expect([...container.querySelectorAll("button")].filter(
      (candidate) => candidate.textContent?.trim() === "Make default",
    )).toHaveLength(1);
  });

  it("and puts nothing, because there is nothing to say", async () => {
    const s = stack({ write: () => json({ ...PRO, isDefault: true }) });

    await arrive(s);
    await click("Make default");
    await until(() => s.calls.some((call) => call.method === "PUT"), "the move to reach the API");

    const put = s.calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("http://localhost:8080/api/admin/tiers/pro/default");
    expect(put?.body).toBeUndefined();
  });
});

describe("deleting a tier", () => {
  it("is offered on every row, including the default one and the last one", async () => {
    // Every tier is deletable (T77, ADR-0032). The narrower designs — refuse the
    // default, soft-delete behind a flag — are rejected in the ADR on the same
    // point: they make an operator's own catalog something the data model has an
    // opinion about.
    const s = stack();

    await arrive(s);

    expect([...container.querySelectorAll("button")].filter(
      (candidate) => candidate.textContent?.trim() === "Delete",
    )).toHaveLength(2);
  });

  it("always says what it is about to cost before it does anything", async () => {
    // "A quantified warning always" (ADR-0032). The panel is never skipped, because
    // an operator should not learn what a delete costs by having already done it.
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Delete");

    expect(text()).toContain("Deleting Pro");
    expect(s.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("and goes on one click where nobody is on the tier and nobody pays for it", async () => {
    // A draft the sync invented, or a plan created thirty seconds ago — the friction
    // T61 existed to remove. The panel says there is nothing to lose and asks for
    // nothing: the escalation is the typed name, and it is not owed here.
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Delete");

    expect(text()).toContain("Nobody is on this tier");
    expect(button("Delete Pro").disabled).toBe(false);

    await click("Delete Pro");
    await until(() => s.calls.some((call) => call.method === "DELETE"), "the delete to reach the API");

    expect(s.calls.find((call) => call.method === "DELETE")?.url).toBe(
      "http://localhost:8080/api/admin/tiers/pro",
    );
  });

  it("and says where subscribers move, and how many", async () => {
    // Quantified rather than generic: "are you sure?" is a sentence somebody clicks
    // through, and "12 subscribers move to Free" is one they read. FREE has twelve
    // people on it and nobody paying.
    const s = stack();

    await arrive(s);
    await clickInRowFor("free", "Delete");

    expect(text()).toContain("Deleting Free");
    expect(text()).toContain("12 subscribers");
    expect(s.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("and says that this one is the default, so new accounts land on nothing", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("free", "Delete");

    expect(text()).toContain("This is the default tier");
  });

  it("and names where they land, read off the catalog rather than described as a rule", async () => {
    // The API moves them to whichever tier holds the flag, and this screen is
    // holding every row — so it can say the name instead of the rule.
    const s = stack({ tiers: () => json({ tiers: [{ ...FREE, isDefault: true }, { ...PRO, subscribers: 4 }] }) });

    await arrive(s);
    await clickInRowFor("pro", "Delete");

    expect(text()).toContain("4 subscribers move to Free");
  });

  it("and warns loudest when there is nowhere for them to land", async () => {
    // The state `NO_TIER` exists to describe: those accounts are on no plan until an
    // operator makes a tier the default, at which point every one of them is adopted.
    const s = stack({ tiers: () => json({ tiers: [{ ...PRO, isDefault: true, subscribers: 4 }] }) });

    await arrive(s);
    await clickInRowFor("pro", "Delete");

    expect(text()).toContain("left on no tier at all");
    expect(text()).toContain("This is the last tier in the catalog");
  });

  it("asks for the tier's name only when live payers will be cancelled", async () => {
    // Friction tracking consequence. This is the one outcome here that costs
    // somebody money and cannot be undone from this screen.
    const s = stack({
      tiers: () => json({ tiers: [FREE, { ...PRO, subscribers: 9, payingSubscribers: 3 }] }),
    });

    await arrive(s);
    await clickInRowFor("pro", "Delete");

    expect(text()).toContain("3 live Stripe subscriptions will be cancelled");
    expect(button("Delete Pro").disabled).toBe(true);
    expect(s.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("and lets it through once the name matches", async () => {
    const s = stack({
      tiers: () => json({ tiers: [FREE, { ...PRO, subscribers: 9, payingSubscribers: 3 }] }),
    });

    await arrive(s);
    await clickInRowFor("pro", "Delete");
    await type(".admin-form input", "Pro");
    await click("Delete Pro");
    await until(() => s.calls.some((call) => call.method === "DELETE"), "the delete to reach the API");

    expect(s.calls.find((call) => call.method === "DELETE")?.url).toBe(
      "http://localhost:8080/api/admin/tiers/pro",
    );
  });

  it("draws an emptied catalog as the state it is, rather than as a blank table", async () => {
    // An empty catalog is reachable on purpose and is an outage for every user, so
    // the screen says so — and says the way out, which is New plan rather than undo.
    const s = stack({ tiers: () => json({ tiers: [PRO] }), remove: () => json({ tiers: [] }) });

    await arrive(s);
    await clickInRowFor("pro", "Delete");
    await click("Delete Pro");
    await until(() => text().includes("There are no tiers"), "the empty catalog to be drawn");

    expect(text()).toContain("nobody can repost");
  });

  it("and says out loud when a delete left the catalog with no default", async () => {
    // The one outcome worth naming after the fact: everybody on that tier, and every
    // new account, is on no plan until a tier is made the default.
    const s = stack({
      tiers: () => json({ tiers: [{ ...FREE, isDefault: true }, PRO] }),
      remove: () => json({ tiers: [{ ...PRO, isDefault: false }] }),
    });

    await arrive(s);
    await clickInRowFor("free", "Delete");
    await click("Delete Free");
    await until(() => text().includes("no default tier"), "the note to say what happened");

    expect(text()).toContain("make one the default");
  });

  it("reloads on a 404, because the catalog this tab holds is wrong about more than the row", async () => {
    const s = stack({ remove: () => new Response(null, { status: 404 }) });

    await arrive(s);
    await clickInRowFor("pro", "Delete");
    await click("Delete Pro");
    await until(() => text().includes("deleted somewhere else"), "the refusal to be said");

    expect(text()).toContain("reloaded");
  });
});

describe("the order the plans are read in", () => {
  it("moves the row and sends the whole catalog rather than one row's index", async () => {
    // A sequence, never a per-row number: moving a tier moves others, so the order
    // is a property of the catalog (T75, #164; ADR-0030).
    const s = stack();

    await arrive(s);
    await move("Pro", "up");
    await until(() => s.calls.some((call) => call.url.endsWith("/order")), "the order to reach the API");

    expect(sentOrder(s)).toEqual(["pro", "free"]);
  });

  it("and renders what was stored rather than what was asked for", async () => {
    // The row moved before the API was asked, which is what makes a drag feel
    // direct — and what makes the answer, not the gesture, the thing to end up on.
    const s = stack({ order: () => json({ tiers: [DRAFT, PRO, FREE] }) });

    await arrive(s);
    await move("Pro", "up");
    await until(() => codesOnScreen().length === 3, "the stored order to arrive");

    expect(codesOnScreen()).toEqual(["starter", "pro", "free"]);
  });

  it("puts the row back and says why when the write is refused", async () => {
    // `409` here is not the edit form's: it means the list sent was not the
    // catalog's set, so something arrived or left while this page was open.
    const s = stack({ order: () => new Response(null, { status: 409 }) });

    await arrive(s);
    expect(codesOnScreen()).toEqual(["free", "pro"]);

    await move("Pro", "up");
    await until(() => text().includes("changed while this page was open"), "the refusal to be said");

    expect(codesOnScreen()).toEqual(["free", "pro"]);
  });

  it("and reloads the catalog, because the useful next act is to look at it", async () => {
    const s = stack({ order: () => new Response(null, { status: 409 }) });

    await arrive(s);
    const read = s.calls.filter((call) => call.url.endsWith("/api/admin/tiers")).length;
    await move("Pro", "up");
    await until(
      () => s.calls.filter((call) => call.url.endsWith("/api/admin/tiers")).length > read,
      "the catalog to be read again",
    );
  });

  it("offers nowhere to move the first row up, or the last one down", async () => {
    const s = stack();

    await arrive(s);

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move Free up"]')?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move Pro down"]')?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move Free down"]')?.disabled,
    ).toBe(false);
  });

  it("names the tier on every one of them, so eleven of these are told apart", async () => {
    // "Move up" eleven times over is a screen reader saying nothing about which row
    // it is on.
    const s = stack({ tiers: () => json({ tiers: [FREE, PRO, UNLIMITED] }) });

    await arrive(s);

    for (const name of ["Free", "Pro", "Power"]) {
      expect(container.querySelector(`button[aria-label="Move ${name} up"]`), name).not.toBeNull();
    }
  });

  it("makes a row draggable only while its handle is held", async () => {
    // Every row draggable always would take text selection away from the whole
    // table — on the screen somebody copies a Stripe Price id out of a cell.
    const s = stack();

    await arrive(s);
    const row = container.querySelector("tbody tr");
    const grip = row?.querySelector(".admin-grip");
    expect(row?.getAttribute("draggable")).toBe("false");

    await act(async () => grip?.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(row?.getAttribute("draggable")).toBe("true");

    await act(async () => grip?.dispatchEvent(new Event("pointerup", { bubbles: true })));
    expect(row?.getAttribute("draggable")).toBe("false");
  });

  it("keeps the handle out of the accessibility tree, since the buttons are the same act", async () => {
    const s = stack();

    await arrive(s);

    expect(container.querySelector(".admin-grip")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("when the token runs out", () => {
  it("signs in again rather than showing an error", async () => {
    // There is no refresh token by design — nothing survives the page — so a `401`
    // is one redirect away from being fixed.
    const s = stack({ tiers: () => new Response(null, { status: 401 }) });

    await arrive(s);
    await until(() => s.navigated.length > 0, "the expired token to start a sign-in");

    expect(s.navigated.at(-1)).toContain("/protocol/openid-connect/auth");
  });
});

describe("creating a plan from the screen", () => {
  it("shows the one currency the catalog is priced in, and does not offer a choice", async () => {
    // Every tier, the same currency (T63, #129) — a plan screen is a comparison,
    // and €9,99 against $12.99 is not one a buyer can make. Since it is not a
    // choice it is not a field, which is what makes a mixed catalog unsayable
    // rather than merely refused.
    const s = stack();

    await arrive(s);
    await click("New plan");

    expect(text()).toContain("EUR");
    expect(text()).toContain("like every tier");
    expect(container.querySelector("#plan-currency")).toBeNull();
  });

  it("and sends the whole plan, created not on sale", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await type("#plan-quota", "10");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    const sent = sentPlan(s);
    // Nobody typed this: it is the name, filed (see `tier-code.ts`).
    expect(sent["tierCode"]).toBe("starter");
    expect(sent["prices"]).toEqual([{ amount: 500, interval: "month" }]);
    // No currency at all: the catalog has one (T63, #129) and no request names it.
    expect(sent["currency"]).toBeUndefined();
    // Not on sale: the operator checks what Stripe made, then publishes from the row.
    expect(sent["published"]).toBe(false);
  });

  /**
   * Both rhythms on the form that creates the plan (T66).
   *
   * Monthly and annual are one plan a buyer picks a rhythm for, and T62 (#128) had
   * already made a tier able to hold both — but the form wrote one, so the second
   * was a separate act an operator had to remember. In between, the plan card
   * offered no choice, which is the choice the buyer is actually making.
   */
  it("takes both rhythms at once, and sends them as one plan", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await type("#plan-amount-year", "50.00");
    await type("#plan-quota", "10");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["prices"]).toEqual([
      { amount: 500, interval: "month" },
      { amount: 5000, interval: "year" },
    ]);
  });

  /** Monthly first, because that is the order the popup reads a card in — cheapest first. */
  it("and sends the cheaper rhythm first even when the annual one was typed first", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-year", "50.00");
    await type("#plan-amount-month", "5.00");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["prices"]).toEqual([
      { amount: 500, interval: "month" },
      { amount: 5000, interval: "year" },
    ]);
  });

  it("refuses a blank quota rather than creating a plan that grants nothing", async () => {
    // The same `Number("") === 0` hole as the edit form's, at the second of its two
    // call sites — a plan created granting nothing is one nobody can be sold.
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await type("#plan-quota", "");
    await click("Create in Stripe");

    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  it("or creates one with no cap at all, as an explicit null", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await check("#plan-unlimited");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["relistQuotaPerPeriod"]).toBeNull();
  });

  it("and a plan sold only one way is still a plan", async () => {
    // Not every plan is worth an annual rhythm, and a form that insisted on one
    // would be inventing a price to satisfy itself.
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-year", "50.00");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["prices"]).toEqual([{ amount: 5000, interval: "year" }]);
  });

  it("but a plan priced at neither rhythm is refused without asking the API", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await click("Create in Stripe");

    expect(text()).toContain("what it costs");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  /**
   * Money is typed the way money is written (T66), and turned into Stripe's unit here.
   *
   * The field used to be labelled "Amount, in cents" and took `999`. That is the
   * wire format leaking onto a screen: an operator thinking in euros has to convert
   * in their head, every time, to write a number into a Price that can never be
   * edited afterwards.
   */
  it("takes an amount written the way money is, not in cents", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "9,99");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    expect(sentPlan(s)["prices"]).toEqual([{ amount: 999, interval: "month" }]);
  });

  it("and says so rather than rounding a price nobody typed", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "9.999");
    await click("Create in Stripe");

    expect(text()).toContain("2 decimal");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  /**
   * Two Prices are two Stripe calls with no transaction spanning them, so the plan
   * can land selling by the month with the annual one refused. Saying nothing would
   * leave an operator believing they had created something they had not.
   */
  it("says which rhythm did not land when Stripe made only one of the two", async () => {
    const s = stack({ create: () => json(PRO, 201) });

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Pro");
    await type("#plan-amount-month", "9.99");
    await type("#plan-amount-year", "99.00");
    await click("Create in Stripe");
    await until(() => text().includes("yearly"), "the missing rhythm to be reported");

    expect(text()).toContain("Stripe did not make the yearly price");
  });

  it("says the amount is written once, because Stripe Prices cannot be edited", async () => {
    // The thing ADR-0019 refused to let a form pretend about. Saying it here is the
    // difference between a constraint that is explained and one that is invisible.
    const s = stack();

    await arrive(s);
    await click("New plan");

    expect(text()).toContain("written once");
    expect(text()).toContain("metadata.tier_code");
  });

  it("passes on Stripe's refusal in Stripe's own words", async () => {
    const s = stack({
      create: () => json({ problem: "Amount must be at least 50 cents" }, 422),
    });

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "0.01");
    await click("Create in Stripe");
    await until(() => text().includes("at least 50 cents"), "Stripe's refusal to be shown");

    expect(text()).toContain("Amount must be at least 50 cents");
  });

  it("and names every reason the code could be refused, since the status tells them apart", async () => {
    // One `409`, three facts, no `reason` on the wire — the same bargain the edit
    // form's refusal makes. The third is T77's (ADR-0032) and is the only one that
    // clears on its own, which is why it is named rather than folded into "taken":
    // an operator told "pick another name" would rename a plan they could have had.
    const s = stack({ create: () => new Response(null, { status: 409 }) });

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Pro");
    await type("#plan-amount-month", "5.00");
    await click("Create in Stripe");
    await until(() => text().includes("cannot be filed"), "the clash to be reported");

    expect(text()).toContain("another tier already uses the code");
    expect(text()).toContain("still being removed from Stripe");
  });

  it("files a plan under a code made from its name, and shows it while it is typed", async () => {
    // The code used to be a second field beside the name — an identifier an
    // operator had to invent, and one that could disagree with the name it was a
    // copy of. Derived is not the same as secret: it is permanent and it turns up
    // in Stripe, so the form prints it.
    const s = stack();

    await arrive(s);
    await click("New plan");
    expect(container.querySelector("#plan-code")).toBeNull();

    await type("#plan-name", "Zakelijk Pró Plus");

    expect(text()).toContain("zakelijk-pro-plus");
  });

  it("and refuses a name there is no code to be made from, without asking the API", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "!!!");
    await type("#plan-amount-month", "5.00");
    await click("Create in Stripe");

    expect(text()).toContain("needs a letter or a digit");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  it("and refuses the one name whose plan could never be edited afterwards", async () => {
    // "Order" derives `order`, and `PUT /api/admin/tiers/order` is the Catalog
    // order's route (ADR-0031). Creating one is a Stripe Product for a row nothing
    // can then touch, so it is refused before Stripe is asked for anything.
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Order");
    await type("#plan-amount-month", "5.00");
    await click("Create in Stripe");

    // The same sentence the edit form says, because it is the same fact: the
    // literal is `packages/contracts`' and the wording is one function's.
    expect(text()).toContain("could never open again");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  it("will not create anything when Stripe cannot say what it may be priced in", async () => {
    // Offering a guess here is offering a currency the account cannot settle in.
    const s = stack({ currency: () => new Response(null, { status: 503 }) });

    await arrive(s);
    await click("New plan");

    expect(text()).toContain("could not say what this account settles in");
    expect(container.querySelector("#plan-amount-month")).toBeNull();
  });
});

describe("a plan sold at more than one rhythm", () => {
  const BOTH = {
    ...PRO,
    prices: [
      { stripePriceId: "price_pro", interval: "month" },
      { stripePriceId: "price_pro_yearly", interval: "year" },
    ],
  };

  it("shows every price it is sold at, on one row", async () => {
    // The whole of T62 (#128) on this screen: monthly and annual Pro are one plan
    // with two prices, not two tiers to keep in step by hand.
    const s = stack({ tiers: () => json({ tiers: [FREE, BOTH] }) });

    await arrive(s);

    expect(text()).toContain("price_pro");
    expect(text()).toContain("price_pro_yearly");
    // One row for the plan, not two.
    expect([...text().matchAll(/50/g)]).toHaveLength(1);
  });

  it("offers a rhythm the plan does not sell at yet", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Prices");

    // Pro sells monthly, so the form opens on the one it does not have.
    expect(container.querySelector<HTMLSelectElement>("#price-interval")?.value).toBe("year");
  });

  it("and sends it as a price of that tier", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Prices");
    await type("#price-amount", "99.00");
    await click("Add in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/prices") && call.method === "POST"),
      "the price to reach the API",
    );

    const posted = s.calls.find((call) => call.url.endsWith("/prices") && call.method === "POST");
    expect(posted?.url).toBe("http://localhost:8080/api/admin/tiers/pro/prices");
    const sent = JSON.parse(posted?.body ?? "{}") as Record<string, unknown>;
    // Typed as `99.00`: this form takes money the way it is written too (T66), and
    // the smallest unit is what goes on the wire.
    expect(sent["amount"]).toBe(9900);
    // The rhythm Pro does not already sell at, which is what the form opened on.
    expect(sent["interval"]).toBe("year");
    // No currency at all: the catalog has one, and no request may name another.
    expect(sent["currency"]).toBeUndefined();
  });

  it("says plainly that repricing leaves existing subscribers where they are", async () => {
    // The thing an operator most needs told, and the thing a button labelled
    // "replace price" reads as the opposite of.
    const s = stack({ tiers: () => json({ tiers: [FREE, BOTH] }) });

    await arrive(s);
    await clickInRowFor("pro", "Prices");
    // Pro already sells at both, so whichever rhythm is picked is a replacement.
    await act(async () => {
      const rhythm = container.querySelector<HTMLSelectElement>("#price-interval");
      if (rhythm) {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(rhythm, "month");
        rhythm.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(text()).toContain("keeps the price they signed up at");
    expect(text()).toContain("Replace in Stripe");
  });

  /**
   * Pricing the free tier is the one click that ends its freeness, and it is
   * allowed (T76, ADR-0031). Refusing it on the `isDefault` row was weighed and
   * rejected: an operator may genuinely want to start charging for what was free,
   * and refusing would force them through a default-tier swap that hands new
   * accounts a paid tier for nothing while it happens.
   */
  it("warns before pricing the one tier nobody can buy, and still offers to", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("free", "Prices");

    expect(text()).toContain("adding a price ends that");
    // Both consequences, because they are two different facts about the same row.
    expect(text()).toContain("every new account is provisioned onto");
    expect(text()).toContain("becomes permanent");
    expect(button("Add in Stripe").disabled).toBe(false);
  });

  it("and says nothing of the sort on a tier that is already sold", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Prices");

    expect(text()).not.toContain("adding a price ends that");
  });
});


describe("the sidebar", () => {
  it("opens on the catalog, which is what an operator came here to work in", async () => {
    const s = stack();

    await arrive(s);

    // Read off the attribute a screen reader reads: the rule that tints it reads
    // the same one, so there is no second source of truth to fall out of step.
    expect(container.querySelector(".admin-nav-item[aria-current='page']")?.textContent).toContain(
      "Tiers",
    );
  });

  it("and is a list of one while there is one page, without a heading over it", async () => {
    // A group heading over a single word labels nothing. It comes back with the
    // page that makes the list worth grouping.
    const s = stack();

    await arrive(s);

    expect(container.querySelectorAll(".admin-nav-item")).toHaveLength(1);
    expect(container.querySelector(".admin-nav-heading")).toBeNull();
  });

  it("carries the way out, wherever the catalog has been scrolled to", async () => {
    // The sidebar is sticky at the full height for exactly this: the catalog is the
    // one thing on this surface that grows without limit.
    const s = stack();

    await arrive(s);
    await click("Sign out");
    await until(() => s.navigated.length > 0, "the sign-out to reach the realm");

    expect(s.navigated.at(-1)).toContain("/protocol/openid-connect/logout");
  });
});

describe("the Stripe prices that carry no tier", () => {
  it("say nothing at all while every price in Stripe names one", async () => {
    // Empty is the good state here, and the good state is silent: a card saying
    // "nothing to sort out" is a thing to read on every visit.
    const s = stack();

    await arrive(s);

    expect(container.querySelector(".admin-untagged")).toBeNull();
    expect(text()).not.toContain("no tier");
  });

  it("and are one line on the catalog when there are some, closed until it is asked for", async () => {
    // They have been in three places: stacked under the tier table, then a page of
    // their own with a count in the sidebar — a whole door for a list that is empty
    // on a well-kept account. This is the one that is silent when there is nothing.
    const s = stack({ prices: () => json({ prices: [UNTAGGED] }) });

    await arrive(s);

    const fold = container.querySelector<HTMLDetailsElement>(".admin-untagged");
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector("summary")?.textContent).toContain("One price in Stripe carries");
    // On the catalog rather than instead of it: the list an operator works in is
    // still the page.
    expect(text()).toContain("Reposts");
  });

  it("and the list itself is inside that fold, not under the tier table", async () => {
    const s = stack({ prices: () => json({ prices: [UNTAGGED] }) });

    await arrive(s);

    const fold = container.querySelector(".admin-untagged");
    expect(fold?.textContent).toContain("price_loose");
    expect(fold?.textContent).toContain("12.00 EUR");
    // A price with no recurrence is a one-off, which is the commonest thing in
    // this list that is not a mistake.
    expect(fold?.textContent).toContain("one-off");
    // And it says the one thing that makes it go away, which happens in Stripe.
    expect(fold?.textContent).toContain("metadata.tier_code");
    expect(container.querySelector(".admin-table tbody")?.textContent).not.toContain("price_loose");
  });
});

describe("the form an operator opened", () => {
  it("is one panel in one place, whichever row it was opened from", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Prices");
    expect(container.querySelector("#price-amount")).not.toBeNull();

    // Opening another closes the first: two forms over one table is two places to
    // look for the thing you just clicked.
    await clickInRowFor("free", "Edit");

    expect(container.querySelector("#price-amount")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#tier-name")?.value).toBe("Free");
  });

  it("and the row it belongs to is marked, since the panel is above the table", async () => {
    const s = stack();

    await arrive(s);
    await clickInRowFor("pro", "Edit");

    const open = container.querySelector('tr[data-open="true"]');
    expect(open?.querySelector(".admin-code")?.textContent).toBe("pro");
  });
});

describe("the catalog at a glance", () => {
  it("counts what is on sale and what is still a draft", async () => {
    // The draft is the row this screen exists to let somebody finish, and it is the
    // one that looks like every other row until you have read two columns.
    const s = stack({ tiers: () => json({ tiers: [FREE, DRAFT, PRO] }) });

    await arrive(s);

    const drafts = [...container.querySelectorAll(".admin-stat")].find((stat) =>
      stat.textContent?.startsWith("Drafts"),
    );
    expect(drafts?.textContent).toContain("1");
    expect(drafts?.className).toContain("admin-stat--attention");
  });

  it("and says nothing is waiting when nothing is", async () => {
    const s = stack();

    await arrive(s);

    expect(text()).toContain("Nothing waiting on you");
    expect(container.querySelector(".admin-stat--attention")).toBeNull();
  });
});

describe("one word for the thing users press (T74, #161)", () => {
  /**
   * Everything `/admin` renders, on the one screen there is.
   *
   * Asserted as a sweep rather than field by field because the defect T74 exists
   * for is a *mixture* — the quota field said "Relists per period" over a hint
   * that said reposts — and a per-string assertion is exactly what let the two
   * disagree for four tickets. A panel added later is covered by this the day it
   * is opened here.
   */
  async function everythingOnScreen(): Promise<string> {
    const s = stack({ tiers: () => json({ tiers: [FREE, PRO, DRAFT, UNLIMITED] }) });
    let swept = "";

    await arrive(s);
    swept += text();
    // New plan first: it is a page action, and an open row panel takes that slot.
    await click("New plan");
    swept += text();
    await clickInRowFor("pro", "Edit");
    swept += text();
    await clickInRowFor("pro", "Prices");
    swept += text();
    await clickInRowFor("pro", "Delete");
    swept += text();

    return swept;
  }

  it("says repost to an operator, everywhere the screen says it at all", async () => {
    // ADR-0029: users read *repost*, internal identifiers keep *relist*. `/admin`
    // is a screen, so nothing here is an identifier — and the word an operator
    // sets a number against has to be the word the subscriber reads under the
    // button.
    const swept = await everythingOnScreen();

    // Both halves matter. The negative is the sweep; the positive is what stops
    // it passing on a screen that failed to render — every panel above draws the
    // word, so it has to appear once per panel opened rather than merely once.
    expect(swept.match(/repost/gi)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(swept).not.toMatch(/relist/i);
  });

  it("and says it on the quota field, whichever form is asking", async () => {
    // The two forms write the same column and used to label it identically —
    // which is why they have to move together, and why a rename that reached one
    // of them would read as a difference between them.
    const s = stack();

    await arrive(s);
    await click("New plan");
    expect(text()).toContain("Reposts per period");

    await clickInRowFor("free", "Edit");
    expect(text()).toContain("Reposts per period");
  });

  it("and refuses the New plan form's quota in the same words", async () => {
    // The sentence is spelled twice, because the two forms parse the quota
    // separately — so it is the one string here that can come apart, and the
    // edit form's copy was the only one anything asserted.
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-name", "Starter");
    await type("#plan-amount-month", "5.00");
    await type("#plan-quota", "");
    await click("Create in Stripe");

    expect(text()).toContain("Reposts per period has to be");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });
});
