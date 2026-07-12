// Offline stand-in for https://deno.land/std@0.168.0/http/server.ts (type-check
// only — eval tests never start the edge servers).
export type Handler = (req: Request) => Response | Promise<Response>;
export function serve(_handler: Handler, _options?: Record<string, unknown>): Promise<void> {
  return Promise.resolve();
}
