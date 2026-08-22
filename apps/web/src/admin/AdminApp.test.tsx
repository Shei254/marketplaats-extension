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
};

const FREE: AdminTier = {
  tier: { code: "free", name: "Free" },
  relistQuotaPerPeriod: 3,
  features: {},
  published: false,
  isDefault: true,
  prices: [],
};

const DRAFT: AdminTier = {
  tier: { code: "starter", name: "starter" },
  relistQuotaPerPeriod: 0,
  features: {},
  published: false,
  isDefault: false,
  prices: [{ stripePriceId: "price_starter", interval: "month" }],
};

interface Backend {
  /** Roles the exchanged token carries; `null` means the code exchange fails. */
  roles?: string[] | null;
  tiers?: () => Response;
  prices?: () => Response;
  write?: () => Response;
  currencies?: () => Response;
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
    if (url.endsWith("/api/admin/prices")) return (backend.prices ?? (() => json({ prices: [] })))();
    if (url.endsWith("/api/admin/currencies")) {
      return (backend.currencies ??
        (() => json({ defaultCurrency: "eur", supported: ["eur", "usd"] })))();
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
    expect(Object.keys(sent).sort()).toEqual(["features", "name", "published", "relistQuotaPerPeriod"]);
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
    await until(() => text().includes("cannot go on sale"), "the API's refusal to be reported");

    expect(text()).toContain("cannot go on sale");
  });

  it("refuses flags that are not a JSON object, rather than sending them", async () => {
    const s = stack();

    await arrive(s);
    await click("Edit");
    await type("#tier-features", "not json");
    await click("Save");

    expect(text()).toContain("JSON object");
    expect(s.calls.some((call) => call.method === "PUT")).toBe(false);
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
  it("offers the currencies Stripe says the account can settle in", async () => {
    // Not a hardcoded list of Stripe's hundred and thirty: a currency this account
    // cannot take is a plan card that renders and a Checkout that fails.
    const s = stack();

    await arrive(s);
    await click("New plan");

    const options = [...container.querySelectorAll("#plan-currency option")].map((o) => o.textContent);
    expect(options).toEqual(["EUR", "USD"]);
  });

  it("and sends the whole plan, created not on sale", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-code", "starter");
    await type("#plan-name", "Starter");
    await type("#plan-amount", "500");
    await type("#plan-quota", "10");
    await click("Create in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/api/admin/plans")),
      "the plan to reach the API",
    );

    const sent = JSON.parse(
      s.calls.find((call) => call.url.endsWith("/api/admin/plans"))?.body ?? "{}",
    ) as Record<string, unknown>;
    expect(sent["tierCode"]).toBe("starter");
    expect(sent["amount"]).toBe(500);
    expect(sent["currency"]).toBe("eur");
    expect(sent["interval"]).toBe("month");
    // Not on sale: the operator checks what Stripe made, then publishes from the row.
    expect(sent["published"]).toBe(false);
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
    await type("#plan-code", "starter");
    await type("#plan-name", "Starter");
    await type("#plan-amount", "1");
    await click("Create in Stripe");
    await until(() => text().includes("at least 50 cents"), "Stripe's refusal to be shown");

    expect(text()).toContain("Amount must be at least 50 cents");
  });

  it("and says a code is taken rather than repointing the tier that has it", async () => {
    const s = stack({ create: () => new Response(null, { status: 409 }) });

    await arrive(s);
    await click("New plan");
    await type("#plan-code", "pro");
    await type("#plan-name", "Pro again");
    await type("#plan-amount", "500");
    await click("Create in Stripe");
    await until(() => text().includes("already uses that code"), "the clash to be reported");

    expect(text()).toContain("Codes are permanent");
  });

  it("refuses a code that could not be a tier code, without asking the API", async () => {
    const s = stack();

    await arrive(s);
    await click("New plan");
    await type("#plan-code", "Not A Code");
    await type("#plan-name", "Starter");
    await type("#plan-amount", "500");
    await click("Create in Stripe");

    expect(text()).toContain("lower-case letters");
    expect(s.calls.some((call) => call.url.endsWith("/api/admin/plans"))).toBe(false);
  });

  it("will not create anything when Stripe cannot say what it may be priced in", async () => {
    // Offering a guess here is offering a currency the account cannot charge in.
    const s = stack({ currencies: () => new Response(null, { status: 503 }) });

    await arrive(s);
    await click("New plan");

    expect(text()).toContain("could not say which currencies");
    expect(container.querySelector("#plan-amount")).toBeNull();
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
    await type("#price-amount", "9900");
    await click("Add in Stripe");
    await until(
      () => s.calls.some((call) => call.url.endsWith("/prices") && call.method === "POST"),
      "the price to reach the API",
    );

    const posted = s.calls.find((call) => call.url.endsWith("/prices") && call.method === "POST");
    expect(posted?.url).toBe("http://localhost:8080/api/admin/tiers/pro/prices");
    const sent = JSON.parse(posted?.body ?? "{}") as Record<string, unknown>;
    expect(sent["amount"]).toBe(9900);
    // The rhythm Pro does not already sell at, which is what the form opened on.
    expect(sent["interval"]).toBe("year");
    expect(sent["currency"]).toBe("eur");
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
});
