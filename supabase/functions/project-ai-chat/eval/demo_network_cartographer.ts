// Phase 4b end-to-end demo transcript (ai-agents.md §18.2 acceptance):
// drives the REAL B8 machinery offline — router decision → three ingests
// (paste of two news paragraphs + one report excerpt naming a tier-2
// supplier; scripted extraction, real screening/verbatim/LEI/verification
// gates) → evidence rows with sources + confidence → get_network_evidence
// tallies → Cartographer agent turn (scripted provider I/O, real draft
// handler; VERIFIED triples only) → persona wrap-up → Approve →
// networkMapDiffApply through bulk_upsert_suppliers + the
// assign_material_supplier lane path — and prints the transcript. The
// single-source Baltic triple stays visibly pending and is NOT applied.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_network_cartographer.ts

import { decideRoute } from "../router.ts";
import { runChat } from "../providers.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import "../cartographerTools.ts";
import { buildWrapupMessage, runAgentTurn } from "../agentTurn.ts";
import { applyNetworkMapDiff } from "../../agent-apply/networkMapDiffApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "network-cartographer");
Deno.env.set("GEMINI_API_KEY", "demo-key");

// The project: Helix Drives is the known tier-1 supplier of power modules;
// the pasted documents name Nordwind Semiconductor as ITS supplier (tier-2).
const P = { project_id: PROJECT };
const tables: Record<string, Row[]> = {
  projects: [{ id: PROJECT, plant_name: "Alpine Assembly Graz", organization: "demo-org" }],
  suppliers: [
    { ...P, supplier_id: "S-HELIX", name: "Helix Drives GmbH", capacity_per_week: 800, reliability_score: 1 },
  ],
  materials: [
    { ...P, material_id: "MAT-PM", name: "power modules" },
    { ...P, material_id: "MAT-CTH", name: "battery cathodes" },
  ],
  inbound_logistics: [
    { ...P, plant_name: "Alpine Assembly Graz", supplier_id: "S-HELIX", material_id: "MAT-PM", unit_price: 120, lead_time: 2, volume: 40, time_unit: "week" },
  ],
  external_evidence: [],
};
const db = makeStubDb(tables, makeAgentRpcs(tables));
const utterance =
  "Here are two news paragraphs and a report excerpt about who supplies Helix Drives — map the tier-2 supplier";

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);
say("user", utterance);

// 1 — router (classifier scripted; the §6.2 wrapper is the real one)
const decision = await decideRoute(utterance, {
  personaId: "risk-analyst",
  hasProject: true,
  enabledAgents: ["network-cartographer"],
  modelId: "gemini-2.5-flash",
}, () =>
  Promise.resolve(JSON.stringify({
    route: "artifact",
    agent_id: "network-cartographer",
    intent: "cartographer.map_from_documents",
    confidence: 0.94,
    advisory_part: null,
    artifact_part: utterance,
  })));
say("router.decision", JSON.stringify(decision));

const ctx: ToolContext = {
  projectId: PROJECT,
  userId: USER,
  supabase: db as unknown as ToolContext["supabase"],
  draft: {
    userEmail: "demo@example.com",
    threadId: "33333333-3333-4333-8333-333333333333",
    modelCode: "gemini-2.5-flash",
    providerCode: "gemini",
    canProposals: true,
    utterance,
  },
};

