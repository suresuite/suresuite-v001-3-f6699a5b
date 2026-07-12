// Golden-transcript scenarios (ai-agents.md §9.1 exit criterion).
// Each scenario pins one recorded Layer A request/response pair: the exact
// provider request bodies runChat emits and the exact ChatRunResult it returns,
// with all provider I/O scripted. Recorded against pre-Stage-0 code; replayed
// against Stage 0 code with flags off — outputs must match byte-for-byte
// (timestamps do not appear in either side).

import type { ScriptedResponse } from "../harness/fetch_mock.ts";

export interface GoldenScenario {
  id: string;
  model: string;                       // client model id (MODEL_REGISTRY key)
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  agentId: string | null;
  /** null = no project attached; otherwise the stub tables the tools read. */
  projectTables: Record<string, unknown[]> | null;
  responses: ScriptedResponse[];
}

const PROJECT_NODE_LIST = [
  { node_id: "S1", node_type: "supplier", node_group: "tier1" },
  { node_id: "S2", node_type: "supplier", node_group: "tier1" },
  { node_id: "MAT-1", node_type: "material", node_group: "raw" },
  { node_id: "C1", node_type: "customer", node_group: "oem" },
];

function geminiText(text: string, finishReason = "STOP"): ScriptedResponse {
  return { json: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }] } };
}

function geminiFunctionCall(name: string, args: Record<string, unknown>): ScriptedResponse {
  return { json: { candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] }, finishReason: "STOP" }] } };
}

function openaiText(content: string): ScriptedResponse {
  return { json: { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] } };
}

function openaiToolCall(name: string, args: Record<string, unknown>): ScriptedResponse {
  return {
    json: {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: "tool_calls",
      }],
    },
  };
}

const LONG_TURN = "lead time considerations: " + "x".repeat(2400);

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: "gemini-noproject-text",
    model: "gemini-2.5-flash",
    message: "What is safety stock and why does it matter?",
    history: [],
    agentId: null,
    projectTables: null,
    responses: [geminiText("Safety stock is the buffer inventory you hold against demand and supply variability.")],
  },
  {
    id: "gemini-project-toolcall",
    model: "gemini-2.5-flash",
    message: "Which suppliers do we have?",
    history: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello! Ask me about your supply chain." }],
    agentId: "risk-analyst",
    projectTables: { node_list: PROJECT_NODE_LIST },
    responses: [
      geminiFunctionCall("list_project_entities", { entity_type: "supplier" }),
      geminiText("You have two tier-1 suppliers, S1 and S2."),
    ],
  },
  {
    id: "gemini-safety-block",
    model: "gemini-2.5-flash",
    message: "Tell me something you should not.",
    history: [],
    agentId: null,
    projectTables: null,
    responses: [{ json: { candidates: [{ finishReason: "SAFETY" }] } }],
  },
  {
    id: "gemini-empty-reply",
    model: "gemini-2.5-flash",
    message: "…",
    history: [],
    agentId: null,
    projectTables: null,
    responses: [{ json: { candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }] } }],
  },
  {
    id: "gpt5-noproject-text",
    model: "gpt-5",
    message: "Explain reorder points briefly.",
    history: [],
    agentId: "inventory-strategist",
    projectTables: null,
    responses: [openaiText("A reorder point is the inventory level that triggers a replenishment order.")],
  },
  {
    id: "gpt5-project-toolcall",
    model: "gpt-5",
    message: "List the entities in this project.",
    history: [],
    agentId: "simulation-modeler",
    projectTables: { node_list: PROJECT_NODE_LIST },
    responses: [
      openaiToolCall("list_project_entities", { entity_type: "all" }),
      openaiText("The project has 2 suppliers, 1 material and 1 customer."),
    ],
  },
  {
    id: "deepseek-project-toolcall",
    model: "deepseek-chat",
    message: "Who supplies MAT-1?",
    history: [],
    agentId: "logistics-planner",
    projectTables: { node_list: PROJECT_NODE_LIST },
    responses: [
      openaiToolCall("list_project_entities", { entity_type: "supplier" }),
      openaiText("S1 and S2 are the registered suppliers."),
    ],
  },
  {
    id: "deepseek-history-clamp",
    model: "deepseek-chat",
    message: "Summarise our conversation so far.",
    history: [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "turn 2" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: LONG_TURN },
      { role: "user", content: "turn 5" },
      { role: "assistant", content: "turn 6" },
      { role: "user", content: "turn 7" },
      { role: "assistant", content: "turn 8" },
      { role: "user", content: "turn 9" },
      { role: "assistant", content: "turn 10" },
    ],
    agentId: null,
    projectTables: null,
    responses: [openaiText("We covered ten turns of lead-time discussion.")],
  },
];
