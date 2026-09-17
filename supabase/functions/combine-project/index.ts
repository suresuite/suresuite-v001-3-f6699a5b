// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { weeklyVolume, weeklyVolumeTotalsBy, volumeShare, unitSubstitutions } from '../_shared/laneVolumes.ts';
import { sameOrganization } from '../_shared/orgIdentity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// D2 — every lane `volume` is a rate over its row's own `time_unit`. This ETL
// read them raw at all eight read sites, so sourcing shares were computed
// across incompatible units. Normalization is the engine's own rule and lives
// in ONE place: _shared/laneVolumes.ts, over _shared/grading.ts's unit table
// (invariant I3 — never a second copy here).

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
    // This runs as the service role, so it is the whole authorization.
    if (!sameOrganization(userData, projectData)) return { success: false, error: 'Forbidden: Organization mismatch' };
    if (projectData.modeler_id !== user_id && userData.role !== 'admin') return { success: false, error: 'Forbidden: Not project owner or admin' };

    // WP 4.1 — D36 CLOSED, AND THE REPLACE IS ATOMIC NOW.
    //
    // What stood here was `DELETE` on both tier-3 tables followed, hundreds of
    // lines later, by four `INSERT`s — each a separate PostgREST call. Two
    // things were wrong and only one of them was the audit:
    //   * a failure between the delete and the inserts left the project with NO
    //     ETL output at all, and the only symptom is a page that renders zero
    //     rows. Nothing retried and nothing said so;
    //   * every one of those statements wrote as the service role with no
    //     session context, so the audit rows recorded `actor_known: false`
    //     although `user_id` has been a parameter of this function all along.
    // The rows are accumulated here and written by `etl_replace_supply_chain`
    // in ONE transaction, with the actor as a parameter. See
    // `supabase/rehearsal/110` §7c, which reads the audit row back.
    const scdInserts: Record<string, unknown>[] = [];

    let totalInserted = 0;
    // Degradations the caller must be told about. §5 T2: a substitution is
    // visible at the point of display, not buried in a function log nobody
    // reads. These ride back on the response so the UI can surface them.
    const warnings: string[] = [];
    let scdOutboundCount = 0, scdBomCount = 0, scdInboundCount = 0;
    let mtOutboundCount = 0, mtBomCount = 0, mtInboundCount = 0;

    // --- FETCH CORE DATASETS UP FRONT ---
    
    // Fetch Outbound / Inbound. Both reads used to destructure only `{ data }`,
    // the same swallow as the `product_code_map` read D3 removed, but on the CORE
    // inputs: a failed read left the lane empty and the run reported success,
    // so the user got a graph missing half its arcs with nothing to explain it.
    // An empty lane is legitimate; a FAILED read is not, and the two must not
    // look identical. (D25 — found while fixing D3.)
    const { data: outboundData, error: outboundError } = await supabase.from('outbound_logistics').select('*').eq('project_id', project_id);
    const { data: inboundData, error: inboundError } = await supabase.from('inbound_logistics').select('*').eq('project_id', project_id);
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
    // day count that landed one column left, and until now each was read as a
    // weekly volume and displayed with nothing to say so: a §5 T1 breach (a number
    // whose source is a parse failure) and T2 (the substitution is invisible).
    //
    // NOTHING CAN ADD TO THAT POPULATION since WP 3.2 — `ingestValidate` refuses
    // an unrecognised token at ingestion — so this reports a closed and shrinking
    // set. An ABSENT unit is not reported: "absent means weekly" is an explicit
    // default the contract states, and T1 permits a default. It forbids a guess.
    for (const [lane, rows] of [['inbound_logistics', inboundData], ['outbound_logistics', outboundData]] as const) {
      for (const sub of unitSubstitutions(rows ?? [])) {
        warnings.push(
          `${lane}: ${sub.rows} row(s) carry time_unit "${sub.token}", which is not a unit this ` +
          `platform recognises. Their volumes were read as ${sub.assumed}ly. If "${sub.token}" is a ` +
          `lead time in days, the row's columns are shifted and the volume is wrong (PLAN.md §4 D46).`,
        );
      }
    }

    // Create strict validation sets
    const validOutboundProducts = new Set(outboundData?.map(r => `${r.plant_name}::${r.product_id}`) || []);
    const validInboundMaterials = new Set(inboundData?.map(r => `${r.plant_name}::${r.material_id}`) || []);

    // ------------------------------------

    // Step 1: Process Outbound Logistics
    const totalsByPlantProduct = new Map<string, number>();
    const productDemandByPlant = new Map<string, number>();
    
    if (outboundData && outboundData.length > 0) {
      for (const row of outboundData) {
        const key = `${row.plant_name}::${row.product_id}`;
        const volume = weeklyVolume(row);
        totalsByPlantProduct.set(key, (totalsByPlantProduct.get(key) || 0) + volume);
        productDemandByPlant.set(key, (productDemandByPlant.get(key) || 0) + volume);
      }

      const outboundInserts = outboundData.map(row => {
        const key = `${row.plant_name}::${row.product_id}`;
        const totalVolume = totalsByPlantProduct.get(key) || 0;
        const volume = weeklyVolume(row);
        return {
          project_id: project_id,
          data_source: 'outbound',
          plant_name: row.plant_name,
          from_location: row.product_id || '',
          to_location: row.customer_id || '',
          material_consumption_rate: volume,
          sourcing_ratio: volumeShare(volume, totalVolume),
          weighted: volume,
          uploaded_by: user_id,
          organization: projectData.organization
        };
      });

      scdInserts.push(...outboundInserts);
      totalInserted += outboundInserts.length;
      scdOutboundCount += outboundInserts.length;
    }

    // Step 2: Process BOM Data
    const materialDemand = new Map<string, number>(); 
    let outboundTierInserts = []; 
    let bomTierInserts = [];      
    let inboundTierInserts = [];  
    let bomDataMulti = null; 

    // Product mapping — DELETED in Phase 1 / WP 1.4 (D3 closed).
    //
    // `product_code_map` was read here to translate an outbound product code into
    // a BOM material code. The table exists in NO migration and never did, and
    // until WP 0.2 this read destructured only `{ data }`, so the "relation does
    // not exist" error was thrown away and the mapping stayed empty. The mapped
    // branch below has therefore NEVER EXECUTED — not once, in production or
    // anywhere else.
    //
    // WP 1.4's orphan reconciliation deleted it rather than writing the migration.
    // Creating the table would have meant inventing a feature: there is no upload
    // path for it, no UI that writes it, no template column, and no record of what
    // the two codes were supposed to mean to each other. A table whose only client
    // is an unreachable branch is a guess about a requirement, and the joined
    // behaviour it would switch on has never been observed by anyone.
    //
    // The unmapped path — `productDemandByPlant` keyed by the BOM's own
    // `product_id` — is what every project has always run. It is now the only
    // path, and it is written out rather than selected at runtime by a Map that
    // is always empty.
    //
    // If a project genuinely needs outbound codes to differ from BOM codes, that
    // is an ingestion-contract question (a declared alias column on an uploaded
    // table, Phase 3), not a silent lookup table. PLAN.md §4 D3 records this.
    
    if (projectData.bom_level === 'single') {
      const { data: bomData, error: bomError } = await supabase.from('bom_single_level').select('*').eq('project_id', project_id);
      if (bomError) {
        console.error(`[combine-project] bom_single_level read FAILED for project ${project_id}: ${bomError.message ?? bomError}`);
        return { success: false, error: `Could not read bom_single_level: ${bomError.message ?? bomError}` };
      }

      if (bomData && bomData.length > 0) {
        const bomInserts = bomData.map(row => {
          const mappedKey = `${row.plant_name}::${row.product_id}`;
          const productDemand = productDemandByPlant.get(mappedKey) || 0;

          const weighted = productDemand * (row.consumption_rate || 0);
          const materialKey = `${row.plant_name}::${row.material_id}`;
          materialDemand.set(materialKey, (materialDemand.get(materialKey) || 0) + weighted);

          return {
            project_id: project_id,
            data_source: 'bom',
            plant_name: row.plant_name,
            from_location: row.material_id || '',
            to_location: row.product_id || '',
            material_consumption_rate: row.consumption_rate || 0,
            sourcing_ratio: 1.0,
            weighted: weighted,
            uploaded_by: user_id,
            organization: projectData.organization
          };
        });

        scdInserts.push(...bomInserts);
        totalInserted += bomInserts.length;
        scdBomCount += bomInserts.length;
      }
    } else {
      // Multi-level BOM Logic
      let bomData = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data, error: bomMultiError } = await supabase
          .from('bom_multi_level')
          .select('*')
          .eq('project_id', project_id)
          .order('level', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (bomMultiError) {
          console.error(`[combine-project] bom_multi_level page at offset ${offset} FAILED for project ${project_id}: ${bomMultiError.message ?? bomMultiError}`);
          // A failed PAGE is worse than a failed read: the pages already
          // collected would be silently treated as the whole BOM.
          return { success: false, error: `Could not read bom_multi_level: ${bomMultiError.message ?? bomMultiError}` };
        }
        if (!data || data.length === 0) break;
        bomData = bomData.concat(data);
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      if (bomData.length > 0) {
        bomDataMulti = bomData;
        const demandByNodeAndRoot = new Map<string, Map<string, number>>();
        
        // Seed the root products from outbound data
        for (const [outboundKey, demand] of productDemandByPlant) {
          const [plant, productId] = outboundKey.split('::');
          if (!validOutboundProducts.has(outboundKey)) continue; 
          
          if (!demandByNodeAndRoot.has(outboundKey)) demandByNodeAndRoot.set(outboundKey, new Map());
          demandByNodeAndRoot.get(outboundKey)!.set(productId, demand);
        }

        // Propagate demand down the tree
        const levelsForDemand = [...new Set(bomDataMulti.map(row => row.level))].sort((a, b) => (a || 0) - (b || 0));
        for (const level of levelsForDemand) {
          const levelData = bomDataMulti.filter(row => row.level === level);
          for (const row of levelData) {
            const parentKey = `${row.plant_name}::${row.higher_level_component_id}`;
            const childKey = `${row.plant_name}::${row.material_id}`;
            const parentRoots = demandByNodeAndRoot.get(parentKey);
            
            if (parentRoots) {
              if (!demandByNodeAndRoot.has(childKey)) demandByNodeAndRoot.set(childKey, new Map());
              const childMap = demandByNodeAndRoot.get(childKey)!;
              const rate = row.consumption_rate || 0;
              
              let materialNeedTotal = 0;
              for (const [root, parentDemand] of parentRoots.entries()) {
                const required = parentDemand * rate;
                childMap.set(root, (childMap.get(root) || 0) + required);
                materialNeedTotal += required;
              }
              
              // Also keep materialDemand updated for inbound calculations later
              materialDemand.set(childKey, (materialDemand.get(childKey) || 0) + materialNeedTotal);
            }
          }
        }

        // Flat BOM Inserts (Direct Material -> Product)
        const bomInserts = [];
        for (const [nodeKey, rootsMap] of demandByNodeAndRoot.entries()) {
          if (!validInboundMaterials.has(nodeKey)) continue;

          const [plant, material_id] = nodeKey.split('::');

          for (const [rootProduct, totalDemand] of rootsMap.entries()) {
            const rootKey = `${plant}::${rootProduct}`;
            if (!validOutboundProducts.has(rootKey)) continue;

            if (totalDemand > 0) {
              bomInserts.push({
                project_id: project_id,
                data_source: 'bom',
                plant_name: plant,
                from_location: material_id,      
                to_location: rootProduct,        
                material_consumption_rate: 0,    
                sourcing_ratio: 1.0,
                weighted: totalDemand,           
                uploaded_by: user_id,
                organization: projectData.organization
              });
            }
          }
        }

        if (bomInserts.length > 0) {
            scdInserts.push(...bomInserts);
            totalInserted += bomInserts.length;
            scdBomCount += bomInserts.length;
        }

        // Build Multi-Tier Edges for Interactive Space
        for (const row of outboundData || []) {
           outboundTierInserts.push({
             project_id: project_id, data_source: 'outbound', plant_name: row.plant_name,
             from_location: row.product_id || '', to_location: row.customer_id || '',
             level: 0, material_consumption_rate: weeklyVolume(row), sourcing_ratio: 1.0,
             weighted: weeklyVolume(row), path_root: row.product_id, uploaded_by: user_id, organization: projectData.organization
           });
        }

        for (const level of levelsForDemand) {
          const levelData = bomDataMulti.filter(row => row.level === level);
          for (const row of levelData) {
            const childNodeKey = `${row.plant_name}::${row.material_id}`;
            const roots = demandByNodeAndRoot.get(childNodeKey);
            const rate = row.consumption_rate || 0;

            if (roots) {
                for(const [root, totalRootDemand] of roots.entries()){
                    // Reverse the rate out to find what the edge contribution was
                    const contrib = totalRootDemand; 
                    bomTierInserts.push({
                        project_id: project_id, data_source: 'bom', plant_name: row.plant_name,
                        from_location: row.material_id || '', to_location: row.higher_level_component_id || '',
                        level: row.level || 1, material_consumption_rate: rate, sourcing_ratio: 1.0,
                        weighted: contrib, path_root: root, uploaded_by: user_id, organization: projectData.organization
                    });
                }
            }
          }
        }
      }
    }

    // Step 3: Process Inbound Logistics
    if (inboundData && inboundData.length > 0) {
      const totalVolumeByPlantMaterial = weeklyVolumeTotalsBy(
        inboundData,
        (row) => `${row.plant_name}::${row.material_id}`,
      );

      const inboundInserts = inboundData.map(row => {
        const materialKey = `${row.plant_name}::${row.material_id}`;
        const totalMaterialVolume = totalVolumeByPlantMaterial.get(materialKey) || 0;
        const rowVolume = weeklyVolume(row);
        
        const sourcing_ratio = volumeShare(rowVolume, totalMaterialVolume);
        const weighted = (materialDemand.get(materialKey) || 0) * sourcing_ratio;

        return {
          project_id: project_id,
          data_source: 'inbound',
          plant_name: row.plant_name,
          from_location: row.supplier_id || '',
          to_location: row.material_id || '',
          material_consumption_rate: rowVolume,
          sourcing_ratio: sourcing_ratio,
          weighted: weighted,
          uploaded_by: user_id,
          organization: projectData.organization
        };
      });

      scdInserts.push(...inboundInserts);
      totalInserted += inboundInserts.length;
      scdInboundCount += inboundInserts.length;

      // Add Multi-Tier Inbound Edges
      if (projectData.bom_level === 'multi' && bomDataMulti && bomDataMulti.length > 0) {
        const materialLevels = new Map<string, number>();
        for (const row of bomDataMulti) {
          const key = `${row.plant_name}::${row.material_id}`;
          materialLevels.set(key, Math.max(materialLevels.get(key) || 0, Number.isFinite(row.level) ? row.level : 1));
        }

        for (const row of inboundData) {
          const materialKey = `${row.plant_name}::${row.material_id}`;
          const materialLevel = materialLevels.get(materialKey) || 1;
          const totalMaterialVolume = totalVolumeByPlantMaterial.get(materialKey) || 0;
          const rowVolume = weeklyVolume(row);
          const sourcing_ratio = volumeShare(rowVolume, totalMaterialVolume);

          // FIX: Just use materialDemand directly
          const baseDemand = materialDemand.get(materialKey) || 0;

          inboundTierInserts.push({
             project_id: project_id, data_source: 'inbound', plant_name: row.plant_name,
             from_location: row.supplier_id || '', to_location: row.material_id || '',
             level: materialLevel + 1, material_consumption_rate: rowVolume, sourcing_ratio: sourcing_ratio,
             weighted: baseDemand * sourcing_ratio, path_root: row.material_id, uploaded_by: user_id, organization: projectData.organization
          });
        }
      }
    }

    // ── the one write ────────────────────────────────────────────────────
    // Delete both tier-3 tables and insert everything, in one transaction, with
    // the actor named. The RPC also enforces project role >= editor, which a
    // service-role key made irrelevant on this path.
    const { data: etl, error: etlError } = await supabase.rpc('etl_replace_supply_chain', {
      _project_id: project_id,
      _actor_user_id: user_id,
      _rows: scdInserts,
      _multi_tier_rows: [...outboundTierInserts, ...bomTierInserts, ...inboundTierInserts],
    });
    if (etlError) return { success: false, error: `etl_replace_supply_chain: ${etlError.message}` };
    const etlCounts = etl as { deleted: number; inserted: number;
                               multi_tier_deleted: number; multi_tier_inserted: number };

    // THE COUNTS THE RESPONSE REPORTS ARE THE STATEMENT'S, not the array
    // lengths that were pushed. They can differ — a row the table refuses is a
    // row not written — and a count with no source is the defect §5 T1 names.
    if (etlCounts.inserted !== scdInserts.length) {
      warnings.push(
        `The ETL wrote ${etlCounts.inserted} of ${scdInserts.length} supply-chain rows. ` +
        `The difference was refused by the database, not dropped here.`,
      );
    }

    return { 
      success: true, 
      warnings,
      total_records: etlCounts.inserted,
      total_rows_built: totalInserted,
      multi_tier_written: etlCounts.multi_tier_inserted,
      scd_breakdown: { outbound: scdOutboundCount, bom: scdBomCount, inbound: scdInboundCount, total: scdOutboundCount + scdBomCount + scdInboundCount },
      multi_tier_breakdown: { outbound: outboundTierInserts.length, bom: bomTierInserts.length, inbound: inboundTierInserts.length, total: outboundTierInserts.length + bomTierInserts.length + inboundTierInserts.length },
      message: 'Project data combined successfully'
    };

  } catch (error) {
    console.error('[combine-project] ETL Error:', error);
    return { success: false, error: error.message };
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

    if (sync === true) {
      const etlResult = await runETLLogic(supabase, project_id, user_id, user_email);
      if (!etlResult.success) {
        return new Response(JSON.stringify({ success: false, error: etlResult.error }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      await supabase.rpc('refresh_node_list_for_project', { p_project_id: project_id });
      return new Response(JSON.stringify({ success: true, message: 'Combine completed', project_id, warnings: etlResult.warnings ?? [], total_records: etlResult.total_records, scd_breakdown: etlResult.scd_breakdown, multi_tier_breakdown: etlResult.multi_tier_breakdown }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Background task
    const backgroundTask = async () => {
      try {
        const etlResult = await runETLLogic(supabase, project_id, user_id, user_email);
        for (const w of etlResult.warnings ?? []) console.warn(`[combine-project] ${w}`);
        if (etlResult.success) await supabase.rpc('refresh_node_list_for_project', { p_project_id: project_id });
      } catch (error) {
        console.error(`[combine-project] Background task failed:`, error);
      }
    };

    EdgeRuntime.waitUntil(backgroundTask());
    return new Response(JSON.stringify({ success: true, message: 'Combine process started', project_id }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: `Function error: ${error.message}`}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});