// 2 — the three pasted documents, each attributed to a registered
// extraction source (§18.5 law). Extraction is scripted; the screening,
// verbatim-substring, LEI and verification gates are the real ones.
const NSG = "Nordwind Semiconductor GmbH";
const HDG = "Helix Drives GmbH";
const docs = [
  {
    source_id: "news-wire",
    title: "Wire: Nordwind-Helix supply agreement",
    text:
      "Nordwind Semiconductor GmbH has signed a three-year agreement to supply power modules to Helix Drives GmbH. Nordwind Semiconductor GmbH produces power modules at its Dresden fab.",
    entities: [
      { type: "Company", text: NSG },
      { type: "Company", text: HDG },
      { type: "Material", text: "power modules" },
      { type: "Location", text: "Dresden" },
    ],
    triples: [
      { subject: NSG, relation: "SuppliesTo", object: HDG, quote: "Nordwind Semiconductor GmbH has signed a three-year agreement to supply power modules to Helix Drives GmbH." },
      { subject: NSG, relation: "Produces", object: "power modules", quote: "Nordwind Semiconductor GmbH produces power modules at its Dresden fab." },
    ],
  },
  {
    source_id: "gdelt",
    title: "Screened article: Helix supply chain",
    text:
      "Industry coverage confirms that Nordwind Semiconductor GmbH supplies power modules to Helix Drives GmbH. Nordwind Semiconductor GmbH produces power modules. Separately, Baltic Cathode Works is described as a maker of battery cathodes that supplies battery cathodes to Helix Drives GmbH.",
    entities: [
      { type: "Company", text: NSG },
      { type: "Company", text: HDG },
      { type: "Company", text: "Baltic Cathode Works" },
      { type: "Material", text: "power modules" },
      { type: "Material", text: "battery cathodes" },
    ],
    triples: [
      { subject: NSG, relation: "SuppliesTo", object: HDG, quote: "Industry coverage confirms that Nordwind Semiconductor GmbH supplies power modules to Helix Drives GmbH." },
      { subject: NSG, relation: "Produces", object: "power modules", quote: "Nordwind Semiconductor GmbH produces power modules." },
      { subject: "Baltic Cathode Works", relation: "SuppliesTo", object: HDG, quote: "Separately, Baltic Cathode Works is described as a maker of battery cathodes that supplies battery cathodes to Helix Drives GmbH." },
    ],
  },
  {
    source_id: "sec-edgar",
    title: "10-K excerpt: supplier disclosures",
    text:
      "Helix Drives GmbH sources power modules from Nordwind Semiconductor GmbH. Nordwind Semiconductor GmbH produces power modules and is headquartered in Dresden.",
    entities: [
      { type: "Company", text: HDG },
      { type: "Company", text: NSG },
      { type: "Material", text: "power modules" },
      { type: "Location", text: "Dresden" },
    ],
    triples: [
      { subject: NSG, relation: "SuppliesTo", object: HDG, quote: "Helix Drives GmbH sources power modules from Nordwind Semiconductor GmbH." },
      { subject: NSG, relation: "Produces", object: "power modules", quote: "Nordwind Semiconductor GmbH produces power modules and is headquartered in Dresden." },
    ],
  },
];

const evidenceIds: Record<string, string[]> = { SuppliesTo: [], Produces: [] };
for (const doc of docs) {
  const queue = [
    JSON.stringify({ entities: doc.entities }),
    JSON.stringify({ triples: doc.triples }),
  ];
  ctx.extract = () => Promise.resolve(queue.shift() ?? "{}");
  const env = await executeTool("ingest_network_evidence", {
    source_id: doc.source_id,
    text: doc.text,
    title: doc.title,
  }, ctx);
  const data = env.data as { columns: string[]; rows: unknown[][] };
  say(`ingest_network_evidence (${doc.source_id})`,
    [data.columns.join(" | ")].concat(data.rows.map((r) => r.map(String).join(" | "))).join("\n"));
  for (const r of data.rows) {
    const [subject, relation, , , , , evidenceId] = r as string[];
    if (String(subject).startsWith("Nordwind")) evidenceIds[String(relation)]?.push(String(evidenceId));
  }
}

// 3 — the verification tallies (Q27: verified >= 3 / corroborated 2 /
// provisional 1 — sub-threshold triples stay stored + pending).
const tally = await executeTool("get_network_evidence", {}, ctx);
const tallyData = tally.data as { columns: string[]; rows: unknown[][] };
say("get_network_evidence (Q27 tallies)",
  [tallyData.columns.slice(0, 6).join(" | ")]
    .concat(tallyData.rows.map((r) => r.slice(0, 6).map(String).join(" | "))).join("\n"));

