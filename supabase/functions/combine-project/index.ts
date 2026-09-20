// @ts-nocheck
import { completeRun, failRun, getOrStart } from "../_shared/analysisStore.ts";
import type { RunHandle, StoreClient } from "../_shared/analysisStore.ts";

/** WP 4.3 · part of the store's key. Bump when the ETL changes what it writes. */
const COMBINE_CODE_VERSION = 'combine_etl@wp43.1';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { unitSubstitutions } from '../_shared/laneVolumes.ts';
import { sameOrganization } from '../_shared/orgIdentity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// D2 — every lane `volume` is a rate over its row's own `time_unit`. This ETL
// read them raw at all eight read sites, so sourcing shares were computed
// across incompatible units. WP 8.2 moved the arithmetic into the database, so
// the conversion is now `rate_to_weekly` inside `rebuild_supply_chain_lanes` —
// the SAME rule over the SAME unit table (invariant I3, one UNIT_DAYS). What is
// left here is `unitSubstitutions`, which does not convert: it REPORTS which
// tokens the platform did not recognise, so the UI can say so (§5 T2).

/**
 * WP 8.2 · §4 D140 — THE LANE BUILD IS GONE FROM HERE.
 *
 * This function used to compute both edge tables itself: an outbound pass, a
 * single-level or multi-level BOM branch, a demand walk, a flat projection, a
 * deep-tier projection and an inbound pass, ~270 lines, ending in one call to
 * `etl_replace_supply_chain`. `combine_project_into_supply_chain` — a SQL RPC —
 * did the same job by a DIFFERENT set of rules, and both were live: this
 * function is invoked by the Combine button (`DataManager.tsx`), the RPC by the
 * `projects` completion trigger and three other client sites.
 *
 * TWO WRITERS OF ONE TABLE THAT DISAGREE ABOUT WHAT A COLUMN MEANS IS NOT A
 * REDUNDANCY, IT IS §4 D140: the RPC wrote `supply_chain_data_multi_tier.level`
 * as a literal 2 for every BOM row and this function wrote the BOM's own depth,
 * so you could tell which writer had last run a project by looking at its level
 * histogram — and no reader could be correct for both.
 *
 * WHY THE RPC WON AND NOT THIS FUNCTION. `combine_project_into_supply_chain` is
 * reached by a DATABASE TRIGGER as well as by clients, and a trigger cannot call
 * an edge function; D142's rebuild-on-source-change needs a trigger too. A
 * derivation over tier-2 tables belongs in the database (`no-tier-skip`, I2).
 * The full argument is in `20260920000003_one_etl.sql`.
 *
 * WHAT THIS FUNCTION STILL DOES, AND WHY IT IS NOT DELETED. It owns two things
 * the RPC cannot: the `combine_etl` RUN in the analysis store (WP 4.3), and the
 * D46 unit-substitution WARNINGS, which ride back on the response so the UI can
 * surface them at the point of display (§5 T2 — a substitution is visible where
 * it is used, not in a function log). It reads the two lane tables for the
 * warnings and for nothing else; the write is one RPC call.
 */
