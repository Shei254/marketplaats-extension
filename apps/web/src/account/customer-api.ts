import type { Choice, SwitchAnswer, SwitchPreviewAnswer } from "../public/viewer";

/**
 * The calls the landing page makes as its visitor (T85, ADR-0036): who they
 * are, and the four ways of paying or changing what they pay. Every one carries
 * the token in memory and nothing else — no cookie, `credentials: "omit"` —
 * because the API's answer depends on the token alone.
 *
 * A `401` is its own answer on each: the token lapsed while the page was open,
 * and the caller signs in again rather than calling it a fault.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Me =
  | { status: "ready"; tierCode: string; paying: boolean; rhythm: string | null }
  /** Signed in, on no tier at all (ADR-0032): not paying, nothing current. */
  | { status: "no-tier" }
  | { status: "expired" }
  | { status: "unavailable" };

export type Opened = { status: "opened"; url: string } | { status: "expired" } | { status: "refused" };

export class CustomerApi {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
    private readonly fetch: Fetch,
  ) {}

  async me(): Promise<Me> {
    const response = await this.call("GET", "/api/me");
    if (!response) return { status: "unavailable" };
    if (response.status === 401) return { status: "expired" };
    if (response.status === 403) return { status: "no-tier" };
    if (!response.ok) return { status: "unavailable" };
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const tier = body?.["tier"] as Record<string, unknown> | undefined;
    if (typeof tier?.["code"] !== "string") return { status: "unavailable" };
    return {
      status: "ready",
      tierCode: tier["code"],
      paying: body?.["paying"] === true,
      rhythm: typeof body?.["rhythm"] === "string" ? body["rhythm"] : null,
    };
  }

  /** Checkout for a first subscription. */
  checkout(choice: Choice): Promise<Opened> {
    return this.opening("/api/checkout", choice);
  }

  /** The Customer Portal. */
  portal(): Promise<Opened> {
    return this.opening("/api/portal");
  }

  async previewSwitch(choice: Choice): Promise<SwitchPreviewAnswer | { status: "expired" }> {
    const response = await this.call("POST", "/api/plan-switch/preview", choice);
    if (!response) return { status: "unavailable" };
    const refused = refusal(response.status);
    if (refused) return refused;
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const amount = body?.["amount"];
    const currency = body?.["currency"];
    if (typeof amount !== "number" || typeof currency !== "string") return { status: "unavailable" };
    return { status: "ready", amount, currency };
  }

  /**
   * The switch. `confirmAt` is the hosted invoice page when the payer has to
   * confirm the charge first; the caller navigates there.
   */
  async switchPlan(
    choice: Choice,
  ): Promise<Exclude<SwitchAnswer, { status: "confirming" }> | { status: "confirm"; url: string } | { status: "expired" }> {
    const response = await this.call("POST", "/api/plan-switch", choice);
    if (!response) return { status: "unavailable" };
    const refused = refusal(response.status);
    if (refused) return refused;
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !("confirmAt" in body)) return { status: "unavailable" };
    const confirmAt = body["confirmAt"];
    return typeof confirmAt === "string" ? { status: "confirm", url: confirmAt } : { status: "switched" };
  }

  private async opening(path: string, body?: Choice): Promise<Opened> {
    const response = await this.call("POST", path, body);
    if (!response) return { status: "refused" };
    if (response.status === 401) return { status: "expired" };
    if (!response.ok) return { status: "refused" };
    const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const url = answer?.["url"];
    return typeof url === "string" ? { status: "opened", url } : { status: "refused" };
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response | null> {
    try {
      return await this.fetch(`${this.apiBaseUrl}${path}`, {
        method,
        credentials: "omit",
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return null;
    }
  }
}

function refusal(
  status: number,
): { status: "expired" | "not-paying" | "not-for-sale" | "unavailable" } | null {
  if (status === 401) return { status: "expired" };
  if (status === 409) return { status: "not-paying" };
  if (status === 404) return { status: "not-for-sale" };
  if (status < 200 || status >= 300) return { status: "unavailable" };
  return null;
}
