// Telemetry writer deterministic tier (ai-agents.md §7.1/§7.5): flag-gated,
// never-throws, ids-and-hashes-only.

import { assert, assertEquals } from "./harness/asserts.ts";
import { canonicalJson, makeTelemetry, sha256Hex, telemetryEnabled } from "../telemetry.ts";

Deno.test("disabled by default: no insert attempted, emit resolves", async () => {
  Deno.env.delete("AGENT_TELEMETRY_ENABLED");
  assertEquals(telemetryEnabled(), false);
  let inserts = 0;
  const db = { from: () => ({ insert: () => { inserts++; return Promise.resolve({ error: null }); } }) };
  const t = makeTelemetry(db, {});
  await t.emit("chat.request", { prompt_chars: 10 });
  assertEquals(inserts, 0, "flag off must be a pure no-op");
});

Deno.test("enabled: inserts the §7.1 row shape (ids only, payload jsonb)", async () => {
  Deno.env.set("AGENT_TELEMETRY_ENABLED", "true");
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  const db = { from: (table: string) => ({ insert: (row: unknown) => { rows.push({ table, row }); return Promise.resolve({ error: null }); } }) };
  const t = makeTelemetry(db, {
    user_id: "u-1", project_id: "p-1", request_id: "r-1",
    persona_id: "risk-analyst", model_code: "gemini-2.5-flash", provider_code: "gemini",
  });
  await t.emit("chat.reply", { reply_chars: 42, parts_kinds: ["table"], blocked: false }, { latency_ms: 1234 });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].table, "ai_chat_events");
  assertEquals(rows[0].row.event_kind, "chat.reply");
  assertEquals(rows[0].row.request_id, "r-1");
  assertEquals(rows[0].row.latency_ms, 1234);
  assertEquals(rows[0].row.payload, { reply_chars: 42, parts_kinds: ["table"], blocked: false });
  Deno.env.delete("AGENT_TELEMETRY_ENABLED");
});

Deno.test("never throws: rejecting client and throwing client are both swallowed", async () => {
  Deno.env.set("AGENT_TELEMETRY_ENABLED", "true");
  const rejecting = { from: () => ({ insert: () => Promise.reject(new Error("db down")) }) };
  await makeTelemetry(rejecting, {}).emit("tool.call", {});
  const throwing = { from: () => { throw new Error("catastrophic"); } };
  await makeTelemetry(throwing, {}).emit("tool.call", {});
  const errorResult = { from: () => ({ insert: () => Promise.resolve({ error: { message: "constraint" } }) }) };
  await makeTelemetry(errorResult, {}).emit("tool.call", {});
  Deno.env.delete("AGENT_TELEMETRY_ENABLED");
});

Deno.test("args hashing: canonical (key-order-insensitive) sha256 (§7.5)", async () => {
  const a = await sha256Hex(canonicalJson({ b: 1, a: [2, { z: 3, y: 4 }] }));
  const b = await sha256Hex(canonicalJson({ a: [2, { y: 4, z: 3 }], b: 1 }));
  assertEquals(a, b, "semantically equal args must hash identically");
  assert(/^[0-9a-f]{64}$/.test(a), "sha256 hex");
  const c = await sha256Hex(canonicalJson({ b: 2, a: [2, { z: 3, y: 4 }] }));
  assert(a !== c, "different args must differ");
});