async function runETLLogic(supabase: any, project_id: string, user_id: string, user_email: string) {
  try {
    console.log(`[combine-project] Starting ETL for project ${project_id}`);

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('organization, organization_id, modeler_id, bom_level, plant_name')
      .eq('id', project_id)
      .single();

    if (projectError || !projectData) return { success: false, error: 'Project not found' };

    const { data: userData, error: userError } = await supabase
      .from('approved_users')
      .select('id, email, role, organization, organization_id')
      .eq('id', user_id)
      .single();

    if (userError || !userData) return { success: false, error: 'User not found or not approved' };
    // D13: the uuid plane when both sides carry one, text as the fallback.
    //
    // KEPT, although the RPC now re-checks the same predicate. This function runs
    // as the SERVICE ROLE, so without this the HTTP endpoint would be open to any
    // caller holding the anon key and the only check would be the one the RPC
    // performs under `set_current_user_context(user_id, …)` — a context this
    // function supplies. A gate you hand the answer to is not a gate.
    if (!sameOrganization(userData, projectData)) return { success: false, error: 'Forbidden: Organization mismatch' };
    if (projectData.modeler_id !== user_id && userData.role !== 'admin') return { success: false, error: 'Forbidden: Not project owner or admin' };

    // Product mapping — DELETED in Phase 1 / WP 1.4 (D3), and the note stays.
    //
    // `product_code_map` was read here to translate an outbound product code into
    // a BOM material code. The table exists in NO migration and never did, and
    // until WP 0.2 this read destructured only `{ data }`, so the "relation does
    // not exist" error was thrown away and the mapping stayed empty. The mapped
    // branch it selected had therefore NEVER EXECUTED — not once, in production
    // or anywhere else.
    //
    // A deletion with no record invites the next person to re-add it, which is
    // how the branch survived unexecuted for as long as it did — so the record
    // outlives the code, and `loudFailure.test.ts` fails if it goes. If a project
    // genuinely needs outbound codes to differ from BOM codes, that is an
    // ingestion-contract question (a declared alias column on an uploaded table,
    // Phase 3), not a silent lookup table. The lane build that held the branch is
    // itself gone now (WP 8.2, §4 D140); the reason it must not come back is not.

    // Degradations the caller must be told about. §5 T2: a substitution is
    // visible at the point of display, not buried in a function log nobody
    // reads. These ride back on the response so the UI can surface them.
    const warnings: string[] = [];

    // Read the two lane tables FOR THE WARNINGS ONLY. Both reads used to
    // destructure `{ data }` alone, the same swallow D3 removed, on the CORE
    // inputs — a failed read left the lane empty and the run reported success
    // (D25). The lane build has moved into the database, but a failed read here
    // still means the warnings are computed over a set that is not the data, so
    // it is still an error and still not an empty lane.
    const { data: outboundData, error: outboundError } = await supabase.from('outbound_logistics').select('volume, time_unit').eq('project_id', project_id);
    const { data: inboundData, error: inboundError } = await supabase.from('inbound_logistics').select('volume, time_unit').eq('project_id', project_id);
    if (outboundError) {
      console.error(`[combine-project] outbound_logistics read FAILED for project ${project_id}: ${outboundError.message ?? outboundError}`);
      return { success: false, error: `Could not read outbound_logistics: ${outboundError.message ?? outboundError}` };
    }
    if (inboundError) {
      console.error(`[combine-project] inbound_logistics read FAILED for project ${project_id}: ${inboundError.message ?? inboundError}`);
      return { success: false, error: `Could not read inbound_logistics: ${inboundError.message ?? inboundError}` };
    }

    // D46's READER HALF (WP 3.3). Every lane row whose `time_unit` this platform
    // does not recognise is still computed on the 7-day basis — the value is
    // usable and refusing it would blank rows whose owners did not cause the
    // defect — but it is NO LONGER SILENT. §15 counts 27 such tokens already in
    // tier 2 (`21`, `15`, `7`, `14`, …), each of them almost certainly a lead-time
    // day count that landed one column left.
    //
    // NOTHING CAN ADD TO THAT POPULATION since WP 3.2 — `ingestValidate` refuses
    // an unrecognised token at ingestion — so this reports a closed and shrinking
    // set. An ABSENT unit is not reported: "absent means weekly" is an explicit
    // default the contract states, and T1 permits a default. It forbids a guess.
    //
    // The DATABASE now performs the conversion these warnings describe:
    // `rebuild_supply_chain_lanes` calls `rate_to_weekly` at every volume read,
    // which is the same rule as `_shared/laneVolumes.ts` over the same unit table
    // (I3 — one UNIT_DAYS, never a second copy). Before WP 8.2 the deployed SQL
    // writer did no conversion at all (§4 D148), so these warnings described a
    // normalization that only one of the two ETLs performed.
    for (const [lane, rows] of [['inbound_logistics', inboundData], ['outbound_logistics', outboundData]] as const) {
      for (const sub of unitSubstitutions(rows ?? [])) {
        warnings.push(
          `${lane}: ${sub.rows} row(s) carry time_unit "${sub.token}", which is not a unit this ` +
          `platform recognises. Their volumes were read as ${sub.assumed}ly. If "${sub.token}" is a ` +
          `lead time in days, the row's columns are shifted and the volume is wrong (PLAN.md §4 D46).`,
        );
      }
    }

    // ── the one write ────────────────────────────────────────────────────
    //
    // ONE CALL, and the actor is a parameter of it. The RPC authorizes under
    // `set_current_user_context(p_user_id, p_user_email)` and delegates to
    // `rebuild_supply_chain_lanes`, which names the actor on every tier-3
    // statement (`audit-actor`, G4) — the property WP 4.1 gave this path and
    // which moving the write must not lose. `rehearsal/310` §10 reads the audit
    // row back with the session actor deliberately blanked first.
    const { error: combineError } = await supabase.rpc('combine_project_into_supply_chain', {
      p_project_id: project_id,
      p_user_id: user_id,
      p_user_email: user_email,
    });
    if (combineError) {
      console.error(`[combine-project] combine_project_into_supply_chain FAILED for project ${project_id}: ${combineError.message ?? combineError}`);
      return { success: false, error: `combine_project_into_supply_chain: ${combineError.message ?? combineError}` };
    }

    // THE COUNTS THE RESPONSE REPORTS ARE THE TABLE'S, read back after the write,
    // not array lengths accumulated on the way in. A count with no source is the
    // defect §5 T1 names, and the arrays no longer exist here to count.
    const { count: scdCount } = await supabase
      .from('supply_chain_data')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project_id);
    const { count: mtCount } = await supabase
      .from('supply_chain_data_multi_tier')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project_id);

    return {
      success: true,
      warnings,
      total_records: scdCount ?? 0,
      multi_tier_written: mtCount ?? 0,
      message: 'Project data combined successfully'
    };

  } catch (error) {
    console.error('[combine-project] ETL Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * WP 4.3 · the run around the ETL.
 *
 * NEVER FATAL. `combine-project` is on the critical path of every upload, and a
 * store that cannot be reached must not stop a user combining their project —
 * the honest consequence of a failure here is an ETL run with no provenance,
 * which is exactly the state that existed before this package and is strictly
 * better than a broken upload. It is logged, not swallowed silently.
 */
async function startCombineRun(supabase: StoreClient, project_id: string, user_id: string): Promise<RunHandle | null> {
  try {
    return await getOrStart(supabase, {
      projectId: project_id,
      analysisKind: 'combine_etl',
      params: {},
      codeVersion: COMBINE_CODE_VERSION,
      actorUserId: user_id,
    });
  } catch (e) {
    console.warn('[combine-project] could not register a combine_etl run:', e);
    return null;
  }
}

async function finishCombineRun(
  supabase: StoreClient, run: RunHandle | null, user_id: string,
  etlResult: Record<string, unknown>,
) {
  // A HIT IS NOT COMPLETED AGAIN. WP 4.2 refuses a second `analysis_complete_run`
  // on a finished run — the answer is frozen — so re-completing would raise on a
  // path that has already succeeded.
  if (!run || run.cacheHit) return;
  try {
    await completeRun(
      supabase, run.runId, user_id,
      [],   // the output is `supply_chain_data`, not per-entity metric rows
      {
        total_records: etlResult.total_records ?? 0,
        // WP 8.2: the per-lane breakdowns were counters on the arrays this
        // function used to accumulate. It no longer builds the rows, so it
        // cannot count them by lane without asking the database three more
        // questions for a figure nothing reads. The totals are read back from
        // the tables and are real; an absent breakdown is better than one
        // inferred, which is §5 T1.
        total_multi_tier: etlResult.multi_tier_written ?? 0,
      },
      ((etlResult.warnings as unknown[]) ?? []).map((w: unknown) => ({ code: 'etl_warning', message: String(w) })),
    );
  } catch (e) {
    console.warn('[combine-project] could not complete the combine_etl run:', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, user_id, user_email, sync } = await req.json();

    if (!project_id || !user_id || !user_email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // ── WP 4.3 · `combine_etl` — an analysis in everything but name (§11) ──
    //
    // IT REGISTERS A RUN AND IT DOES NOT SKIP ON A HIT, and the second half is a
    // deliberate limit on this package rather than an oversight. `combine_etl`'s
    // OUTPUT is `supply_chain_data` — rows in a table, not entries in
    // `analysis_results` — so "already computed" here means "those rows are
    // still there", which the store cannot see. A row deleted by hand would
    // make a hit skip an ETL the project genuinely needs. What the run DOES buy
    // today is identity: the ETL's output can finally be attributed to the
    // world and the code that produced it. WP 4.4 owns staleness and is the
    // package that may turn a hit into a skip.
    const combineRun = await startCombineRun(supabase, project_id, user_id);

    if (sync === true) {
      const etlResult = await runETLLogic(supabase, project_id, user_id, user_email);
      if (!etlResult.success) {
        if (combineRun && !combineRun.cacheHit) {
          await failRun(supabase, combineRun.runId, user_id,
            [{ code: 'etl_failed', message: etlResult.error }]);
        }
        return new Response(JSON.stringify({ success: false, error: etlResult.error }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      await finishCombineRun(supabase, combineRun, user_id, etlResult);

      // WP 4.3 · the two-argument overload names the actor, so the `node_list`
      // writes audit as a person rather than as `actor_known: false`. The actor
      // has been a parameter of this function all along; nothing told the
      // trigger (same shape as `assign_material_supplier`, WP 3.3).
      await supabase.rpc('refresh_node_list_for_project',
        { p_project_id: project_id, p_actor_user_id: user_id });
      return new Response(JSON.stringify({ success: true, message: 'Combine completed', project_id, warnings: etlResult.warnings ?? [], total_records: etlResult.total_records, multi_tier_written: etlResult.multi_tier_written }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Background task
    const backgroundTask = async () => {
      try {
        const etlResult = await runETLLogic(supabase, project_id, user_id, user_email);
        for (const w of etlResult.warnings ?? []) console.warn(`[combine-project] ${w}`);
        if (etlResult.success) {
          await finishCombineRun(supabase, combineRun, user_id, etlResult);
          await supabase.rpc('refresh_node_list_for_project',
            { p_project_id: project_id, p_actor_user_id: user_id });
        } else if (combineRun && !combineRun.cacheHit) {
          await failRun(supabase, combineRun.runId, user_id,
            [{ code: 'etl_failed', message: etlResult.error }]);
        }
      } catch (error) {
        console.error(`[combine-project] Background task failed:`, error);
        if (combineRun && !combineRun.cacheHit) {
          await failRun(supabase, combineRun.runId, user_id,
            [{ code: 'etl_threw', message: String(error) }]);
        }
      }
    };

    EdgeRuntime.waitUntil(backgroundTask());
    return new Response(JSON.stringify({ success: true, message: 'Combine process started', project_id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: `Function error: ${error.message}`}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});