import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
import { dispatchExperiment, reusePromptText } from "../dispatch";

const args = { projectId: "p", scenarioId: "s", policyVersionId: "v", acknowledgeWarnings: false };
const failWith = (status: number, body: unknown) => ({
  data: null,
  error: { message: "non-2xx", context: new Response(JSON.stringify(body), { status }) },
});

describe("one sim-command dispatch client (WP 9.4 slice 8)", () => {
  beforeEach(() => invoke.mockReset());

  it("sends the caller's acknowledgement and options, and returns the run id", async () => {
    invoke.mockResolvedValue({ data: { run_id: "r1" }, error: null });
    const r = await dispatchExperiment({ ...args, acknowledgeWarnings: true, compute: "client", forceRerun: true });
    expect(r).toEqual({ queued: true, runId: "r1" });
    const payload = invoke.mock.calls[0][1].body.payload;
    expect(payload).toMatchObject({ policy_version_id: "v", acknowledge_warnings: true, compute: "client", force_rerun: true });
  });

  it("a 422 returns the gate's findings, typed", async () => {
    invoke.mockResolvedValue(failWith(422, { validation: "ack_required", findings: [{ message: "m" }] }));
    const r = await dispatchExperiment(args);
    expect(r.queued).toBe(false);
    expect(r.status).toBe("ack_required");
    expect(r.findings?.[0].message).toBe("m");
  });

  it("a 409 returns the reuse candidate; the prompt is worded once", async () => {
    const c = { run_id: "old", ended_at: null, created_at: "", code_version: "0.2.8", rep_count_done: 10 };
    invoke.mockResolvedValue(failWith(409, { reuse_available: true, reuse_candidate: c }));
    const r = await dispatchExperiment(args);
    expect(r.status).toBe("reuse_available");
    expect(reusePromptText(r.reuseCandidate!)).toMatch(/10 replication\(s\), engine 0\.2\.8/);
  });

  it("an operational failure carries the server's words, not the SDK's", async () => {
    invoke.mockResolvedValue(failWith(500, { error: "worker unreachable" }));
    await expect(dispatchExperiment(args)).rejects.toThrow(/HTTP 500: worker unreachable/);
  });
});
