/**
 * Minimal `chrome` stand-in for tests, in one place.
 *
 * Three near-copies of this existed — the golden harness, `endpoint-config.test.ts`
 * inline, and `scripts/build.test.ts` — each stubbing the same `storage.local`
 * with slightly different fidelity. They drifted the way restated things do: the
 * build test's `get` ignored its key and always answered `{}`, so a suite using it
 * could not have caught a config actually being read. One definition instead, for
 * the same reason `DEFAULT_ENDPOINT_CONFIG` and `DEV_HOOK_NAMES` are single.
 *
 * `storage.onChanged` matters at *import* time: `marktplaats-api.ts` registers a
 * listener at module scope, so this has to be installed before it is imported.
 * `runtime`'s three events are what the background worker registers on startup —
 * nothing here is ever fired, so no relist can run. `alarms` is there for the same
 * reason since T68 (#147): the worker registers a listener and asks whether a run
 * has lost its wake-up, both at module scope, so a stub without it is an import
 * that throws.
 */

export interface ChromeStub {
  /**
   * The backing `chrome.storage.local`. Exposed because the interesting assertion
   * is often what *reached* storage rather than what loads back out — an override
   * write and a resolved write are indistinguishable through `loadEndpointConfig`
   * until the defaults change, which is exactly when the difference bites.
   */
  area: Record<string, unknown>;
  restore(): void;
}

/**
 * @param stored initial contents of `chrome.storage.local`; omit for empty, which
 *   is what makes the config module fall back to `DEFAULT_ENDPOINT_CONFIG`.
 */
export function installChromeStub(stored?: Record<string, unknown>): ChromeStub {
  const area: Record<string, unknown> = { ...stored };
  const global = globalThis as Record<string, unknown>;
  const saved = global.chrome;
  const event = { addListener: () => {} };

  global.chrome = {
    runtime: { onStartup: event, onInstalled: event, onMessage: event },
    // Answers "no alarm pending" rather than nothing, so a worker asking on wake
    // gets a real answer and still starts none: `create` is a no-op here, and
    // nothing in these suites fires one.
    alarms: {
      onAlarm: event,
      create: () => {},
      clear: async () => true,
      get: async () => undefined,
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    storage: {
      local: {
        get: async (key: string) => (key in area ? { [key]: area[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(area, items);
        },
        remove: async (key: string) => {
          delete area[key];
        },
      },
      onChanged: event,
    },
  };

  return {
    area,
    restore: () => {
      global.chrome = saved;
    },
  };
}
