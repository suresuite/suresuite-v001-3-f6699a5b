// One-shot recorder: captures the golden transcripts from the CURRENT code
// into fixtures/golden-transcripts.json. Run once against pre-Stage-0 Layer A
// (done for the Stage 0 PR); re-run only when a behavior change is deliberate,
// and say so in the commit (the fixture is the contract).
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read --allow-write golden/record_golden.ts

import { runAllScenarios } from "./run_scenarios.ts";

const captures = await runAllScenarios();
const outPath = new URL("../fixtures/golden-transcripts.json", import.meta.url);
await Deno.mkdir(new URL("../fixtures/", import.meta.url), { recursive: true });
await Deno.writeTextFile(outPath, JSON.stringify(captures, null, 2) + "\n");
console.log(`recorded ${captures.length} golden transcripts -> ${outPath.pathname}`);
