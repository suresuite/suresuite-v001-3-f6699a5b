// Scripted fetch for the golden-transcript harness (ai-agents.md §9.1).
// Each outbound provider call pops the next scripted response; the request
// URL + parsed JSON body are recorded so equivalence can be asserted on the
// exact bytes the provider would have received.

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

export interface ScriptedResponse {
  status?: number;
  json: unknown;
}

export interface FetchMock {
  calls: RecordedCall[];
  restore(): void;
}

export function installFetchMock(script: ScriptedResponse[]): FetchMock {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  let i = 0;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown = null;
    const raw = init?.body;
    if (typeof raw === "string") {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    calls.push({ url, method: init?.method ?? "GET", body });
    const scripted = script[i];
    if (!scripted) {
      return Promise.reject(new Error(`fetch mock: no scripted response for call #${i} (${url})`));
    }
    i += 1;
    return Promise.resolve(
      new Response(JSON.stringify(scripted.json), {
        status: scripted.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}
