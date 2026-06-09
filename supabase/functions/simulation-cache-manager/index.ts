import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CacheRequest {
  action: 'get' | 'set' | 'invalidate' | 'cleanup' | 'stats';
  project_id: string;
  cache_key?: string;
  cache_type?: 'baseline_data' | 'scenario_data' | 'network_analysis' | 'risk_factors';
  data?: any;
  ttl_hours?: number;
  user_id: string;
  user_email: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const {
      action,
      project_id,
      cache_key,
      cache_type,
      data,
      ttl_hours = 24,
      user_id,
      user_email
    }: CacheRequest = await req.json();

    // Set user context for RLS
    await supabase.rpc('set_current_user_context', {
      user_id,
      user_email
    });

    let result = null;

    switch (action) {
      case 'get':
        result = await getCacheData(supabase, project_id, cache_key!);
        break;
      case 'set':
        result = await setCacheData(supabase, project_id, cache_key!, cache_type!, data, ttl_hours);
        break;
      case 'invalidate':
        result = await invalidateCache(supabase, project_id, cache_key);
        break;
      case 'cleanup':
        result = await cleanupExpiredCache(supabase, project_id);
        break;
      case 'stats':
        result = await getCacheStats(supabase, project_id);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        result
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[simulation-cache-manager] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function getCacheData(supabase: any, projectId: string, cacheKey: string) {
  const { data, error } = await supabase
    .from('simulation_cache')
    .select('*')
    .eq('project_id', projectId)
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
    throw new Error(`Cache lookup failed: ${error.message}`);
  }

  if (data) {
    // Update access statistics
    await supabase
      .from('simulation_cache')
      .update({
        access_count: data.access_count + 1,
        last_accessed_at: new Date().toISOString()
      })
      .eq('id', data.id);

    return {
      found: true,
      data: data.data,
      cache_info: {
        created_at: data.created_at,
        expires_at: data.expires_at,
        access_count: data.access_count + 1,
        data_version: data.data_version
      }
    };
  }

  return { found: false };
}

async function setCacheData(
  supabase: any, 
  projectId: string, 
  cacheKey: string, 
  cacheType: string, 
  data: any, 
  ttlHours: number
) {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const dataHash = generateDataHash(data);

  const { data: cacheRecord, error } = await supabase
    .from('simulation_cache')
    .upsert({
      project_id: projectId,
      cache_key: cacheKey,
      cache_type: cacheType,
      data: data,
      data_hash: dataHash,
      expires_at: expiresAt,
      access_count: 0,
      data_version: 1
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Cache set failed: ${error.message}`);
  }

  return {
    cached: true,
    cache_id: cacheRecord.id,
    expires_at: expiresAt,
    data_hash: dataHash
  };
}

async function invalidateCache(supabase: any, projectId: string, cacheKey?: string) {
  let query = supabase.from('simulation_cache').delete().eq('project_id', projectId);
  
  if (cacheKey) {
    query = query.eq('cache_key', cacheKey);
  }

  const { error, count } = await query;

  if (error) {
    throw new Error(`Cache invalidation failed: ${error.message}`);
  }

  return {
    invalidated: true,
    records_deleted: count || 0
  };
}

async function cleanupExpiredCache(supabase: any, projectId?: string) {
  let query = supabase
    .from('simulation_cache')
    .delete()
    .lt('expires_at', new Date().toISOString());

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { error, count } = await query;

  if (error) {
    throw new Error(`Cache cleanup failed: ${error.message}`);
  }

  return {
    cleaned_up: true,
    expired_records_deleted: count || 0
  };
}

async function getCacheStats(supabase: any, projectId: string) {
  // Get cache statistics
  const { data: stats, error: statsError } = await supabase
    .from('simulation_cache')
    .select('cache_type, access_count, created_at, expires_at')
    .eq('project_id', projectId);

  if (statsError) {
    throw new Error(`Cache stats failed: ${statsError.message}`);
  }

  const now = new Date();
  const totalEntries = stats?.length || 0;
  const expiredEntries = stats?.filter(entry => new Date(entry.expires_at) < now).length || 0;
  const activeEntries = totalEntries - expiredEntries;

  // Group by cache type
  const typeStats = stats?.reduce((acc: any, entry: any) => {
    if (!acc[entry.cache_type]) {
      acc[entry.cache_type] = {
        count: 0,
        total_access: 0,
        active: 0,
        expired: 0
      };
    }
    
    acc[entry.cache_type].count++;
    acc[entry.cache_type].total_access += entry.access_count;
    
    if (new Date(entry.expires_at) > now) {
      acc[entry.cache_type].active++;
    } else {
      acc[entry.cache_type].expired++;
    }
    
    return acc;
  }, {}) || {};

  // Calculate total access count
  const totalAccess = stats?.reduce((sum: number, entry: any) => sum + entry.access_count, 0) || 0;

  return {
    summary: {
      total_entries: totalEntries,
      active_entries: activeEntries,
      expired_entries: expiredEntries,
      total_access_count: totalAccess,
      cache_efficiency: totalEntries > 0 ? (totalAccess / totalEntries).toFixed(2) : '0.00'
    },
    by_type: typeStats,
    project_id: projectId
  };
}

function generateDataHash(data: any): string {
  // Simple hash function for cache validation
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}