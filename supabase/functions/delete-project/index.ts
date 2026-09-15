// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { sameOrganization } from '../_shared/orgIdentity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, userId, userEmail, force } = await req.json();

    if (!projectId || !userId || !userEmail) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Background deletion to avoid timeouts
    EdgeRuntime.waitUntil((async () => {
      const BATCH_SIZE = 200;
      const MAX_RETRIES = 3;

      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

      async function withRetry<T>(fn: () => Promise<T>, label: string, attempt = 1): Promise<T> {
        try {
          return await fn();
        } catch (err) {
          console.error(`[delete-project] ${label} failed (attempt ${attempt})`, err);
          if (attempt >= MAX_RETRIES) throw err;
          await sleep(250 * Math.pow(2, attempt - 1));
          return withRetry(fn, label, attempt + 1);
        }
      }

      async function authorize() {
        // Fetch project
        const { data: project, error: projErr } = await withRetry(
          () => supabaseAdmin
            .from('projects')
            .select('id, organization, organization_id, modeler_id')
            .eq('id', projectId)
            .single(),
          'load project'
        );
        if (projErr || !project) throw new Error(`project_not_found: ${projErr?.message ?? ''}`);

        // Fetch user
        const { data: user, error: userErr } = await withRetry(
          () => supabaseAdmin
            .from('approved_users')
            .select('id, role, organization, organization_id')
            .eq('id', userId)
            .single(),
          'load user'
        );
        if (userErr || !user) throw new Error(`user_not_found: ${userErr?.message ?? ''}`);

        const isOwner = project.modeler_id === userId;
        const isAdmin = (user.role === 'admin');
        // D13: the uuid plane when both sides carry one, text as the fallback.
        // This runs as the service role, so it is the whole authorization.
        const sameOrg = sameOrganization(project, user);
        if (!sameOrg || !(isOwner || isAdmin)) {
          throw new Error('forbidden: user not allowed to delete project');
        }

        return { project, user } as const;
      }

      async function deleteByIds(table: string, idColumn: string, ids: string[]) {
        if (ids.length === 0) return;
        await withRetry(
          () => supabaseAdmin.from(table).delete().in(idColumn, ids),
          `delete batch from ${table} (${ids.length})`
        );
      }

      async function deleteTableByProjectId(table: string) {
        let total = 0;
        for (;;) {
          const { data: rows, error } = await withRetry(
            () => supabaseAdmin
              .from(table)
              .select('id')
              .eq('project_id', projectId)
              .order('id', { ascending: true })
              .limit(BATCH_SIZE),
            `select batch from ${table}`
          );
          if (error) throw error;
          const ids = (rows ?? []).map((r: any) => r.id);
          if (!ids.length) break;
          await deleteByIds(table, 'id', ids);
          total += ids.length;
          console.log(`[delete-project] ${table}: deleted ${total} so far`);
        }
      }

      async function deleteDisruptionProfilesAndChildren() {
        for (;;) {
          const { data: profiles, error: profErr } = await withRetry(
            () => supabaseAdmin
              .from('disruption_scenario_profiles')
              .select('id')
              .eq('project_id', projectId)
              .order('id', { ascending: true })
              .limit(BATCH_SIZE),
            'select disruption profiles batch'
          );
          if (profErr) throw profErr;
          const profileIds = (profiles ?? []).map((r: any) => r.id);
          if (!profileIds.length) break;

          // Delete children
          for (const child of [
            'disruption_scenario_effects',
            'disruption_scenario_settings',
            'disruption_scenario_targets',
          ]) {
            await withRetry(
              () => supabaseAdmin.from(child).delete().in('profile_id', profileIds),
              `delete child ${child} (${profileIds.length} profiles)`
            );
          }

          // Delete profiles
          await deleteByIds('disruption_scenario_profiles', 'id', profileIds);
          console.log(`[delete-project] disruption profiles: deleted ${profileIds.length}`);
        }
      }

      try {
        console.log('[delete-project] Authorization start', { projectId, userId, force });
        await authorize();

        console.log('[delete-project] Deleting related data in batches (force:', force, ')');

        // 1) Simulation results (if any)
        await deleteTableByProjectId('simulation_results');

        // 2) Disruption scenarios (v2 profile model)
        await deleteDisruptionProfilesAndChildren();

        // 3) Deep-tier network data
        await deleteTableByProjectId('network_edges');
        await deleteTableByProjectId('network_nodes');

        // 4) Derived node list
        await deleteTableByProjectId('node_list');

        // 5) Combined supply chain data
        await deleteTableByProjectId('supply_chain_data');

        // 6) Source datasets and related tables
        // If "force" or complex, we make sure to clear all regardless
        await deleteTableByProjectId('inbound_logistics');
        await deleteTableByProjectId('outbound_logistics');
        await deleteTableByProjectId('bom_multi_level');
        await deleteTableByProjectId('bom_single_level');
        await deleteTableByProjectId('multi_tier_supply_chain');
        // `product_code_map` was deleted here in Phase 1 / WP 1.4 (D3): the table
        // exists in no migration, so this call could only ever fail. A delete of a
        // table that does not exist is not harmless bookkeeping — it is a line
        // that makes the list look complete.
        await deleteTableByProjectId('supply_chain_data_multi_tier');

        // 7) Views and legacy tables (if present in older data)
        // Note: simulation_result_scenarios is a view, may not need deletion
        try {
          await deleteTableByProjectId('simulation_result_scenarios');
        } catch (e) {
          console.log('[delete-project] simulation_result_scenarios skip (likely a view):', String(e?.message || e));
        }

        let legacyDone = false;
        try {
          await deleteTableByProjectId('disruption_scenarios');
          legacyDone = true;
        } catch (e) {
          console.log('[delete-project] legacy disruption_scenarios skip or error:', String(e?.message || e));
        }

        console.log('[delete-project] All related data deleted. Removing project row...');
        await withRetry(
          () => supabaseAdmin.from('projects').delete().eq('id', projectId),
          'delete project row'
        );

        console.log('[delete-project] Project deleted successfully', projectId, { legacyDone });
      } catch (e) {
        console.error('[delete-project] Background deletion failed', e);
      }
    })());

    return new Response(JSON.stringify({ success: true, message: 'Deletion started' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[delete-project] Request handling error', error);
    return new Response(JSON.stringify({ success: false, error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