// 4 — agent turn: scripted provider files the draft through the REAL
// handler; only the verified triples are drafted.
const agentReplyText =
  "Three independent registered sources (news-wire, gdelt, sec-edgar) verify that Nordwind " +
  "Semiconductor GmbH supplies Helix Drives and produces power modules, so I drafted the " +
  "supplier plus a power-modules source link. The Baltic Cathode Works claim has one source " +
  "and stays pending (provisional) — it was stored, not drafted. Review the card before " +
  "anything applies.";
let mock = installFetchMock([
  {
    json: {
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "draft_network_map_diff",
              args: {
                rows: [
                  { op: "add_supplier", supplier_name: NSG, evidence_ids: evidenceIds.SuppliesTo },
                  { op: "add_supply_link", supplier_name: NSG, material_id: "MAT-PM", evidence_ids: evidenceIds.Produces },
                ],
                title: "Map Nordwind Semiconductor as a verified tier-2 supplier",
              },
            },
          }],
        },
      }],
    },
  },
  { json: { candidates: [{ content: { parts: [{ text: agentReplyText }] } }] } },
]);
const agent = await runAgentTurn({ agentId: "network-cartographer", modelId: "gemini-2.5-flash", utterance, ctx });
mock.restore();
say("network-cartographer (agent turn)", agent.reply);
say("proposal part (attached mechanically)", JSON.stringify(agent.proposalPart?.data, null, 2));

// 5 — what the card renders: verified rows + the visibly-pending block,
// all from the stored payload (§4.6: no client recompute).
const stored = tables.proposals.find((p) => p.id === agent.proposalPart!.data.proposal_id)!;
const payload = stored.payload as { rows: Array<Record<string, unknown>>; pending: Array<Record<string, unknown>> };
say("card rows (verified triples only)", payload.rows.map((r) =>
  `${r.op}: ${r.supplier_name} (${r.supplier_id}, LEI ${r.lei})` +
  (r.material_id ? ` -> ${r.material_id}` : "") +
  ` — ${r.status} @ ${r.independent_sources} sources [${(r.source_ids as string[]).join(", ")}], confidence ${r.confidence}`
).join("\n"));
say("card pending (stored, flagged, NOT integrated)", payload.pending.map((p) =>
  `${p.subject} ${p.relation} ${p.object} — ${p.status} (${p.independent_sources} source)`
).join("\n"));
say("card citations", JSON.stringify(stored.citations));

// 6 — persona wrap-up (voice)
const wrapText =
  "I mapped Nordwind Semiconductor GmbH as a verified tier-2 supplier of power modules — three " +
  "independent sources back it, and every row on the card cites its stored evidence. The Baltic " +
  "Cathode Works claim is only single-source, so it stays pending. Review and approve the card " +
  "below before anything is added to your network.";
mock = installFetchMock([{ json: { candidates: [{ content: { parts: [{ text: wrapText }] } }] } }]);
const wrap = await runChat("gemini-2.5-flash", buildWrapupMessage({
  utterance,
  agentReply: agent.reply,
  proposal: agent.proposalPart!.data,
  agentName: "Network Cartographer",
}), [], null, "risk-analyst");
mock.restore();
say("persona (wrap-up)", wrap.reply);

// 7 — Approve (modeler) → agent-apply walks the §4.4 sequence through the
// EXISTING mutation paths (bulk_upsert_suppliers + assign_material_supplier).
stored.status = "approved";
const result = await applyNetworkMapDiff(db, {
  projectId: PROJECT,
  payload: stored.payload as Record<string, unknown>,
  grounding: stored.grounding as Record<string, unknown>,
  userId: USER,
  userEmail: "demo@example.com",
});
say("agent-apply (bulk_upsert_suppliers + assign_material_supplier)", JSON.stringify(result, null, 2));
say("suppliers after apply", JSON.stringify(
  tables.suppliers.map((s) => ({ id: s.supplier_id, name: s.name })), null, 2));
say("inbound lanes after apply", JSON.stringify(
  tables.inbound_logistics.map((l) => `${l.supplier_id} -> ${l.material_id}`)));
say("check: the provisional Baltic triple did NOT apply",
  String(!JSON.stringify(tables.suppliers).includes("Baltic")));
