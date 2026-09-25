import type { Plans } from "@mprelist/contracts";

/**
 * What the landing page's plan cards show (T58): `GET /api/plans`, asked with no
 * token, or the fact that it could not be.
 *
 * **The one call the public site makes**, and the only file outside `src/admin/`
 * that `no-identity.test.ts` lets call `fetch`. What it lets through is narrow on
 * purpose: `credentials: "omit"` and no headers, so the request says nothing about
 * who is asking. ADR-0017's line is that the public pages never learn who anybody
 * is, and this keeps it — the route answers a visitor exactly what it answers the
 * popup.
 *
 * **Anything but a well-formed `200` is `unavailable`**, the API's `503` included.
 * The page then says so and offers a retry, which is what the popup's cards do; it
 * never draws a guessed price. An empty list is a `200` and is not a fault: nothing
 * is on sale, and the page draws no cards.
 */
export type PlansOnOffer = ({ status: "ready" } & Plans) | { status: "unavailable" };

/** Asking it, as the page is handed the question: `main.tsx` binds the address and `fetch`. */
export type LoadPlans = () => Promise<PlansOnOffer>;

/** `fetch`'s shape, narrowed to what this uses, so a test can hand one in. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function plansOnOffer(apiBaseUrl: string, fetch: Fetch): Promise<PlansOnOffer> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/plans`, { credentials: "omit" });
    if (response.status !== 200) return UNAVAILABLE;
    const body: unknown = await response.json();
    // An API from before T84 sends no `freeTier`: read that as none rather than
    // as `undefined`, which the page would otherwise have to check for twice.
    return isPlans(body) ? { status: "ready", ...body, freeTier: body.freeTier ?? null } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

const UNAVAILABLE: PlansOnOffer = { status: "unavailable" };

/** The two lists the cards read, checked for being lists; their entries are the API's to get right. */
function isPlans(body: unknown): body is Plans {
  if (typeof body !== "object" || body === null) return false;
  const { plans, paymentMethods } = body as Record<string, unknown>;
  return Array.isArray(plans) && Array.isArray(paymentMethods);
}
