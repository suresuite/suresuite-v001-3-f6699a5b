// Pure-function checks for the localStorage→store import mapping
// (ai-agents.md §14.7 M0). TS↔SQL parity of the quick-thread id is asserted
// against live Postgres in db_rpc_test.ts; these tests cover the mapping
// logic that runs in the browser.

import { assert, assertEquals } from "./harness/asserts.ts";
import {
  isUuid,
  quickThreadServerId,
  serializeThreadsForImport,
  type LocalThreadLike,
} from "../../../../src/lib/chat/localThreadImport.ts";

Deno.test("quickThreadServerId is deterministic and uuid-shaped", async () => {
  const a = await quickThreadServerId("22222222-2222-4222-8222-222222222222");
  const b = await quickThreadServerId("22222222-2222-4222-8222-222222222222");
  const c = await quickThreadServerId("55555555-5555-4555-8555-555555555555");
  assertEquals(a, b);
  assert(a !== c, "different users get different quick threads");
  assert(isUuid(a), `uuid-shaped: ${a}`);
});

Deno.test("serializeThreadsForImport is content-preserving and defensive", () => {
  const threads: LocalThreadLike[] = [
    {
      id: "quick",
      projectId: null,
      title: "Quick chat",
      updatedAt: 1720000300000,
      messages: [
        { id: "m1", role: "user", content: "hello", createdAt: 1720000100000 },
        // deno-lint-ignore no-explicit-any
        { id: "m2", role: "system" as any, content: "dropped", createdAt: 1 }, // invalid role filtered
      ],
    },
    // deno-lint-ignore no-explicit-any
    { id: "", title: "no id — dropped", messages: [] } as any,
  ];
  const out = serializeThreadsForImport(threads) as Array<Record<string, unknown>>;
  assertEquals(out.length, 1);
  const msgs = out[0].messages as Array<Record<string, unknown>>;
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].content, "hello");
  assertEquals(msgs[0].parts, []);
  assertEquals(msgs[0].toolCalls, []);
  assertEquals(out[0].updatedAt, 1720000300000);
});
