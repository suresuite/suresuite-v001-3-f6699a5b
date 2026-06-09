// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function runETLLogic(supabase: any, project_id: string, user_id: string, user_email: string) {
  try {
    console.log(`[combine-project] Starting ETL for project ${project_id}`);

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('organization, modeler_id, bom_level, plant_name')
      .eq('id', project_id)
      .single();

    if (projectError || !projectData) return { success: false, error: 'Project not found' };

    const { data: userData, error: userError } = await supabase
      .from('approved_users')
      .select('id, email, role, organization')
      .eq('id', user_id)
      .single();

    if (userError || !userData) return { success: false, error: 'User not found or not approved' };
    if (userData.organization !== projectData.organization) return { success: false, error: 'Forbidden: Organization mismatch' };
    if (projectData.modeler_id !== user_id && userData.role !== 'admin') return { success: false, error: 'Forbidden: Not project owner or admin' };

    // Clear existing data
    await supabase.from('supply_chain_data').delete().eq('project_id', project_id);
    await supabase.from('supply_chain_data_multi_tier').delete().eq('project_id', project_id);

    let totalInserted = 0;
    let scdOutboundCount = 0, scdBomCount = 0, scdInboundCount = 0;
    let mtOutboundCount = 0, mtBomCount = 0, mtInboundCount = 0;

    // --- FETCH CORE DATASETS UP FRONT ---
    
    // Fetch Outbound
    const { data: outboundData } = await supabase.from('outbound_logistics').select('*').eq('project_id', project_id);
    
    // Fetch Inbound (Moved to top)
    const { data: inboundData } = await supabase.from('inbound_logistics').select('*').eq('project_id', project_id);

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
        const volume = row.volume || 0;
        totalsByPlantProduct.set(key, (totalsByPlantProduct.get(key) || 0) + volume);
        productDemandByPlant.set(key, (productDemandByPlant.get(key) || 0) + volume);
      }

      const outboundInserts = outboundData.map(row => {
        const key = `${row.plant_name}::${row.product_id}`;
        const totalVolume = totalsByPlantProduct.get(key) || 0;
        const volume = row.volume || 0;
        return {
          project_id: project_id,
          data_source: 'outbound',
          plant_name: row.plant_name,
          from_location: row.product_id || '',
          to_location: row.customer_id || '',
          material_consumption_rate: volume,
          sourcing_ratio: totalVolume > 0 ? volume / totalVolume : 1.0,
          weighted: volume,
          uploaded_by: user_id,
          organization: projectData.organization
        };
      });

      await supabase.from('supply_chain_data').insert(outboundInserts);
      totalInserted += outboundInserts.length;
      scdOutboundCount += outboundInserts.length;
    }

    // Step 2: Process BOM Data
    const materialDemand = new Map<string, number>(); 
    let outboundTierInserts = []; 
    let bomTierInserts = [];      
    let inboundTierInserts = [];  
    let bomDataMulti = null; 

    // Product mapping
    const { data: productCodeMap } = await supabase.from('product_code_map').select('*').eq('project_id', project_id);
    const productMapping = new Map<string, string>();
    if (productCodeMap) {
      for (const mapping of productCodeMap) {
        productMapping.set(`${mapping.plant_name}::${mapping.outbound_product_code}`, mapping.bom_material_code);
      }
    }
    
    if (projectData.bom_level === 'single') {
      const { data: bomData } = await supabase.from('bom_single_level').select('*').eq('project_id', project_id);

      if (bomData && bomData.length > 0) {
        const bomInserts = bomData.map(row => {
          const mappedKey = `${row.plant_name}::${row.product_id}`;
          const mappedProduct = productMapping.get(mappedKey);
          let productDemand = mappedProduct 
            ? (productDemandByPlant.get(`${row.plant_name}::${mappedProduct}`) || 0)
            : (productDemandByPlant.get(mappedKey) || 0);
          
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

        await supabase.from('supply_chain_data').insert(bomInserts);
        totalInserted += bomInserts.length;
        scdBomCount += bomInserts.length;
      }
    } else {
      // Multi-level BOM Logic
      let bomData = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data } = await supabase
          .from('bom_multi_level')
          .select('*')
          .eq('project_id', project_id)
          .order('level', { ascending: false })
          .range(offset, offset + pageSize - 1);
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
            await supabase.from('supply_chain_data').insert(bomInserts);
            totalInserted += bomInserts.length;
            scdBomCount += bomInserts.length;
        }

        // Build Multi-Tier Edges for Interactive Space
        for (const row of outboundData || []) {
           outboundTierInserts.push({
             project_id: project_id, data_source: 'outbound', plant_name: row.plant_name,
             from_location: row.product_id || '', to_location: row.customer_id || '',
             level: 0, material_consumption_rate: row.volume || 0, sourcing_ratio: 1.0,
             weighted: row.volume || 0, path_root: row.product_id, uploaded_by: user_id, organization: projectData.organization
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
      const totalVolumeByPlantMaterial = new Map<string, number>();
      for (const row of inboundData) {
        const key = `${row.plant_name}::${row.material_id}`;
        const volume = row.volume || 0;
        totalVolumeByPlantMaterial.set(key, (totalVolumeByPlantMaterial.get(key) || 0) + volume);
      }

      const inboundInserts = inboundData.map(row => {
        const materialKey = `${row.plant_name}::${row.material_id}`;
        const totalMaterialVolume = totalVolumeByPlantMaterial.get(materialKey) || 0;
        const rowVolume = row.volume || 0;
        
        let sourcing_ratio = totalMaterialVolume > 0 ? rowVolume / totalMaterialVolume : 1.0;
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

      await supabase.from('supply_chain_data').insert(inboundInserts);
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
          const totalMaterialVolume = totalVolumeByPlantMaterial.get(materialKey) || 1;
          let sourcing_ratio = (row.volume || 0) / totalMaterialVolume;

          // FIX: Just use materialDemand directly
          const baseDemand = materialDemand.get(materialKey) || 0;

          inboundTierInserts.push({
             project_id: project_id, data_source: 'inbound', plant_name: row.plant_name,
             from_location: row.supplier_id || '', to_location: row.material_id || '',
             level: materialLevel + 1, material_consumption_rate: row.volume || 0, sourcing_ratio: sourcing_ratio,
             weighted: baseDemand * sourcing_ratio, path_root: row.material_id, uploaded_by: user_id, organization: projectData.organization
          });
        }
      }
    }

    // Insert multi-tier data by tier
    if (outboundTierInserts.length > 0) await supabase.from('supply_chain_data_multi_tier').insert(outboundTierInserts);
    if (bomTierInserts.length > 0) await supabase.from('supply_chain_data_multi_tier').insert(bomTierInserts);
    if (inboundTierInserts.length > 0) await supabase.from('supply_chain_data_multi_tier').insert(inboundTierInserts);

    return { 
      success: true, 
      total_records: totalInserted,
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
      return new Response(JSON.stringify({ success: true, message: 'Combine completed', project_id, total_records: etlResult.total_records, scd_breakdown: etlResult.scd_breakdown, multi_tier_breakdown: etlResult.multi_tier_breakdown }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Background task
    const backgroundTask = async () => {
      try {
        const etlResult = await runETLLogic(supabase, project_id, user_id, user_email);
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