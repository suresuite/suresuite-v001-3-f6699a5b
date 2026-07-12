// Shared executor for the golden-transcript scenarios: runs each scenario
// through providers.ts::runChat with scripted provider I/O and a stubbed
// project database, mirroring exactly what index.ts does around the call
// (4,000-char message clamp, history filtering).

import { runChat } from "../../providers.ts";
import type { ToolContext } from "../../tools.ts";
import { installFetchMock } from "../harness/fetch_mock.ts";
import { stubSupabaseTables } from "../harness/stub_supabase.ts";
import { GOLDEN_SCENARIOS, type GoldenScenario } from "./scenarios.ts";

export interface GoldenCapture {
  id: string;
  providerCalls: Array<{ url: string; method: string; body: unknown }>;
  result: unknown;
}

const TEST_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_USER_ID = "22222222-2222-4222-8222-222222222222";

export function setTestProviderKeys() {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  Deno.env.set("OPENAI_API_KEY", "test-openai-key");
  Deno.env.set("DEEPSEEK_API_KEY", "test-deepseek-key");
}

export async function runScenario(s: GoldenScenario): Promise<GoldenCapture> {
  const mock = installFetchMock(s.responses);
  try {
    const ctx: ToolContext | null = s.projectTables
      ? {
        projectId: TEST_PROJECT_ID,
        userId: TEST_USER_ID,
        supabase: stubSupabaseTables(s.projectTables) as unknown as ToolContext["supabase"],
      }
      : null;
    const history = s.history.filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    const promptText = String(s.message).slice(0, 4000);
    const result = await runChat(s.model, promptText, history, ctx, s.agentId);
    return { id: s.id, providerCalls: mock.calls, result };
  } finally {
    mock.restore();
  }
}

export async function runAllScenarios(): Promise<GoldenCapture[]> {
  setTestProviderKeys();
  const out: GoldenCapture[] = [];
  for (const s of GOLDEN_SCENARIOS) out.push(await runScenario(s));
  return out;
}
