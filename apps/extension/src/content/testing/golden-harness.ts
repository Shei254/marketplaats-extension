/**
 * Harness for the golden-payload characterization tests (ADR-0015).
 *
 * The internal-API layer is frozen by asserting on the exact request it emits:
 * method, URL, every header, and the body byte-for-byte including form field
 * order. Nothing here touches the network and nothing needs a Marktplaats
 * account — `fetch` is replaced by a recording router.
 *
 * If a golden test fails after you changed this layer, the default assumption
 * is that you changed a payload. Read ADR-0015 before touching the expectation.
 */

import { Window } from "happy-dom";

/** A `fetch` call, captured in the shape the golden tests assert on. */
export interface RecordedRequest {
  method: string;
  url: string;
  credentials: string | undefined;
  /** Lowercased header names, sorted, so assertions are order-independent. */
  headers: Record<string, string>;
  body: RecordedBody;
}

export type RecordedBody =
  | { kind: "none" }
  /** `raw` is the exact wire body. `pairs` is the same thing, decoded, for readable diffs. */
  | { kind: "urlencoded"; raw: string; pairs: [string, string][] }
  | { kind: "formdata"; parts: RecordedPart[] }
  | { kind: "text"; raw: string };

export type RecordedPart =
  | { name: string; value: string }
  | { name: string; filename: string; mimeType: string; bytes: number[] };

/** What the stub should answer with. The first matching key wins. */
export interface Reply {
  status?: number;
  json?: unknown;
  html?: string;
  text?: string;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

export interface Route {
  /** Matched case-insensitively. Omit to match any method. */
  method?: string;
  /** Substring match on the URL, or a regex. */
  url: string | RegExp;
  /**
   * A single reply, or one per successive match of this route — the last entry
   * repeats once exhausted. The array form is how the CSRF 403/419 retry path
   * is driven.
   */
  reply: Reply | Reply[];
}

export interface FetchStub {
  /** Every request emitted, in order. */
  calls: RecordedRequest[];
  /** Requests whose URL contains `fragment`, in order. */
  matching(fragment: string): RecordedRequest[];
  /** The single request whose URL contains `fragment`. Throws unless there is exactly one. */
  only(fragment: string): RecordedRequest;
  restore(): void;
}

/**
 * Give the node test environment just enough DOM to run this layer: `DOMParser`
 * for the hydration scrapers, plus `document`/`location` for `downloadPhoto`.
 *
 * Deliberately NOT `@vitest-environment happy-dom`: that would also replace
 * `FormData`, whose happy-dom implementation drops the filename argument to
 * `append(name, blob, filename)`. `uploadPhoto` depends on that filename, so
 * running under happy-dom would freeze a harness artifact ("blob") instead of
 * the bytes a real browser sends. Node's own `FormData`/`Blob`/`Headers`/
 * `Response` are spec-compliant, so only the parsing bits are borrowed.
 */
export function installDom(url = "https://www.marktplaats.nl/"): () => void {
  const window = new Window({ url });
  const g = globalThis as Record<string, unknown>;
  const saved = { DOMParser: g.DOMParser, document: g.document, location: g.location };

  g.DOMParser = window.DOMParser;
  g.document = window.document;
  g.location = window.location;

  return () => Object.assign(g, saved);
}

/** Replace `globalThis.fetch` with a recording router. */
export function stubFetch(routes: Route[]): FetchStub {
  const calls: RecordedRequest[] = [];
  const hits = new Map<Route, number>();
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    calls.push({
      method,
      url,
      credentials: init?.credentials,
      headers: normalizeHeaders(init?.headers),
      body: await normalizeBody(init?.body),
    });

    const route = routes.find(
      (r) =>
        (r.method === undefined || r.method.toUpperCase() === method) &&
        (typeof r.url === "string" ? url.includes(r.url) : r.url.test(url)),
    );
    if (!route) {
      throw new Error(`golden-harness: no route for ${method} ${url}`);
    }

    const seen = hits.get(route) ?? 0;
    hits.set(route, seen + 1);
    const replies = Array.isArray(route.reply) ? route.reply : [route.reply];
    // The last reply repeats, so a route can be "403 once, then 200 forever".
    const reply = replies[Math.min(seen, replies.length - 1)]!;

    return toResponse(reply);
  }) as typeof globalThis.fetch;

  return {
    calls,
    matching: (fragment) => calls.filter((c) => c.url.includes(fragment)),
    only(fragment) {
      const found = this.matching(fragment);
      if (found.length !== 1) {
        throw new Error(
          `golden-harness: expected exactly one request matching '${fragment}', got ${found.length}` +
            ` (saw: ${calls.map((c) => `${c.method} ${c.url}`).join(", ")})`,
        );
      }
      return found[0]!;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function toResponse(reply: Reply): Response {
  const status = reply.status ?? 200;
  const headers = new Headers(reply.headers);
  let body: BodyInit | null = null;

  if (reply.json !== undefined) {
    body = JSON.stringify(reply.json);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (reply.html !== undefined) {
    body = reply.html;
    if (!headers.has("content-type")) headers.set("content-type", "text/html");
  } else if (reply.bytes !== undefined) {
    // Copy into a plain ArrayBuffer: the view's buffer may be pooled.
    const copy = new Uint8Array(reply.bytes.byteLength);
    copy.set(reply.bytes);
    body = copy;
  } else if (reply.text !== undefined) {
    body = reply.text;
  }

  // 204/304 must not carry a body.
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(init);
  const out: Record<string, string> = {};
  for (const name of [...headers.keys()].sort()) {
    out[name] = headers.get(name)!;
  }
  return out;
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<RecordedBody> {
  if (body === undefined || body === null) return { kind: "none" };

  if (body instanceof URLSearchParams) {
    // `toString()` is the exact wire body, field order included.
    return { kind: "urlencoded", raw: body.toString(), pairs: [...body.entries()] };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: RecordedPart[] = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === "string") {
        parts.push({ name, value });
      } else {
        parts.push({
          name,
          filename: value.name,
          mimeType: value.type,
          bytes: [...new Uint8Array(await value.arrayBuffer())],
        });
      }
    }
    return { kind: "formdata", parts };
  }

  if (typeof body === "string") return { kind: "text", raw: body };

  return { kind: "text", raw: String(body) };
}

/**
 * Re-encode decoded pairs back to a urlencoded body. Paired with an assertion on
 * `raw`, this catches an encoding change (`+` vs `%20`) that a pairs-only
 * comparison would let through.
 */
export function encodePairs(pairs: [string, string][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params.toString();
}
