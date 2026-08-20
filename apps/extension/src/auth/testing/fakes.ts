import type { BrowserAuthFlow, LaunchOutcome } from "../browser-flow";
import type { Http } from "../discovery";
import type { AuthSession, SessionStore } from "../session";

/** In-memory `SessionStore`, plus a count of clears so ordering can be asserted. */
export class InMemorySessionStore implements SessionStore {
  session: AuthSession | null = null;
  clears = 0;

  constructor(initial: AuthSession | null = null) {
    this.session = initial;
  }

  async read(): Promise<AuthSession | null> {
    return this.session;
  }

  async write(session: AuthSession): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.clears += 1;
    this.session = null;
  }
}

export interface LaunchRecord {
  url: URL;
  interactive: boolean;
}

/**
 * A `BrowserAuthFlow` that answers with whatever the test scripts, and records
 * every URL it was handed — which is where the assertions about PKCE and scope
 * live, since the authorize URL is the only thing a real user's browser ever sees.
 */
export class FakeBrowserAuthFlow implements BrowserAuthFlow {
  readonly launches: LaunchRecord[] = [];

  constructor(
    private readonly answer: (url: URL) => LaunchOutcome = (url) =>
      redirectedWithCode("test-code", url.searchParams.get("state") ?? ""),
    private readonly uri = "https://extension-id.chromiumapp.org/",
  ) {}

  redirectUri(): string {
    return this.uri;
  }

  async launch(url: string, options: { interactive: boolean }): Promise<LaunchOutcome> {
    const parsed = new URL(url);
    this.launches.push({ url: parsed, interactive: options.interactive });
    return this.answer(parsed);
  }

  /** The authorize request, which is the first thing every sign-in launches. */
  get authorizeUrl(): URL {
    const first = this.launches[0];
    if (!first) throw new Error("nothing was launched");
    return first.url;
  }
}

export function redirectedWithCode(code: string, state: string): LaunchOutcome {
  return {
    ok: true,
    redirectedTo: `https://extension-id.chromiumapp.org/?code=${code}&state=${encodeURIComponent(state)}`,
  };
}

export interface HttpCall {
  url: string;
  method: string;
  /** Form bodies parsed back out, which is what the token request is asserted on. */
  form: URLSearchParams;
}

export interface FakeHttpRoutes {
  /** Answer for the discovery document, or a thrown error to simulate an unreachable realm. */
  discovery?: () => Response | Promise<Response>;
  token?: () => Response | Promise<Response>;
}

export const ISSUER = "http://localhost:8081/realms/mprelist";
export const AUTHORIZATION_ENDPOINT = `${ISSUER}/protocol/openid-connect/auth`;
export const TOKEN_ENDPOINT = `${ISSUER}/protocol/openid-connect/token`;
export const END_SESSION_ENDPOINT = `${ISSUER}/protocol/openid-connect/logout`;

export function discoveryDocument(overrides: Record<string, unknown> = {}): Response {
  return json({
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    end_session_endpoint: END_SESSION_ENDPOINT,
    ...overrides,
  });
}

export function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return json({
    access_token: "an-access-token",
    expires_in: 300,
    refresh_token: "a-refresh-token",
    id_token: "an-id-token",
    token_type: "Bearer",
    ...overrides,
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` over two routes, recording every call. */
export class FakeHttp {
  readonly calls: HttpCall[] = [];

  constructor(private readonly routes: FakeHttpRoutes = {}) {}

  get fetch(): Http {
    return async (url, init) => {
      const method = init?.method ?? "GET";
      this.calls.push({
        url,
        method,
        form: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
      });

      if (url.includes("/.well-known/openid-configuration")) {
        return (this.routes.discovery ?? (() => discoveryDocument()))();
      }
      if (url === TOKEN_ENDPOINT) {
        return (this.routes.token ?? (() => tokenResponse()))();
      }
      throw new Error(`unexpected request to ${url}`);
    };
  }

  callsTo(url: string): HttpCall[] {
    return this.calls.filter((call) => call.url === url);
  }

  get discoveryCalls(): HttpCall[] {
    return this.calls.filter((call) => call.url.includes("/.well-known/"));
  }
}
