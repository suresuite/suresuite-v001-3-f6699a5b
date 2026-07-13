// §17.3 suggested-actions golden suite, deterministic tier: each sug-*
// fixture drives the REAL buildSuggestions over the stub project store,
// asserting the normative v0 rule order (data gaps > validation > experiments
// > reports > memory hygiene), the ≤4 cap, the {label, utterance, agent_hint,
// reason} shape, and the two honesty rules (capability filter; ask-mode
// "switch to Review" phrasing). No LLM, no network, no DB.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";
import {
  buildSuggestions,
  MAX_SUGGESTIONS,
  SUGGESTION_RULE_ORDER,
  suggestionsEnabled,
  type SuggestionCaller,
} from "../suggestions.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";

interface Fixture {
  id: string;
  description: string;
  project_snapshot: Record<string, Row[]> | { reuse: string; patch?: Record<string, Row[]> };
  caller: SuggestionCaller & { features: Record<string, boolean> };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

/** Fixture loader with cross-suite reuse: suggestions fixtures may build on
 * the experiment-designer project snapshots (one complete-project seed). */
async function loadFixture(id: string): Promise<Fixture> {
  let text: string;
  try {
    text = await Deno.readTextFile(new URL(`./fixtures/suggestions/${id}.json`, import.meta.url));
  } catch {
    text = await Deno.readTextFile(new URL(`./fixtures/experiment-designer/${id}.json`, import.meta.url));
  }
  const f: Fixture = JSON.parse(text);
  if ("reuse" in f.project_snapshot) {
    const spec = f.project_snapshot as { reuse: string; patch?: Record<string, Row[]> };
    const base = await loadFixture(spec.reuse);
    f.project_snapshot = {
      ...(base.project_snapshot as Record<string, Row[]>),
      ...(spec.patch ?? {}),
    };
  }
  return f;
}

async function runFixture(id: string) {
  const fixture = await loadFixture(id);
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const suggestions = await buildSuggestions(db, PROJECT, fixture.caller);
  return { fixture, suggestions };
}

Deno.test("sug-01-gap-driven: data gaps rank first; ≤4; every entry carries the §17.3 shape", async () => {
  const { fixture, suggestions } = await runFixture("sug-01-gap-driven");
  assert(suggestions.length >= 1, "gaps must produce a suggestion");
  assert(suggestions.length <= fixture.expect.max_count);
  assertEquals(suggestions[0].rule, fixture.expect.first_rule);
  assertEquals(suggestions[0].agent_hint, "data-steward");
  for (const s of suggestions) {
    for (const key of fixture.expect.shape_keys as string[]) {
      assert(key in s, `suggestion missing "${key}"`);
    }
    assert(s.label.length > 0 && s.utterance.length > 0 && s.reason.length > 0);
  }
  // Rule order is normative: the returned rules appear in SUGGESTION_RULE_ORDER order.
  const idx = suggestions.map((s) => SUGGESTION_RULE_ORDER.indexOf(s.rule));
  assertEquals([...idx].sort((a, b) => a - b), idx, "rule order preserved");
});

Deno.test("sug-02-validation-driven: completed run + no active card ⇒ validation leads; experiment follows", async () => {
  const { fixture, suggestions } = await runFixture("sug-02-validation-driven");
  assertEquals(suggestions[0].rule, fixture.expect.first_rule);
  const rules = suggestions.map((s) => s.rule);
  for (const r of fixture.expect.rules_include as string[]) {
    assert(rules.includes(r as typeof rules[number]), `expected rule ${r} in ${rules}`);
  }
  for (const r of fixture.expect.rules_exclude as string[]) {
    assert(!rules.includes(r as typeof rules[number]), `rule ${r} must not fire`);
  }
});

Deno.test("sug-03-no-data-project: an empty project produces no invented guidance (and no crash)", async () => {
  const { fixture, suggestions } = await runFixture("sug-03-no-data-project");
  assertEquals(suggestions.length, fixture.expect.count);
});

Deno.test("sug-04-capability-filtered: never suggest what the caller cannot do", async () => {
  const { fixture, suggestions } = await runFixture("sug-04-capability-filtered");
  assertEquals(suggestions[0]?.rule, fixture.expect.first_rule);
  const rules = suggestions.map((s) => s.rule);
  for (const r of fixture.expect.rules_exclude as string[]) {
    assert(!rules.includes(r as typeof rules[number]), `rule ${r} must be capability-filtered out`);
  }
});

Deno.test("sug-05-ask-mode: Review-only actions in an Ask thread say 'switch to Review'", async () => {
  const { fixture, suggestions } = await runFixture("sug-05-ask-mode");
  assert(suggestions.length >= 1);
  assertEquals(suggestions[0].rule, fixture.expect.first_rule);
  for (const s of suggestions) {
    if (s.rule === "data_gaps" || s.rule === "validation" || s.rule === "experiment") {
      assertStringIncludes(
        `${s.label} ${s.reason}`,
        fixture.expect.every_draft_suggestion_mentions,
        `§17.3 honesty rule on ${s.rule}`,
      );
    }
  }
});

Deno.test("memory-hygiene rule: an applied proposal + memory on ⇒ the save-decision chip, last", async () => {
  const fixture = await loadFixture("sug-01-gap-driven");
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  tables.proposals = [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    project_id: PROJECT,
    agent_id: "policy-configurator",
    artifact_type: "policy_bundle_diff",
    title: "Set 95% service level on A-class materials",
    status: "applied",
    applied_at: 200,
  }];
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const suggestions = await buildSuggestions(db, PROJECT, {
    ...fixture.caller,
    memoryOn: true,
    features: { ...fixture.caller.features, project_memory: true },
  });
  const memory = suggestions.find((s) => s.rule === "memory_hygiene");
  assert(memory, "memory-hygiene chip offered after an applied decision");
  assertStringIncludes(memory!.utterance, "Remember that we applied");
  assertEquals(suggestions[suggestions.length - 1].rule, "memory_hygiene", "memory ranks last (§17.3)");
  assert(suggestions.length <= MAX_SUGGESTIONS);
});

Deno.test("flag: SUGGESTED_ACTIONS_ENABLED default off (§9 conventions)", () => {
  Deno.env.delete("SUGGESTED_ACTIONS_ENABLED");
  assertEquals(suggestionsEnabled(), false);
  Deno.env.set("SUGGESTED_ACTIONS_ENABLED", "true");
  assertEquals(suggestionsEnabled(), true);
  Deno.env.delete("SUGGESTED_ACTIONS_ENABLED");
});
